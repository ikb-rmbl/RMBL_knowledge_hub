/**
 * NOAA NCEI Dataset Discovery
 *
 * Discovers datasets from NOAA's National Centers for Environmental
 * Information using the geoportal search API with keyword + geographic
 * bounding box filtering.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-ncei.ts [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, CONCURRENCY, DELAYS } from './lib/config.js'
import { titleSimilarity } from './lib/doi-utils.js'
import type { NormalizedDataset } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const GEOPORTAL_API = 'https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/search'

// Keywords relevant to the Gunnison Basin / RMBL area
const QUERY = 'Gunnison OR "Crested Butte" OR "East River" OR RMBL OR "Rocky Mountain Biological" OR Gothic OR SAIL'
// Geographic bounding box (west,south,east,north)
const BBOX = '-107.5,38.5,-106.5,39.5'

const PAGE_SIZE = 25

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NceiResult {
  id: string
  title: string
  description: string
  published: string
  updated: string
  author: { name: string }
  links: { rel: string; type: string; href: string }[]
  bbox: number[] // [west, south, east, north]
  categories: string[]
}

// ---------------------------------------------------------------------------
// Query NCEI geoportal
// ---------------------------------------------------------------------------

async function queryNcei(): Promise<NceiResult[]> {
  const allResults: NceiResult[] = []
  let start = 1
  let total = Infinity

  while (start <= total && allResults.length < limit) {
    const params = new URLSearchParams({
      f: 'json',
      q: QUERY,
      bbox: BBOX,
      max: String(PAGE_SIZE),
      start: String(start),
    })

    const res = await fetch(`${GEOPORTAL_API}?${params}`)
    if (!res.ok) {
      console.warn(`  NCEI query failed (start=${start}): ${res.status}`)
      break
    }

    const data = await res.json()
    total = data.total || 0
    const results = (data.results || []) as NceiResult[]
    allResults.push(...results)

    process.stdout.write(`\r  Fetched ${allResults.length}/${total}`)

    if (results.length === 0 || allResults.length >= total) break
    start += PAGE_SIZE
    await sleep(200)
  }
  console.log()

  return allResults.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Fetch full XML metadata for DOI and additional fields
// ---------------------------------------------------------------------------

async function fetchXmlMetadata(nceiId: string, links: { href: string; type: string }[]): Promise<{ doi: string | null; keywords: string[] }> {
  // Find the XML link
  const xmlLink = links.find((l) => l.type === 'application/xml')
  if (!xmlLink) return { doi: null, keywords: [] }

  try {
    const res = await fetch(xmlLink.href)
    if (!res.ok) return { doi: null, keywords: [] }
    const xml = await res.text()

    // Extract DOI
    let doi: string | null = null
    const doiMatch = xml.match(/10\.\d{4,}\/[^\s<"]+/)
    if (doiMatch) doi = doiMatch[0].replace(/[.,;)\s]+$/, '')

    // Extract keywords
    const keywords: string[] = []
    const kwMatches = xml.matchAll(/<gmd:keyword[^>]*>[\s\S]*?<gco:CharacterString>([^<]+)<\/gco:CharacterString>/gi)
    for (const m of kwMatches) {
      const kw = m[1].trim()
      if (kw && kw.length < 100) keywords.push(kw)
    }

    // Also try GCMD-style keywords
    const gcmdMatches = xml.matchAll(/<gmx:Anchor[^>]*>([^<]+)<\/gmx:Anchor>/gi)
    for (const m of gcmdMatches) {
      const kw = m[1].trim()
      if (kw && kw.length < 100 && !keywords.includes(kw)) keywords.push(kw)
    }

    return { doi, keywords }
  } catch {
    return { doi: null, keywords: [] }
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(
  results: NceiResult[],
  existing: NormalizedDataset[],
): { newResults: NceiResult[]; duplicates: number } {
  const existingTitles = existing.map((d) => d.title)
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))

  let duplicates = 0
  const newResults: NceiResult[] = []

  for (const result of results) {
    const isDupTitle = existingTitles.some(
      (t) => titleSimilarity(result.title || '', t) > 0.8,
    )
    if (isDupTitle) {
      duplicates++
      continue
    }
    newResults.push(result)
  }

  return { newResults, duplicates }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeNceiResult(
  result: NceiResult,
  xmlMeta: { doi: string | null; keywords: string[] },
): NormalizedDataset {
  const dateStr = result.published?.slice(0, 10) || null
  const year = dateStr ? new Date(dateStr).getUTCFullYear() : 0

  const spatialExtent = result.bbox?.length === 4
    ? {
        westBoundLongitude: result.bbox[0],
        southBoundLatitude: result.bbox[1],
        eastBoundLongitude: result.bbox[2],
        northBoundLatitude: result.bbox[3],
      }
    : null

  const description = result.description
    ? result.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : ''

  return {
    _sourceId: `ncei:${result.id}`,
    title: result.title || 'Untitled',
    description,
    creators: result.author?.name
      ? [{ name: result.author.name, orcid: null, affiliation: 'NOAA NCEI' }]
      : [{ name: 'NOAA', orcid: null, affiliation: null }],
    datePublished: dateStr,
    publicationYear: year,
    spatialExtent,
    temporalExtent: { start: null, end: null },
    downloadUrl: null,
    doi: xmlMeta.doi,
    _doiStatus: xmlMeta.doi ? 'valid' : 'none',
    repository: 'other',
    externalCatalogUrl: `https://www.ncei.noaa.gov/metadata/geoportal/#/metadata/details/${result.id}`,
    spatialDescription: 'Gunnison Basin, Colorado',
    tags: xmlMeta.keywords.length > 0 ? xmlMeta.keywords : (result.categories || []),
    license: null,
    resourceType: 'dataset',
    dataPublisher: 'NOAA NCEI',
    _citation: null,
    _source: 'NCEI',
    _metadataLink: result.links?.find((l) => l.type === 'application/xml')?.href || null,
    _webMapLink: null,
    _methods: undefined,
    _metadataFullText: [result.title, description, ...xmlMeta.keywords].filter(Boolean).join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('NOAA NCEI Dataset Discovery')
  console.log('===========================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/datasets-discovered-ncei.json`

  // Step 1: Query NCEI geoportal
  console.log('\nStep 1: Querying NCEI geoportal (keywords + bbox)...')
  const raw = await queryNcei()
  console.log(`  ${raw.length} results from NCEI`)

  // Step 2: Deduplicate
  console.log('\nStep 2: Deduplicating against existing datasets...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newResults, duplicates } = deduplicateResults(raw, existing)
  console.log(`  ${duplicates} duplicates, ${newResults.length} new`)

  if (dryRun) {
    console.log('\n(DRY RUN — skipping metadata fetch)')
    console.log('\nSample new datasets:')
    for (const r of newResults.slice(0, 10)) {
      console.log(`  ${r.title?.slice(0, 65)} | ${r.published?.slice(0, 10)} | ${r.id}`)
    }
    return
  }

  // Step 3: Fetch XML metadata for DOIs and keywords
  console.log(`\nStep 3: Fetching XML metadata for ${newResults.length} datasets...`)
  const xmlCache = new Map<string, { doi: string | null; keywords: string[] }>()

  await runConcurrent(
    newResults,
    CONCURRENCY.API_CALLS,
    async (result) => {
      const meta = await fetchXmlMetadata(result.id, result.links || [])
      xmlCache.set(result.id, meta)
      await sleep(DELAYS.METADATA_MS)
    },
    'XML metadata',
  )

  const withDoi = [...xmlCache.values()].filter((m) => m.doi).length
  console.log(`  ${withDoi}/${newResults.length} had DOIs in metadata`)

  // Step 4: Normalize
  console.log('\nStep 4: Normalizing...')
  const normalized = newResults.map((r) =>
    normalizeNceiResult(r, xmlCache.get(r.id) || { doi: null, keywords: [] }),
  )

  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

  console.log('\n========== Summary ==========')
  console.log(`NCEI results:        ${raw.length}`)
  console.log(`Duplicates removed:  ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`With description:    ${normalized.filter((d) => d.description).length}`)
  console.log(`With keywords:       ${normalized.filter((d) => d.tags.length > 0).length}`)
  console.log(`\nOutput: ${outputPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
