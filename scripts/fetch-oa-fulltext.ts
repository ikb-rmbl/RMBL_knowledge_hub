/**
 * Fetch open-access full text for a list of publications.
 *
 * The PDF pipeline (download-pdfs → extract-text → load-fulltext) works from
 * the legacy pdf-manifest, keyed by old source ids, so recently discovered or
 * ingested papers never get full text through it. This takes publication ids
 * directly: finds an open-access PDF (every Unpaywall location, repositories
 * first, then the record's own pdf_link), saves it to pdf-staging/publications/pub_<id>.pdf (private
 * archive naming), extracts text with lib/pdf-extract, and stores full_text.
 *
 * Text only: pdf_link and served files are untouched, so this stays within the
 * redistribution rules (audit-pdf-rights decides what is served).
 *
 * Written for the SAIL classifier, which needs acknowledgments: 105 recent
 * RMBL articles had no text (2026-10-28). Re-run classify-funding-programs after.
 *
 * Usage:
 *   npx tsx scripts/fetch-oa-fulltext.ts --ids-file=<file> [--dry-run] [--limit=N]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import { STAGING_DIR, UNPAYWALL_API, UNPAYWALL_EMAIL } from './lib/config.js'
import { extractText } from './lib/pdf-extract.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const idsFile = args.find((a) => a.startsWith('--ids-file='))?.split('=')[1]
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
if (!idsFile) { console.error('Usage: npx tsx scripts/fetch-oa-fulltext.ts --ids-file=<file> [--dry-run] [--limit=N]'); process.exit(1) }

const MIN_TEXT = 2000
const UA = 'Mozilla/5.0 (compatible; RMBL-Knowledge-Commons/1.0; +https://rmblknowledgecommons.org)'

/** Every open-access PDF Unpaywall knows for a DOI, repositories first: publisher
 *  "pdfdirect" links (Wiley, AGU) answer scripts with a bot check, while
 *  eScholarship, PMC, OSTI and preprint servers serve the file. */
async function oaLocations(doi: string): Promise<string[]> {
  try {
    const res = await fetch(`${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return []
    const d: any = await res.json()
    const locs = (d.oa_locations ?? []).filter((l: any) => l.url_for_pdf)
    locs.sort((a: any, b: any) => (a.host_type === 'repository' ? 0 : 1) - (b.host_type === 'repository' ? 0 : 1))
    return [...new Set<string>(locs.map((l: any) => l.url_for_pdf))]
  } catch {
    return []
  } finally {
    await new Promise((r) => setTimeout(r, 120)) // Unpaywall's polite rate
  }
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.subarray(0, 4).toString() === '%PDF' ? buf : null // landing pages and paywalls are HTML
  } catch {
    return null
  }
}

async function main() {
  const ids = readFileSync(idsFile!, 'utf-8').split(/\s+/).filter(Boolean).map(Number)
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const dir = join(STAGING_DIR, 'publications')
  mkdirSync(dir, { recursive: true })
  const { rows } = await db.query(
    `SELECT id, doi, pdf_link, length(coalesce(full_text, '')) AS len FROM publications WHERE id = ANY($1) ORDER BY id`,
    [ids],
  )
  const todo = rows.filter((r) => r.len < MIN_TEXT).slice(0, limitArg ? parseInt(limitArg) : undefined)
  console.log(`${ids.length} ids, ${todo.length} without full text${dryRun ? ' (dry-run)' : ''}`)
  const tally = { stored: 0, noPdf: 0, tooShort: 0 }
  try {
    for (const p of todo) {
      const path = join(dir, `pub_${p.id}.pdf`)
      let source = existsSync(path) ? 'staged' : ''
      if (!source) {
        const candidates: string[] = []
        if (p.doi) candidates.push(...(await oaLocations(p.doi)))
        if (p.pdf_link && /^https?:/.test(p.pdf_link)) candidates.push(p.pdf_link)
        for (const url of candidates) {
          const buf = await download(url)
          if (buf) { if (!dryRun) writeFileSync(path, buf); source = new URL(url).host; break }
        }
      }
      if (!source) { tally.noPdf++; console.log(`  ${p.id}: no open-access PDF`); continue }
      if (dryRun) { console.log(`  ${p.id}: PDF from ${source}`); tally.stored++; continue }
      const ex = await extractText(path)
      if (ex.text.length < MIN_TEXT) { tally.tooShort++; console.log(`  ${p.id}: ${ex.text.length} chars extracted (${ex.method}) — skipped`); continue }
      await db.query(`UPDATE publications SET full_text = $1, updated_at = now() WHERE id = $2`, [ex.text.replace(/\u0000/g, ''), p.id])
      tally.stored++
      console.log(`  ${p.id}: ${ex.text.length} chars (${ex.method}, ${ex.pageCount} pp) from ${source}`)
    }
  } finally {
    await db.end()
  }
  console.log(`\n${dryRun ? 'Would store' : 'Stored'} ${tally.stored}; no OA PDF ${tally.noPdf}; too little text ${tally.tooShort}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
