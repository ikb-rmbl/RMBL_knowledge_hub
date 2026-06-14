/**
 * Generate Future Scenarios
 *
 * Pipeline-driven generation of Future Scenario artifacts for the RMBL
 * Knowledge Commons, following the Future Scenarios Framework spec
 * (specification/Future_scenarios_framework.md).
 *
 * Architecture mirrors scripts/generate-era-primers.ts:
 *
 *   - Context assembly via src/services/scenarios.ts
 *     (spec section extraction + YAML definitions + Commons grounding)
 *   - PROMPT_SCENARIO with the spec sections inlined as system preamble
 *   - Claude JSON output → markdown template assembly → file write
 *
 * Storage: scenarios are version-controlled .md files at
 *   specification/scenarios/<set_id>/<slug>.md
 * Not DB rows — scenarios evolve with the spec, and git is the right
 * backing store for the strategic-planning artifacts they are.
 *
 * Usage:
 *   npx tsx scripts/generate-scenarios.ts --set=centennial-2027
 *   npx tsx scripts/generate-scenarios.ts --set=centennial-2027 --slug=centennial-stewardship
 *   npx tsx scripts/generate-scenarios.ts --set=centennial-2027 --dry-run
 *   npx tsx scripts/generate-scenarios.ts --set=centennial-2027 --skip-existing
 *
 * Requires: ANTHROPIC_API_KEY
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import {
  assembleScenarioContext,
  loadDefinitions,
  type AssembledScenarioContext,
  type ScenarioInput,
  type ScenarioSetDefinitions,
} from '../src/services/scenarios.js'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const skipExisting = args.includes('--skip-existing')
const setArg = args.find((a) => a.startsWith('--set='))?.split('=')[1]
const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1]
const modelArg = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'opus'

if (!setArg) {
  console.error('Usage: generate-scenarios.ts --set=<set_id> [--slug=<scenario_slug>] [--model=opus|sonnet] [--dry-run] [--skip-existing]')
  process.exit(1)
}

const MODELS: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
}
const modelId = MODELS[modelArg] ?? MODELS.opus

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY && !dryRun) throw new Error('ANTHROPIC_API_KEY is required')

// Output directory follows the same convention as the spec.
const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const OUTPUT_DIR = path.join(REPO_ROOT, 'specification', 'scenarios', setArg)
mkdirSync(OUTPUT_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * The PROMPT_SCENARIO template. The system context is the spec preamble
 * (operating model, current moment, LLM implications, candidate frontiers,
 * required rules, forbidden patterns, public-facing register) — substituted
 * in from spec sections at runtime so prompt changes ride along with spec
 * revisions.
 *
 * Output is requested as JSON so each structured field stays separable for
 * the markdown template assembly downstream.
 */
function buildPrompt(ctx: AssembledScenarioContext): string {
  const { setDefinitions, scenarioInput, spec, grounding, frontiers, siblings } = ctx

  const tw = setDefinitions.set_metadata.time_window
  const mag = scenarioInput.campaign_magnitude
  const split = scenarioInput.continuity_innovation_split

  const frontierBlock = frontiers
    .map((f) => `**${f.id}** (source: ${f.source}):\n${f.description}`)
    .join('\n\n')

  const planningBlock = grounding.planning_themes
    .map((t) => `- **${t.title}** — ${t.summary ?? '(no summary)'}`)
    .join('\n')

  const siblingBlock = siblings.length === 0
    ? '(no sibling scenarios yet in this set — yours is the first or only)'
    : siblings
        .map(
          (s) =>
            `### ${s.name} (slug: ${s.slug})\nShared inflection IDs already used: ${s.shared_inflection_ids.join(', ') || '(none)'}\n\nSynopsis:\n${s.synopsis || '(no synopsis available)'}`,
        )
        .join('\n\n')

  return `You are writing a Future Scenario for the RMBL Knowledge Commons under the Future Scenarios Framework v${setDefinitions.set_metadata.framework_version}. Scenarios are grounded, contingency-honest descriptions of plausible basin-science futures over a 15-year primary horizon (plus a lower-resolution coda). They are public-facing artifacts that inform organizational visioning, donor engagement, and strategic planning — not forecasts, not campaign marketing.

The spec sections below are authoritative. Honor them strictly.

# Institutional grounding (spec §3.1, §3.2, §3.2a, §3.3)

${spec.operating_model}

${spec.current_moment}

${spec.factual_anchors}

${spec.llm_implications}

${setDefinitions.set_id.endsWith('-upside') ? `# Upside companion set framing (spec §4.1b)\n\n${spec.upside_sets}\n\nThis set is explicitly an upside companion set. Bracket-bending is expected. Honor the upside-set conventions: name the stacked-favorable conditions on which this scenario depends (the YAML \`upside_conditions\` field is the input), keep \`mattering_in_2040\` honest about which conditions had to hold, and avoid utopian register. The thriving is structural, not magical.\n` : ''}${setDefinitions.set_id.endsWith('-downside') ? `# Downside companion set framing (spec §4.1c)\n\n${spec.downside_sets}\n\nThis set is explicitly a downside companion set. Bracket-bending is expected downward. Honor the downside-set conventions: name the stacked-unfavorable conditions on which this scenario depends (the YAML \`downside_conditions\` field is the input), keep \`mattering_in_2040\` honest about what RMBL still does (not what it has lost), and avoid collapse register. The hardship is real but bounded; the institution is constrained but functioning.\n` : ''}

# Candidate research frontiers (spec §6)

${spec.candidate_frontiers}

# Required field rules (spec §7.1)

${spec.required_rules}

# Forbidden patterns (spec §7.2)

${spec.forbidden_patterns}

# Public-facing register (spec §9.1)

${spec.public_facing}

---

# Scenario inputs (this generation)

- **set_id:** ${setDefinitions.set_id}
- **name:** ${scenarioInput.name}
- **slug:** ${scenarioInput.slug}
- **version:** ${scenarioInput.version}
- **time_window:** primary ${tw.primary_start}–${tw.primary_end}; coda ${tw.coda_end}
- **campaign_magnitude:** ~$${mag.target_m_dollars}M (range $${mag.range_m_dollars[0]}M–$${mag.range_m_dollars[1]}M) — **${mag.bracket_position}**
- **continuity_innovation_split:** ${split.continuity_pct}% continuity / ${split.innovation_pct}% innovation
- **frontier_portfolio:** ${scenarioInput.frontier_portfolio.join(', ')}

# STRATEGIC DISTINCTNESS (CRITICAL — this is the organizing principle of the scenario)

Per spec §2.7, scenarios within a set must rest on distinguishing theses — central strategic claims no other scenario makes. Convergence on a shared playbook with different emphasis is a framework failure mode this prompt explicitly rejects. Two inputs anchor the strategic identity of this scenario; every prose section must trace back to them.

**Distinguishing thesis** (the bet this scenario makes that no other scenario in the set makes):

> ${scenarioInput.distinguishing_thesis}

**Mattering in 2040** (forward-looking consequence, consistent with the thesis — completes "In 2040, RMBL matters because..."):

> ${scenarioInput.mattering_in_2040}

${(scenarioInput as { upside_conditions?: string }).upside_conditions ? `**Upside conditions** (the stacked-favorable conditions on which this upside-tail scenario depends — surface these in plausibility_caveats and in the audience-lens prose; do not pretend the scenario is the central case):\n\n> ${(scenarioInput as { upside_conditions?: string }).upside_conditions}\n` : ''}

Operational requirements for distinctness:

1. **Synopsis must translate the distinguishing_thesis into plain language.** A reader of just the synopsis should understand what makes this scenario different from the others in the set.
2. **Coda + audience lenses must describe the mattering_in_2040 as the scenario's lasting consequence.** Don't just paraphrase the thesis; surface what the bet produces if it plays out.
3. **At least 1–2 \`campaign_deliverables\` entries must be distinctive to this scenario** — investments that would not appear at the same magnitude in any sibling scenario. Not just "more emphasis on X"; structurally different commitments traceable to the thesis.
4. **At least 2 \`moments_of_choice\` entries must have \`shared_inflection_id: null\`** — choices distinctive to this scenario, articulating decisions specific to this scenario's bet rather than generic campaign-design choices.
5. **\`plausibility_caveats\` must include at least one failure mode specific to this scenario's bet** — not generic risk language. What's the characteristic way this particular scenario could go wrong, given its central claim?

When the sibling-scenario list below shows another scenario already using a moment of choice's shared_inflection_id, REUSE the slug if your scenario faces the same choice; but be alert to whether your scenario faces *different* choices because its thesis is different. Distinctive inflection IDs (no recurrence) are not failures — they are the structural signature of a scenario's strategic identity.

CRITICAL — magnitude framing rule: You receive the magnitude numerically for the structured-fields output (campaign_magnitude.target_m_dollars and range_m_dollars). In the **prose body** of every section (synopsis, setting, phase arc, audience lenses, plausibility caveats, coda), refer to magnitude only via the bracket_position phrase ("${mag.bracket_position}") or equivalent impressionistic framing. Do NOT use dollar figures ($7.5M, $7M, etc.) anywhere in the prose body. Per §7.2 forbidden patterns, this is enforced.

---

# FACTUAL ANCHORS — long records (CRITICAL — do not get this wrong)

The campaign is named "Centennial" because RMBL was founded in 1928 (2028 is the institutional centennial). This is the *campaign's* centennial, not the *records'*. The long records are decades younger. Use the dates below as ground truth — do not let "centennial" framing leak across.

| Record | Started | Age by 2027 | Age by 2040 | Centennial year |
|---|---|---|---|---|
| Yellow-bellied marmot demographic study (Barash → Armitage → Blumstein) | 1963 | 64 years | 77 years | 2063 |
| Meadow phenology series (Inouye and collaborators) | ~1974 | 53 years | 66 years | ~2074 |
| Snowmelt-driven plant work | various, ~1970s | ~50 years | ~63 years | ~2070s |
| RMBL itself | 1928 | 99 years | 112 years | 2028 |

Within any reasonable horizon (extending into the early 2040s), **the marmot study passes its 75-year mark in 2038**. The phenology series is at its half-century in the early 2020s and approaches 65 years by 2040. None of the records reach a centennial within the horizon. If you reference a record's age, milestone, or anniversary, use the actual milestone for the date — not "centennial." Common errors to avoid: "the marmot study reaches its hundredth year in this period" (no — it's at 75 in 2038); "the marmot study, well into its second century" (no — it's at 77 by 2040); "the marmot study's centennial in the early 2040s" (no — 2063).

# VOICE AND ACCESSIBILITY (CRITICAL — readability is the highest-priority constraint after factual accuracy)

The scenario is a public artifact. Imagine all of these readers reading the same prose: a board member without scientific training; a journalist; a working basin scientist; a high-school student doing a project on RMBL; a prospective donor evaluating their giving. All of them must follow it.

Sentence-level rules (enforce strictly):
- Average sentence length 15–20 words.
- **No sentence over 30 words.** Hard cap. Break it into two.
- Prefer concrete nouns over abstract noun chains. "The marmot study" beats "the basin's longest demographic infrastructure." "RMBL's data scientists" beats "in-house catalytic capacity." "Renovating RMBL365" beats "capital deployed to existing community-facing infrastructure."
- Prefer active voice. "The campaign protects the records" beats "The records are protected by campaign funding."
- One claim per sentence. Multi-clause sentences are the exception, not the default.

Forbidden spec-vocabulary in prose (these are developer/strategist vocabulary from the spec; they are not for readers):
- "central contingency" — say "this scenario assumes" or "the campaign expects"
- "scenario assumption" — say "this scenario chooses"
- "contingency-honest", "frontier portfolio", "frontier support strategy" — translate or drop
- "in-house catalytic capacity", "catalytic infrastructure" — say what these actually are: "RMBL's data scientists and technicians," "the data systems and instruments RMBL maintains"
- "innovation-to-infrastructure flywheel" — say "the recent pattern where outside grants build RMBL's own tools and capacity, which then attract more grants" if you must name it; do not use as a noun phrase
- "diversified-funding-base", "operating reserves" (as abstract nouns) — say "less dependence on federal grants," "savings that buffer RMBL against funding shocks"
- "load-bearing" — say what it actually does
- "posture of X" — say what RMBL or the campaign actually does
- "primary share", "secondary share", "supporting investment" — these belong in structured fields, not in prose
- "bracket position", "magnitude bracket" — say "near the upper end of what the campaign might raise" or simply describe the campaign as substantial / modest / focused
- "F.cont.1", "F.innov.3", etc. — never reference these IDs in prose; name what the frontier is about

When you find yourself reaching for a phrase from the forbidden list, that is a signal to stop and write the concrete thing the phrase is gesturing at.

Length caps per prose field (hard caps — pipeline rejects scenarios that blow past these):
- **synopsis**: 130–170 words (was 220 in earlier drafts; tighten)
- **forgone**: 100–180 words
- **seeds_in_present**: 100–180 words
- **setting**: 200–320 words total across all paragraphs
- each **phase_arc[i].summary**: 130–200 words
- **lines_of_inquiry**: 200–300 words
- each **audience_lens_***: 100–150 words
- **overlay_robustness.central_case**: 60–110 words; each stress case 60–110 words
- **plausibility_caveats**: 200–300 words
- **coda**: 100–180 words

Per-section audience reminder:
- **synopsis**: a reader who reads only this paragraph should understand what the scenario is and isn't; aim for the register of a thoughtful local-news feature
- **setting**: a journalist re-explaining the scenario in their own words; concrete, evocative, no jargon
- **phase_arc**: a board member or scientist tracking what concrete things happen by when; specific years, specific events, specific decisions
- **audience_lens_research**: someone considering whether to bring their research to RMBL during the period
- **audience_lens_institution**: someone on staff or the board trying to picture what RMBL will feel like to work at
- **audience_lens_donor**: someone considering whether their gift would matter; invitation register, never promise
- **plausibility_caveats**: a careful reader checking what the scenario does and doesn't claim
- **coda**: a reader curious where this could lead but accepting that the further future is hazier

---

# Frontier portfolio (resolved)

${frontierBlock}

# Commons grounding

## Where basin science is now (most recent era primer: ${grounding.most_recent_era?.slug ?? 'n/a'})

${grounding.most_recent_era?.primer ?? '(no recent era primer available)'}

## The longer arc (${grounding.century_era?.slug ?? 'n/a'} primer)

${grounding.century_era?.primer ?? '(no century primer available)'}

## Cross-lens planning themes (12 themes from the planning pipeline)

${planningBlock}

# Sibling scenarios in this set (for cross-scenario consistency)

When you identify a moment of choice that already appears in a sibling scenario under a particular shared_inflection_id slug, REUSE that slug rather than inventing a new one. Spec §7.3 mechanism: shared inflection IDs cluster moments-of-choice across scenarios so the Commons can render a "this decision RMBL will face regardless of scenario" cross-view. Inventing new slugs for choices already present elsewhere defeats this.

${siblingBlock}

---

# Output (JSON only — no code fences, no preamble)

Return a single JSON object with the schema below. Every prose field is written in the public-facing register (§9.1), respects the §7.1 / §7.2 rules, AND honors the VOICE AND ACCESSIBILITY constraints above (length caps, sentence-length rules, forbidden spec-vocabulary). The synopsis (130–170 words) must read coherently as a standalone artifact — a reader who never engages the full prose body should still understand what the scenario is and isn't.

Schema:

{
  "synopsis": "<150-250 word paragraph: central contingency, priorities, what's forgone, what's asked of donors and the institution>",
  "campaign_deliverables": [
    {"priority_weight": "primary|secondary|supporting|continuity_residual", "description": "<strategic priority and required capacities; no fund names, no dollar amounts; impressionistic sizing>"},
    ...
  ],
  "frontier_support_strategies": [
    {"frontier_id": "F.X.N", "strategy": "<how the campaign's investments serve this frontier; references catalytic infrastructure + in-house capacity where appropriate>"},
    ...
  ],
  "forgone": "<paragraph: what this scenario does not fund or pursue; explicit tradeoffs>",
  "seeds_in_present": "<paragraph: pointers to current Era entries, landmark papers, planning themes, current in-house capacity (e.g. innovation-to-infrastructure flywheel products including this Knowledge Commons) that the scenario takes as foundational>",
  "setting": "<paragraph(s): contingency-first opener; 'this scenario takes as its central contingency...'; sets up the decisive feature; uses bracket-position framing, never dollar figures>",
  "phase_arc": [
    {"phase_number": 1, "years": "2026–2030", "name": "<short label>", "summary": "<paragraph(s)>"},
    {"phase_number": 2, "years": "2031–2035", "name": "<short label>", "summary": "<paragraph(s)>"},
    {"phase_number": 3, "years": "2036–2040", "name": "<short label>", "summary": "<paragraph(s)>"}
  ],
  "lines_of_inquiry": "<paragraph(s): what research themes mature through the period; what doesn't>",
  "moments_of_choice": [
    {
      "year": <int between 2026 and 2040>,
      "actors": "<role descriptions, NOT individuals — e.g. 'RMBL leadership and board'>",
      "choice_description": "<what's being decided>",
      "alternatives": "<the realistic alternatives the choice has>",
      "scenario_assumption": "<what this scenario assumes is chosen>",
      "shared_inflection_id": "<slug if this choice recurs across scenarios; null if distinctive to this scenario>"
    },
    ... (4-7 entries)
  ],
  "audience_lens_research": "<paragraph: what scientists working on these frontiers get to do during the horizon>",
  "audience_lens_institution": "<paragraph: what RMBL becomes through this frontier portfolio>",
  "audience_lens_donor": "<paragraph: invitation register; public-readable; what donors are part of building; no promise language>",
  "overlay_robustness": {
    "central_case": "<paragraph: gradual federal contraction × gradual AI evolution × RCP6.0 climate>",
    "stress_cases": [
      {"name": "<short label>", "evolution": "<paragraph: how the scenario plays out under this stress>"},
      ... (2-3 stress cases)
    ]
  },
  "plausibility_caveats": "<paragraph(s): explicit assumptions; what could invalidate; structural blind spots>",
  "coda": "<paragraph(s): 2040–2050 lower-resolution; explicitly speculative>"
}`
}

// ---------------------------------------------------------------------------
// Output schema (matches JSON output from the prompt)
// ---------------------------------------------------------------------------

interface ScenarioOutput {
  synopsis: string
  campaign_deliverables: Array<{ priority_weight: string; description: string }>
  frontier_support_strategies: Array<{ frontier_id: string; strategy: string }>
  forgone: string
  seeds_in_present: string
  setting: string
  phase_arc: Array<{
    phase_number: number
    years: string
    name: string
    summary: string
  }>
  lines_of_inquiry: string
  moments_of_choice: Array<{
    year: number
    actors: string
    choice_description: string
    alternatives: string
    scenario_assumption: string
    shared_inflection_id: string | null
  }>
  audience_lens_research: string
  audience_lens_institution: string
  audience_lens_donor: string
  overlay_robustness: {
    central_case: string
    stress_cases: Array<{ name: string; evolution: string }>
  }
  plausibility_caveats: string
  coda: string
}

// ---------------------------------------------------------------------------
// Markdown template assembly
// ---------------------------------------------------------------------------

function emphasisLabel(continuity_pct: number): string {
  if (continuity_pct >= 60) return 'continuity-leaning'
  if (continuity_pct >= 40) return 'balanced'
  return 'innovation-leaning'
}

function bracketShortLabel(target: number): string {
  if (target >= 7) return 'Target magnitude'
  if (target >= 5) return 'Mid-range magnitude'
  return 'Floor magnitude'
}

function assembleMarkdown(
  setDefs: ScenarioSetDefinitions,
  input: ScenarioInput,
  output: ScenarioOutput,
): string {
  const tw = setDefs.set_metadata.time_window
  const mag = input.campaign_magnitude
  const split = input.continuity_innovation_split
  const fwVersion = setDefs.set_metadata.framework_version
  const emphasis = emphasisLabel(split.continuity_pct)
  const bracketLabel = bracketShortLabel(mag.target_m_dollars)

  const out: string[] = []
  out.push(`# ${input.name}`)
  out.push('')
  out.push(
    `*A Future Scenario in the \`${setDefs.set_id}\` set. ${bracketLabel}, ${emphasis}. v${input.version} under [Future Scenarios Framework v${fwVersion}](../../Future_scenarios_framework.md).*`,
  )
  out.push('')
  out.push('---')
  out.push('')

  // Synopsis — sits immediately after the header per §9.3
  out.push('## Synopsis')
  out.push('')
  out.push(output.synopsis)
  out.push('')
  out.push('---')
  out.push('')

  // Structured fields
  out.push('## Structured fields')
  out.push('')
  out.push('| Field | Value |')
  out.push('|---|---|')
  out.push(`| \`name\` | ${input.name} |`)
  out.push(`| \`slug\` | ${input.slug} |`)
  out.push(`| \`version\` | ${input.version} |`)
  out.push(`| \`set_id\` | ${setDefs.set_id} |`)
  out.push(
    `| \`time_window\` | primary ${tw.primary_start}–${tw.primary_end}; coda ${tw.coda_end} |`,
  )
  out.push(
    `| \`campaign_magnitude\` | ${mag.bracket_position}; range $${mag.range_m_dollars[0]}M–$${mag.range_m_dollars[1]}M |`,
  )
  out.push(
    `| \`continuity_innovation_split\` | ${split.continuity_pct}% continuity / ${split.innovation_pct}% innovation |`,
  )
  out.push(`| \`frontier_portfolio\` | ${input.frontier_portfolio.join(', ')} |`)
  out.push('')

  out.push('### Campaign deliverables')
  out.push('')
  for (const d of output.campaign_deliverables) {
    out.push(`- **${d.priority_weight}.** ${d.description}`)
  }
  out.push('')

  out.push('### Frontier support strategies')
  out.push('')
  for (const s of output.frontier_support_strategies) {
    out.push(`- **${s.frontier_id}.** ${s.strategy}`)
  }
  out.push('')

  out.push('### Forgone')
  out.push('')
  out.push(output.forgone)
  out.push('')

  out.push('### Seeds in the present')
  out.push('')
  out.push(output.seeds_in_present)
  out.push('')
  out.push('---')
  out.push('')

  // Prose sections
  out.push('## Setting')
  out.push('')
  out.push(output.setting)
  out.push('')

  out.push('## The arc — three phases across the primary horizon')
  out.push('')
  for (const p of output.phase_arc) {
    out.push(`### Phase ${p.phase_number}: ${p.name} (${p.years})`)
    out.push('')
    out.push(p.summary)
    out.push('')
  }

  out.push('## Lines of inquiry')
  out.push('')
  out.push(output.lines_of_inquiry)
  out.push('')

  out.push('## Moments of choice within the primary horizon')
  out.push('')
  output.moments_of_choice.forEach((m, i) => {
    const idTag = m.shared_inflection_id
      ? ` *Shared inflection: \`${m.shared_inflection_id}\`.*`
      : ' *Distinctive to this scenario.*'
    out.push(`${i + 1}. **${m.year} — ${m.choice_description}**${idTag}`)
    out.push(`   - Actors: ${m.actors}`)
    out.push(`   - Alternatives: ${m.alternatives}`)
    out.push(`   - Scenario assumption: ${m.scenario_assumption}`)
    out.push('')
  })

  out.push('## Audience lens — research')
  out.push('')
  out.push(output.audience_lens_research)
  out.push('')

  out.push('## Audience lens — institution')
  out.push('')
  out.push(output.audience_lens_institution)
  out.push('')

  out.push('## Audience lens — donor')
  out.push('')
  out.push(output.audience_lens_donor)
  out.push('')

  out.push('## Overlay robustness')
  out.push('')
  out.push(`**Central case.** ${output.overlay_robustness.central_case}`)
  out.push('')
  for (const sc of output.overlay_robustness.stress_cases) {
    out.push(`**Stress case — ${sc.name}.** ${sc.evolution}`)
    out.push('')
  }

  out.push('## Plausibility caveats')
  out.push('')
  out.push(output.plausibility_caveats)
  out.push('')
  out.push('---')
  out.push('')

  out.push(`## Looking further out: ${tw.primary_end}–${tw.coda_end}`)
  out.push('')
  out.push('*Speculative. Lower resolution than the primary horizon.*')
  out.push('')
  out.push(output.coda)
  out.push('')

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Citation post-processing (mirrors era-primer pattern)
// ---------------------------------------------------------------------------

function postProcessCitations(text: string): string {
  let out = text
  // (Author, Year){pub_id:N} → [Author, Year](/publications/N)
  out = out.replace(/\(([^)]+)\)\s*\{pub_id:(\d+)\}/g, '[$1](/publications/$2)')
  out = out.replace(/\(([^)]+)\)\s*\{doc_id:(\d+)\}/g, '[$1](/documents/$2)')
  out = out.replace(/\(([^)]+)\)\s*\{dataset_id:(\d+)\}/g, '[$1](/datasets/$2)')
  // Standalone (in references section) — no author-year wrapper available.
  out = out.replace(/\{pub_id:(\d+)\}/g, '[→](/publications/$1)')
  out = out.replace(/\{doc_id:(\d+)\}/g, '[→](/documents/$1)')
  out = out.replace(/\{dataset_id:(\d+)\}/g, '[→](/datasets/$1)')
  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Generating Future Scenarios (set=${setArg}, model=${modelArg} → ${modelId}, dryRun=${dryRun})`)

  const setDefs = loadDefinitions(setArg!)
  console.log(`  Set: ${setDefs.set_metadata.name} (framework v${setDefs.set_metadata.framework_version})`)

  const targets = slugArg
    ? setDefs.scenarios.filter((s) => s.slug === slugArg)
    : setDefs.scenarios

  if (targets.length === 0) {
    console.error(`No scenarios match slug=${slugArg ?? '(all)'}`)
    process.exit(1)
  }

  console.log(`  Targeting ${targets.length} scenario(s): ${targets.map((s) => s.slug).join(', ')}`)

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  let succeeded = 0
  let skipped = 0
  let costTotal = 0

  try {
    for (let i = 0; i < targets.length; i++) {
      const input = targets[i]
      console.log(`\n[${i + 1}/${targets.length}] ${input.name} (slug=${input.slug}, v${input.version})`)

      const outPath = path.join(OUTPUT_DIR, `${input.slug}.md`)
      if (skipExisting && existsSync(outPath)) {
        console.log(`  Skipping (--skip-existing and file exists)`)
        skipped++
        continue
      }

      const ctx = await assembleScenarioContext(pool, setArg!, input.slug)
      const prompt = buildPrompt(ctx)
      console.log(`  Context: ${(prompt.length / 1000).toFixed(1)}k chars`)
      console.log(`  Sibling scenarios: ${ctx.siblings.length} (shared inflection IDs: ${ctx.siblings.flatMap((s) => s.shared_inflection_ids).join(', ') || 'none yet'})`)

      if (dryRun) {
        console.log(`  (DRY RUN) — prompt preview:`)
        console.log(prompt.slice(0, 1500))
        console.log(`  ... (${prompt.length - 1500} more chars omitted)`)
        continue
      }

      const { data, response } = await callClaudeJson<ScenarioOutput>({
        apiKey: ANTHROPIC_API_KEY!,
        prompt,
        content:
          'Generate the scenario described above. Output JSON only, no code fences.',
        maxTokens: 32768,
        model: modelId,
      })

      if (!data?.synopsis) {
        console.log(`  No synopsis in response (cost: $${response.cost.toFixed(3)})`)
        console.log(`  Response start: ${response.text.slice(0, 300)}`)
        continue
      }

      const markdown = assembleMarkdown(ctx.setDefinitions, input, data)
      const processed = postProcessCitations(markdown)
      costTotal += response.cost

      writeFileSync(outPath, processed)

      console.log(`  ✓ Scenario written (${processed.length} chars, cost: $${response.cost.toFixed(3)})`)
      console.log(`    → ${path.relative(REPO_ROOT, outPath)}`)
      succeeded++
    }
  } finally {
    await pool.end()
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
