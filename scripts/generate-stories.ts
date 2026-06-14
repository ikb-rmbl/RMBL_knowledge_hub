/**
 * Generate Stories — short literary fiction grounded in scenarios.
 *
 * Pipeline analogous to scripts/generate-scenarios.ts, but smaller and
 * literary in register. Stories are companion artifacts to scenarios
 * (see spec §11). They help readers inhabit the futures the scenarios
 * describe in a register the scenarios deliberately cannot reach.
 *
 * Usage:
 *   npx tsx scripts/generate-stories.ts --set=centennial-2027
 *   npx tsx scripts/generate-stories.ts --set=centennial-2027 --story=stewardship-2034-snowmelt
 *   npx tsx scripts/generate-stories.ts --set=centennial-2027 --dry-run
 *   npx tsx scripts/generate-stories.ts --set=centennial-2027 --skip-existing
 *
 * Requires: ANTHROPIC_API_KEY
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import './lib/config.js'
import { callClaude } from './lib/claude-api.js'
import {
  assembleStoryContext,
  loadFrontierForStory,
  loadStoryDefinitions,
  type AssembledStoryContext,
  type FrontierForStory,
} from '../src/services/stories.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const skipExisting = args.includes('--skip-existing')
const setArg = args.find((a) => a.startsWith('--set='))?.split('=')[1]
const storyArg = args.find((a) => a.startsWith('--story='))?.split('=')[1]
const modelArg =
  args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'opus'

if (!setArg) {
  console.error(
    'Usage: generate-stories.ts --set=<set_id> [--story=<story_slug>] [--model=opus|sonnet] [--dry-run] [--skip-existing]',
  )
  process.exit(1)
}

const MODELS: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
}
const modelId = MODELS[modelArg] ?? MODELS.opus

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY && !dryRun) throw new Error('ANTHROPIC_API_KEY is required')

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const OUTPUT_DIR = path.join(REPO_ROOT, 'specification', 'stories', setArg)
mkdirSync(OUTPUT_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// PROMPT_STORY
// ---------------------------------------------------------------------------

function protagonistBlock(ctx: AssembledStoryContext): string {
  const type = ctx.storyInput.protagonist_type ?? 'guest_scientist'
  if (type === 'rmbl_staff') {
    return `**Protagonist type: rmbl_staff.** The protagonist is an RMBL staff member — someone whose working life is the institution, year-round. This vantage is reserved (per spec §11.2a) for stories whose subject is an institutional decision only staff can plausibly carry: executive-director bridge calls, hiring choices, year-end planning. The fact that RMBL exists as an institution that can make such choices is itself the scenario's bet; the staff POV is constitutive here.`
  }
  if (type === 'partner') {
    return `**Protagonist type: partner.** The protagonist is a staff scientist or technical lead at a partner organization (Conservancy District, Forest Service, BLM, tribal natural-resources office, county or state agency). Not RMBL staff. The basin's science crosses into their working life because of partnerships the scenario built. They consume basin records and translation work; they are accountable to a different institutional mission than RMBL's. The story should feel from their side of the table.`
  }
  return `**Protagonist type: guest_scientist** (the modal vantage for this set, per spec §11.2a). The protagonist visits the basin from a home institution — a university, a peer field station, a research institute — to push a specific frontier. They consume the campaign's investments rather than producing them. They have a home lab, a department, a funding cycle, a career stage, a sabbatical or a postdoc clock. RMBL staff are collaborators they have worked with for years, not their colleagues; Gothic and the East River are deeply known but not where they live year-round. Their POV puts the scenario's infrastructure in relief — they see what was funded and what was forgone.

Career stage and field should be specific (PhD student / postdoc / mid-career assistant or associate professor / senior fellow on sabbatical) and the work mode should be one of: a solo field campaign; an established lab back home with a grad-student cohort; a multi-institutional NSF-funded project; a foundation-funded restoration or applied program; a sabbatical residency; a postdoc rotation; an observational synthesis; a modeling project; a common-garden or reciprocal-transplant experiment; a cross-station comparative study. Pick the one that fits. The reader should feel the specificity of how this person is making their living and where their next paper goes.`
}

function frontierBlock(frontier: FrontierForStory | null | undefined): string {
  if (!frontier) return ''
  const questions = frontier.keyQuestions.length
    ? frontier.keyQuestions.map((q) => `> - ${q}`).join('\n')
    : '> (No key questions on file.)'
  const actions = frontier.keyActions.length
    ? frontier.keyActions
        .map(
          (a) =>
            `> - **${a.category} / ${a.effort}** — ${a.action}`,
        )
        .join('\n')
    : '> (No specific actions on file.)'
  const dataGap = frontier.dataGap ? `\n\n**One specific data gap the protagonist is filling, watching, or working around:**\n> ${frontier.dataGap}\n` : ''
  const tract = frontier.tractability
    ? ` Tractability: *${frontier.tractability}*.`
    : ''
  return `# The frontier this protagonist is pushing (spec §11.2a)

The protagonist is grounded by a specific knowledge frontier from the RMBL Knowledge Commons. Their work in this story is one *concrete action* toward that frontier — drawn from the actions catalog below. They are not the only person in the world pushing this frontier; they are one of perhaps a dozen, scattered across institutions, with their own approach.${tract}

**Frontier title:** ${frontier.title}

**Frontier description:**

> ${frontier.description.replace(/\n+/g, '\n> ')}

**Key open questions:**

${questions}

**Specific actions someone pushing this frontier might be undertaking (the protagonist is in the middle of one of these):**

${actions}${dataGap}

The frontier shapes what the protagonist is *actually doing on the page* — a query they run, an experiment they're checking, a paper they're drafting, a meeting they're leading, a sample they're collecting, a model run they're staring at. The frontier is **not announced**. The reader should recognize the protagonist as someone with a defined intellectual stake without ever being told what the stake is. The protagonist would never say "I am pushing the frontier of ${frontier.title.toLowerCase()}" — they would say what they were doing today.

The frontier is also a **contrastive lever**. A frontier-specific action that the campaign funded the scaffolding for should be possible in this scenario and visibly absent or harder in scenarios that forgo that scaffolding. Use this to satisfy the contrastive test in structural element 3.

`
}

function buildPrompt(ctx: AssembledStoryContext, frontier: FrontierForStory | null): string {
  const { storyInput, scenario } = ctx
  const modeBlock = (() => {
    if (storyInput.mode === 'stress-overlay') {
      return `**Mode: stress-overlay.** The scenario's commitments are tested by a specific external stress. The story should show how that stress is felt, and how the scenario's commitments shape (but do not determine) the response. The stress is the engine of the story; the scenario is the world it happens in.\n\n**The stress this story dramatizes:**\n\n> ${storyInput.stress_overlay}`
    }
    if (storyInput.mode === 'inflection-point') {
      return `**Mode: inflection-point.** The story dramatizes a specific decision the scenario describes — a moment of choice where alternatives are present as real options and characters with conflicting views are visible. Do not predetermine the outcome.\n\n**The decision this story dramatizes:**\n\n> ${storyInput.inflection_point}`
    }
    return `**Mode: inhabitation.** Slice-of-life: what daily working life feels like in the basin in this year under this scenario. Quiet, character-anchored, specific.`
  })()

  return `You are writing a short literary science-fiction story grounded in a strategic-planning scenario for the Rocky Mountain Biological Laboratory (RMBL). The story is a companion artifact to the scenario, designed to help readers inhabit the future the scenario describes in a register the scenario itself deliberately cannot reach.

The reader is a working scientist or someone who thinks science is important. Treat them with respect — they can spot inauthentic working-life details immediately, and they recognize hero-scientist tropes as condescending. Write as if for a literary science-fiction anthology, not a science-journalism feature, not a campaign brochure, not a "lessons learned" essay.

# Voice references (the registers we're aiming for)

- **Kim Stanley Robinson** at his best (*Antarctica*, *Ministry for the Future*): institutional scientists doing field work, real institutional politics, climate as ambient pressure, never resolves to triumph
- **Becky Chambers**: character-anchored, low-stakes literary SF about people doing work
- **Ursula K. Le Guin** (*Always Coming Home*): characters embedded in landscape and institution; nothing transcends the larger setting
- **Annalee Newitz** (*The Terraformers*): science institutions as settings, optimism balanced with realistic dysfunction

Explicitly NOT: Andy Weir at his most heroic; Ben Bova; "lessons learned" essay register; science-journalism feature voice.

# The scenario this story is grounded in

${scenario.markdown}

---

# Story parameters

- **Scenario:** ${scenario.name}
- **Year:** ${storyInput.year}
- **POV:** ${storyInput.pov} — never omniscient (omniscient invites editorializing). We see this world through one working life; we do not jump into other characters' inner thoughts.
- **Primary character role:** ${storyInput.primary_character_role}
- **Scene anchor:** ${storyInput.scene_anchor}
- **Target word count:** ~${storyInput.word_count_target} (±15% acceptable)

${protagonistBlock(ctx)}

${frontierBlock(frontier)}${modeBlock}

# Voice and texture (CRITICAL)

Sentence-level: vary length deliberately. Short for impact, long for thought. Avoid uniform paragraph rhythm. Working-language register when characters would actually use technical terms; plain when they wouldn't.

Texture must be specific to the basin. Real places — Gothic, RMBL365 in Crested Butte, the East River, the meadow plots above Gothic, the talus slope above Copper Lake. Real seasons — the short summer, the brief glacier-lily window in early July, the late-September close. Real organisms — yellow-bellied marmots (*Marmota flaviventris*), glacier lilies, *Boechera stricta*, bumble bees, *Ipomopsis aggregata*. Real instruments — piezometers, weighing platforms, archival databases, particular data tools the year requires.

If you could substitute "Niwot Ridge" or "H. J. Andrews" for "RMBL" without changing the story, you have written generic mountain-lab fiction. The story should not be portable.

# Required structural elements (the story must include each of these — spec §11.2)

1. **At least one scene set in a named basin location.** Specific place, not abstract.
2. **At least one moment where the stress or scenario condition is felt concretely** — someone notices, someone is affected, the texture of a familiar place is changed.
3. **At least one way the scenario's specific investments shape what's possible or impossible** — something the campaign funded should make a character's action, decision, or option possible, and something forgone should be felt as a constraint, an absence, or a road not taken. Not in campaign-marketing register; just present in the world. **The contrastive test:** if a reader could substitute a sibling scenario's slug at the top of this story without anything material in the plot or texture changing, the scenario's commitment is not yet on the page. The world, the character's options, or the outcome must be visibly different from how they would be under a different campaign bet. Example: in Stewardship, an archivist can run a query across digitized 1948–2039 notebooks because the campaign funded the digitization; in Records-Only, the same archivist would have to physically open three boxes of paper. In Capacity, a data scientist has standing collaborations with tribal natural-resources offices because the campaign funded RMBL365 as a partnership venue; in Records-and-Independence, those partnerships would be informal at best. In Watershed, a piezometer self-diagnoses a calibration drift overnight because the campaign sustained the watershed infrastructure post-SAIL; in Records-Only, that instrument was retired in 2032.
4. **At least one moment that isn't about science** — characters as people, not as functions. They have weather opinions, family considerations, dinner plans, small angers, brief joys. Working life includes these; their absence reads as portentous.
5. **An ending that doesn't resolve to triumph or despair.** Things continue. Stakes remain. Sometimes a small choice is made; sometimes not.

# Voice (spec §11.4)

Four principles. Honor them in spirit. They are not a checklist of beats to insert. They are the register the story should inhabit. The voice references named above (Robinson, Chambers, Le Guin, Newitz) carry these principles together; a story written in their register will inhabit the four principles naturally.

## Principle 1 — Inhabitation, not observation

Characters belong here. They know what years of being there teach you: the willows turning early like they did only in 2031; the colony of pikas that wasn't there in 2027; the way August light at 6am differs from at 7am at 9,500 feet; the meadow's smell in the first week of July; the year *Boechera* set seed two weeks late and what that meant for the rest of the system. Relationships have visible history — accreted inside jokes, learned rhythms, mutual patience with someone's quirks. The work has texture: archival queries returning more than expected; calibration drifts found; 1979 field notebooks read in handwriting aging toward illegibility.

Place is recognized, not described. Other people are known, not characterized.

## Principle 2 — Pleasure and competence

Characters are good at their work and the goodness is felt, not stated. The query that lands in three seconds and reveals 1998 and 2034 as the only previously-uncombined years. The transect crew with a rhythm built across summers — trap-check, weigh, record, release — that an outsider would have to learn. The senior scientist whose decisions read as decisions because we watch her make them.

Characters also have strong opinions — about methods, instruments, institutions, received wisdom, individual roles. They voice them. KSR's scientists are opinionated. Stories in this register should be too. A character who doesn't have a take has not been drawn fully.

## Principle 3 — Agency under stress

Characters act. They call collaborators, draft paragraphs, open queries, hire people, write memos, send drafts, make decisions in real time on the page. The stress shapes the response; it does not determine it.

The closing 200 words must not collapse into contemplative acceptance, watching-the-light-fade, "they would do this as long as they were able" register (per the §11.3 low-affect-resolution forbidden pattern below). Allowed closings: forward-leaning, charged with curiosity or possibility, animated by a small joy, opening rather than closing. A character writing the first sentence of something they will keep arguing with for the next week is a closing in this register. A character alone on a porch watching dusk fall is not.

## Principle 4 — Why they're up at 4am

Characters do amazing or ridiculous things — drive up at 4am to be at the meadow before the crew starts; sleep in trucks so they're there at first light; carry batteries on snowshoes; rearrange family Christmas to be at Gothic for first snowmelt; walk five miles after dark to fix a sensor; bring breakfast for the trap crew because it's their tenth season together — because of their commitments to the work, the place, and the community. The excess only reads as excess if you don't know what they care about. A story in this register includes at least one such commitment moment, justified by attachment rather than explained. The "amazing and ridiculous" is what makes the commitment visible.

This is the most distinctively RMBL principle: the institutional culture of intense attachment to the basin and to the small community of people who know it. The story should feel that attachment without naming it.

## Principle 5 — A recognizably different ${storyInput.year}

The story is set in ${storyInput.year}, roughly fifteen years after the present. The world has shifted at the texture level in ways characters take for granted but a 2024 reader would notice. **Environmental:** species have moved up in elevation; phenology stacks reorganized further than the v0.10 base assumed; summer rituals retimed to match a shifted season; fire seasons longer and at different times; certain late-season streams now reliably dry; certain plants now common at elevations they weren't. **Technological:** AI is integrated into daily research work in ways that don't yet exist; field instruments self-report and self-diagnose; small daily tools have changed shape (vehicles, communication patterns, lab equipment, the data systems on field tablets); maybe robotics in the field. **Social:** different demographic and career patterns among scientists; community partnerships evolved (co-production with tribal nations, water districts, county schools now established as ongoing); shifted academic and institutional norms; climate-driven migration visible at the edges of the basin.

These shifts are felt sideways, not announced. Characters do not explain to each other that ${storyInput.year} is different from 2024. They take their world as given. The 2024 reader notices the difference; the ${storyInput.year} character does not.

**AI specifically.** By ${storyInput.year} AI is integrated into research work in ways we can only guess at today. It reads entire archives overnight. It shows up to morning meetings with annotations. It has opinions characters argue with. It anticipates queries. It makes some field skills obsolete and creates new ones. Occasionally it does something a 2024 reader would find uncanny — and the character does not remark on the uncanny, because to them it isn't. **Lean into that strangeness.** Not as plot device, not as scary-AI trope, just as world. Some AI-textured moments should be normal in a way that is normalized only in retrospect. The way a 2009 story would have shown someone Googling something without commentary; the way a 1985 story would have shown a cordless phone without commentary. ${storyInput.year} AI is like that.

The test: if you could substitute "2024" for the story's year without changing anything material, the world isn't yet on the page. The shift should be subtle and present, not absent and not announced.

# Forbidden patterns (CRITICAL — spec §11.3)

- **"RMBL science saves the day" arc.** The scenario's commitments may shape what's possible, but the story must not resolve as triumph. Avoid the breakthrough-at-the-last-minute arc.
- **Exposition through dialogue.** Characters do not explain the scenario to each other. They live inside it. They reference it sideways at most.
- **Didactic endings / "lessons learned" voice.** No final paragraph telling the reader what to take away. No "and so" sentences. No essay-y closing reflection.
- **Fatalism / nihilism.** The future is not foregone. Characters can act, even under stress, even when their actions don't save things. Action matters even when it doesn't transcend.
- **Low-affect resolution.** Endings that resolve into quiet acceptance, contemplative melancholy, the "they would do this as long as they were able" register. Allowed endings: forward-leaning, charged with possibility, charged with curiosity, charged with a small joy, genuinely uncertain in a way that opens rather than closes, or — sparingly — quietly accepting. A story whose final beat is a character alone with their feelings, watching light fade, has slipped into the v0.8 failure mode the prompt is designed to prevent.
- **Generic mountain-lab fiction.** Specifics anchor the story.
- **Naming real living people.** Characters are roles, not real RMBL staff. No real researcher names in dialogue or attribution.
- **Default-LLM-naming clusters.** Without instruction, LLM-written ecology fiction gravitates toward names like Mara, Maren, Maya, Mira, Maria, Marisol — short, feminine, beginning with M. The centennial-2027 set already has several of these; do not pick another. Choose a distinctive name appropriate to the protagonist's described background (career stage, region of training, institution, family heritage). Non-Anglo names are welcome where the role description supports them. The point is just that the reader of the whole set should see distinct people, not a roomful of Maras.
- **Heroic individuals.** No one in the story singlehandedly figures anything out. Work is collaborative, partial, often inconclusive.
- **Spec vocabulary.** No "distinguishing thesis," "frontier portfolio," "innovation-to-infrastructure flywheel," "in-house catalytic capacity," "campaign deliverables," "bracket position," "load-bearing," etc. The story is not a planning document. The scenario you're grounded in *uses* this vocabulary; the story you write *must not*.
- **Documentary or scientific-paper voice.** This is fiction, not journalism.

${ctx.setId.endsWith('-upside') ? `# Additional forbidden patterns for upside-set stories (CRITICAL — spec §11.3a)

This story is grounded in an **upside companion scenario** (spec §4.1b). Upside-tail futures have their own failure modes the §11.3 list above does not catch:

- **Utopia.** Things are not better in this future because every problem has been solved. They are better because several favorable conditions stacked and the institution responded well. Characters in this story still have ordinary problems: bad weather, instrument failures, conflicts with collaborators, family obligations, federal-cycle uncertainty (federal cycles remain federal cycles even in a richer funding environment). The texture is **thriving**, not **idyllic**.
- **Deus-ex-machina policy shift.** The reader should not be told that the policy environment has improved — they should feel it as the texture of how characters work. Do not write a sentence like "since the Western Adaptive Co-Management Act passed in 2034." You may have a character walk into a meeting that exists *because* such a shift happened, without naming it.
- **Scientists save the world.** RMBL is part of a larger ecosystem — peer field stations, university labs, agencies, tribal natural-resources offices, partner foundations, community partners. Even in this upside future, no individual scientist or institution carries the work alone. The thriving register makes collaborative scope visible; it does not collapse onto a hero.
- **Triumphalism / "we did it."** Closings still face forward. The world is **more capacious**, not **resolved**. The characters are still working on questions whose answers they will not see.
- **Glossing the contingency.** This scenario is upside-*tail*, not the central case. The story should occasionally acknowledge — sideways — that the conditions that made this future possible were not the only ones that could have obtained: through a character's offhand reflection, through a peer's situation at a different institution where conditions did not stack as favorably, or simply through a memory of an earlier decade when the texture was thinner. The flourishing is felt as recently-arrived, not as natural.
- **Documentary register for the favorable conditions.** Do not have characters explain how public attitudes shifted or how federal policy reformed. The shift is the world; characters live in it. If a policy reform must be named at all, name it sideways and once.

The optimism in this story is **structural** (favorable conditions stacked), not **magical**.

` : ''}${ctx.setId.endsWith('-downside') ? `# Additional forbidden patterns for downside-set stories (CRITICAL — spec §11.3b)

This story is grounded in a **downside companion scenario** (spec §4.1c). Constrained-future stories have their own failure modes the §11.3 list above does not catch:

- **Collapse / dystopia / apocalypse register.** The institution exists. The basin exists. Researchers still work. Students still come, though fewer of them. The texture is **hardship and constraint**, not **catastrophe**. A field station running on a tight budget with a smaller staff and harder choices is not a dystopia; it is a small nonprofit having a difficult decade.
- **"They lose everything" register.** Not every long record can be saved, not every position retained, not every partnership renewed — characters confront real losses. But the story is not about loss-as-totality; it is about the specific things that are still being done, by people who have decided what their constrained options actually allow.
- **Reactive helplessness.** Characters still act. Their action space is narrower than the central case, much narrower than the upside, but they have agency. Decisions are still being made. The §11.3 agency-under-stress rule applies more strictly here, not less.
- **Villain attribution.** The conditions are multi-causal — federal contraction *and* foundation appetite contracting *and* climate stress *and* social-political shifts, intersecting. The story does not blame an administration, a party, a federal agency, or any single actor. The conditions are conditions; characters operate inside them.
- **Nostalgia trap.** Characters live in the present, not in the basin-as-it-was. Memory has its place — a multi-decade observer remembering a colony, a senior scientist recalling a year of better snowpack — but the story's center of gravity is what is being done now, not what was done then. The §11.3 low-affect-resolution forbidden pattern doubles down here.
- **False equivalence with the central case.** Downside scenarios are downside-*tail*. The story should acknowledge — sideways — that the conditions that produced this future were not the only ones that could have obtained: a character's offhand reflection on a peer institution that fared better, a reference to a different state's choices, a memory of when the conditions could still have gone several ways. The downside is structural and contingent, not foreordained.
- **Heroism through suffering.** The institution and its people are not ennobled by hardship. They are working scientists having a harder decade than they wanted. They are competent, opinionated, sometimes funny, sometimes tired, and still doing the work.
- **Documentary register for the unfavorable conditions.** Do not have characters explain how funding contracted or how the political environment changed. The conditions are the world; characters live in them. If conditions must be named at all, name them sideways and once.

The character of this story is **hardship without despair, constraint without collapse, real losses set against real ongoing work**. The §11.3 forward-leaning closing rule is doubly load-bearing.

` : ''}# Factual anchors — long records (CRITICAL — do not get this wrong)

The campaign is named "Centennial" because RMBL was founded in 1928 (2028 is the institutional centennial). This is the *campaign's* centennial, not the *records'*. Use the dates below as ground truth — do not let "centennial" framing leak across.

| Record | Started | Age by 2027 | Age by ${storyInput.year} | Centennial year |
|---|---|---|---|---|
| Yellow-bellied marmot demographic study (Barash → Armitage → Blumstein) | 1963 | 64 years | ${storyInput.year - 1963} years | 2063 |
| Meadow phenology series (Inouye and collaborators) | ~1974 | 53 years | ${storyInput.year - 1974} years | ~2074 |
| RMBL itself | 1928 | 99 years | ${storyInput.year - 1928} years | 2028 |

The marmot study passes **its 75-year mark in 2038**. Its centennial is 2063, well outside any horizon you should be writing inside. If a character refers to the marmot study's age in dialogue or thought, use the value from this table for the story's year. The phenology series and the snowmelt-driven plant work are similarly grounded — neither is approaching a centennial within your horizon.

# Output

Begin with a short evocative title on its own line, prefixed with "# ". Then the story prose. No frontmatter (the YAML metadata is added separately). No "(Story by ...)" attribution. No "The End." No author's notes. Just the title and the prose.

~${storyInput.word_count_target} words. Aim for the target; ±15% is fine.`
}

// ---------------------------------------------------------------------------
// Markdown wrapper assembly (frontmatter + LLM output)
// ---------------------------------------------------------------------------

function assembleMarkdown(
  ctx: AssembledStoryContext,
  body: string,
): string {
  const { storyInput, scenario } = ctx
  const modeLabel =
    storyInput.mode === 'stress-overlay'
      ? 'Stress-overlay'
      : storyInput.mode === 'inflection-point'
      ? 'Inflection-point'
      : 'Inhabitation'

  const wordCount = body.split(/\s+/).filter(Boolean).length

  const header: string[] = []
  header.push(
    `*Story grounded in [${scenario.name}](../../scenarios/${ctx.setId}/${scenario.slug}.md). Mode: ${modeLabel}. Year: ${storyInput.year}. Word count: ${wordCount}. Published: ${storyInput.published ? 'yes' : 'internal-only'}.*`,
  )
  header.push('')
  header.push('---')
  header.push('')

  return header.join('\n') + body.trim() + '\n'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `Generating Stories (set=${setArg}, model=${modelArg} → ${modelId}, dryRun=${dryRun})`,
  )

  const defs = loadStoryDefinitions(setArg!)
  console.log(
    `  Set: ${defs.set_id} (framework v${defs.framework_version}, ${defs.stories.length} stories defined)`,
  )

  const targets = storyArg
    ? defs.stories.filter((s) => s.story_slug === storyArg)
    : defs.stories

  if (targets.length === 0) {
    console.error(`No stories match story=${storyArg ?? '(all)'}`)
    process.exit(1)
  }

  console.log(`  Targeting ${targets.length} stor${targets.length === 1 ? 'y' : 'ies'}`)

  // DB pool for frontier loading (spec §11.2a). Created here once and
  // closed at the end; loadFrontierForStory is called per-story.
  const dbPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  let succeeded = 0
  let skipped = 0
  let costTotal = 0

  for (let i = 0; i < targets.length; i++) {
    const story = targets[i]
    console.log(`\n[${i + 1}/${targets.length}] ${story.story_slug} (${story.mode}, year ${story.year}, scenario=${story.scenario_slug})`)

    const outPath = path.join(OUTPUT_DIR, `${story.story_slug}.md`)
    if (skipExisting && existsSync(outPath)) {
      console.log(`  Skipping (--skip-existing and file exists)`)
      skipped++
      continue
    }

    const ctx = assembleStoryContext(setArg!, story.story_slug)
    const frontier = story.frontier_slug
      ? await loadFrontierForStory(dbPool, story.frontier_slug)
      : null
    if (story.frontier_slug && !frontier) {
      console.warn(
        `  ⚠️  Frontier slug "${story.frontier_slug}" not found in Commons — prompt will skip frontier block.`,
      )
    }
    const prompt = buildPrompt(ctx, frontier)
    console.log(`  Context: ${(prompt.length / 1000).toFixed(1)}k chars`)

    if (dryRun) {
      console.log(`  (DRY RUN) — prompt preview:`)
      console.log(prompt.slice(0, 1500))
      console.log(`  ... (${prompt.length - 1500} more chars omitted)`)
      continue
    }

    const response = await callClaude({
      apiKey: ANTHROPIC_API_KEY!,
      maxTokens: 8192,
      model: modelId,
      messages: [
        { role: 'user', content: prompt + '\n\nWrite the story now.' },
      ],
    })

    const body = response.text.trim()
    if (!body) {
      console.log(`  Empty response (cost: $${response.cost.toFixed(3)})`)
      continue
    }
    costTotal += response.cost
    const markdown = assembleMarkdown(ctx, body)
    writeFileSync(outPath, markdown)
    console.log(`  ✓ Story written (${body.split(/\s+/).length} words, cost: $${response.cost.toFixed(3)})`)
    console.log(`    → ${path.relative(REPO_ROOT, outPath)}`)
    succeeded++
  }

  await dbPool.end()

  console.log('\n========== Summary ==========')
  console.log(`Processed: ${targets.length}`)
  console.log(`Succeeded: ${succeeded}`)
  console.log(`Skipped:   ${skipped}`)
  if (!dryRun) console.log(`Total cost: $${costTotal.toFixed(2)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
