/**
 * Link the research abstracts rescued from the legacy rmbl.org site
 * ("Research Abstract: <researcher>", 2004) to the research plan they describe
 * and to their author.
 *
 *   1. Candidates: legacy/2022+ research plans filed by the same researcher
 *      (surname + first initial, any of the names in a joint abstract) whose
 *      years overlap the abstract's ± WINDOW years.
 *   2. Pick by content: cosine similarity between the abstract's embedding and
 *      each plan's (plan embeddings cached by text hash in
 *      scripts/output/study-assignment/plan-embeddings.json, as in
 *      link-plan-pis.ts). Link only when the best plan is similar enough
 *      (MIN_SIMILARITY) and clearly better than any other study's
 *      (MARGIN) — a renewal of the same study (same renews_project_id chain)
 *      does not count as a competitor.
 *   3. The abstract joins the plan's documents (projects_rels path
 *      'documents'), and its author is the plan's PI author (pi_author_id,
 *      itself evidence-gated by link-plan-pis.ts) via authors_rels — no author
 *      link without one. Projects whose document list an admin has curated
 *      are skipped.
 *
 * Resolves everything inside the target database (project and author ids
 * differ between local and Neon), so run it once per target. Idempotent: links
 * that exist are left alone. Review list → scripts/output/abstract-links/.
 *
 * Usage:
 *   npx tsx scripts/link-rescued-abstracts.ts [--dry-run] [--target=neon]
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { piKey, personKeys } from './lib/person-names.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

export const WINDOW = 2
export const MIN_SIMILARITY = 0.6
export const MARGIN = 0.05

const OUT = join(import.meta.dirname, 'output', 'abstract-links')
const EMBED_CACHE = join(import.meta.dirname, 'output', 'study-assignment', 'plan-embeddings.json')
const RESCUED = `provenance->>'discoveryMethod' = 'wayback_rescue'`

const parseVec = (s: string) => s.slice(1, -1).split(',').map(Number)
function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return d / Math.sqrt(na * nb)
}

export interface Candidate { id: number; plan_id: string; root: number; similarity: number }

/** Best plan, if it is similar enough and no other study comes close. */
export function choosePlan(cands: Candidate[]): { pick: Candidate | null; reason: string } {
  if (!cands.length) return { pick: null, reason: 'no plan by this researcher in the window' }
  const sorted = [...cands].sort((a, b) => b.similarity - a.similarity)
  const best = sorted[0]
  if (best.similarity < MIN_SIMILARITY) return { pick: null, reason: `best plan only ${best.similarity.toFixed(2)} similar` }
  const rival = sorted.find((c) => c.root !== best.root)
  if (rival && best.similarity - rival.similarity < MARGIN) {
    return { pick: null, reason: `two studies equally similar (${best.plan_id} ${best.similarity.toFixed(2)} vs ${rival.plan_id} ${rival.similarity.toFixed(2)})` }
  }
  return { pick: best, reason: `similarity ${best.similarity.toFixed(2)}${rival ? `, next study ${rival.similarity.toFixed(2)}` : ''}` }
}

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  mkdirSync(OUT, { recursive: true })
  try {
    const { rows: abstracts } = await db.query<{ id: number; title: string; year: number | null; embedding: string | null }>(
      `SELECT id, title, extract(year FROM date_original)::int AS year, embedding::text AS embedding
         FROM documents WHERE ${RESCUED} AND title LIKE 'Research Abstract:%' ORDER BY id`)
    const { rows: plans } = await db.query<{
      id: number; plan_id: string; pi: string; name: string; description: string | null
      start_year: number | null; end_year: number | null; root: number; pi_author_id: number | null; docs_curated: boolean
    }>(`SELECT id, plan_id, pi, name, description, start_year, end_year, coalesce(renews_project_id, id) AS root,
               pi_author_id, coalesce(curated_fields, '[]'::jsonb) ? 'documents' AS docs_curated
          FROM projects WHERE project_type = 'research_plan' AND pi IS NOT NULL`)
    if (!existsSync(EMBED_CACHE)) throw new Error(`Plan embedding cache missing: ${EMBED_CACHE} (run link-plan-pis.ts first)`)
    const cache: Record<string, number[]> = JSON.parse(readFileSync(EMBED_CACHE, 'utf-8'))
    const planVec = (p: (typeof plans)[number]) =>
      cache[createHash('sha1').update(`${p.name}. ${p.description ?? ''}`.slice(0, 8000)).digest('hex')]

    const decisions: Record<string, unknown>[] = []
    const links: { doc: number; project: number; author: number | null }[] = []
    for (const a of abstracts) {
      const who = a.title.replace(/^Research Abstract:\s*/, '')
      const keys = new Set(personKeys(who))
      const year = a.year ?? 2004
      const vec = a.embedding ? parseVec(a.embedding) : null
      const cands: (Candidate & { plan: (typeof plans)[number] })[] = []
      for (const p of plans) {
        if (!keys.has(piKey(p.pi))) continue
        if ((p.start_year ?? year) > year + WINDOW || (p.end_year ?? p.start_year ?? year) < year - WINDOW) continue
        const pv = planVec(p)
        cands.push({ id: p.id, plan_id: p.plan_id, root: p.root, similarity: vec && pv ? cosine(vec, pv) : 0, plan: p })
      }
      const { pick, reason } = choosePlan(cands)
      const plan = pick ? cands.find((c) => c.id === pick.id)!.plan : null
      decisions.push({
        document_id: a.id, researcher: who, plan: plan ? `${plan.plan_id} ${plan.start_year}-${plan.end_year} ${plan.name}` : '',
        author_id: plan?.pi_author_id ?? '', reason: plan?.docs_curated ? `${reason}; plan's document list is admin-curated — skipped` : reason,
        candidates: cands.map((c) => `${c.plan_id} ${c.similarity.toFixed(2)}`).join('; '),
      })
      if (plan && !plan.docs_curated) links.push({ doc: a.id, project: plan.id, author: plan.pi_author_id })
    }

    const linkedAuthors = links.filter((l) => l.author).length
    console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}: ${abstracts.length} research abstracts → ${links.length} linked to a plan, ${linkedAuthors} to an author`)
    const csv = (rows: Record<string, unknown>[]) => rows.length
      ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))].join('\n') + '\n' : ''
    writeFileSync(join(OUT, `decisions-${target}.csv`), csv(decisions))
    console.log(`Decisions → ${join(OUT, `decisions-${target}.csv`)}`)
    if (dryRun) return

    const client = await db.connect()
    let projNew = 0, authNew = 0
    try {
      await client.query('BEGIN')
      for (const l of links) {
        const p = await client.query(
          `INSERT INTO projects_rels ("order", parent_id, path, documents_id)
           SELECT coalesce((SELECT max("order") FROM projects_rels WHERE parent_id = $1 AND path = 'documents'), 0) + 1, $1, 'documents', $2
            WHERE NOT EXISTS (SELECT 1 FROM projects_rels WHERE parent_id = $1 AND path = 'documents' AND documents_id = $2)`,
          [l.project, l.doc])
        projNew += p.rowCount ?? 0
        if (l.author) {
          const r = await client.query(
            `INSERT INTO authors_rels (parent_id, path, documents_id, "order")
             SELECT $1, 'documents', $2, coalesce((SELECT max("order") FROM authors_rels WHERE parent_id = $1 AND path = 'documents'), 0) + 1
              WHERE NOT EXISTS (SELECT 1 FROM authors_rels WHERE parent_id = $1 AND path = 'documents' AND documents_id = $2)`,
            [l.author, l.doc])
          authNew += r.rowCount ?? 0
        }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    console.log(`Added ${projNew} plan links and ${authNew} author links.`)
  } finally {
    await db.end()
  }
}

if (process.argv[1]?.endsWith('link-rescued-abstracts.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
