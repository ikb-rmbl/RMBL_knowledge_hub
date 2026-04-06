/**
 * Fetch External Citation Counts
 *
 * Retrieves citation counts from OpenAlex (publications) and DataCite
 * (datasets) and stores them in the database. Supports staleness-based
 * refresh so only stale records are re-fetched.
 *
 * Usage:
 *   npx tsx scripts/fetch-citation-counts.ts [--step=publications|datasets|all] [--dry-run] [--limit=N] [--stale-days=30]
 */

import pg from 'pg'
import { sleep } from './lib/concurrency.js'
import { OPENALEX_API, OPENALEX_MAILTO, DATACITE_API, DELAYS } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const step = args.find((a) => a.startsWith('--step='))?.split('=')[1] || 'all'
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const staleDaysArg = args.find((a) => a.startsWith('--stale-days='))?.split('=')[1]
const staleDays = staleDaysArg ? parseInt(staleDaysArg) : 30

const OPENALEX_BATCH_SIZE = 50 // max DOIs per OpenAlex filter query

// ---------------------------------------------------------------------------
// Publications — OpenAlex batch lookup
// ---------------------------------------------------------------------------

async function fetchPublicationCounts(db: pg.Pool): Promise<void> {
  console.log('\n--- Publications (OpenAlex) ---')

  // Get publications needing citation count update
  const { rows } = await db.query(
    `SELECT id, doi FROM publications
     WHERE doi IS NOT NULL
     AND (citation_count_updated_at IS NULL OR citation_count_updated_at < NOW() - INTERVAL '${staleDays} days')
     ORDER BY id`,
  )

  let candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} publications need update (${candidates.length} to process)`)

  if (candidates.length === 0) {
    console.log('  All citation counts are fresh.')
    return
  }

  // Batch into groups of 50
  let updated = 0
  let withCitations = 0
  let errors = 0

  for (let i = 0; i < candidates.length; i += OPENALEX_BATCH_SIZE) {
    const batch = candidates.slice(i, i + OPENALEX_BATCH_SIZE)
    const doiFilter = batch.map((r) => r.doi).join('|')

    try {
      const url = `${OPENALEX_API}/works?filter=doi:${encodeURIComponent(doiFilter)}&select=doi,cited_by_count&per_page=${OPENALEX_BATCH_SIZE}&mailto=${OPENALEX_MAILTO}`
      const res = await fetch(url)

      if (!res.ok) {
        if (res.status === 429) {
          console.log(`  Rate limited, waiting 5s...`)
          await sleep(5000)
          i -= OPENALEX_BATCH_SIZE // retry this batch
          continue
        }
        errors++
        continue
      }

      const data = await res.json()
      const countByDoi = new Map<string, number>()
      for (const work of data.results || []) {
        const doi = work.doi?.replace('https://doi.org/', '')?.toLowerCase()
        if (doi) countByDoi.set(doi, work.cited_by_count || 0)
      }

      // Update each publication in this batch
      for (const row of batch) {
        const count = countByDoi.get(row.doi.toLowerCase()) ?? 0
        if (!dryRun) {
          await db.query(
            'UPDATE publications SET external_citation_count = $1, citation_count_updated_at = NOW() WHERE id = $2',
            [count, row.id],
          )
        }
        updated++
        if (count > 0) withCitations++
      }
    } catch (err) {
      errors++
    }

    if ((i + OPENALEX_BATCH_SIZE) % 250 === 0 || i + OPENALEX_BATCH_SIZE >= candidates.length) {
      process.stdout.write(`\r  ${Math.min(i + OPENALEX_BATCH_SIZE, candidates.length)}/${candidates.length} (${withCitations} with citations, ${errors} errors)`)
    }

    await sleep(DELAYS.OPENALEX_MS)
  }

  console.log(`\r  ${updated} updated (${withCitations} with citations, ${errors} errors)`)
}

// ---------------------------------------------------------------------------
// Datasets — DataCite individual lookup
// ---------------------------------------------------------------------------

async function fetchDatasetCounts(db: pg.Pool): Promise<void> {
  console.log('\n--- Datasets (DataCite) ---')

  const { rows } = await db.query(
    `SELECT id, doi FROM datasets
     WHERE doi IS NOT NULL
     AND (citation_count_updated_at IS NULL OR citation_count_updated_at < NOW() - INTERVAL '${staleDays} days')
     ORDER BY id`,
  )

  let candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} datasets need update (${candidates.length} to process)`)

  if (candidates.length === 0) {
    console.log('  All citation counts are fresh.')
    return
  }

  let updated = 0
  let withCitations = 0
  let errors = 0

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]

    try {
      const res = await fetch(`${DATACITE_API}/${encodeURIComponent(row.doi)}`)

      if (res.ok) {
        const data = await res.json()
        const count = data.data?.attributes?.citationCount || 0

        if (!dryRun) {
          await db.query(
            'UPDATE datasets SET external_citation_count = $1, citation_count_updated_at = NOW() WHERE id = $2',
            [count, row.id],
          )
        }
        updated++
        if (count > 0) withCitations++
      } else if (res.status === 404) {
        // DOI not in DataCite — set to 0
        if (!dryRun) {
          await db.query(
            'UPDATE datasets SET external_citation_count = 0, citation_count_updated_at = NOW() WHERE id = $2',
            [row.id],
          )
        }
        updated++
      } else {
        errors++
      }
    } catch {
      errors++
    }

    if ((i + 1) % 50 === 0 || i + 1 === candidates.length) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} (${withCitations} with citations, ${errors} errors)`)
    }

    await sleep(DELAYS.METADATA_MS)
  }

  console.log(`\r  ${updated} updated (${withCitations} with citations, ${errors} errors)`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetch External Citation Counts')
  console.log('==============================')
  console.log(`Step: ${step}`)
  console.log(`Stale threshold: ${staleDays} days`)
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
  })

  if (step === 'publications' || step === 'all') {
    await fetchPublicationCounts(db)
  }

  if (step === 'datasets' || step === 'all') {
    await fetchDatasetCounts(db)
  }

  // Summary
  const { rows: pubStats } = await db.query(
    `SELECT count(*) as total,
            count(*) FILTER (WHERE external_citation_count > 0) as with_citations,
            sum(external_citation_count) as total_citations,
            max(external_citation_count) as max_citations
     FROM publications`,
  )
  const { rows: dsStats } = await db.query(
    `SELECT count(*) as total,
            count(*) FILTER (WHERE external_citation_count > 0) as with_citations,
            sum(external_citation_count) as total_citations,
            max(external_citation_count) as max_citations
     FROM datasets`,
  )

  console.log('\n========== Summary ==========')
  console.log(`Publications: ${pubStats[0].with_citations}/${pubStats[0].total} with citations (${pubStats[0].total_citations} total, max ${pubStats[0].max_citations})`)
  console.log(`Datasets:     ${dsStats[0].with_citations}/${dsStats[0].total} with citations (${dsStats[0].total_citations} total, max ${dsStats[0].max_citations})`)

  // Show top cited
  const { rows: topPubs } = await db.query(
    'SELECT title, external_citation_count FROM publications ORDER BY external_citation_count DESC LIMIT 5',
  )
  if (topPubs.length > 0 && topPubs[0].external_citation_count > 0) {
    console.log('\nTop cited publications:')
    for (const p of topPubs) {
      console.log(`  ${p.external_citation_count} — ${p.title.slice(0, 80)}`)
    }
  }

  const { rows: topDs } = await db.query(
    'SELECT title, external_citation_count FROM datasets ORDER BY external_citation_count DESC LIMIT 5',
  )
  if (topDs.length > 0 && topDs[0].external_citation_count > 0) {
    console.log('\nTop cited datasets:')
    for (const d of topDs) {
      console.log(`  ${d.external_citation_count} — ${d.title.slice(0, 80)}`)
    }
  }

  await db.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
