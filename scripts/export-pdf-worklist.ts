/**
 * Export PDF Worklist
 *
 * Generates a CSV worklist of publications/documents that need manual PDF
 * acquisition. Used by a technician to systematically search for and download
 * PDFs that automated discovery couldn't find.
 *
 * Each row's `suggested_filename` tells the technician exactly what to name
 * the PDF when they download it (e.g., pub_6497.pdf). The technician then
 * fills in `source_description` and runs `npx tsx scripts/ingest-manual-pdfs.ts`
 * to ingest the dropped PDFs.
 *
 * Usage:
 *   npx tsx scripts/export-pdf-worklist.ts [--limit=200] [--type=article|thesis|all] [--year-min=2010] [--out=path.csv]
 */

import pg from 'pg'
import { writeFileSync } from 'fs'
import { join } from 'path'
import './lib/config.js'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : 200
const typeArg = args.find((a) => a.startsWith('--type='))?.split('=')[1] || 'all'
const yearMinArg = args.find((a) => a.startsWith('--year-min='))?.split('=')[1]
const yearMin = yearMinArg ? parseInt(yearMinArg, 10) : null
const outArg = args.find((a) => a.startsWith('--out='))?.split('=')[1]
const outPath = outArg || join(OUTPUT_DIR, 'pdf-worklist.csv')

const VALID_TYPES = ['article', 'thesis', 'student_paper', 'chapter', 'book', 'other']

function csvEscape(value: any): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

async function main() {
  console.log('Export PDF Worklist')
  console.log('===================')
  console.log(`Limit: ${limit}`)
  console.log(`Type: ${typeArg}`)
  if (yearMin) console.log(`Year >= ${yearMin}`)
  console.log(`Output: ${outPath}`)
  console.log()

  if (typeArg !== 'all' && !VALID_TYPES.includes(typeArg)) {
    console.error(`Invalid type: ${typeArg}. Valid: ${VALID_TYPES.join(', ')}, all`)
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    const filters: string[] = [
      'p.pdf_link IS NULL',
      'p.full_text IS NULL',
      '(p.pdf_restricted IS NULL OR p.pdf_restricted = false)',
      "(p.doi IS NOT NULL OR p.external_url IS NOT NULL)",
    ]
    const params: any[] = []
    if (typeArg !== 'all') {
      params.push(typeArg)
      filters.push(`p.publication_type = $${params.length}`)
    }
    if (yearMin !== null) {
      params.push(yearMin)
      filters.push(`p.year >= $${params.length}`)
    }
    params.push(limit)

    const { rows } = await db.query(
      `SELECT
         p.id,
         p.publication_type,
         p.year,
         p.title,
         (
           SELECT string_agg(family || ', ' || given, '; ' ORDER BY _order)
           FROM publications_authors a
           WHERE a._parent_id = p.id
         ) as authors,
         p.journal,
         p.volume,
         p.issue,
         p.pages,
         p.doi,
         p.external_url,
         coalesce(p.external_citation_count, 0) as citation_count
       FROM publications p
       WHERE ${filters.join(' AND ')}
       ORDER BY coalesce(p.external_citation_count, 0) DESC, p.year DESC NULLS LAST, p.id
       LIMIT $${params.length}`,
      params,
    )

    console.log(`Found ${rows.length} candidate publications`)

    const headers = [
      'id',
      'publication_type',
      'year',
      'title',
      'authors',
      'journal',
      'volume',
      'issue',
      'pages',
      'doi',
      'external_url',
      'citation_count',
      'suggested_filename',
      'source_description',
      'status',
      'notes',
    ]

    const lines: string[] = [headers.join(',')]
    for (const r of rows) {
      const row = [
        r.id,
        r.publication_type || '',
        r.year || '',
        r.title || '',
        r.authors || '',
        r.journal || '',
        r.volume || '',
        r.issue || '',
        r.pages || '',
        r.doi || '',
        r.external_url || '',
        r.citation_count,
        `pub_${r.id}.pdf`,
        '', // source_description (technician fills in)
        '', // status (technician fills in: 'found', 'not found', 'paywalled', etc.)
        '', // notes
      ]
      lines.push(row.map(csvEscape).join(','))
    }

    writeFileSync(outPath, lines.join('\n') + '\n')
    console.log(`\nWrote ${rows.length} rows to ${outPath}`)
    console.log('\nNext steps for the technician:')
    console.log('  1. Open the CSV in a spreadsheet')
    console.log('  2. For each row: search for the PDF using the DOI or title')
    console.log('  3. Save downloaded PDFs to scripts/output/pdf-staging/manual/ using the suggested_filename')
    console.log('  4. Fill in source_description for each PDF you download (e.g., "via UC Davis library ILL")')
    console.log('  5. Mark status="not found" for papers you cannot access')
    console.log('  6. Save the CSV, then run: npx tsx scripts/ingest-manual-pdfs.ts --worklist=' + outPath)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
