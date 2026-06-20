/**
 * Paper-grounded frontier synthesis — Stage B Step 4.
 *
 * For each cluster produced by `cluster-frontiers-grounded.ts`, calls the
 * LLM to synthesize a named frontier whose `key_questions` and
 * `data_gaps` each carry **verbatim citations** drawn from the input
 * member statements' cite snippets. Every cite is verified against the
 * cluster's input — no LLM-invented citations make it into the output.
 *
 * Reads JSON, writes JSON. DB load happens in a follow-up step (the
 * existing pipeline splits this for the same reason — synthesis is
 * non-deterministic + expensive, and inspecting output before loading
 * keeps cutover safe).
 *
 * Design + rationale: specification/grounded-frontiers-design.md §4.3.
 *
 * Usage:
 *   npx tsx scripts/synthesize-frontiers-grounded.ts
 *   npx tsx scripts/synthesize-frontiers-grounded.ts --input=path/to/clustered.json
 *   npx tsx scripts/synthesize-frontiers-grounded.ts --output=path/to/synthesized.json
 *   npx tsx scripts/synthesize-frontiers-grounded.ts --limit=5
 *   npx tsx scripts/synthesize-frontiers-grounded.ts --model=claude-sonnet-4-6
 *   npx tsx scripts/synthesize-frontiers-grounded.ts --min-cluster-size=2
 *   npx tsx scripts/synthesize-frontiers-grounded.ts --dry-run
 *
 * Tracks: PR #63 (spec) → PR #64 (step 1) → PR #65 (step 2) →
 * PR #66 (step 3) → this PR (step 4).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'

// ─── Config ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Number.POSITIVE_INFINITY
const MODEL = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'claude-opus-4-7'
const MIN_CLUSTER = parseInt(args.find(a => a.startsWith('--min-cluster-size='))?.split('=')[1] || '2')
const INPUT_PATH = args.find(a => a.startsWith('--input='))?.split('=')[1]
  || 'scripts/output/frontiers-clustered-grounded.json'
const OUTPUT_PATH = args.find(a => a.startsWith('--output='))?.split('=')[1]
  || 'scripts/output/frontiers-synthesized-grounded.json'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
if (!dryRun && !ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Either export it or pass --dry-run.')
  process.exit(1)
}

// ─── Types (mirror step-3 output + spec §4.3) ─────────────────────────

interface InputCite {
  pub_id: number
  snippet: string
  role: string
  position_in_paper: string | null
  match_confidence: number | null
  pub_year: number | null
}

interface InputMember {
  statement_id: number
  text: string
  kind: string
  confidence: string
  median_cite_year: number | null
  cites: InputCite[]
}

interface InputCluster {
  cluster_id: number
  size: number
  year_range: [number, number] | null
  year_median: number | null
  neighborhood_distribution: Array<{ id: number; title: string; count: number }>
  representative_text: string
  members: InputMember[]
  union_cite_pub_ids: number[]
  cite_count: number
}

interface InputDoc {
  pipeline_version: string
  extraction_run_id: number
  generated_at: string
  threshold: number
  recency_halflife_years: number
  recency_fresh_window: number
  current_year: number
  total_candidates: number
  clusters: InputCluster[]
}

interface OutputCite {
  pub_id: number
  snippet: string                 // verbatim from one of the input member cites
  role: string
}

interface OutputQuestion {
  text: string
  cites: OutputCite[]
  // year_range derived structurally from the cites' pub_year values
  year_range: [number, number] | null
}

interface PushAction {
  category: string
  effort: string
  action: string
}

interface SynthesizedFrontier {
  cluster_id: number
  title: string
  context: string
  frontier_description: string
  barriers: string
  research_opportunities: string
  impacts: string
  cross_cutting_summary: string
  tractability: 'high' | 'medium' | 'low'
  framing_notes: string | null
  key_questions: OutputQuestion[]
  data_gaps: OutputQuestion[]
  pushing_the_frontier: PushAction[]
  source_cluster_size: number
  source_neighborhoods: number
  source_paper_count: number      // distinct cited pub_ids
  source_year_median: number | null
  source_year_range: [number, number] | null
  cost: number
  dropped_questions_ungrounded: number
  dropped_gaps_ungrounded: number
}

interface OutputDoc {
  pipeline_version: string
  extraction_run_id: number
  synthesis_generated_at: string
  model: string
  source_clusters_total: number
  synthesized_count: number
  frontiers: SynthesizedFrontier[]
}

// ─── Prompt ───────────────────────────────────────────────────────────

function renderClusterForPrompt(cluster: InputCluster): string {
  const lines: string[] = []
  for (let i = 0; i < cluster.members.length; i++) {
    const m = cluster.members[i]
    lines.push(`[S${i + 1}] (${m.kind}, ${m.confidence} confidence, median_cite_year=${m.median_cite_year ?? 'unknown'})`)
    lines.push(`     ${m.text}`)
    for (const c of m.cites) {
      lines.push(`     ↪ cite pub#${c.pub_id} (${c.pub_year ?? 'n.d.'}, ${c.role}, ${c.position_in_paper ?? 'unknown position'}):`)
      lines.push(`         "${c.snippet}"`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

const SYNTHESIS_PROMPT = `You are writing an entry for a "frontier" in the RMBL Knowledge Commons — a coherent boundary between what scientists know and what they don't, with identifiable paths to push the boundary forward.

The narrative-prose fields stay at the level of patterns and forward-looking framing — NOT a literature review. The structured fields (key_questions, data_gaps) carry verbatim citations from primary sources.

INPUT: a cluster of atomic frontier statements, each with verbatim citation snippets drawn from primary literature.

CRITICAL GROUNDING RULE
Each entry in "key_questions" and "data_gaps" MUST include a "cites" array. Every cite must use exactly one of the snippet strings that appears in the input below — do NOT invent, paraphrase, abbreviate, or modify cite snippets. If a question or data gap cannot be grounded in at least one verbatim input cite, DO NOT emit it. Quality over breadth.

You can split, merge, or rephrase the QUESTION text itself, but the CITES propagate verbatim.

Return strict JSON only:

{
  "title": "5-10 word name for the frontier",

  "context": "~80-100 words. Establish the subject and why it matters at a level a science-literate generalist could follow. Concepts and themes, not specific findings. No process-meta phrases ('this cluster', 'these statements', etc.).",

  "frontier_description": "~150-180 words. Diagnose the gap at the level of patterns: what kinds of questions are unresolved, what kinds of integration would advance the boundary. Avoid statistical claims, exact magnitudes, or specific paper attributions in the prose.",

  "key_questions": [
    {
      "text": "<one specific question phrased as a question>",
      "cites": [
        { "pub_id": <number>, "snippet": "<VERBATIM snippet from the input above>", "role": "articulates" | "reinforces" | "addresses" | "contradicts" }
      ]
    }
    // 3-7 entries. Each MUST have at least one cite. Snippets MUST be verbatim from the input.
  ],

  "barriers": "~70-100 words. Categorize the blockers (data gaps, method gaps, scale mismatch, jurisdictional fragmentation, coordination gaps, translation gaps). Name SPECIFIC categories relevant to this frontier.",

  "research_opportunities": "~150-180 words. Forward-looking proposals: new datasets, experiments, models, frameworks. These are proposals, not findings — citations not required here.",

  "data_gaps": [
    {
      "text": "<one specific data gap, named concretely>",
      "cites": [
        { "pub_id": <number>, "snippet": "<VERBATIM snippet>", "role": "articulates" | "reinforces" }
      ]
    }
    // 0-5 entries. Each MUST have at least one cite. Same verbatim rule.
  ],

  "pushing_the_frontier": [
    {
      "category": "data" | "experiment" | "model" | "synthesis" | "framework" | "infrastructure" | "collaboration" | "other",
      "effort":   "near-term" | "ambitious" | "major" | "consortium",
      "action":   "<1-2 sentence proposal naming what to do specifically>"
    }
    // 4-8 entries. No cites required on actions.
  ],

  "impacts": "~100-130 words. Who would benefit and how. Named decision contexts are appropriate. Do NOT invent management hooks for basic-science frontiers — if impact is primarily within research, say that plainly.",

  "cross_cutting_summary": "1 sentence on which research areas the frontier bridges and why the bridge matters.",

  "tractability": "high" | "medium" | "low",

  "framing_notes": "Optional 1-sentence audit note explaining a non-obvious choice (e.g. why a basic-science frontier has no policy impact)."
}

RULES
1. NO process-meta phrases in prose ('this cluster', 'this frontier addresses', 'these statements', etc.).
2. Stay HIGH-LEVEL in narrative prose. Specifics belong in key_questions / data_gaps cites.
3. EVERY key_question and data_gap MUST carry ≥1 verbatim cite from the input below. No exceptions.
4. Cite snippets must be EXACT substrings of the input. The verifier will reject any non-verbatim snippet by string match.
5. If you cannot find enough verbatim-supportable questions/gaps to fill the minimum counts, emit fewer. Quality over quantity.

Return strict JSON only.`

function buildPrompt(cluster: InputCluster): string {
  const neighborhoods = cluster.neighborhood_distribution
    .map(n => `  - ${n.title} (${n.count} statement${n.count === 1 ? '' : 's'})`)
    .join('\n')
  const yearInfo = cluster.year_range
    ? `Citation year range: ${cluster.year_range[0]}–${cluster.year_range[1]}, median ${cluster.year_median}`
    : 'No citation year info available'

  return `${SYNTHESIS_PROMPT}

CLUSTER METADATA
- ${cluster.size} member statement${cluster.size === 1 ? '' : 's'}
- ${cluster.union_cite_pub_ids.length} distinct cited paper${cluster.union_cite_pub_ids.length === 1 ? '' : 's'}
- ${yearInfo}
- Contributing research neighborhoods:
${neighborhoods}

CLUSTER MEMBER STATEMENTS (with verbatim citation snippets from primary sources):

${renderClusterForPrompt(cluster)}`
}

// ─── Verbatim cite verification ───────────────────────────────────────

/**
 * Build the set of input cite snippets (normalized to whitespace) so we
 * can check whether an LLM-emitted cite snippet is verbatim. The
 * verifier matches normalized substrings, not exact bytes — small
 * whitespace / case differences shouldn't reject a real verbatim cite.
 */
function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

interface InputCiteLookup {
  // pub_id → list of normalized cite snippet strings from the input,
  // keyed by their original (unnormalized) snippet text.
  byPubId: Map<number, Array<{ original: string; normalized: string }>>
}

function buildLookup(cluster: InputCluster): InputCiteLookup {
  const byPubId = new Map<number, Array<{ original: string; normalized: string }>>()
  for (const m of cluster.members) {
    for (const c of m.cites) {
      const bucket = byPubId.get(c.pub_id) ?? []
      bucket.push({ original: c.snippet, normalized: normalize(c.snippet) })
      byPubId.set(c.pub_id, bucket)
    }
  }
  return { byPubId }
}

/** Returns the (canonical) verbatim cite if the LLM-emitted snippet
 *  matches an input cite for the same pub_id — exact substring on
 *  normalized text. Returns null if the snippet isn't grounded. */
function findGroundedCite(
  emitted: { pub_id: number; snippet: string; role: string },
  lookup: InputCiteLookup,
  yearByPubId: Map<number, number | null>,
): { cite: OutputCite; year: number | null } | null {
  const bucket = lookup.byPubId.get(emitted.pub_id)
  if (!bucket || bucket.length === 0) return null
  const needle = normalize(emitted.snippet)
  if (needle.length < 20) return null
  for (const inputCite of bucket) {
    if (inputCite.normalized.includes(needle) || needle.includes(inputCite.normalized)) {
      // Prefer the input's original (which we know is exactly from the source)
      // over the LLM's emitted text, so downstream readers see the canonical form.
      return {
        cite: { pub_id: emitted.pub_id, snippet: inputCite.original, role: emitted.role },
        year: yearByPubId.get(emitted.pub_id) ?? null,
      }
    }
  }
  return null
}

function verifyQuestions(
  rawQuestions: Array<{ text: string; cites: Array<{ pub_id: number; snippet: string; role: string }> }>,
  lookup: InputCiteLookup,
  yearByPubId: Map<number, number | null>,
): { kept: OutputQuestion[]; dropped: number } {
  const kept: OutputQuestion[] = []
  let dropped = 0
  for (const q of rawQuestions || []) {
    const verifiedCites: OutputCite[] = []
    const yearsForQuestion: number[] = []
    for (const c of q.cites || []) {
      const result = findGroundedCite(c, lookup, yearByPubId)
      if (result) {
        verifiedCites.push(result.cite)
        if (result.year != null) yearsForQuestion.push(result.year)
      }
    }
    if (verifiedCites.length === 0) {
      dropped++
      continue
    }
    yearsForQuestion.sort((a, b) => a - b)
    kept.push({
      text: q.text,
      cites: verifiedCites,
      year_range: yearsForQuestion.length === 0 ? null : [yearsForQuestion[0], yearsForQuestion[yearsForQuestion.length - 1]],
    })
  }
  return { kept, dropped }
}

// ─── Per-cluster synthesis ────────────────────────────────────────────

async function synthesizeCluster(cluster: InputCluster): Promise<SynthesizedFrontier | null> {
  const prompt = buildPrompt(cluster)
  const yearByPubId = new Map<number, number | null>()
  for (const m of cluster.members) {
    for (const c of m.cites) yearByPubId.set(c.pub_id, c.pub_year)
  }
  const lookup = buildLookup(cluster)

  console.log(`  → cluster ${cluster.cluster_id} (size=${cluster.size}, ${cluster.union_cite_pub_ids.length} cited papers): prompt ${prompt.length} chars`)
  if (dryRun) {
    console.log(`     (dry-run: skipping LLM call)`)
    return null
  }

  const { data, response } = await callClaudeJson<any>({
    apiKey: ANTHROPIC_API_KEY,
    prompt,
    content: '',
    model: MODEL,
    // Bumped 4000 → 8000 — large clusters (size ≥ 12) produce JSON outputs
    // longer than ~3000 tokens once cite snippets are included, and the
    // 4000 limit was truncating mid-array. Cost impact is marginal because
    // we pay per token used, not per allocated cap.
    maxTokens: 8000,
  })
  if (!data) {
    // Dump the raw payload + cluster id so we can diagnose what went wrong.
    // Goes to scripts/output/synth-failures/<run>-<cluster>.txt.
    const dumpDir = 'scripts/output/synth-failures'
    if (!existsSync(dumpDir)) mkdirSync(dumpDir, { recursive: true })
    const dumpPath = `${dumpDir}/cluster-${cluster.cluster_id}.txt`
    writeFileSync(dumpPath, response.text)
    console.log(`     ⚠ LLM JSON parse failed (raw len ${response.text.length}, dumped to ${dumpPath})`)
    return null
  }

  const { kept: keptQuestions, dropped: droppedQ } = verifyQuestions(data.key_questions || [], lookup, yearByPubId)
  const { kept: keptGaps,      dropped: droppedG } = verifyQuestions(data.data_gaps      || [], lookup, yearByPubId)

  const years = cluster.members.flatMap(m => m.cites.map(c => c.pub_year).filter((y): y is number => typeof y === 'number'))
  years.sort((a, b) => a - b)
  const source_year_range: [number, number] | null = years.length === 0 ? null : [years[0], years[years.length - 1]]
  const source_year_median = years.length === 0 ? null : years[Math.floor(years.length / 2)]

  const synthesized: SynthesizedFrontier = {
    cluster_id: cluster.cluster_id,
    title: String(data.title || '').slice(0, 240),
    context: String(data.context || ''),
    frontier_description: String(data.frontier_description || ''),
    barriers: String(data.barriers || ''),
    research_opportunities: String(data.research_opportunities || ''),
    impacts: String(data.impacts || ''),
    cross_cutting_summary: String(data.cross_cutting_summary || ''),
    tractability: ['high', 'medium', 'low'].includes(data.tractability) ? data.tractability : 'medium',
    framing_notes: data.framing_notes ? String(data.framing_notes) : null,
    key_questions: keptQuestions,
    data_gaps: keptGaps,
    pushing_the_frontier: Array.isArray(data.pushing_the_frontier) ? data.pushing_the_frontier : [],
    source_cluster_size: cluster.size,
    source_neighborhoods: cluster.neighborhood_distribution.length,
    source_paper_count: cluster.union_cite_pub_ids.length,
    source_year_median,
    source_year_range,
    cost: response.cost,
    dropped_questions_ungrounded: droppedQ,
    dropped_gaps_ungrounded: droppedG,
  }

  console.log(`     cost: $${response.cost.toFixed(4)}  questions: ${keptQuestions.length} kept / ${droppedQ} dropped  data_gaps: ${keptGaps.length} kept / ${droppedG} dropped`)
  return synthesized
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`Grounded frontier synthesis (${MODEL})`)
  console.log(`  input:        ${INPUT_PATH}`)
  console.log(`  output:       ${OUTPUT_PATH}`)
  console.log(`  min-cluster:  ${MIN_CLUSTER}`)
  console.log(`  dry-run:      ${dryRun}`)
  console.log('')

  const input = JSON.parse(readFileSync(INPUT_PATH, 'utf-8')) as InputDoc
  const eligible = input.clusters.filter(c => c.size >= MIN_CLUSTER)

  // Resume support — if OUTPUT_PATH exists for the same extraction_run_id,
  // load it and skip clusters already synthesized. Lets us recover from
  // mid-run failures without redoing the expensive Opus calls. Re-running
  // from scratch is still possible via `--no-resume`.
  const noResume = args.includes('--no-resume')
  let frontiers: SynthesizedFrontier[] = []
  let alreadyDone = new Set<number>()
  if (!noResume && existsSync(OUTPUT_PATH)) {
    try {
      const prior = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as OutputDoc
      if (prior.extraction_run_id === input.extraction_run_id && Array.isArray(prior.frontiers)) {
        frontiers = prior.frontiers
        alreadyDone = new Set(prior.frontiers.map(f => f.cluster_id))
        console.log(`Resuming from existing output (extraction_run_id=${prior.extraction_run_id}): ${alreadyDone.size} clusters already synthesized`)
      }
    } catch (e) {
      console.warn(`  (existing output unreadable, starting fresh: ${(e as Error).message})`)
    }
  }
  const toProcess = eligible
    .filter(c => !alreadyDone.has(c.cluster_id))
    .slice(0, LIMIT === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : LIMIT)
  console.log(`Loaded ${input.clusters.length} clusters from ${INPUT_PATH}`)
  console.log(`  (filtered to size >= ${MIN_CLUSTER}: ${eligible.length}; resume skip: ${alreadyDone.size}; processing ${toProcess.length})`)
  console.log('')

  // Periodically checkpoint to disk so a crash doesn't lose every prior
  // synthesis since the last full write.
  const CHECKPOINT_EVERY = 5
  let sinceCheckpoint = 0
  const writeOutput = () => {
    const output: OutputDoc = {
      pipeline_version: input.pipeline_version,
      extraction_run_id: input.extraction_run_id,
      synthesis_generated_at: new Date().toISOString(),
      model: MODEL,
      source_clusters_total: input.clusters.length,
      synthesized_count: frontiers.length,
      frontiers,
    }
    if (!existsSync(dirname(OUTPUT_PATH))) mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))
  }

  for (const cluster of toProcess) {
    const f = await synthesizeCluster(cluster)
    if (f) {
      frontiers.push(f)
      sinceCheckpoint++
      if (sinceCheckpoint >= CHECKPOINT_EVERY) {
        writeOutput()
        sinceCheckpoint = 0
        console.log(`     · checkpoint: ${frontiers.length}/${eligible.length} written to disk`)
      }
    }
    // Brief courtesy pause between clusters
    if (!dryRun) await sleep(300)
  }
  writeOutput()

  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const totalCost = frontiers.reduce((acc, f) => acc + f.cost, 0)
  const totalQ = frontiers.reduce((acc, f) => acc + f.key_questions.length, 0)
  const totalG = frontiers.reduce((acc, f) => acc + f.data_gaps.length, 0)
  const totalDroppedQ = frontiers.reduce((acc, f) => acc + f.dropped_questions_ungrounded, 0)
  const totalDroppedG = frontiers.reduce((acc, f) => acc + f.dropped_gaps_ungrounded, 0)
  console.log(`Done. ${frontiers.length} frontier(s) synthesized.`)
  console.log(`  total grounded questions: ${totalQ}  (dropped ${totalDroppedQ} ungrounded)`)
  console.log(`  total grounded data_gaps: ${totalG}  (dropped ${totalDroppedG} ungrounded)`)
  console.log(`  LLM cost:                 $${totalCost.toFixed(2)}`)
  console.log(`  output:                   ${OUTPUT_PATH}`)
}

main().catch(e => { console.error(e); process.exit(1) })
