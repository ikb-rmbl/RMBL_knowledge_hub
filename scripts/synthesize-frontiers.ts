/**
 * Stage 3 of the "frontiers" pipeline: LLM synthesis per cluster into a
 * named, summarized frontier entity. Reads scripts/output/frontiers-
 * clustered.json + frontiers-extracted.json, writes
 * scripts/output/frontiers-synthesized.json. No DB writes.
 *
 * Dual framing: each frontier gets a researcher_framing always, plus a
 * Single flowing narrative (context → frontier → key questions → barriers →
 * research opportunities → impacts) — the `impacts` paragraph carries the
 * management framing inline when warranted, and stays research-focused
 * otherwise. Guardrail: don't invent management hooks for basic-science
 * frontiers; `framing_notes` explains a non-obvious choice.
 *
 * Usage:
 *   npx tsx scripts/synthesize-frontiers.ts                # top N (default 100)
 *   npx tsx scripts/synthesize-frontiers.ts --limit=5     # quick sample
 *   npx tsx scripts/synthesize-frontiers.ts --model=claude-sonnet-4-6
 *   npx tsx scripts/synthesize-frontiers.ts --dry-run     # show prompts, no calls
 */

import pg from 'pg'
import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '100')
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-opus-4-7'
const outputSuffix = args.find((a) => a.startsWith('--output-suffix='))?.split('=')[1] || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

interface AtomicStatement {
  id: number
  neighborhood_id: number
  neighborhood_title: string
  statement: string
  concepts: string[]
  protocols: string[]
  datasets_needed: string[]
  management_relevance: number
  source_section: string
}

interface ClusterSummary {
  cluster_id: number
  size: number
  cross_cutting_score: number
  avg_management_relevance: number
  priority_score: number
  neighborhoods: { id: number; title: string; statement_count: number }[]
  representative_statements: string[]
  union_concepts: { tag: string; count: number }[]
  union_protocols: { tag: string; count: number }[]
  union_datasets: { tag: string; count: number }[]
  mgmt_distribution: number[]
  member_statement_ids: number[]
}

interface SynthesizedFrontier {
  cluster_id: number
  title: string
  context: string
  frontier_description: string
  key_questions: string[]
  barriers: string
  research_opportunities: string
  impacts: string
  cross_cutting_summary: string
  tractability: 'high' | 'medium' | 'low'
  framing_notes: string | null
  // Structural pass-through from cluster aggregates (NOT from LLM) — used
  // downstream for entity linking and detail-page chips.
  linkable_entities: {
    concepts: { tag: string; count: number }[]
    protocols: { tag: string; count: number }[]
    datasets: { tag: string; count: number }[]
  }
  source_cluster_size: number
  source_neighborhoods: number
  avg_management_relevance: number
  cost: number
}

const SYNTHESIS_PROMPT = `You are writing an entry for a "frontier" in the RMBL Knowledge Fabric — a coherent boundary between what scientists know and what they don't, with identifiable paths to push the boundary forward.

The entry will be displayed alongside a structured audit trail of all source statements and cited publications, so the narrative itself should stay at the level of patterns, integration questions, and forward-looking framing — NOT a literature review. Avoid the kinds of specific factual claims (numerical results, exact magnitudes, named studies, attributed findings) that would typically demand inline citations. Those specifics live in the audit trail.

INPUT: a set of atomic frontier statements extracted from research primers about the Rocky Mountain Biological Laboratory and the Gunnison Basin of western Colorado, plus aggregated concepts, methods, data-needs, contributing research neighborhoods, and an avg_management_relevance score (0-3, where 0 = pure basic science, 3 = regulatory/legal decision waiting on this).

WRITE A SINGLE FLOWING NARRATIVE. Return strict JSON only.

{
  "title": "5-10 word name for the frontier",

  "context": "~80-100 words. Establish the subject and why it matters at a level a science-literate generalist could follow. Concepts and themes, not specific findings. Do NOT use process-language like 'this cluster' or 'these statements'.",

  "frontier_description": "~150-180 words. Diagnose the gap at the level of patterns: what kinds of questions are unresolved, what kinds of integration across sub-fields would advance the boundary. Avoid statistical claims, exact magnitudes, or specific paper attributions — these belong in the audit trail. Write about the science directly without process-meta phrasing.",

  "key_questions": [
    "4-7 specific questions the frontier raises, each phrased as a question.",
    "These can be more pointed than the prose because they're questions, not claims.",
    "Favor questions that imply a test or a specific kind of evidence."
  ],

  "barriers": "~70-100 words. Categorize the blockers (data gaps, method gaps, scale mismatch, jurisdictional fragmentation, coordination gaps, translation gaps). Name the SPECIFIC categories relevant to this frontier without enumerating each instance.",

  "research_opportunities": "~150-180 words. Forward-looking proposals: what new datasets, experiments, models, frameworks, or projects could meaningfully advance this frontier? These are proposals, not findings — citations not required. Be concrete in what's being proposed (a paired-catchment dataset, a full-matrix crossing experiment, a coupled simulation platform) without naming specific PIs or institutions.",

  "impacts": "~100-130 words. Who would benefit and how. Named decision contexts (Bureau of Reclamation operations at Aspinall, CWCB instream flow filings, BLM RMP revisions, specific recovery programs) are appropriate here because they describe decision processes, not factual claims. Do NOT invent management hooks for basic-science frontiers — if impact is primarily within research, say that plainly.",

  "cross_cutting_summary": "1 sentence on which research areas the frontier bridges and why the bridge matters.",

  "tractability": "high | medium | low — can existing methods make progress now, or are new methods needed first?",

  "framing_notes": "Optional 1-sentence audit note explaining a non-obvious choice."
}

RULES:

1. NO process-meta phrases anywhere ('this cluster', 'this frontier addresses', 'these statements', 'the research described here', etc.).

2. Stay HIGH-LEVEL in prose. If a sentence makes a claim that a knowledgeable reader would want a citation for, REWRITE it to talk about patterns or integration. Example:
     instead of: "Vital rates have shifted by X% in the past Y years."
     write:      "Demographic responses to climate variability are heterogeneous across the slow-fast life-history spectrum."
   The audit trail carries the citations; the narrative carries the synthesis.

3. EXCEPTION for "impacts": specific named decision contexts (agencies, projects, regulatory instruments) are appropriate because they reference decision processes, not factual claims about findings.

4. EXCEPTION for the frontier subject itself: named species, places, named regulatory frameworks central to the frontier topic are fine throughout.

5. For "impacts": avg_management_relevance < 1.0 OR no specific decisions named in source statements => keep impacts research-focused. Don't invent.

6. Don't fabricate findings. Source statements are the only ground truth.

Return strict JSON only.`

async function fetchNeighborhoodSummaries(db: pg.Pool, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (ids.length === 0) return out
  const { rows } = await db.query(
    `SELECT id, summary FROM neighborhoods WHERE id = ANY($1)`,
    [ids],
  )
  for (const r of rows) out.set(r.id, r.summary || '')
  return out
}

function buildContext(
  cluster: ClusterSummary,
  members: AtomicStatement[],
  nbrSummaries: Map<number, string>,
): string {
  const parts: string[] = []
  parts.push(`avg_management_relevance: ${cluster.avg_management_relevance.toFixed(2)}`)
  parts.push(`management_relevance_distribution (0/1/2/3): ${cluster.mgmt_distribution.join('/')}`)
  parts.push('')
  parts.push(`Contributing research neighborhoods:`)
  for (const n of cluster.neighborhoods) {
    const summary = nbrSummaries.get(n.id)
    parts.push(`  - "${n.title}" (${n.statement_count} statement${n.statement_count > 1 ? 's' : ''} from this cluster)`)
    if (summary) parts.push(`      ${summary}`)
  }
  parts.push('')
  parts.push(`Most-frequent concepts across cluster (count):`)
  for (const c of cluster.union_concepts.slice(0, 10)) parts.push(`  ${c.tag} (${c.count})`)
  parts.push('')
  parts.push(`Most-frequent methods/protocols across cluster (count):`)
  for (const p of cluster.union_protocols.slice(0, 10)) parts.push(`  ${p.tag} (${p.count})`)
  parts.push('')
  parts.push(`Most-frequent data needs across cluster (count):`)
  for (const d of cluster.union_datasets.slice(0, 10)) parts.push(`  ${d.tag} (${d.count})`)
  parts.push('')
  parts.push(`All ${members.length} atomic statements in this cluster:`)
  for (let i = 0; i < members.length; i++) {
    parts.push(`  [${i + 1}] (from "${members[i].neighborhood_title}", mgmt=${members[i].management_relevance})`)
    parts.push(`      ${members[i].statement}`)
  }
  return parts.join('\n')
}

async function main() {
  console.log('Synthesize frontier entities (stage 3)')
  console.log('======================================')
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }

  const clustered = JSON.parse(readFileSync('scripts/output/frontiers-clustered.json', 'utf-8'))
  const extracted = JSON.parse(readFileSync('scripts/output/frontiers-extracted.json', 'utf-8'))

  // Build statement-by-id map
  const stmtById = new Map<number, AtomicStatement>()
  let idCounter = 0
  for (const n of extracted.neighborhoods) {
    for (const s of n.statements || []) {
      stmtById.set(idCounter, {
        id: idCounter,
        neighborhood_id: n.neighborhood_id,
        neighborhood_title: n.title,
        statement: s.statement,
        concepts: s.concepts || [],
        protocols: s.protocols || [],
        datasets_needed: s.datasets_needed || [],
        management_relevance: s.management_relevance || 0,
        source_section: s.source_section || '',
      })
      idCounter++
    }
  }

  const clusters: ClusterSummary[] = clustered.clusters
  const toProcess = clusters.slice(0, limit)
  console.log(`Processing top ${toProcess.length} of ${clusters.length} clusters (model: ${model})`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const allNbrIds = [...new Set(toProcess.flatMap((c) => c.neighborhoods.map((n) => n.id)))]
  const nbrSummaries = await fetchNeighborhoodSummaries(db, allNbrIds)
  console.log(`Loaded summaries for ${nbrSummaries.size} neighborhoods`)
  await db.end()

  const synthesized: SynthesizedFrontier[] = []
  let totalCost = 0

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i]
    const members = c.member_statement_ids.map((id) => stmtById.get(id)!).filter(Boolean)
    const context = buildContext(c, members, nbrSummaries)

    if (dryRun) {
      console.log(`\n=== Cluster #${c.cluster_id} (size=${c.size}, nbrs=${c.neighborhoods.length}, mgmt=${c.avg_management_relevance}) ===`)
      console.log(`Context preview (${context.length} chars):`)
      console.log(context.slice(0, 400) + '\n...')
      continue
    }

    process.stdout.write(`  [${i + 1}/${toProcess.length}] cluster #${c.cluster_id} (n=${c.size}, nbrs=${c.neighborhoods.length}, mgmt=${c.avg_management_relevance.toFixed(1)}) `)
    try {
      const { data, response } = await callClaudeJson<any>({
        apiKey: ANTHROPIC_API_KEY,
        model,
        prompt: SYNTHESIS_PROMPT,
        content: context,
        maxTokens: 4000,
      })
      if (!data) {
        const stopReason = (response as any).stopReason || (response as any).stop_reason || '?'
        const sample = (response.text || '').slice(-300)
        console.log(`— no JSON parse (stop=${stopReason})\n      tail: ${sample.replace(/\n/g, ' ').slice(0, 250)}`)
        continue
      }
      const out: SynthesizedFrontier = {
        cluster_id: c.cluster_id,
        title: data.title || '(untitled)',
        context: data.context || '',
        frontier_description: data.frontier_description || '',
        key_questions: data.key_questions || [],
        barriers: data.barriers || '',
        research_opportunities: data.research_opportunities || '',
        impacts: data.impacts || '',
        cross_cutting_summary: data.cross_cutting_summary || '',
        tractability: data.tractability || 'medium',
        framing_notes: data.framing_notes ?? null,
        linkable_entities: {
          concepts: c.union_concepts,
          protocols: c.union_protocols,
          datasets: c.union_datasets,
        },
        source_cluster_size: c.size,
        source_neighborhoods: c.neighborhoods.length,
        avg_management_relevance: c.avg_management_relevance,
        cost: response.cost,
      }
      synthesized.push(out)
      totalCost += response.cost
      console.log(`→ "${out.title.slice(0, 60)}" ${out.key_questions.length}Q $${response.cost.toFixed(3)}`)
    } catch (err: any) {
      console.log(`— ERROR ${err.message?.slice(0, 80)}`)
    }
    await sleep(300)
  }

  if (dryRun) {
    console.log('\nDry run — no output written')
    return
  }

  const outputPath = `scripts/output/frontiers-synthesized${outputSuffix ? '-' + outputSuffix : ''}.json`
  writeFileSync(outputPath, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      model,
      clusters_processed: synthesized.length,
      total_cost_usd: totalCost,
      frontiers_with_framing_notes: synthesized.filter((s) => s.framing_notes).length,
    },
    frontiers: synthesized,
  }, null, 2))
  console.log(`\nWritten ${outputPath}`)
  console.log(`  Total cost: $${totalCost.toFixed(2)}`)
  console.log(`  Framing notes (audit trail): ${synthesized.filter((s) => s.framing_notes).length} of ${synthesized.length} frontiers`)
}

main().catch((err) => { console.error(err); process.exit(1) })
