/**
 * Load Referenced Works from Document/Longform Extractions
 *
 * Reads extraction JSON files and inserts each extracted referenced work into
 * references_cited. Handles both document-sourced refs (source_document_id) and
 * publication-sourced refs from longform extraction (source_publication_id).
 *
 * The referencedWorks field is LLM-extracted citations of external reports,
 * legislation, studies, books, etc — not necessarily other items in the Hub.
 * Most will remain unlinked (no target_publication_id) but are valuable as
 * citation graph context.
 *
 * Usage:
 *   npx tsx scripts/load-referenced-works.ts [--dry-run]
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

interface Stats {
  inserted: number
  duplicate: number
  skipped: number
  errors: number
}

const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s\]>,]+)/

/** Parse a year value that might be a string or number, extracting the first 4-digit year */
function parseYear(val: any): number | null {
  if (val == null) return null
  const match = String(val).match(/\d{4}/)
  if (!match) return null
  const year = parseInt(match[0], 10)
  return year >= 1600 && year <= 2100 ? year : null
}

/** Try to extract a DOI from an identifier field */
function extractDoi(identifier: string | null | undefined): string | null {
  if (!identifier) return null
  const match = String(identifier).match(DOI_PATTERN)
  return match ? match[1] : null
}

async function processFile(db: pg.Pool, path: string, stats: Stats): Promise<void> {
  console.log(`\n--- ${path} ---`)
  let items: any[]
  try {
    items = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err: any) {
    console.log(`  Could not read file: ${err.message}`)
    return
  }
  console.log(`  ${items.length} items`)

  let fileInserted = 0, fileDuplicate = 0, fileSkipped = 0

  for (const item of items) {
    const extraction = item.strategy3?.extraction
    if (!extraction?.referencedWorks?.length) continue

    // Parse item ID (handle "doc_N" / "pub_N" prefixes from legacy runs)
    const rawId = String(item.id).replace(/^(doc_|pub_|dataset_)/, '')
    const itemId = parseInt(rawId, 10)
    if (!itemId) { fileSkipped += extraction.referencedWorks.length; continue }

    const collection = item.collection
    const sourceCol = collection === 'documents'
      ? 'source_document_id'
      : collection === 'publications'
        ? 'source_publication_id'
        : null
    if (!sourceCol) { fileSkipped += extraction.referencedWorks.length; continue }

    for (const rw of extraction.referencedWorks) {
      if (!rw?.title) { fileSkipped++; continue }

      const title = String(rw.title).slice(0, 500).trim()
      if (!title) { fileSkipped++; continue }
      const authors = rw.authors ? String(rw.authors).slice(0, 500) : null
      const year = parseYear(rw.year)
      const doi = extractDoi(rw.identifier)
      const rawCitation = rw.identifier ? String(rw.identifier).slice(0, 500) : null
      const category = rw.type ? String(rw.type).slice(0, 64) : null

      if (dryRun) { fileInserted++; stats.inserted++; continue }

      try {
        // Dedup by (source_*, lower(title), year) to avoid reinserting on re-runs
        const { rowCount } = await db.query(
          `INSERT INTO references_cited
            (${sourceCol}, cited_title, cited_authors, cited_year, cited_doi, raw_citation,
             reference_category, link_type, extraction_source)
           SELECT $1::int, $2::text, $3::text, $4::int, $5::text, $6::text, $7::text,
                  'external', 'llm_extract'
           WHERE NOT EXISTS (
             SELECT 1 FROM references_cited
             WHERE ${sourceCol} = $1::int
               AND lower(coalesce(cited_title, '')) = lower($2::text)
               AND coalesce(cited_year, 0) = coalesce($4::int, 0)
           )`,
          [itemId, title, authors, year, doi, rawCitation, category],
        )
        if ((rowCount || 0) > 0) { fileInserted++; stats.inserted++ }
        else { fileDuplicate++; stats.duplicate++ }
      } catch (err: any) {
        stats.errors++
        if (stats.errors <= 3) {
          console.log(`    ${collection}:${itemId} "${title.slice(0, 50)}" — ${err.message?.slice(0, 100)}`)
        }
      }
    }
  }

  console.log(`  Inserted ${fileInserted}, duplicate ${fileDuplicate}, skipped ${fileSkipped}`)
}

async function main() {
  console.log('Load Referenced Works')
  console.log('=====================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const stats: Stats = { inserted: 0, duplicate: 0, skipped: 0, errors: 0 }

  try {
    await processFile(db, 'scripts/output/document-entity-extraction.json', stats)
    await processFile(db, 'scripts/output/longform-entity-extraction.json', stats)

    console.log('\n========== Summary ==========')
    console.log(`Inserted: ${stats.inserted}`)
    console.log(`Duplicate: ${stats.duplicate}`)
    console.log(`Skipped: ${stats.skipped}`)
    console.log(`Errors: ${stats.errors}`)

    if (!dryRun) {
      const { rows: [{ count: fromDocs }] } = await db.query(
        `SELECT count(*)::int as count FROM references_cited WHERE source_document_id IS NOT NULL`,
      )
      const { rows: [{ count: llmExtract }] } = await db.query(
        `SELECT count(*)::int as count FROM references_cited WHERE extraction_source = 'llm_extract'`,
      )
      console.log(`\nTotals in DB:`)
      console.log(`  References from documents: ${fromDocs}`)
      console.log(`  References extracted by LLM: ${llmExtract}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
