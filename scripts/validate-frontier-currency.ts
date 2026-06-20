/**
 * Validate frontier currency — step 5/9 of the grounded-frontiers refactor.
 *
 * For each grounded frontier (extraction_run_id IS NOT NULL), walk every
 * key question + data gap and ask "have newer papers in this frontier's
 * neighborhoods substantively addressed this?" Write the verdict back
 * into the jsonb as `currency` + `addressed_by[]`, plus a frontier-level
 * rollup in `question_currency_summary`.
 *
 * Snapshot before writing iff ≥1 item's currency category shifted, so the
 * snapshot table preserves the prior verdict.
 *
 * Reads DB, calls Voyage (embeddings) + Claude (per-item judgement), writes DB.
 *
 * Design + rationale: specification/grounded-frontiers-design.md §4.4 + §10.
 *
 * Usage:
 *   npx tsx scripts/validate-frontier-currency.ts                # all grounded frontiers
 *   npx tsx scripts/validate-frontier-currency.ts --frontier-id=102
 *   npx tsx scripts/validate-frontier-currency.ts --since=180    # validated > 180 days ago
 *   npx tsx scripts/validate-frontier-currency.ts --limit=3 --dry-run
 *   npx tsx scripts/validate-frontier-currency.ts --model=claude-opus-4-7
 *
 * Tracks: PR #63 → #64 → #65 → #66 → #67 → #68 → this PR (step 5).
 */

import pg from 'pg'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { embedTexts, cosineSimilarity } from './lib/embedding-cluster.js'
import { snapshotFrontier } from './lib/frontier-snapshots.js'

// ─── Config ───────────────────────────────────────────────────────────

const TOP_K_CANDIDATES = 15
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const ABSTRACT_BUDGET = 700  // chars per candidate in the LLM prompt
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY

type Currency = 'open' | 'partially_addressed' | 'addressed'

interface Cite { pub_id: number; snippet: string; role?: string }
interface AddressedBy { pub_id: number; mode: 'addressed' | 'partially_addressed'; rationale?: string }

interface GroundedItem {
  text: string
  cites: Cite[]
  year_range?: [number, number] | null
  currency?: Currency
  addressed_by?: AddressedBy[]
  last_checked_at?: string
}

interface PubMeta {
  id: number
  year: number | null
  title: string
  abstract: string | null
  embedding: number[]   // best chunk's embedding (highest-sim against the item)
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseEmbedding(v: any): number[] {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string') return JSON.parse(v)
  throw new Error(`Unexpected embedding shape: ${typeof v}`)
}

/** Per-frontier candidate pool: pubs in any of its neighborhoods, with
 *  year + embedding present. One row per (pub, chunk) so we can rank at
 *  the chunk level then dedupe by pub. */
interface PubChunk {
  id: number
  year: number | null
  title: string
  abstract: string | null
  embedding: number[]
}
async function loadPubChunks(db: pg.Pool | pg.PoolClient, frontierId: number): Promise<PubChunk[]> {
  const { rows } = await db.query<{ id: number; year: number | null; title: string; abstract: string | null; embedding: any }>(
    `SELECT p.id, p.year, p.title, p.abstract, c.embedding
       FROM publications p
       JOIN neighborhood_members nm
         ON nm.entity_type='publication' AND nm.entity_id = p.id
       JOIN frontier_neighborhoods fn
         ON fn.neighborhood_id = nm.neighborhood_id
       JOIN content_chunks c
         ON c.collection='publications' AND c.item_id = p.id
      WHERE fn.frontier_id = $1
        AND p.year IS NOT NULL
        AND c.embedding IS NOT NULL`,
    [frontierId],
  )
  return rows.map(r => ({ id: r.id, year: r.year, title: r.title, abstract: r.abstract, embedding: parseEmbedding(r.embedding) }))
}

/** Pick top-K candidates for `item` from `chunks`, filtered to pubs newer
 *  than the item's year cutoff. Dedupes by pub_id (keeps best chunk). */
function rankCandidates(
  item: GroundedItem,
  itemEmbedding: number[],
  chunks: PubChunk[],
): PubMeta[] {
  const cutoff = item.year_range?.[1] ?? null
  const pool = cutoff == null ? chunks : chunks.filter(c => c.year != null && c.year > cutoff)

  const ranked = pool
    .map(c => ({ chunk: c, sim: cosineSimilarity(itemEmbedding, c.embedding) }))
    .sort((a, b) => b.sim - a.sim)

  const bestByPub = new Map<number, PubMeta>()
  for (const r of ranked) {
    if (!bestByPub.has(r.chunk.id)) {
      bestByPub.set(r.chunk.id, {
        id: r.chunk.id,
        year: r.chunk.year,
        title: r.chunk.title,
        abstract: r.chunk.abstract,
        embedding: r.chunk.embedding,
      })
    }
    if (bestByPub.size >= TOP_K_CANDIDATES) break
  }
  return Array.from(bestByPub.values())
}

interface LLMVerdict {
  currency: Currency
  addressed_by: AddressedBy[]
  cost: number
}

async function judgeItem(
  item: GroundedItem,
  candidates: PubMeta[],
  model: string,
  frontierTitle: string,
): Promise<LLMVerdict> {
  if (candidates.length === 0) {
    // Nothing newer to consider — still open.
    return { currency: 'open', addressed_by: [], cost: 0 }
  }
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required')

  const yearLo = item.year_range?.[0]
  const yearHi = item.year_range?.[1]
  const yearStr = yearLo && yearHi ? `${yearLo}–${yearHi}` : (yearHi ?? '?')

  const prompt = `You are evaluating whether a known open research statement from a research
"frontier" has been substantively addressed by newer literature in the same
neighborhood. Be strict: a paper that *touches the topic* but doesn't
deliver a substantive answer counts as NOT addressed.

FRONTIER: ${frontierTitle}
STATEMENT (source-paper years: ${yearStr}):
"${item.text}"

CANDIDATE PAPERS (all published after the statement's source-paper years):

${candidates.map((c, i) => {
    const abs = c.abstract ? c.abstract.slice(0, ABSTRACT_BUDGET) : '(no abstract)'
    return `[${i + 1}] pub #${c.id} (${c.year ?? '?'}): "${c.title}"\nAbstract: ${abs}`
  }).join('\n\n')}

TASK
For each candidate, decide one of:
- "addressed"            — substantively answers the statement
- "partially_addressed"  — meaningful progress, but the core is still open
- "not_addressed"        — touches the topic but doesn't address the statement

CALIBRATION RULE — STRICT
A paper that merely *studies the same system / topic* without delivering
findings on the specific statement is "not_addressed". Words like "touches
on," "investigates," "related to" in your own rationale are a strong
signal that the verdict should be "not_addressed" (not "partially_addressed").
"Partially_addressed" requires the paper to make concrete progress on the
specific gap the statement names.

Then roll up:
- currency = "addressed"            if ANY candidate is "addressed"
- currency = "partially_addressed"  else if ANY candidate is "partially_addressed"
- currency = "open"                 otherwise

OUTPUT (strict JSON, no prose, no markdown):
{
  "currency": "open" | "partially_addressed" | "addressed",
  "addressed_by": [
    {"pub_id": <int>, "mode": "addressed" | "partially_addressed", "rationale": "<one short sentence>"}
  ]
}

Only include in "addressed_by" papers you classified as addressed or
partially_addressed. Use the exact pub_id integers from the candidate list.`

  const { data, response } = await callClaudeJson<{ currency: Currency; addressed_by: AddressedBy[] }>({
    apiKey: ANTHROPIC_API_KEY,
    prompt,
    content: '',
    model,
    maxTokens: 1024,
  })
  if (!data) {
    // Bad JSON / parse fail — preserve prior verdict, mark cost.
    return { currency: item.currency || 'open', addressed_by: item.addressed_by || [], cost: response.cost }
  }
  // Verify pub_ids are real candidates (drop hallucinations).
  const candidateIds = new Set(candidates.map(c => c.id))
  const verified = (data.addressed_by ?? []).filter(a => candidateIds.has(a.pub_id))
  // If roll-up says "addressed" but no addressed-mode pub survives, demote.
  let currency: Currency = data.currency
  const hasAddressed = verified.some(a => a.mode === 'addressed')
  const hasPartial   = verified.some(a => a.mode === 'partially_addressed')
  if (currency === 'addressed' && !hasAddressed) currency = hasPartial ? 'partially_addressed' : 'open'
  if (currency === 'partially_addressed' && !hasPartial && !hasAddressed) currency = 'open'
  return { currency, addressed_by: verified, cost: response.cost }
}

function rollup(items: GroundedItem[]): Record<Currency, number> {
  const s: Record<Currency, number> = { open: 0, partially_addressed: 0, addressed: 0 }
  for (const i of items) s[(i.currency as Currency) ?? 'open']++
  return s
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }
  if (!VOYAGE_API_KEY)    { console.error('VOYAGE_API_KEY required');    process.exit(1) }

  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const onlyFrontierId = Number.parseInt(args.find(a => a.startsWith('--frontier-id='))?.split('=')[1] || '0') || null
  const sinceDays      = Number.parseInt(args.find(a => a.startsWith('--since='))?.split('=')[1] || '0') || null
  const limit          = Number.parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || null
  const model = args.find(a => a.startsWith('--model='))?.split('=')[1] || DEFAULT_MODEL

  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
  const db = new pg.Pool({ connectionString: url })

  console.log(`Validate frontier currency`)
  console.log(`  model:        ${model}`)
  console.log(`  frontier-id:  ${onlyFrontierId ?? '(all grounded)'}`)
  console.log(`  since-days:   ${sinceDays ?? '(any age)'}`)
  console.log(`  limit:        ${limit ?? '(no cap)'}`)
  console.log(`  dry-run:      ${dryRun}`)
  console.log('')

  // Find frontiers to check.
  let where = 'extraction_run_id IS NOT NULL'
  const params: any[] = []
  if (onlyFrontierId) { params.push(onlyFrontierId); where += ` AND id = $${params.length}` }
  if (sinceDays)      { params.push(sinceDays);      where += ` AND (last_validated_at IS NULL OR last_validated_at < now() - ($${params.length}::int * INTERVAL '1 day'))` }

  const { rows: frontiers } = await db.query<{ id: number; title: string; key_questions: any; data_gaps: any }>(
    `SELECT id, title, key_questions, data_gaps
       FROM frontiers
      WHERE ${where}
   ORDER BY id`,
    params,
  )
  const selected = limit ? frontiers.slice(0, limit) : frontiers
  console.log(`Found ${selected.length} grounded frontier(s) to check\n`)
  if (selected.length === 0) { await db.end(); return }

  // Open validation run.
  const { rows: [vr] } = await db.query<{ id: number }>(
    `INSERT INTO frontier_validation_runs (model_name, notes)
     VALUES ($1, $2) RETURNING id`,
    [model, dryRun ? 'dry-run' : null],
  )
  const runId = vr.id
  console.log(`Validation run id = ${runId}\n`)

  let totalCost = 0
  let totalQuestionsChecked = 0
  let totalCurrencyChanges = 0

  for (const f of selected) {
    console.log(`Frontier #${f.id}: ${f.title}`)
    const chunks = await loadPubChunks(db, f.id)
    console.log(`  pool: ${chunks.length} pub-chunks in this frontier's neighborhoods`)

    const keyQs: GroundedItem[] = Array.isArray(f.key_questions) ? f.key_questions : []
    const gaps:  GroundedItem[] = Array.isArray(f.data_gaps)     ? f.data_gaps     : []

    // Embed all items in one Voyage call (cheaper than per-item).
    const itemTexts = [...keyQs, ...gaps].map(i => i.text)
    if (itemTexts.length === 0) { console.log(`  (no items to validate)\n`); continue }
    const itemEmbeddings = await embedTexts(itemTexts)

    const judged = await Promise.resolve().then(async () => {
      const out: { kind: 'q' | 'g'; idx: number; prev: Currency; v: LLMVerdict }[] = []
      for (let i = 0; i < keyQs.length; i++) {
        const prev = (keyQs[i].currency as Currency) ?? 'open'
        const cands = rankCandidates(keyQs[i], itemEmbeddings[i], chunks)
        const v = await judgeItem(keyQs[i], cands, model, f.title)
        out.push({ kind: 'q', idx: i, prev, v })
      }
      for (let i = 0; i < gaps.length; i++) {
        const prev = (gaps[i].currency as Currency) ?? 'open'
        const cands = rankCandidates(gaps[i], itemEmbeddings[keyQs.length + i], chunks)
        const v = await judgeItem(gaps[i], cands, model, f.title)
        out.push({ kind: 'g', idx: i, prev, v })
      }
      return out
    })

    let changedHere = 0
    const updatedQs: GroundedItem[] = [...keyQs]
    const updatedGs: GroundedItem[] = [...gaps]
    const nowIso = new Date().toISOString()
    for (const j of judged) {
      totalCost += j.v.cost
      const next = j.v.currency
      if (j.prev !== next) changedHere++
      const dest = j.kind === 'q' ? updatedQs : updatedGs
      dest[j.idx] = { ...dest[j.idx], currency: next, addressed_by: j.v.addressed_by, last_checked_at: nowIso }
    }
    totalQuestionsChecked += judged.length
    totalCurrencyChanges += changedHere

    const summary = rollup([...updatedQs, ...updatedGs])
    console.log(`  judged: ${judged.length} items, ${changedHere} currency change(s), $${totalCost.toFixed(4)} cumulative`)
    console.log(`  rollup: open=${summary.open}, partially_addressed=${summary.partially_addressed}, addressed=${summary.addressed}`)

    if (dryRun) { console.log(`  (dry-run: skipped DB write)\n`); continue }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (changedHere > 0) {
        const snapId = await snapshotFrontier(client, f.id, 'validation_currency_shift', { validationRunId: runId })
        if (snapId == null) throw new Error(`Failed to snapshot frontier #${f.id} before currency update`)
      }
      await client.query(
        `UPDATE frontiers
            SET key_questions             = $2::jsonb,
                data_gaps                 = $3::jsonb,
                question_currency_summary = $4::jsonb,
                last_validation_run_id    = $5,
                last_validated_at         = now(),
                updated_at                = now()
          WHERE id = $1`,
        [f.id, JSON.stringify(updatedQs), JSON.stringify(updatedGs), JSON.stringify(summary), runId],
      )
      await client.query('COMMIT')
      console.log(`  ✓ updated frontier #${f.id}${changedHere > 0 ? ' (snapshot taken)' : ''}\n`)
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`✗ frontier #${f.id} update failed; rolled back`)
      throw e
    } finally {
      client.release()
    }
  }

  // Close validation run.
  await db.query(
    `UPDATE frontier_validation_runs
        SET finished_at = now(),
            frontiers_checked = $2,
            questions_checked = $3,
            currency_changes  = $4,
            cost_usd          = $5
      WHERE id = $1`,
    [runId, selected.length, totalQuestionsChecked, totalCurrencyChanges, totalCost.toFixed(4)],
  )
  await db.end()

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Validation run #${runId} complete`)
  console.log(`  frontiers checked: ${selected.length}`)
  console.log(`  items checked:     ${totalQuestionsChecked}`)
  console.log(`  currency changes:  ${totalCurrencyChanges}`)
  console.log(`  total cost:        $${totalCost.toFixed(4)}`)
  if (dryRun) console.log(`  (dry-run — no DB writes other than the validation_runs row)`)
}

main().catch(e => { console.error(e); process.exit(1) })
