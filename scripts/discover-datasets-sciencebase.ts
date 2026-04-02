/**
 * USGS ScienceBase Dataset Discovery
 *
 * Discovers datasets from USGS ScienceBase using keyword searches for the
 * Gunnison Basin / RMBL area. Deduplicates against existing datasets
 * and normalizes to the NormalizedDataset schema.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-sciencebase.ts [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sleep } from './lib/concurrency.js'
import { OUTPUT_DIR } from './lib/config.js'
import { titleSimilarity } from './lib/doi-utils.js'
import type { NormalizedDataset } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const SCIENCEBASE_API = 'https://www.sciencebase.gov/catalog/items'

// ScienceBase doesn't support OR queries; run individual searches and merge
const QUERIES = [
  'Gunnison',
  'East River Colorado',
  'Crested Butte',
  'Rocky Mountain Biological',
  'Gothic Colorado',
]

const PAGE_SIZE = 20
const FIELDS = 'title,summary,dates,spatial,contacts,webLinks,tags,browseCategories,identifiers,body'

// ---------------------------------------------------------------------------
// ScienceBase API types
// ---------------------------------------------------------------------------

interface ScienceBaseContact {
  name: string
  type?: string
  contactType?: string
}

interface ScienceBaseTag {
  name: string
  type?: string
  scheme?: string
}

interface ScienceBaseIdentifier {
  type: string
  key: string
}

interface ScienceBaseDate {
  type: string
  dateString: string
}

interface ScienceBaseWebLink {
  type: string
  uri: string
  title?: string
}

interface ScienceBaseItem {
  id: string
  title: string
  summary?: string
  body?: string
  contacts?: ScienceBaseContact[]
  tags?: ScienceBaseTag[]
  identifiers?: ScienceBaseIdentifier[]
  dates?: ScienceBaseDate[]
  spatial?: {
    boundingBox?: {
      minX: number
      minY: number
      maxX: number
      maxY: number
    }
  }
  webLinks?: ScienceBaseWebLink[]
  browseCategories?: string[]
}

// ---------------------------------------------------------------------------
// Query ScienceBase
// ---------------------------------------------------------------------------

async function queryScienceBase(): Promise<ScienceBaseItem[]> {
  const allItems = new Map<string, ScienceBaseItem>() // dedupe by ScienceBase ID

  for (const query of QUERIES) {
    let offset = 0
    while (true) {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        max: String(PAGE_SIZE),
        s: String(offset),
        fields: FIELDS,
        browseCategory: 'Data',
      })

      const res = await fetch(`${SCIENCEBASE_API}?${params}`)
      if (!res.ok) break

      const data = await res.json()
      const total = data.total || 0
      const items = (data.items || []) as ScienceBaseItem[]

      for (const item of items) {
        allItems.set(item.id, item)
      }

      if (offset + PAGE_SIZE >= total || items.length === 0) break
      offset += PAGE_SIZE
      await sleep(200)
    }
    process.stdout.write(`\r  "${query}": ${allItems.size} unique results so far`)
    await sleep(200)
  }
  console.log()

  return [...allItems.values()]
}

// ---------------------------------------------------------------------------
// Relevance filtering — remove false positives
// ---------------------------------------------------------------------------

const RELEVANCE_KEYWORDS = /\b(rmbl|gunnison|crested butte|gothic|east river|colorado|rocky mountain biological|alpine|subalpine|montane|upper colorado|elk mountains)\b/i

function isRelevant(item: ScienceBaseItem): boolean {
  const text = [
    item.title,
    item.summary?.slice(0, 500),
    item.body?.slice(0, 500),
    ...(item.tags?.map((t) => t.name) || []),
    ...(item.contacts?.map((c) => c.name) || []),
  ]
    .filter(Boolean)
    .join(' ')

  return RELEVANCE_KEYWORDS.test(text)
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(
  items: ScienceBaseItem[],
  existing: NormalizedDataset[],
): { newItems: ScienceBaseItem[]; duplicates: number } {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => d.title)

  let duplicates = 0
  const newItems: ScienceBaseItem[] = []

  for (const item of items) {
    const doi = item.identifiers?.find((i) => i.type === 'doi')?.key || null
    if (doi && existingDois.has(doi)) {
      duplicates++
      continue
    }

    const isDupTitle = existingTitles.some(
      (t) => titleSimilarity(item.title || '', t) > 0.8,
    )
    if (isDupTitle) {
      duplicates++
      continue
    }

    newItems.push(item)
  }

  return { newItems, duplicates }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeScienceBaseItem(item: ScienceBaseItem): NormalizedDataset {
  const doi = item.identifiers?.find((i) => i.type === 'doi')?.key || null
  const dateStr = item.dates?.find((d) => d.type === 'Publication')?.dateString || null
  const year = dateStr ? new Date(dateStr).getUTCFullYear() : 0

  const description = item.summary ? stripHtml(item.summary) : ''
  const tags = item.tags?.map((t) => t.name) || []

  const creators = item.contacts?.length
    ? [{ name: item.contacts[0].name, orcid: null, affiliation: null }]
    : [{ name: 'Unknown', orcid: null, affiliation: null }]

  const downloadUrl = item.webLinks?.find((l) => l.type === 'download')?.uri || null

  const spatialExtent = item.spatial?.boundingBox
    ? {
        westBoundLongitude: item.spatial.boundingBox.minX,
        southBoundLatitude: item.spatial.boundingBox.minY,
        eastBoundLongitude: item.spatial.boundingBox.maxX,
        northBoundLatitude: item.spatial.boundingBox.maxY,
      }
    : null

  return {
    _sourceId: `sciencebase:${item.id}`,
    title: item.title || 'Untitled',
    description,
    creators,
    datePublished: dateStr,
    publicationYear: year,
    spatialExtent,
    temporalExtent: { start: null, end: null },
    downloadUrl,
    doi,
    _doiStatus: doi ? 'valid' : 'none',
    repository: 'other',
    externalCatalogUrl: `https://www.sciencebase.gov/catalog/item/${item.id}`,
    spatialDescription: 'Gunnison Basin, Colorado',
    tags,
    license: null,
    resourceType: 'dataset',
    dataPublisher: 'USGS',
    _citation: null,
    _source: 'ScienceBase',
    _metadataLink: `https://www.sciencebase.gov/catalog/item/${item.id}?format=json`,
    _webMapLink: null,
    _methods: undefined,
    _metadataFullText: [item.title, description, ...tags].filter(Boolean).join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('USGS ScienceBase Dataset Discovery')
  console.log('===================================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/datasets-discovered-sciencebase.json`

  // Step 1: Query ScienceBase
  console.log('\nStep 1: Querying ScienceBase (keywords + browseCategory=Data)...')
  const raw = await queryScienceBase()
  console.log(`  ${raw.length} results from ScienceBase`)

  // Step 2: Filter for relevance
  console.log('\nStep 2: Filtering for relevance...')
  const relevant = raw.filter(isRelevant)
  const filtered = raw.length - relevant.length
  console.log(`  ${relevant.length} relevant, ${filtered} filtered out`)

  if (dryRun && filtered > 0) {
    console.log('  Filtered out (false positives):')
    for (const item of raw.filter((i) => !isRelevant(i)).slice(0, 5)) {
      console.log(`    ${item.title?.slice(0, 70)}`)
    }
  }

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating against existing datasets...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newItems, duplicates } = deduplicateResults(
    relevant.slice(0, limit),
    existing,
  )
  console.log(`  ${duplicates} duplicates, ${newItems.length} new`)

  if (dryRun) {
    console.log('\n(DRY RUN — not saving)')
    console.log('\nSample new datasets:')
    for (const item of newItems.slice(0, 10)) {
      const doi = item.identifiers?.find((i) => i.type === 'doi')?.key || 'no DOI'
      const date = item.dates?.find((d) => d.type === 'Publication')?.dateString || 'no date'
      console.log(`  ${item.title?.slice(0, 65)} | ${date} | ${doi}`)
    }
    return
  }

  // Step 4: Normalize
  console.log('\nStep 4: Normalizing...')
  const normalized = newItems.map(normalizeScienceBaseItem)
  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

  console.log('\n========== Summary ==========')
  console.log(`ScienceBase results: ${raw.length}`)
  console.log(`Filtered (noise):    ${filtered}`)
  console.log(`Duplicates removed:  ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`With description:    ${normalized.filter((d) => d.description).length}`)
  console.log(`With keywords:       ${normalized.filter((d) => d.tags.length > 0).length}`)
  console.log(`With creators:       ${normalized.filter((d) => d.creators[0]?.name !== 'Unknown').length}`)
  console.log(`With spatial:        ${normalized.filter((d) => d.spatialExtent).length}`)
  console.log(`\nOutput: ${outputPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
