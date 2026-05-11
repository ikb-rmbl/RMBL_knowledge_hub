/**
 * Discover Open-Access PDFs via Semantic Scholar
 *
 * Uses the batch endpoint to check up to 500 DOIs per request,
 * avoiding per-request rate limits. Updates pdf_link in the database.
 *
 * Usage:
 *   npx tsx scripts/discover-pdfs.ts [--dry-run] [--limit=N] [--type=article|thesis|student_paper|all]
 */

import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'
import { curatedSkipClause } from './lib/curation.js'

const S2_BATCH_API = 'https://api.semanticscholar.org/graph/v1/paper/batch'
const BATCH_SIZE = 500 // S2 batch endpoint max
const BATCH_DELAY_MS = 3000 // pause between batches

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity
const typeFilter = args.find((a) => a.startsWith('--type='))?.split('=')[1] || 'all'

async function discoverPdfs(db: pg.Pool): Promise<void> {
  const validTypes = ['article', 'thesis', 'student_paper', 'chapter', 'book', 'other']
  let typeClause = ''
  const params: any[] = []

  if (typeFilter !== 'all') {
    if (!validTypes.includes(typeFilter)) {
      console.error(`Invalid type: ${typeFilter}. Valid: ${validTypes.join(', ')}, all`)
      process.exit(1)
    }
    typeClause = ' AND publication_type = $1'
    params.push(typeFilter)
  }

  const { rows } = await db.query(
    `SELECT id, doi, title, year, publication_type
     FROM publications
     WHERE doi IS NOT NULL AND pdf_link IS NULL
     ${typeClause}
     ORDER BY year DESC NULLS LAST, id`,
    params,
  )

  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} publications need PDF links (${candidates.length} to process)`)

  if (candidates.length === 0) return

  // Build DOI → row lookup
  const doiToRow = new Map<string, (typeof rows)[0]>()
  for (const row of candidates) {
    doiToRow.set(row.doi.toLowerCase(), row)
  }

  const typeCounts = new Map<string, { checked: number; found: number }>()
  let totalFound = 0
  let totalNotFound = 0
  let totalErrors = 0

  // Process in batches
  const batches = []
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE))
  }

  console.log(`  Processing in ${batches.length} batch(es) of up to ${BATCH_SIZE}...\n`)

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const doiIds = batch.map((r) => `DOI:${r.doi}`)

    // Track types for this batch
    for (const row of batch) {
      const typeKey = row.publication_type || 'unknown'
      if (!typeCounts.has(typeKey)) typeCounts.set(typeKey, { checked: 0, found: 0 })
      typeCounts.get(typeKey)!.checked++
    }

    let retries = 0
    let data: any[] | null = null

    while (retries < 5) {
      try {
        const res = await fetch(`${S2_BATCH_API}?fields=openAccessPdf,externalIds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: doiIds }),
        })

        if (res.status === 429) {
          retries++
          const waitMs = 15000 * retries
          console.log(`  Batch ${b + 1}: rate limited, waiting ${waitMs / 1000}s (retry ${retries}/5)...`)
          await sleep(waitMs)
          continue
        }

        if (!res.ok) {
          console.log(`  Batch ${b + 1}: HTTP ${res.status}, skipping`)
          totalErrors += batch.length
          break
        }

        data = await res.json()
        break
      } catch (err: any) {
        retries++
        console.log(`  Batch ${b + 1}: error (${err.message}), retry ${retries}/5...`)
        await sleep(5000 * retries)
      }
    }

    if (!data) continue

    // Process results — batch response is an array in same order as input, with nulls for not-found
    for (let j = 0; j < data.length; j++) {
      const result = data[j]
      const row = batch[j]
      const typeKey = row.publication_type || 'unknown'

      if (!result) {
        totalNotFound++
        continue
      }

      const pdfUrl = result.openAccessPdf?.url
      if (pdfUrl) {
        totalFound++
        typeCounts.get(typeKey)!.found++

        if (dryRun) {
          console.log(`  FOUND: [${row.year}] ${row.title?.slice(0, 70)}`)
          console.log(`         ${pdfUrl}`)
        } else {
          await db.query(`UPDATE publications SET pdf_link = $1 WHERE id = $2 AND ${curatedSkipClause(['pdf_link'])}`, [pdfUrl, row.id])
        }
      }
    }

    const checked = (b + 1) * BATCH_SIZE > candidates.length ? candidates.length : (b + 1) * BATCH_SIZE
    console.log(`\n  Batch ${b + 1}/${batches.length} complete — ${checked} checked, ${totalFound} PDFs found so far`)

    if (b < batches.length - 1) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  // Summary
  console.log('\n  --- Results by type ---')
  for (const [type, counts] of [...typeCounts.entries()].sort((a, b) => b[1].found - a[1].found)) {
    const rate = counts.checked > 0 ? Math.round((100 * counts.found) / counts.checked) : 0
    console.log(`  ${type}: ${counts.found}/${counts.checked} (${rate}%)`)
  }
  console.log(`\n  Total: ${totalFound} PDFs found out of ${candidates.length} checked (${Math.round((100 * totalFound) / candidates.length)}%)`)
  if (totalNotFound > 0) console.log(`  ${totalNotFound} DOIs not in Semantic Scholar`)
  if (totalErrors > 0) console.log(`  ${totalErrors} errors`)
}

async function main() {
  console.log('Discover Open-Access PDFs (Semantic Scholar)')
  console.log('=============================================')
  console.log(`Type filter: ${typeFilter}`)
  if (dryRun) console.log('(DRY RUN — no database updates)')
  if (limit < Infinity) console.log(`Limit: ${limit}`)
  console.log()

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    await discoverPdfs(db)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
