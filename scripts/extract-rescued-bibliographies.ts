/**
 * Citations from the bibliographies rescued from the legacy rmbl.org site
 * (yearly "Publications by RMBL Scientists" lists 1998–2003, the complete
 * "Bibliography of Research at RMBL", taxon bibliographies, Mexican Cut, the
 * student-paper bibliography) → references_cited rows on the bibliography
 * document, matched to publications and documents.
 *
 *   1. Claude (Sonnet) reads each bibliography in ~10k-character chunks and
 *      returns its citations (authors, year, title, venue, DOI). A citation is
 *      kept only if its title occurs in the chunk (letters and digits
 *      compared), so nothing invented gets in. Extractions are cached per
 *      document in scripts/output/bibliographies/ — a --target=neon run makes
 *      no LLM calls.
 *   2. Rows are written with extraction_source = 'rescued_bibliography'; a
 *      re-run replaces exactly those rows.
 *   3. Matching (same rules as match-document-citations.ts): exact DOI, then
 *      title similarity ≥ 0.8 to a publication (year within 1 when both have
 *      one), then to a document.
 *   4. Unmatched citations go to scripts/output/bibliographies/unmatched-<target>.csv:
 *      for the yearly lists and the complete bibliography, the candidates
 *      for gaps in the Commons' RMBL publication record.
 *
 * Usage:
 *   npx tsx scripts/extract-rescued-bibliographies.ts [--dry-run] [--target=neon] [--model=]
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { callClaude, parseJsonResponse } from './lib/claude-api.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)
const MODEL = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-sonnet-5'

const OUT = join(import.meta.dirname, 'output', 'bibliographies')
const SOURCE = 'rescued_bibliography'
const CHUNK = 10000
const TITLE_SIM = 0.8

const BIBLIOGRAPHIES = `d.provenance->>'discoveryMethod' = 'wayback_rescue'
  AND (d.document_type = 'bibliography' OR d.title ILIKE 'Bibliography of %' OR d.title ILIKE '%Publications by Rocky Mountain Biological Lab Scientists%')`

const PROMPT = `Below is part of a bibliography from the Rocky Mountain Biological Laboratory's old website. Extract every citation in it. Ignore navigation text ("Return to top", single letters, menus). For each citation return: authors (as written), year (number or null), title (copied exactly as written), venue (journal, book or report, as written, or null), doi (or null), note (e.g. "REU paper; mentor: …", or null). A citation cut off at the start or end of the excerpt: include it only if its title is complete. Return only JSON: {"citations": [{"authors": "...", "year": 1998, "title": "...", "venue": "...", "doi": null, "note": null}]}`

export interface Citation { authors: string | null; year: number | null; title: string; venue: string | null; doi: string | null; note: string | null }

const letters = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')

/** Split on line breaks into chunks of at most `size` characters. */
export function chunks(text: string, size = CHUNK): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > size && cur) { out.push(cur); cur = '' }
    cur += line + '\n'
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** A citation survives only if its title is in the source text. */
export function verified(c: Citation, source: string): boolean {
  const t = letters(c.title ?? '')
  return t.length >= 12 && letters(source).includes(t)
}

async function extract(apiKey: string, docId: number, sourceId: string, text: string): Promise<Citation[]> {
  const file = join(OUT, `${createHash('sha1').update(sourceId).digest('hex').slice(0, 16)}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')).citations
  let all: Citation[] = []
  let cost = 0
  for (const part of chunks(text)) {
    const res = await callClaude({ apiKey, model: MODEL, maxTokens: 16000, messages: [{ role: 'user', content: `${PROMPT}\n\n<bibliography>\n${part}\n</bibliography>` }] })
    cost += res.cost
    const got = parseJsonResponse<{ citations: Citation[] }>(res.text)?.citations ?? []
    all.push(...got.filter((c) => c?.title && verified(c, part)))
  }
  // A citation split across a chunk boundary can come back twice.
  all = [...new Map(all.map((c) => [`${letters(c.title)}|${c.year ?? ''}`, c])).values()]
  writeFileSync(file, JSON.stringify({ document_id: docId, source_id: sourceId, model: MODEL, cost, citations: all }, null, 1))
  console.log(`    extracted ${all.length} citations ($${cost.toFixed(2)})`)
  return all
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  try {
    const { rows: docs } = await db.query<{ id: number; title: string; source_id: string; full_text: string }>(
      `SELECT d.id, d.title, d.provenance->>'sourceId' AS source_id, d.full_text FROM documents d WHERE ${BIBLIOGRAPHIES} ORDER BY d.id`)
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
    console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}: ${docs.length} rescued bibliographies`)
    const byDoc = new Map<number, Citation[]>()
    for (const d of docs) {
      console.log(`  #${d.id} ${d.title.slice(0, 70)}`)
      byDoc.set(d.id, await extract(apiKey, d.id, d.source_id, d.full_text ?? ''))
    }

    // ---------------------------------------------------------- match
    const unmatched: Record<string, unknown>[] = []
    const rows: (Citation & { doc: number; pub: number | null; dataset: null; document: number | null; method: string | null; conf: number | null })[] = []
    for (const d of docs) {
      for (const c of byDoc.get(d.id)!) {
        let pub: number | null = null, document: number | null = null, method: string | null = null, conf: number | null = null
        if (c.doi) {
          const { rows: [p] } = await db.query(`SELECT id FROM publications WHERE lower(doi) = lower($1) LIMIT 1`, [c.doi])
          if (p) { pub = p.id; method = 'doi'; conf = 1 }
        }
        if (!pub) {
          const { rows: [p] } = await db.query(
            `SELECT id, similarity(lower(title), lower($1)) AS s FROM publications
              WHERE lower(title) % lower($1) AND similarity(lower(title), lower($1)) >= $2
                AND ($3::int IS NULL OR year IS NULL OR abs(year - $3::int) <= 1)
              ORDER BY s DESC LIMIT 1`, [c.title, TITLE_SIM, c.year])
          if (p) { pub = p.id; method = 'title_trigram'; conf = Number(p.s) }
        }
        if (!pub) {
          const { rows: [x] } = await db.query(
            `SELECT id, similarity(lower(title), lower($1)) AS s FROM documents
              WHERE id <> $3 AND lower(title) % lower($1) AND similarity(lower(title), lower($1)) >= $2
              ORDER BY s DESC LIMIT 1`, [c.title, TITLE_SIM, d.id])
          if (x) { document = x.id; method = 'title_trigram_document'; conf = Number(x.s) }
        }
        rows.push({ ...c, doc: d.id, pub, dataset: null, document, method, conf })
        if (!pub && !document) unmatched.push({ bibliography: d.title, year: c.year, authors: c.authors, title: c.title, venue: c.venue, note: c.note })
      }
    }
    const matched = rows.filter((r) => r.pub || r.document).length
    console.log(`\n${rows.length} citations: ${rows.filter((r) => r.pub).length} matched to publications, ${rows.filter((r) => r.document).length} to documents, ${rows.length - matched} unmatched`)
    for (const d of docs) {
      const rs = rows.filter((r) => r.doc === d.id)
      if (rs.length) console.log(`  ${String(rs.filter((r) => r.pub || r.document).length).padStart(4)}/${String(rs.length).padEnd(4)} ${d.title.slice(0, 70)}`)
    }
    const csv = (rs: Record<string, unknown>[]) => rs.length
      ? [Object.keys(rs[0]).join(','), ...rs.map((r) => Object.values(r).map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))].join('\n') + '\n' : ''
    writeFileSync(join(OUT, `unmatched-${target}.csv`), csv(unmatched))
    console.log(`Unmatched → ${join(OUT, `unmatched-${target}.csv`)}`)
    if (dryRun) return

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const del = await client.query(`DELETE FROM references_cited WHERE extraction_source = $1 AND source_document_id = ANY($2)`, [SOURCE, docs.map((d) => d.id)])
      for (const r of rows) {
        await client.query(
          `INSERT INTO references_cited (source_document_id, cited_title, cited_authors, cited_year, cited_doi, cited_journal, raw_citation,
                                         target_publication_id, target_document_id, link_type, match_method, match_confidence,
                                         extraction_source, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
          [r.doc, r.title.slice(0, 1000), r.authors?.slice(0, 1000) ?? null, r.year, r.doi, r.venue?.slice(0, 500) ?? null,
           [r.authors, r.year, r.title, r.venue, r.note].filter(Boolean).join('. '),
           r.pub, r.document, r.pub || r.document ? 'internal' : 'external', r.method, r.conf, SOURCE])
      }
      await client.query('COMMIT')
      console.log(`Replaced ${del.rowCount} earlier rows with ${rows.length}.`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  } finally {
    await db.end()
  }
}

if (process.argv[1]?.endsWith('extract-rescued-bibliographies.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
