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
import './lib/config.js'
import { callClaude } from './lib/claude-api.js'
import {
  assembleStoryContext,
  loadStoryDefinitions,
  type AssembledStoryContext,
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

function buildPrompt(ctx: AssembledStoryContext): string {
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

${modeBlock}

# Voice and texture (CRITICAL)

Sentence-level: vary length deliberately. Short for impact, long for thought. Avoid uniform paragraph rhythm. Working-language register when characters would actually use technical terms; plain when they wouldn't.

Texture must be specific to the basin. Real places — Gothic, RMBL365 in Crested Butte, the East River, the meadow plots above Gothic, the talus slope above Copper Lake. Real seasons — the short summer, the brief glacier-lily window in early July, the late-September close. Real organisms — yellow-bellied marmots (*Marmota flaviventris*), glacier lilies, *Boechera stricta*, bumble bees, *Ipomopsis aggregata*. Real instruments — piezometers, weighing platforms, archival databases, particular data tools the year requires.

If you could substitute "Niwot Ridge" or "H. J. Andrews" for "RMBL" without changing the story, you have written generic mountain-lab fiction. The story should not be portable.

# Required structural elements (the story must include each of these — spec §11.2)

1. **At least one scene set in a named basin location.** Specific place, not abstract.
2. **At least one moment where the stress or scenario condition is felt concretely** — someone notices, someone is affected, the texture of a familiar place is changed.
3. **At least one way the scenario's commitments shape what's possible or impossible** — something the campaign funded matters in the world of the story, OR something the scenario forgoes is missed. Not in campaign-marketing register; just present in the world.
4. **At least one moment that isn't about science** — characters as people, not as functions. They have weather opinions, family considerations, dinner plans, small angers, brief joys. Working life includes these; their absence reads as portentous.
5. **An ending that doesn't resolve to triumph or despair.** Things continue. Stakes remain. Sometimes a small choice is made; sometimes not.

# Required tonal moves (spec §11.4)

- **One moment of physical specificity** — the smell of woodsmoke; the way light moves across the talus; the cold weight of a marmot in someone's hands; the sound of a pika in late August.
- **One moment of texture from the work** — running an archival query that returns more than expected; finding a calibration drift; reading a 1979 field notebook in handwriting that has aged toward illegibility; the moment when a sensor fails and a person has to climb to fix it.
- **One moment of humor or warmth.** Real working life includes these. Their absence is portentous.
- **One reference to something the campaign funded that now matters** — not in campaign-marketing register, just present in the world of the story.

# Forbidden patterns (CRITICAL — spec §11.3)

- **"RMBL science saves the day" arc.** The scenario's commitments may shape what's possible, but the story must not resolve as triumph. Avoid the breakthrough-at-the-last-minute arc.
- **Exposition through dialogue.** Characters do not explain the scenario to each other. They live inside it. They reference it sideways at most.
- **Didactic endings / "lessons learned" voice.** No final paragraph telling the reader what to take away. No "and so" sentences. No essay-y closing reflection.
- **Fatalism / nihilism.** The future is not foregone. Characters can act, even under stress, even when their actions don't save things. Action matters even when it doesn't transcend.
- **Generic mountain-lab fiction.** Specifics anchor the story.
- **Naming real living people.** Characters are roles, not real RMBL staff. No real researcher names in dialogue or attribution.
- **Heroic individuals.** No one in the story singlehandedly figures anything out. Work is collaborative, partial, often inconclusive.
- **Spec vocabulary.** No "distinguishing thesis," "frontier portfolio," "innovation-to-infrastructure flywheel," "in-house catalytic capacity," "campaign deliverables," "bracket position," "load-bearing," etc. The story is not a planning document. The scenario you're grounded in *uses* this vocabulary; the story you write *must not*.
- **Documentary or scientific-paper voice.** This is fiction, not journalism.

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
    const prompt = buildPrompt(ctx)
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
