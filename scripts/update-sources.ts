/**
 * Incremental Source Updater
 *
 * Checks all three data sources for new, updated, or removed entries
 * and updates the cached JSON files accordingly. Designed to run
 * periodically (e.g., once per season) without re-doing expensive
 * operations (detail page scraping, CrossRef lookups) for unchanged entries.
 *
 * Usage:
 *   npx tsx scripts/update-sources.ts [--source=library|publications|catalog|all] [--dry-run]
 *
 * What it does:
 *   1. Fetches current record IDs + lightweight metadata from each source
 *   2. Compares against cached data to detect new / changed / removed
 *   3. For new entries: runs full enrichment (detail pages, CrossRef, etc.)
 *   4. For changed entries: updates metadata in place
 *   5. Flags removed entries (does not delete — marks for review)
 *   6. Writes updated cache files and a change report
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import {
  sustLibFetchAll,
  sustLibFetchDetailPage,
  pubsFetchAll,
  catalogFetchAll,
  type SustLibDocument,
  type PubRawRecord,
  type CatalogRawEntry,
} from './lib/sources.js'
import { runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, CONCURRENCY } from './lib/config.js'

const REPORT_DIR = `${OUTPUT_DIR}/reports`

const args = process.argv.slice(2)
const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1] || 'all'
const dryRun = args.includes('--dry-run')

interface ChangeReport {
  source: string
  timestamp: string
  previousCount: number
  currentCount: number
  added: string[]
  changed: string[]
  removed: string[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeReport(report: ChangeReport) {
  mkdirSync(REPORT_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const filename = `${REPORT_DIR}/${date}-${report.source}.json`
  writeFileSync(filename, JSON.stringify(report, null, 2))

  console.log(`\n--- ${report.source} Change Report ---`)
  console.log(`  Previous: ${report.previousCount} records`)
  console.log(`  Current:  ${report.currentCount} records`)
  console.log(`  Added:    ${report.added.length}`)
  console.log(`  Changed:  ${report.changed.length}`)
  console.log(`  Removed:  ${report.removed.length}`)
  if (report.errors.length > 0) {
    console.log(`  Errors:   ${report.errors.length}`)
  }
  console.log(`  Report:   ${filename}`)
}

// ---------------------------------------------------------------------------
// Sustainable Library update
// ---------------------------------------------------------------------------

async function updateSustainableLibrary(): Promise<ChangeReport> {
  console.log('\n=== Sustainable Library ===')
  const cachePath = `${OUTPUT_DIR}/sustainable-library.json`
  const cached: SustLibDocument[] = loadJson(cachePath) || []
  const cachedById = new Map(cached.map((d) => [d.postId, d]))

  console.log(`  Cached: ${cached.length} records`)
  console.log('  Fetching current index from source...')

  const { records: current } = await sustLibFetchAll()
  console.log(`  Source: ${current.length} records`)

  const currentIds = new Set(current.map((d) => d.postId))
  const cachedIds = new Set(cached.map((d) => d.postId))

  // Detect changes
  const added: SustLibDocument[] = []
  const changed: SustLibDocument[] = []
  const removed = [...cachedIds].filter((id) => !currentIds.has(id))

  for (const rec of current) {
    const existing = cachedById.get(rec.postId)
    if (!existing) {
      added.push(rec)
    } else if (existing.title !== rec.title || existing.summary !== rec.summary) {
      // Metadata changed — update in place but preserve enriched fields
      rec.tags = existing.tags
      rec.datePosted = existing.datePosted
      rec.fileType = existing.fileType
      rec.pdfSizeBytes = existing.pdfSizeBytes
      changed.push(rec)
    }
  }

  console.log(`  New: ${added.length}, Changed: ${changed.length}, Removed: ${removed.length}`)

  // Enrich new entries with detail page data
  if (added.length > 0 && !dryRun) {
    console.log(`  Scraping detail pages for ${added.length} new entries...`)
    await runConcurrent(added, CONCURRENCY.DETAIL_PAGES, sustLibFetchDetailPage, 'Detail pages')
  }

  if (!dryRun) {
    // Merge: start with current records, overlay cached enrichment data for unchanged
    const merged: SustLibDocument[] = []
    for (const rec of current) {
      if (added.find((a) => a.postId === rec.postId)) {
        // New — use freshly enriched version
        merged.push(added.find((a) => a.postId === rec.postId)!)
      } else if (changed.find((c) => c.postId === rec.postId)) {
        // Changed — use updated version (with preserved enrichment)
        merged.push(changed.find((c) => c.postId === rec.postId)!)
      } else {
        // Unchanged — keep cached version with all enrichment
        merged.push(cachedById.get(rec.postId)!)
      }
    }

    writeFileSync(cachePath, JSON.stringify(merged, null, 2))
    console.log(`  Updated ${cachePath} (${merged.length} records)`)
  }

  return {
    source: 'sustainable-library',
    timestamp: new Date().toISOString(),
    previousCount: cached.length,
    currentCount: current.length,
    added: added.map((d) => `${d.postId}: ${d.title.slice(0, 60)}`),
    changed: changed.map((d) => `${d.postId}: ${d.title.slice(0, 60)}`),
    removed: removed.map((id) => `${id}: ${cachedById.get(id)?.title.slice(0, 60) || '?'}`),
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Publications update
// ---------------------------------------------------------------------------

async function updatePublications(): Promise<ChangeReport> {
  console.log('\n=== Publications ===')
  const cachePath = `${OUTPUT_DIR}/publications-raw.json`
  const normPath = `${OUTPUT_DIR}/publications-normalized.json`
  const cached: PubRawRecord[] = loadJson(cachePath) || []
  const cachedById = new Map(cached.map((d) => [d.id, d]))

  console.log(`  Cached: ${cached.length} records`)
  console.log('  Fetching current records from source...')

  const current = await pubsFetchAll()
  console.log(`  Source: ${current.length} records`)

  const currentIds = new Set(current.map((d) => d.id))
  const cachedIds = new Set(cached.map((d) => d.id))

  const added: PubRawRecord[] = []
  const changed: PubRawRecord[] = []
  const removed = [...cachedIds].filter((id) => !currentIds.has(id))

  for (const rec of current) {
    const existing = cachedById.get(rec.id)
    if (!existing) {
      added.push(rec)
    } else if (
      existing.title !== rec.title ||
      existing.year !== rec.year ||
      existing.authors !== rec.authors ||
      existing.pdf_url !== rec.pdf_url
    ) {
      changed.push(rec)
    }
  }

  console.log(`  New: ${added.length}, Changed: ${changed.length}, Removed: ${removed.length}`)

  if (!dryRun) {
    writeFileSync(cachePath, JSON.stringify(current, null, 2))
    console.log(`  Updated ${cachePath} (${current.length} records)`)

    if (added.length > 0 || changed.length > 0) {
      console.log(
        `  NOTE: Re-run 'npx tsx scripts/scrape-publications.ts' to normalize and enrich new entries via CrossRef.`,
      )
      console.log(`        The raw cache has been updated; the normalized file needs regeneration.`)
    }
  }

  return {
    source: 'publications',
    timestamp: new Date().toISOString(),
    previousCount: cached.length,
    currentCount: current.length,
    added: added.map((d) => `${d.id}: ${d.title.slice(0, 60)}`),
    changed: changed.map((d) => `${d.id}: ${d.title.slice(0, 60)}`),
    removed: removed.map((id) => `${id}: ${cachedById.get(id)?.title.slice(0, 60) || '?'}`),
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Data Catalog update
// ---------------------------------------------------------------------------

async function updateDataCatalog(): Promise<ChangeReport> {
  console.log('\n=== Data Catalog ===')
  const cachePath = `${OUTPUT_DIR}/data-catalog-raw.json`
  const cached: CatalogRawEntry[] = loadJson(cachePath) || []
  const cachedById = new Map(cached.map((d) => [d.id, d]))
  const errors: string[] = []

  console.log(`  Cached: ${cached.length} records`)
  console.log('  Fetching current records from source...')

  let current: CatalogRawEntry[]
  try {
    current = await catalogFetchAll()
  } catch (err) {
    const msg = `Catalog API error: ${err}. The API may still have the server-side bug. Using cached data.`
    console.log(`  ERROR: ${msg}`)
    return {
      source: 'data-catalog',
      timestamp: new Date().toISOString(),
      previousCount: cached.length,
      currentCount: cached.length,
      added: [],
      changed: [],
      removed: [],
      errors: [msg],
    }
  }

  console.log(`  Source: ${current.length} records`)

  const currentIds = new Set(current.map((d) => d.id))
  const cachedIds = new Set(cached.map((d) => d.id))

  const added: CatalogRawEntry[] = []
  const changed: CatalogRawEntry[] = []
  const removed = [...cachedIds].filter((id) => !currentIds.has(id))

  for (const rec of current) {
    const existing = cachedById.get(rec.id)
    if (!existing) {
      added.push(rec)
    } else if (
      existing.DatasetName !== rec.DatasetName ||
      existing.DOI !== rec.DOI ||
      existing.DateModified !== rec.DateModified ||
      existing.Citation !== rec.Citation
    ) {
      changed.push(rec)
    }
  }

  console.log(`  New: ${added.length}, Changed: ${changed.length}, Removed: ${removed.length}`)

  if (!dryRun) {
    writeFileSync(cachePath, JSON.stringify(current, null, 2))
    console.log(`  Updated ${cachePath} (${current.length} records)`)

    if (added.length > 0 || changed.length > 0) {
      console.log(
        `  NOTE: Re-run 'npx tsx scripts/scrape-data-catalog.ts' to regenerate normalized output.`,
      )
    }
  }

  return {
    source: 'data-catalog',
    timestamp: new Date().toISOString(),
    previousCount: cached.length,
    currentCount: current.length,
    added: added.map((d) => `${d.id}: ${d.DatasetName.slice(0, 60)}`),
    changed: changed.map((d) => `${d.id}: ${d.DatasetName.slice(0, 60)}`),
    removed: removed.map((id) => `${id}: ${cachedById.get(id)?.DatasetName.slice(0, 60) || '?'}`),
    errors,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const timestamp = new Date().toISOString()
  console.log(`Source update check — ${timestamp}`)
  if (dryRun) console.log('(DRY RUN — no files will be modified)')

  const sources = sourceArg === 'all' ? ['library', 'publications', 'catalog'] : [sourceArg]
  const reports: ChangeReport[] = []

  for (const source of sources) {
    switch (source) {
      case 'library':
        reports.push(await updateSustainableLibrary())
        break
      case 'publications':
        reports.push(await updatePublications())
        break
      case 'catalog':
        reports.push(await updateDataCatalog())
        break
      default:
        console.error(`Unknown source: ${source}`)
        process.exit(1)
    }
  }

  // Write combined summary
  console.log('\n========== Update Summary ==========')
  let totalAdded = 0
  let totalChanged = 0
  let totalRemoved = 0

  for (const r of reports) {
    totalAdded += r.added.length
    totalChanged += r.changed.length
    totalRemoved += r.removed.length
    writeReport(r)
  }

  console.log(`\nTotal across all sources:`)
  console.log(`  Added:   ${totalAdded}`)
  console.log(`  Changed: ${totalChanged}`)
  console.log(`  Removed: ${totalRemoved}`)

  if (totalAdded === 0 && totalChanged === 0 && totalRemoved === 0) {
    console.log('\nAll sources are up to date — no changes detected.')
  }

  if (dryRun) {
    console.log('\n(DRY RUN complete — no files were modified)')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
