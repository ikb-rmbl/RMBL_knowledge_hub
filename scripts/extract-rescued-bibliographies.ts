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
 *   4. DOI lookup (CrossRef bibliographic search: title + venue, first author,
 *      year ± 1; titles must agree ≥ 0.75) for citations still unmatched,
 *      cached in scripts/output/bibliographies/doi-lookup.json (failed lookups
 *      are not cached, so a re-run retries them). A found DOI is stored as
 *      cited_doi and matched to a publication with that DOI.
 *   5. --add-missing: a looked-up work the Commons lacks becomes a publication
 *      (CrossRef metadata + authors; data_source 'manual', discovery_method
 *      'manual_entry', rmbl_research left NULL for the review queue — the
 *      yearly lists are "publications by RMBL scientists", not all RMBL
 *      research). The citation then links to it. On --target=neon the row
 *      takes the id of the local row with the same DOI (ids stay aligned).
 *   6. Unmatched citations go to scripts/output/bibliographies/unmatched-<target>.csv:
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
import { crossrefStats, fetchCrossRefWork, searchCrossRefCitation } from './lib/crossref-client.js'
import { extractKeys, matchesAnyTombstone, type TombstoneKeys } from './lib/dedup-keys.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)
const MODEL = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-sonnet-5'
const noLookup = args.includes('--no-lookup')
const addMissing = args.includes('--add-missing')

const OUT = join(import.meta.dirname, 'output', 'bibliographies')
const SOURCE = 'rescued_bibliography'
const CHUNK = 10000
const TITLE_SIM = 0.8

const BIBLIOGRAPHIES = `d.provenance->>'discoveryMethod' = 'wayback_rescue'
  AND (d.document_type = 'bibliography' OR d.title ILIKE 'Bibliography of %' OR d.title ILIKE '%Publications by Rocky Mountain Biological Lab Scientists%')`

const PROMPT = `Below is part of a bibliography from the Rocky Mountain Biological Laboratory's old website. Extract every citation in it. Ignore navigation text ("Return to top", single letters, menus). For each citation return: authors (as written), year (number or null), title (copied exactly as written), venue (journal, book or report, as written, or null), doi (or null), note (e.g. "REU paper; mentor: …", or null). A citation cut off at the start or end of the excerpt: include it only if its title is complete. Return only JSON: {"citations": [{"authors": "...", "year": 1998, "title": "...", "venue": "...", "doi": null, "note": null}]}`

export interface Citation { authors: string | null; year: number | null; title: string; venue: string | null; doi: string | null; note: string | null }

/** "1998a" (an author's first 1998 paper) → 1998; anything without a plausible year → null. */
export function yearOf(y: unknown): number | null {
  const m = /(1[89]\d\d|20\d\d)/.exec(String(y ?? ''))
  return m ? Number(m[1]) : null
}

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

const CROSSREF_TYPES: Record<string, string> = {
  'journal-article': 'article', 'book-chapter': 'chapter', book: 'book', monograph: 'book', 'edited-book': 'book',
  'reference-book': 'book', dissertation: 'thesis',
}

/** A publications row from a CrossRef work. */
export function publicationFromCrossRef(w: any) {
  const strip = (s: string | null | undefined) => (s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null)
  const year = w.issued?.['date-parts']?.[0]?.[0] ?? w['published-print']?.['date-parts']?.[0]?.[0] ?? w['published-online']?.['date-parts']?.[0]?.[0] ?? null
  return {
    title: strip(Array.isArray(w.title) ? w.title[0] : w.title) ?? '',
    year: typeof year === 'number' ? year : null,
    journal: strip(Array.isArray(w['container-title']) ? w['container-title'][0] : w['container-title']),
    volume: w.volume ?? null,
    issue: w.issue ?? null,
    pages: w.page ?? null,
    publisher: w.publisher ?? null,
    doi: String(w.DOI).toLowerCase(),
    abstract: strip(w.abstract),
    type: CROSSREF_TYPES[w.type] ?? 'other',
    authors: (w.author ?? []).filter((a: any) => a.family || a.name).map((a: any) => ({ given: a.given ?? '', family: a.family ?? a.name })),
  }
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
    const rows: (Citation & { doc: number; pub: number | null; dataset: null; document: number | null; method: string | null; conf: number | null })[] = []
    for (const d of docs) {
      for (const raw of byDoc.get(d.id)!) {
        const c = { ...raw, year: yearOf(raw.year) }
        let pub: number | null = null, document: number | null = null, method: string | null = null, conf: number | null = null
        if (c.doi) {
          const { rows: [p] } = await db.query(`SELECT id FROM publications WHERE lower(doi) = lower($1) ORDER BY id LIMIT 1`, [c.doi])
          if (p) { pub = p.id; method = 'doi'; conf = 1 }
        }
        if (!pub) {
          // A short title leaves trigram similarity little to work with: one added
          // word ("The river continuum concept" vs "Testing the river continuum
          // concept") still scores 0.8. Under six words, demand 0.9 and the same year;
          // a record that only adds a subtitle is caught by the prefix rule below.
          const short = c.title.trim().split(/\s+/).length < 6
          const { rows: [p] } = await db.query(
            `SELECT id, similarity(lower(title), lower($1)) AS s FROM publications
              WHERE lower(title) % lower($1) AND similarity(lower(title), lower($1)) >= $2
                AND ($3::int IS NULL OR year IS NULL OR abs(year - $3::int) <= $4)
              -- Ties are duplicate records of one work: break them the same way on every database.
              ORDER BY s DESC, (rmbl_research = 'yes') DESC NULLS LAST, id LIMIT 1`, [c.title, short ? 0.9 : TITLE_SIM, c.year, short ? 0 : 1])
          if (p) { pub = p.id; method = 'title_trigram'; conf = Number(p.s) }
        }
        // A short cited title against a record that adds a subtitle ("Flora of the
        // Gunnison Basin." vs "…: a study in the distribution of plants"): the record's
        // title starts with the cited one. Needs ≥4 words and the SAME year: "The river
        // continuum concept." (1982) must not take "…: fact or fiction?" (1981).
        const stem = c.title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
        if (!pub && c.year && stem.split(' ').length >= 4) {
          const { rows: [p] } = await db.query(
            `SELECT id FROM publications
              WHERE regexp_replace(lower(title), '[^a-z0-9 ]+', ' ', 'g') ~ ('^\\s*' || $1 || '\\M')
                AND year = $2::int
              ORDER BY length(title), id LIMIT 1`, [stem.replace(/ /g, '\\s+'), c.year])
          if (p) { pub = p.id; method = 'title_prefix'; conf = 0.8 }
        }
        // Same main title, different subtitles ("Flora of the Gunnison Basin: Gunnison,
        // Saquache…" vs "…: a study in the distribution of plants").
        const main = c.title.split(':')[0].toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
        if (!pub && c.year && c.title.includes(':') && main.split(' ').length >= 4) {
          const { rows: [p] } = await db.query(
            `SELECT id FROM publications
              WHERE btrim(regexp_replace(regexp_replace(lower(split_part(title, ':', 1)), '[^a-z0-9 ]+', ' ', 'g'), '\\s+', ' ', 'g')) = $1
                AND year IS NOT NULL AND abs(year - $2::int) <= 1
              ORDER BY length(title), id LIMIT 1`, [main, c.year])
          if (p) { pub = p.id; method = 'main_title'; conf = 0.8 }
        }
        if (!pub) {
          const { rows: [x] } = await db.query(
            `SELECT id, similarity(lower(title), lower($1)) AS s FROM documents
              WHERE id <> $3 AND lower(title) % lower($1) AND similarity(lower(title), lower($1)) >= $2
              ORDER BY s DESC, id LIMIT 1`, [c.title, TITLE_SIM, d.id])
          if (x) { document = x.id; method = 'title_trigram_document'; conf = Number(x.s) }
        }
        rows.push({ ...c, doc: d.id, pub, dataset: null, document, method, conf })
      }
    }

    // ---------------------------------------------------------- DOI lookup (+ add missing)
    const lookupPath = join(OUT, 'doi-lookup.json')
    const lookup: Record<string, any> = existsSync(lookupPath) ? JSON.parse(readFileSync(lookupPath, 'utf-8')) : {}
    const saveLookup = () => writeFileSync(lookupPath, JSON.stringify(lookup, null, 1))
    const { rows: tombRows } = await db.query<{ keys: TombstoneKeys }>(`SELECT keys FROM duplicate_tombstones WHERE collection = 'publications'`)
    const tombstones = tombRows.map((t) => t.keys)
    const localDb = target === 'neon' ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null
    let viaDoi = 0, created = 0, wouldCreate = 0, lookupErrors = 0, n = 0
    const todo = rows.filter((r) => !r.pub && !r.document && r.year && !noLookup)
    if (todo.length) console.log(`\nDOI lookup for ${todo.length} unmatched citations (CrossRef, ~1/s; cached)...`)
    for (const r of todo) {
      const key = `${letters(r.title)}|${r.year}`
      if (!(key in lookup)) {
        const family = (r.authors ?? '').split(/[,;]/)[0].trim().split(/\s+/).pop() || null
        const res = await searchCrossRefCitation({ title: r.title, venue: r.venue, firstAuthorFamily: family, year: r.year! })
        if (res.error) { lookupErrors++; continue }
        lookup[key] = res.work
        if (++n % 20 === 0) saveLookup()
      }
      const hit = lookup[key]
      if (!hit?.doi) continue
      r.doi = hit.doi
      const { rows: [p] } = await db.query(`SELECT id FROM publications WHERE lower(doi) = lower($1) ORDER BY id LIMIT 1`, [hit.doi])
      if (p) { r.pub = p.id; r.method = 'doi_lookup'; r.conf = hit.similarity; viaDoi++; continue }
      if (!addMissing) continue
      const wkey = `work:${hit.doi.toLowerCase()}`
      if (!(wkey in lookup)) {
        const w = await fetchCrossRefWork(hit.doi)
        if (w.error) { lookupErrors++; continue }
        lookup[wkey] = w.work
        saveLookup()
      }
      const work = lookup[wkey]
      if (!work) continue
      const pubRow = publicationFromCrossRef(work)
      // The same work can already be here under another DOI (JSTOR vs publisher)
      // or none: match CrossRef's own title before creating anything.
      const { rows: [same] } = await db.query(
        `SELECT id FROM publications WHERE lower(title) % lower($1) AND similarity(lower(title), lower($1)) >= 0.9
            AND ($2::int IS NULL OR year IS NULL OR abs(year - $2::int) <= 1) ORDER BY similarity(lower(title), lower($1)) DESC, id LIMIT 1`,
        [pubRow.title, pubRow.year])
      if (same) { r.pub = same.id; r.method = 'doi_lookup_title'; r.conf = hit.similarity; viaDoi++; continue }
      if (matchesAnyTombstone(extractKeys('publications', { doi: pubRow.doi, title: pubRow.title, year: pubRow.year }), tombstones)) continue
      if (dryRun) { wouldCreate++; continue }
      let explicitId: number | null = null
      if (localDb) {
        const { rows: [l] } = await localDb.query(`SELECT id FROM publications WHERE lower(doi) = lower($1) LIMIT 1`, [pubRow.doi])
        if (!l) { console.log(`  ! not on local yet (run locally first): ${pubRow.doi}`); continue }
        explicitId = l.id
      }
      const { rows: [ins] } = await db.query(
        `INSERT INTO publications (${explicitId ? 'id, ' : ''}title, year, journal, volume, issue, pages, publisher, doi, abstract,
                                   publication_type, data_source, discovery_method, pdf_available, rmbl_research, curated_fields,
                                   created_at, updated_at)
         VALUES (${explicitId ? '$12, ' : ''}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10::enum_publications_publication_type, 'manual', 'manual_entry',
                 false, NULL, $11::jsonb, NOW(), NOW())
         RETURNING id`,
        [pubRow.title, pubRow.year, pubRow.journal, pubRow.volume, pubRow.issue, pubRow.pages, pubRow.publisher, pubRow.doi,
         pubRow.abstract, pubRow.type, '[]', ...(explicitId ? [explicitId] : [])])
      for (const [i, a] of pubRow.authors.entries()) {
        await db.query(
          `INSERT INTO publications_authors (_order, _parent_id, id, given, family) VALUES ($1, $2, gen_random_uuid()::text, $3, $4)`,
          [i + 1, ins.id, a.given, a.family])
      }
      r.pub = ins.id; r.method = 'doi_lookup'; r.conf = hit.similarity; created++
    }
    saveLookup()
    await localDb?.end()
    if (todo.length) {
      const st = crossrefStats()
      console.log(`  matched ${viaDoi} by looked-up DOI; ${dryRun ? `would create ${wouldCreate}` : `created ${created}`} publications` +
        `${addMissing ? '' : ' (--add-missing not set)'}; ${lookupErrors} lookups failed (retry later); CrossRef requests ${st.requests}, retried ${st.retried}`)
    }
    const unmatched = rows.filter((r) => !r.pub && !r.document).map((r) => ({
      bibliography: docs.find((d) => d.id === r.doc)?.title, year: r.year, authors: r.authors, title: r.title, venue: r.venue,
      doi: r.doi ?? '', note: r.note,
    }))
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
