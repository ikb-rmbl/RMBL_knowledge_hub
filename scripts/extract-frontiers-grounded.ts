/**
 * Paper-grounded frontier extraction — Stage B Step 2.
 *
 * Productionizes the Stage-A pilot (scripts/pilot-grounded-frontiers.ts)
 * for full-corpus runs. Writes directly to the database tables shipped in
 * the step-1 schema migration:
 *
 *   - One row in `frontier_extraction_runs` per invocation.
 *   - One row in `frontier_source_statements` per grounded statement, with
 *     `frontier_id = NULL` (the cluster + synthesize stages fill that in).
 *   - One row in `frontier_statement_papers` per verified citation.
 *
 * Design + rationale: specification/grounded-frontiers-design.md §4.1.
 * Pilot script (still useful for dry experiments): pilot-grounded-frontiers.ts.
 *
 * Usage:
 *   npx tsx scripts/extract-frontiers-grounded.ts                  # all neighborhoods
 *   npx tsx scripts/extract-frontiers-grounded.ts --community-ids=0,40,47
 *   npx tsx scripts/extract-frontiers-grounded.ts --papers=30 --model=claude-sonnet-4-6
 *   npx tsx scripts/extract-frontiers-grounded.ts --dry-run        # no DB writes, no LLM calls
 *   npx tsx scripts/extract-frontiers-grounded.ts --limit=5        # cap iterations for smoke tests
 *
 * Tracks: PR #63 (spec) → PR #64 (step 1 schema) → this PR (step 2 extractor).
 */

import pg from 'pg'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'

// ─── Config ───────────────────────────────────────────────────────────

const PIPELINE_VERSION = 'grounded-v1'
const SNIPPET_HARD_CAP = 400

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const PAPERS_PER_NBR = parseInt(args.find(a => a.startsWith('--papers='))?.split('=')[1] || '30')
const MODEL = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'claude-sonnet-4-6'
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Number.POSITIVE_INFINITY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const COMMUNITY_IDS_FILTER = args.find(a => a.startsWith('--community-ids='))
  ?.split('=')[1].split(',').map(s => parseInt(s.trim())).filter(Number.isFinite)

if (!dryRun && !ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Either export it or pass --dry-run.')
  process.exit(1)
}

// ─── Types ────────────────────────────────────────────────────────────

interface KeyFinding {
  finding: string
  confidence?: string
  supportingEvidence?: string
}

interface InputPaper {
  pub_id: number
  year: number | null
  title: string
  abstract: string | null
  keyFindings: KeyFinding[]
}

type StatementKind =
  | 'open_question'
  | 'data_gap'
  | 'methodological_blocker'
  | 'coordination_gap'

type CitationRole = 'articulates' | 'reinforces' | 'addresses' | 'contradicts'

interface Citation {
  pub_id: number
  snippet: string
  role: CitationRole
}

interface RawStatement {
  text: string
  kind: StatementKind
  confidence: 'low' | 'moderate' | 'high'
  cites: Citation[]
}

interface VerifiedCite extends Citation {
  position_in_paper: 'abstract' | 'key_finding' | 'supporting_evidence' | null
  match_confidence: number   // 1.0 = exact, <1.0 = fuzzy-prefix fallback
}

interface GroundedStatement {
  text: string
  kind: StatementKind
  confidence: 'low' | 'moderate' | 'high'
  cites: VerifiedCite[]
}

// ─── Text normalization + grounding helpers (mirror the pilot) ────────

const ENTITIES_RE = /&(?:amp|lt|gt|quot|apos|#39|nbsp|ndash|mdash|times|deg);/g
function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function trimTrailingEllipsis(s: string): string {
  return s.replace(/[\s,;:!?]*(?:\.\.\.|…|\.\.|\.)\s*$/g, '').trimEnd()
}

function longestVerbatimPrefix(needle: string, haystack: string): number {
  if (needle.length === 0) return 0
  let lo = 1, hi = needle.length, best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (haystack.includes(needle.slice(0, mid))) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/**
 * Verify a cite's snippet appears verbatim in the source paper, and
 * detect which field (abstract / key finding / supporting evidence) it
 * came from. Returns null if the snippet can't be grounded.
 */
function verifyCite(cite: Citation, paper: InputPaper): VerifiedCite | null {
  const trimmedSnippet = trimTrailingEllipsis(cite.snippet)
  if (trimmedSnippet.length < 20) return null
  if (cite.snippet.length > SNIPPET_HARD_CAP) return null

  const needle = normalize(trimmedSnippet)

  // Search each field separately so we can record position_in_paper.
  type Search = { haystack: string; position: VerifiedCite['position_in_paper'] }
  const searches: Search[] = []
  if (paper.abstract) {
    searches.push({ haystack: normalize(paper.abstract), position: 'abstract' })
  }
  for (const f of paper.keyFindings) {
    if (f.finding) searches.push({ haystack: normalize(f.finding), position: 'key_finding' })
    if (f.supportingEvidence) searches.push({ haystack: normalize(f.supportingEvidence), position: 'supporting_evidence' })
  }
  // Also let the title contribute — short, occasionally cited.
  if (paper.title) searches.push({ haystack: normalize(paper.title), position: 'abstract' })

  // Exact match first; fallback to fuzzy prefix.
  for (const s of searches) {
    if (s.haystack.includes(needle)) {
      return { ...cite, position_in_paper: s.position, match_confidence: 1.0 }
    }
  }
  for (const s of searches) {
    const prefix = longestVerbatimPrefix(needle, s.haystack)
    if (prefix >= Math.max(40, Math.floor(needle.length * 0.9))) {
      return {
        ...cite,
        position_in_paper: s.position,
        match_confidence: Number((prefix / needle.length).toFixed(3)),
      }
    }
  }
  return null
}

// ─── Prompt + LLM call ────────────────────────────────────────────────

function renderPapersForPrompt(papers: InputPaper[]): string {
  const parts: string[] = []
  for (const p of papers) {
    parts.push(`### PUB #${p.pub_id} (${p.year ?? 'n.d.'})`)
    parts.push(`Title: ${p.title}`)
    if (p.abstract) parts.push(`Abstract: ${p.abstract.replace(/\s+/g, ' ').trim()}`)
    if (p.keyFindings.length > 0) {
      parts.push(`Key findings (with supporting quotes from the paper):`)
      for (const f of p.keyFindings) {
        const ev = f.supportingEvidence ? ` — Supporting: "${f.supportingEvidence}"` : ''
        parts.push(`  - [${f.confidence ?? 'unknown'}] ${f.finding}${ev}`)
      }
    }
    parts.push('')
  }
  return parts.join('\n')
}

function buildPrompt(neighborhoodTitle: string, papers: InputPaper[]): string {
  return `You are an expert research synthesist reading a curated set of ${papers.length} research papers from the "${neighborhoodTitle}" research neighborhood at the Rocky Mountain Biological Laboratory.

TASK
Identify atomic frontier statements that the literature articulates. A frontier statement is a specific open question, data gap, methodological blocker, or coordination gap. NOT a finding ("X happens") — only the unanswered side ("we don't know X" / "Y is unresolved" / "the data needed to test Z is unavailable").

GROUNDING REQUIREMENT — STRICT
Each statement MUST cite 1+ specific papers from the input below. Each citation MUST include a VERBATIM SNIPPET drawn from that paper's Abstract, Key finding, or Supporting quote text. The snippet must articulate or reinforce the gap.

SNIPPET LENGTH
Target 80–250 characters per snippet. Hard cap 400 characters — longer snippets will be rejected. Prefer one or two complete sentences that articulate the gap, not a stitched paraphrase.

If you cannot find a verbatim source-text quote that articulates a gap, DO NOT emit the statement. We prefer fewer well-grounded statements over many paraphrased ones.

KINDS
- "open_question": something the literature explicitly notes as unresolved
- "data_gap": specific data the literature says is missing
- "methodological_blocker": a method or tool the literature says is needed
- "coordination_gap": something the literature flags as requiring cross-group integration

INPUT PAPERS

${renderPapersForPrompt(papers)}

OUTPUT FORMAT — STRICT JSON

{
  "statements": [
    {
      "text": "<one specific frontier statement, 1-2 sentences>",
      "kind": "open_question" | "data_gap" | "methodological_blocker" | "coordination_gap",
      "confidence": "low" | "moderate" | "high",
      "cites": [
        {
          "pub_id": <numeric pub_id from input>,
          "snippet": "<VERBATIM substring of the paper's Abstract / Key finding / Supporting evidence text from the input above, 80-250 chars>",
          "role": "articulates" | "reinforces"
        }
      ]
    }
  ]
}

Emit between 3 and 10 statements. If you cannot find at least 3 well-grounded ones, emit fewer. Quality over quantity.`
}

// ─── DB helpers ───────────────────────────────────────────────────────

async function openExtractionRun(db: pg.Pool): Promise<number> {
  const { rows: [r] } = await db.query<{ id: number }>(
    `INSERT INTO frontier_extraction_runs (started_at, pipeline_version, model)
     VALUES (now(), $1, $2) RETURNING id`,
    [PIPELINE_VERSION, MODEL],
  )
  return r.id
}

async function closeExtractionRun(
  db: pg.Pool,
  runId: number,
  stats: { neighborhoods_processed: number; statements_emitted: number; statements_grounded: number; notes?: string },
): Promise<void> {
  await db.query(
    `UPDATE frontier_extraction_runs
        SET finished_at = now(),
            neighborhoods_processed = $2,
            statements_emitted = $3,
            statements_grounded = $4,
            notes = $5
      WHERE id = $1`,
    [runId, stats.neighborhoods_processed, stats.statements_emitted, stats.statements_grounded, stats.notes ?? null],
  )
}

async function insertStatement(
  db: pg.Pool,
  neighborhoodId: number,
  stmt: GroundedStatement,
  runId: number,
): Promise<number> {
  const { rows: [r] } = await db.query<{ id: number }>(
    `INSERT INTO frontier_source_statements
       (frontier_id, neighborhood_id, statement_text, kind, confidence, extraction_run_id)
     VALUES (NULL, $1, $2, $3, $4, $5)
     RETURNING id`,
    [neighborhoodId, stmt.text, stmt.kind, stmt.confidence, runId],
  )
  return r.id
}

async function insertCite(db: pg.Pool, statementId: number, cite: VerifiedCite): Promise<void> {
  await db.query(
    `INSERT INTO frontier_statement_papers
       (statement_id, pub_id, snippet, role, position_in_paper, match_confidence)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [statementId, cite.pub_id, cite.snippet, cite.role, cite.position_in_paper, cite.match_confidence],
  )
}

// ─── Data fetching ────────────────────────────────────────────────────

async function fetchInputPapers(db: pg.Pool, neighborhoodId: number, n: number): Promise<InputPaper[]> {
  // Mix of top-N by citation count and top-N by recency, deduped.
  const half = Math.ceil(n / 2)
  const { rows } = await db.query(
    `
    WITH neighbor_pubs AS (
      SELECT DISTINCT p.id, p.year, p.title, p.abstract,
             coalesce(p.external_citation_count, 0) AS citations,
             cc.metadata->'keyFindings' AS kf
        FROM neighborhood_members nm
        JOIN publications p ON p.id = nm.entity_id
        LEFT JOIN content_chunks cc ON cc.item_id = p.id AND cc.collection = 'publications'
       WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'publication'
         AND (p.abstract IS NOT NULL OR cc.metadata ? 'keyFindings')
    ),
    by_cit AS (
      SELECT * FROM neighbor_pubs ORDER BY citations DESC NULLS LAST LIMIT $2
    ),
    by_recent AS (
      SELECT * FROM neighbor_pubs ORDER BY year DESC NULLS LAST LIMIT $2
    ),
    merged AS (
      SELECT DISTINCT ON (id) * FROM (
        SELECT * FROM by_cit UNION ALL SELECT * FROM by_recent
      ) x
      ORDER BY id
    )
    SELECT id, year, title, abstract, kf FROM merged
    `,
    [neighborhoodId, half],
  )
  return rows.map((r) => ({
    pub_id: r.id,
    year: r.year,
    title: r.title,
    abstract: r.abstract,
    keyFindings: Array.isArray(r.kf) ? r.kf as KeyFinding[] : [],
  }))
}

async function fetchEligibleNeighborhoods(db: pg.Pool): Promise<{ id: number; community_id: number; title: string }[]> {
  const filter = COMMUNITY_IDS_FILTER && COMMUNITY_IDS_FILTER.length > 0
    ? `WHERE n.community_id = ANY($1)`
    : ''
  const params = COMMUNITY_IDS_FILTER && COMMUNITY_IDS_FILTER.length > 0
    ? [COMMUNITY_IDS_FILTER]
    : []
  const { rows } = await db.query(
    `SELECT n.id, n.community_id, n.title
       FROM neighborhoods n
       ${filter}
      ORDER BY n.community_id`,
    params,
  )
  return rows
}

// ─── Per-neighborhood processing ──────────────────────────────────────

interface NeighborhoodStats {
  community_id: number
  neighborhood_id: number
  title: string
  paper_count: number
  emitted: number
  grounded: number
  cites_verified: number
  cites_emitted: number
  cost_usd: number
  skip_reason?: string
}

async function processNeighborhood(
  db: pg.Pool,
  nbr: { id: number; community_id: number; title: string },
  runId: number,
): Promise<NeighborhoodStats> {
  const papers = await fetchInputPapers(db, nbr.id, PAPERS_PER_NBR)
  const baseStats: NeighborhoodStats = {
    community_id: nbr.community_id,
    neighborhood_id: nbr.id,
    title: nbr.title,
    paper_count: papers.length,
    emitted: 0,
    grounded: 0,
    cites_verified: 0,
    cites_emitted: 0,
    cost_usd: 0,
  }
  if (papers.length === 0) {
    return { ...baseStats, skip_reason: 'no source papers with abstract or keyFindings' }
  }

  const prompt = buildPrompt(nbr.title, papers)
  console.log(`  → c${nbr.community_id} "${nbr.title}": ${papers.length} papers, prompt ${prompt.length} chars`)

  if (dryRun) {
    console.log(`     (dry-run: skipping LLM call + DB writes)`)
    return baseStats
  }

  const { data: llmOutput, response } = await callClaudeJson<{ statements: RawStatement[] }>({
    apiKey: ANTHROPIC_API_KEY,
    prompt,
    content: '',
    model: MODEL,
    maxTokens: 4000,
  })
  baseStats.cost_usd = response.cost

  if (!llmOutput || !Array.isArray(llmOutput.statements)) {
    console.log(`     ⚠ LLM JSON parse failed (raw len ${response.text.length})`)
    return { ...baseStats, skip_reason: 'LLM JSON parse failed' }
  }

  // Build a paper lookup so verifyCite can run.
  const papersById = new Map(papers.map(p => [p.pub_id, p]))

  for (const raw of llmOutput.statements) {
    baseStats.emitted += 1
    if (!Array.isArray(raw.cites)) continue

    const verifiedCites: VerifiedCite[] = []
    for (const cite of raw.cites) {
      baseStats.cites_emitted += 1
      const paper = papersById.get(cite.pub_id)
      if (!paper) continue
      const verified = verifyCite(cite, paper)
      if (verified) {
        baseStats.cites_verified += 1
        verifiedCites.push(verified)
      }
    }
    if (verifiedCites.length === 0) continue   // drop ungrounded — per spec Q2

    const stmtId = await insertStatement(db, nbr.id, {
      text: raw.text,
      kind: raw.kind,
      confidence: raw.confidence,
      cites: verifiedCites,
    }, runId)
    for (const cite of verifiedCites) {
      await insertCite(db, stmtId, cite)
    }
    baseStats.grounded += 1
  }

  console.log(`     cost: $${response.cost.toFixed(4)}  emitted=${baseStats.emitted}  grounded=${baseStats.grounded}  cites=${baseStats.cites_verified}/${baseStats.cites_emitted}`)
  return baseStats
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
  const db = new pg.Pool({ connectionString: url })

  console.log(`Grounded frontier extraction (${PIPELINE_VERSION}, ${MODEL})`)
  console.log(`  papers:   ${PAPERS_PER_NBR} per neighborhood`)
  console.log(`  dry-run:  ${dryRun}`)
  if (COMMUNITY_IDS_FILTER && COMMUNITY_IDS_FILTER.length > 0) {
    console.log(`  filter:   community_ids = ${COMMUNITY_IDS_FILTER.join(', ')}`)
  }
  console.log('')

  const eligible = await fetchEligibleNeighborhoods(db)
  const toProcess = eligible.slice(0, LIMIT === Number.POSITIVE_INFINITY ? eligible.length : LIMIT)
  console.log(`Processing ${toProcess.length} neighborhood(s)…`)
  console.log('')

  let runId = -1
  if (!dryRun) {
    runId = await openExtractionRun(db)
    console.log(`  extraction_run_id = ${runId}`)
    console.log('')
  }

  const allStats: NeighborhoodStats[] = []
  for (const nbr of toProcess) {
    const stats = await processNeighborhood(db, nbr, runId)
    allStats.push(stats)
    if (stats.skip_reason) {
      console.log(`     ⊘ skipped: ${stats.skip_reason}`)
    }
  }

  const totals = allStats.reduce((acc, s) => ({
    emitted:        acc.emitted        + s.emitted,
    grounded:       acc.grounded       + s.grounded,
    cites_emitted:  acc.cites_emitted  + s.cites_emitted,
    cites_verified: acc.cites_verified + s.cites_verified,
    cost_usd:       acc.cost_usd       + s.cost_usd,
  }), { emitted: 0, grounded: 0, cites_emitted: 0, cites_verified: 0, cost_usd: 0 })

  if (!dryRun) {
    await closeExtractionRun(db, runId, {
      neighborhoods_processed: toProcess.length,
      statements_emitted: totals.emitted,
      statements_grounded: totals.grounded,
      notes: `${PIPELINE_VERSION} · ${MODEL} · papers=${PAPERS_PER_NBR}`,
    })
  }

  await db.end()

  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Done. ${toProcess.length} neighborhood(s) processed.`)
  console.log(`  statements emitted by LLM:   ${totals.emitted}`)
  console.log(`  statements grounded (kept):  ${totals.grounded} (${totals.emitted > 0 ? Math.round(100 * totals.grounded / totals.emitted) : 0}%)`)
  console.log(`  cites verified verbatim:     ${totals.cites_verified}/${totals.cites_emitted} (${totals.cites_emitted > 0 ? Math.round(100 * totals.cites_verified / totals.cites_emitted) : 0}%)`)
  console.log(`  LLM cost:                    $${totals.cost_usd.toFixed(2)}`)
  if (!dryRun) console.log(`  extraction_run_id:           ${runId}`)
}

main().catch(e => { console.error(e); process.exit(1) })
