/**
 * Stage 1 of the "frontiers" pipeline (prototype).
 *
 * For each neighborhood primer, extract 3-7 atomic frontier statements
 * from the "Current frontier" and "Open questions" sections. Each statement
 * is a specific, actionable knowledge gap with structured tags for
 * concepts/protocols at stake, datasets that would help, and a 0-3
 * management-relevance score.
 *
 * Output goes to scripts/output/frontiers-extracted.json for inspection
 * before we commit to a DB schema or clustering step. No DB writes.
 *
 * Usage:
 *   npx tsx scripts/extract-frontiers.ts                # process all primers
 *   npx tsx scripts/extract-frontiers.ts --limit=5      # quick sample
 *   npx tsx scripts/extract-frontiers.ts --id=14        # one neighborhood
 *   npx tsx scripts/extract-frontiers.ts --model=opus   # default sonnet
 *   npx tsx scripts/extract-frontiers.ts --dry-run      # show prompts, no calls
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0') || 100000
const onlyId = args.find((a) => a.startsWith('--id='))?.split('=')[1]
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-sonnet-4-6'
// Context tiers: 'minimal' = frontier + open-questions sections only (~2.5K chars)
//                'primer'  = full primer text (~10K chars)
//                'rich'    = full primer + top N cited papers' abstracts + keyFindings (~20K chars)
const contextTier = args.find((a) => a.startsWith('--context='))?.split('=')[1] || 'rich'
const paperContextN = parseInt(args.find((a) => a.startsWith('--papers='))?.split('=')[1] || '8')
const outputSuffix = args.find((a) => a.startsWith('--output-suffix='))?.split('=')[1] || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// Section names as they appear in primer text (case-insensitive match).
// Keep in sync with PRIMER_HEADERS in src/app/(frontend)/neighborhoods/[id]/page.tsx.
const FRONTIER_SECTIONS = new Set([
  'current frontier',
  'open questions',
  'current challenges and future directions',
])
const ANY_HEADER = new Set([
  'background', 'foundational work', 'key findings', 'current frontier', 'open questions', 'references',
  'historical context', 'management actions and stakeholder roles', 'current challenges and future directions',
  'connections to research',
])

/**
 * Pull out the prose under the "Current frontier" and "Open questions"
 * sections from a primer. Returns { frontier, openQuestions } trimmed text.
 */
function extractFrontierSections(primer: string): { frontier: string; openQuestions: string; allRelevant: string } {
  const lines = primer.split('\n')
  let currentSection: string | null = null
  const buckets: Record<string, string[]> = { 'current frontier': [], 'open questions': [], 'current challenges and future directions': [] }

  for (const line of lines) {
    const trimmed = line.trim()
    const headerCandidate = trimmed.replace(/^#{1,3}\s+/, '').toLowerCase()
    if (ANY_HEADER.has(headerCandidate)) {
      currentSection = FRONTIER_SECTIONS.has(headerCandidate) ? headerCandidate : null
      continue
    }
    if (currentSection && trimmed) {
      buckets[currentSection].push(trimmed)
    }
  }

  // Strip the markdown link wrappers so the LLM sees clean prose with
  // citation labels intact, e.g. "(Smith, 2025)" instead of "[Smith, 2025](/publications/N)".
  const cleanLinks = (s: string) => s.replace(/\[([^\]]+)\]\(\/[^)]+\)/g, '$1')

  const frontier = cleanLinks(buckets['current frontier'].join(' '))
  const openQuestions = cleanLinks(buckets['open questions'].join(' '))
  const challenges = cleanLinks(buckets['current challenges and future directions'].join(' '))
  const allRelevant = [
    frontier && `## Current Frontier\n${frontier}`,
    openQuestions && `## Open Questions\n${openQuestions}`,
    challenges && `## Current Challenges and Future Directions\n${challenges}`,
  ].filter(Boolean).join('\n\n')

  return { frontier, openQuestions, allRelevant }
}

const EXTRACTION_PROMPT = `You are extracting "frontier statements" from a research primer for the RMBL Knowledge Fabric.

A frontier statement is an atomic, specific, actionable knowledge gap — what we don't yet understand, what would resolve it, and what tools / data / concepts are at stake. We will later cluster these statements across primers to identify cross-cutting research priorities.

INPUT may include:
- The primer's "Current Frontier" and "Open Questions" sections (always)
- The rest of the primer (Background, Foundational Work, Key Findings) — use as context to ground specifics and distinguish what's settled from what's open
- A "Primary sources" appendix with abstracts and key findings from cited papers — pull direct phrasing of unresolved questions from these when available (authors often state open questions explicitly)

For each primer, extract 3-7 statements that meet ALL of these criteria:
- SPECIFIC: names a concrete question, mechanism, or unresolved tension. Not "more research is needed on X."
- ACTIONABLE: implies what would need to happen to resolve it (a measurement, an experiment, a longer time series, a comparison across systems, etc).
- GROUNDED: the source primer text actually supports the statement; do not invent.
- SELF-CONTAINED: a reader who hasn't read the primer can grasp what's at stake from the statement alone.

Reject statements that are vague exhortations to "do more work" — those are not frontiers.

For each statement, also tag:
- concepts: the scientific concepts at stake (e.g. "heritability", "trophic cascade", "vital rates"). Use noun phrases from the primer when possible. Up to 5.
- protocols: methods / approaches that could push the frontier forward, if any are evident (e.g. "mark-recapture", "eDNA sampling", "drone LiDAR"). Up to 5. Empty array OK.
- datasets_needed: kinds of data that would resolve the question (e.g. "long-term hibernation phenology", "fine-scale snowpack maps", "individual-level cortisol time series"). Up to 5. Empty array OK.
- management_relevance: integer 0-3 scoring whether resolving this would inform land/water/wildlife management decisions:
    0 = pure basic science, no obvious management hook
    1 = indirect: could eventually inform management
    2 = direct: a manager would act differently knowing the answer
    3 = critical: legal/regulatory/stakeholder decision currently waiting on this
- source_section: "frontier" if drawn from Current Frontier, "open_questions" if from Open Questions, "both" if it spans

Return strict JSON:
{
  "statements": [
    {
      "statement": "...",
      "concepts": [...],
      "protocols": [...],
      "datasets_needed": [...],
      "management_relevance": 0,
      "source_section": "frontier"
    }
  ]
}

Return ONLY the JSON. No prose before or after.`

/** Fetch top-N cited papers' abstracts + keyFindings for additional context. */
async function fetchPaperContext(
  db: pg.Pool,
  neighborhoodId: number,
  primerCitations: any,
  limit: number,
): Promise<string> {
  // primer_citations may be [{pub_id: N}, ...] OR empty for older primers.
  // Fall back to neighborhood_members of type 'publication' if empty.
  let pubIds: number[] = []
  if (Array.isArray(primerCitations)) {
    pubIds = primerCitations.map((c: any) => c.pub_id).filter(Boolean)
  }
  if (pubIds.length === 0) {
    const { rows } = await db.query(
      `SELECT entity_id FROM neighborhood_members WHERE neighborhood_id = $1 AND entity_type = 'publication' LIMIT 30`,
      [neighborhoodId],
    )
    pubIds = rows.map((r: any) => r.entity_id)
  }
  if (pubIds.length === 0) return ''

  // Rank by citation count and recency. Take top N.
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, p.year, p.abstract, coalesce(p.external_citation_count, 0) AS cites,
      (SELECT metadata->'keyFindings' FROM content_chunks WHERE item_id = p.id AND collection = 'publications' LIMIT 1) AS findings
    FROM publications p
    WHERE p.id = ANY($1)
    ORDER BY p.external_citation_count DESC NULLS LAST, p.year DESC NULLS LAST
    LIMIT $2
  `, [pubIds, limit])

  if (pubs.length === 0) return ''
  const parts: string[] = ['## Primary sources (cited papers)']
  for (const p of pubs) {
    const abstract = (p.abstract || '').slice(0, 1500).trim()
    const findings = Array.isArray(p.findings) ? p.findings.slice(0, 6).map((f: string) => `- ${f}`).join('\n') : ''
    const block = [
      `### ${p.title} (${p.year || 'n.d.'}) [${p.cites} citations]`,
      abstract && `Abstract: ${abstract}`,
      findings && `Key findings:\n${findings}`,
    ].filter(Boolean).join('\n')
    parts.push(block)
  }
  return parts.join('\n\n')
}

interface ExtractedStatement {
  statement: string
  concepts: string[]
  protocols: string[]
  datasets_needed: string[]
  management_relevance: number
  source_section: 'frontier' | 'open_questions' | 'both'
}

interface NeighborhoodOutput {
  neighborhood_id: number
  community_id: number
  title: string
  size: number
  statements: ExtractedStatement[]
  cost: number
  warnings: string[]
}

async function main() {
  console.log('Extract frontier statements (prototype)')
  console.log('=======================================')
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const whereClauses = ['primer IS NOT NULL']
  const params: any[] = []
  if (onlyId) { whereClauses.push(`id = $${params.length + 1}`); params.push(parseInt(onlyId)) }
  const { rows } = await db.query(
    `SELECT id, community_id, title, size, primer, primer_citations FROM neighborhoods WHERE ${whereClauses.join(' AND ')} ORDER BY size DESC NULLS LAST LIMIT $${params.length + 1}`,
    [...params, limit],
  )
  console.log(`Loaded ${rows.length} primers to process (model: ${model}, context: ${contextTier})`)

  mkdirSync('scripts/output', { recursive: true })
  const outputs: NeighborhoodOutput[] = []
  let totalCost = 0

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const sections = extractFrontierSections(r.primer)
    const warnings: string[] = []
    if (!sections.allRelevant) {
      warnings.push('no frontier or open-questions sections found')
      outputs.push({ neighborhood_id: r.id, community_id: r.community_id, title: r.title, size: r.size, statements: [], cost: 0, warnings })
      console.log(`  [${i + 1}/${rows.length}] ${r.title} — SKIP (no frontier sections)`)
      continue
    }

    // Build context per --context tier
    const cleanPrimer = r.primer.replace(/\[([^\]]+)\]\(\/[^)]+\)/g, '$1')
    let context = sections.allRelevant
    if (contextTier === 'primer' || contextTier === 'rich') {
      context = `# Full primer\n\n${cleanPrimer}`
    }
    if (contextTier === 'rich') {
      const paperCtx = await fetchPaperContext(db, r.id, r.primer_citations, paperContextN)
      if (paperCtx) context = `${context}\n\n${paperCtx}`
    }

    if (dryRun) {
      console.log(`  [${i + 1}/${rows.length}] ${r.title}`)
      console.log(`    context (${context.length} chars, tier: ${contextTier}):`)
      console.log(`    ${context.slice(0, 200).split('\n').join('\n    ')}…`)
      continue
    }

    try {
      const content = `# ${r.title}\n\n${context}`
      const { data, response } = await callClaudeJson<{ statements: ExtractedStatement[] }>({
        apiKey: ANTHROPIC_API_KEY,
        model,
        prompt: EXTRACTION_PROMPT,
        content,
        maxTokens: 2000,
      })
      const statements = data?.statements || []
      if (!statements.length) warnings.push('LLM returned no statements')
      outputs.push({
        neighborhood_id: r.id,
        community_id: r.community_id,
        title: r.title,
        size: r.size,
        statements,
        cost: response.cost,
        warnings,
      })
      totalCost += response.cost
      console.log(`  [${i + 1}/${rows.length}] ${r.title} — ${statements.length} statements, $${response.cost.toFixed(4)}`)
    } catch (err: any) {
      warnings.push(`error: ${err.message?.slice(0, 120)}`)
      outputs.push({ neighborhood_id: r.id, community_id: r.community_id, title: r.title, size: r.size, statements: [], cost: 0, warnings })
      console.log(`  [${i + 1}/${rows.length}] ${r.title} — ERROR ${err.message?.slice(0, 80)}`)
    }
    await sleep(200)
  }

  const outputPath = `scripts/output/frontiers-extracted${outputSuffix ? '-' + outputSuffix : ''}.json`
  writeFileSync(outputPath, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      model,
      context_tier: contextTier,
      paper_context_n: contextTier === 'rich' ? paperContextN : 0,
      neighborhoods_total: rows.length,
      neighborhoods_with_statements: outputs.filter((o) => o.statements.length > 0).length,
      total_statements: outputs.reduce((s, o) => s + o.statements.length, 0),
      total_cost_usd: totalCost,
    },
    neighborhoods: outputs,
  }, null, 2))

  console.log(`\nWritten ${outputPath}`)
  console.log(`  ${outputs.length} neighborhoods processed`)
  console.log(`  ${outputs.reduce((s, o) => s + o.statements.length, 0)} total statements extracted`)
  console.log(`  Total cost: $${totalCost.toFixed(2)}`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
