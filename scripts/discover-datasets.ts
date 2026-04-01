/**
 * DataONE Dataset Discovery
 *
 * Automatically discovers datasets from the DataONE federated catalog
 * using keyword + geographic filtering for the Gunnison Basin area.
 * Deduplicates against existing datasets and fetches full EML metadata
 * for new discoveries.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets.ts [--dry-run] [--limit=N] [--since=YYYY-MM-DD]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, CONCURRENCY, DELAYS } from './lib/config.js'
import { titleSimilarity } from './lib/doi-utils.js'
import { parseEml } from './lib/eml-parser.js'
import type { NormalizedDataset } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1]

const DATAONE_SOLR = 'https://cn.dataone.org/cn/v2/query/solr/'
const DATAONE_OBJECT = 'https://cn.dataone.org/cn/v2/object/'
const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Search keywords and geographic bounding box
// ---------------------------------------------------------------------------

const KEYWORDS = [
  'Gunnison',
  'RMBL',
  '"Crested Butte"',
  '"Rocky Mountain Biological"',
  'Gothic',
  '"East River" AND text:Colorado',
  '"West Elk"',
]

const GEO_FILTER = [
  'northBoundCoord:[38.5 TO 39.5]',
  'southBoundCoord:[38.5 TO 39.5]',
  'eastBoundCoord:[-107.5 TO -106.5]',
  'westBoundCoord:[-107.5 TO -106.5]',
]

const SOLR_FIELDS = [
  'id', 'title', 'abstract', 'author', 'datePublished',
  'keywords', 'datasource', 'formatType', 'seriesId',
  'northBoundCoord', 'southBoundCoord', 'eastBoundCoord', 'westBoundCoord',
  'beginDate', 'endDate',
].join(',')

// ---------------------------------------------------------------------------
// DataONE Solr query
// ---------------------------------------------------------------------------

interface DataOneResult {
  id: string
  title: string
  abstract?: string
  author?: string
  datePublished?: string
  keywords?: string[]
  datasource?: string
  formatType?: string
  seriesId?: string
  northBoundCoord?: number
  southBoundCoord?: number
  eastBoundCoord?: number
  westBoundCoord?: number
  beginDate?: string
  endDate?: string
}

async function queryDataOne(): Promise<DataOneResult[]> {
  const keywordQuery = KEYWORDS.map((kw) => `text:${kw}`).join(' OR ')
  const q = encodeURIComponent(`(${keywordQuery})`)
  const fq = GEO_FILTER.map((f) => `&fq=${encodeURIComponent(f)}`).join('')
  const sinceFilter = sinceArg ? `&fq=${encodeURIComponent(`datePublished:[${sinceArg}T00:00:00Z TO NOW]`)}` : ''

  const allResults: DataOneResult[] = []
  let start = 0
  let total = Infinity

  while (start < total) {
    const url = `${DATAONE_SOLR}?q=${q}${fq}${sinceFilter}&fl=${SOLR_FIELDS}&rows=${PAGE_SIZE}&start=${start}&wt=json&sort=datePublished+desc`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`DataONE query failed: ${res.status}`)
    const data = await res.json()

    total = data.response.numFound
    const docs = data.response.docs as DataOneResult[]
    allResults.push(...docs)

    process.stdout.write(`\r  Fetched ${allResults.length}/${total}`)
    start += PAGE_SIZE

    if (allResults.length >= limit) break
    await sleep(100)
  }
  console.log()

  return allResults.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function extractDoiFromSeriesId(seriesId?: string): string | null {
  if (!seriesId) return null
  const match = seriesId.match(/10\.\d{4,}\/\S+/)
  return match ? match[0].replace(/[.,;)\s]+$/, '') : null
}

interface DedupResult {
  newResults: DataOneResult[]
  duplicates: { dataoneId: string; existingTitle: string; matchType: string }[]
}

function deduplicateResults(
  results: DataOneResult[],
  existing: NormalizedDataset[],
): DedupResult {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => ({ title: d.title, id: d._sourceId }))

  const newResults: DataOneResult[] = []
  const duplicates: { dataoneId: string; existingTitle: string; matchType: string }[] = []

  for (const result of results) {
    // Check DOI match
    const doi = extractDoiFromSeriesId(result.seriesId)
    if (doi && existingDois.has(doi)) {
      duplicates.push({ dataoneId: result.id, existingTitle: result.title, matchType: 'DOI' })
      continue
    }

    // Check title similarity
    let isDup = false
    for (const existing of existingTitles) {
      if (titleSimilarity(result.title || '', existing.title) > 0.8) {
        duplicates.push({ dataoneId: result.id, existingTitle: existing.title, matchType: 'title' })
        isDup = true
        break
      }
    }
    if (isDup) continue

    newResults.push(result)
  }

  return { newResults, duplicates }
}

// ---------------------------------------------------------------------------
// EML metadata enrichment
// ---------------------------------------------------------------------------

async function fetchEmlMetadata(dataoneId: string): Promise<ReturnType<typeof parseEml> | null> {
  try {
    const res = await fetch(`${DATAONE_OBJECT}${encodeURIComponent(dataoneId)}`, {
      headers: { Accept: 'application/xml' },
    })
    if (!res.ok) return null
    const xml = await res.text()
    if (!xml.includes('<eml') && !xml.includes('<dataset>')) return null
    return parseEml(xml)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function mapRepository(datasource?: string): string {
  if (!datasource) return 'other'
  const s = datasource.toLowerCase()
  if (s.includes('ess_dive') || s.includes('ess-dive')) return 'ess_dive'
  if (s.includes('dryad')) return 'other'
  return 'other'
}

function mapLicense(license?: string | null): string | null {
  if (!license) return null
  const l = license.toLowerCase()
  if (l.includes('cc0') || l.includes('public domain')) return 'cc0'
  if (l.includes('cc by-sa') || l.includes('cc by sa')) return 'cc_by_sa_4'
  if (l.includes('cc by-nc') || l.includes('cc by nc')) return 'cc_by_nc_4'
  if (l.includes('cc by') || l.includes('cc-by') || l.includes('attribution')) return 'cc_by_4'
  return 'other'
}

function normalizeDataOneResult(
  result: DataOneResult,
  eml: ReturnType<typeof parseEml> | null,
): NormalizedDataset {
  const doi = extractDoiFromSeriesId(result.seriesId) || eml?.doi || null
  const dateStr = result.datePublished || null
  const year = dateStr ? new Date(dateStr).getUTCFullYear() : 0

  const creators = eml?.creators?.length
    ? eml.creators.map((c) => ({ name: c.name, orcid: null, affiliation: c.affiliation }))
    : result.author
      ? [{ name: result.author, orcid: null, affiliation: null }]
      : [{ name: 'Unknown', orcid: null, affiliation: null }]

  const spatialExtent =
    result.northBoundCoord != null
      ? {
          southBoundLatitude: result.southBoundCoord!,
          northBoundLatitude: result.northBoundCoord!,
          westBoundLongitude: result.westBoundCoord!,
          eastBoundLongitude: result.eastBoundCoord!,
        }
      : null

  const keywords = eml?.keywords?.length
    ? eml.keywords
    : Array.isArray(result.keywords)
      ? result.keywords
      : []

  return {
    _sourceId: result.id,
    title: result.title || eml?.title || 'Untitled',
    description: eml?.abstract || result.abstract || '',
    creators,
    datePublished: dateStr?.slice(0, 10) || null,
    publicationYear: year,
    spatialExtent,
    temporalExtent: {
      start: result.beginDate?.slice(0, 10) || null,
      end: result.endDate?.slice(0, 10) || null,
    },
    downloadUrl: null,
    doi,
    _doiStatus: doi ? 'valid' : 'none',
    repository: mapRepository(result.datasource),
    externalCatalogUrl: `https://search.dataone.org/view/${encodeURIComponent(result.id)}`,
    spatialDescription: eml?.geographicDescription || 'Gunnison Basin, Colorado',
    tags: keywords,
    license: mapLicense(eml?.license),
    resourceType: 'dataset',
    dataPublisher: result.datasource?.replace('urn:node:', '') || 'DataONE',
    _citation: null,
    _source: `DataONE:${result.datasource || 'unknown'}`,
    _metadataLink: `${DATAONE_OBJECT}${encodeURIComponent(result.id)}`,
    _webMapLink: null,
    _methods: eml?.methods || undefined,
    _metadataFullText: eml?.fullText || [result.title, result.abstract, ...keywords].filter(Boolean).join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('DataONE Dataset Discovery')
  console.log('=========================')
  if (dryRun) console.log('(DRY RUN)')
  if (sinceArg) console.log(`Since: ${sinceArg}`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rawPath = `${OUTPUT_DIR}/dataone-discovery-raw.json`
  const outputPath = `${OUTPUT_DIR}/datasets-discovered.json`
  const reportPath = `${OUTPUT_DIR}/dataone-discovery-report.json`

  // Step 1: Query DataONE
  console.log('\nStep 1: Querying DataONE Solr (keywords + geographic filter)...')
  let raw: DataOneResult[]

  if (existsSync(rawPath) && !sinceArg) {
    console.log(`  Found cached ${rawPath}, loading...`)
    raw = JSON.parse(readFileSync(rawPath, 'utf-8'))
    if (limit < raw.length) raw = raw.slice(0, limit)
  } else {
    raw = await queryDataOne()
    writeFileSync(rawPath, JSON.stringify(raw, null, 2))
  }
  console.log(`  ${raw.length} results from DataONE`)

  // Step 2: Deduplicate
  console.log('\nStep 2: Deduplicating against existing datasets...')
  const existingPath = `${OUTPUT_DIR}/data-catalog-normalized.json`
  const existing: NormalizedDataset[] = existsSync(existingPath)
    ? JSON.parse(readFileSync(existingPath, 'utf-8'))
    : []
  console.log(`  ${existing.length} existing datasets to check against`)

  const { newResults, duplicates } = deduplicateResults(raw, existing)
  console.log(`  ${duplicates.length} duplicates found (${duplicates.filter((d) => d.matchType === 'DOI').length} DOI, ${duplicates.filter((d) => d.matchType === 'title').length} title)`)
  console.log(`  ${newResults.length} new datasets to process`)

  if (dryRun) {
    console.log('\n(DRY RUN — skipping metadata fetch and normalization)')
    console.log(`\nSample new datasets:`)
    for (const r of newResults.slice(0, 10)) {
      console.log(`  ${r.title?.slice(0, 70)} | ${r.datasource} | ${r.datePublished?.slice(0, 10) || '?'}`)
    }
    return
  }

  // Step 3: Fetch EML metadata for new datasets
  console.log(`\nStep 3: Fetching EML metadata for ${newResults.length} new datasets...`)
  const emlCache = new Map<string, ReturnType<typeof parseEml> | null>()

  await runConcurrent(
    newResults,
    CONCURRENCY.API_CALLS,
    async (result) => {
      const eml = await fetchEmlMetadata(result.id)
      emlCache.set(result.id, eml)
      await sleep(DELAYS.METADATA_MS)
    },
    'EML fetch',
  )

  const withEml = [...emlCache.values()].filter(Boolean).length
  console.log(`  ${withEml}/${newResults.length} had parseable EML metadata`)

  // Step 4: Normalize
  console.log('\nStep 4: Normalizing...')
  const normalized = newResults.map((r) => normalizeDataOneResult(r, emlCache.get(r.id) || null))

  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))
  console.log(`  Wrote ${normalized.length} datasets to ${outputPath}`)

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    totalQueried: raw.length,
    duplicates: duplicates.length,
    newDatasets: normalized.length,
    withEml: withEml,
    withDoi: normalized.filter((d) => d.doi).length,
    withAbstract: normalized.filter((d) => d.description).length,
    withSpatialExtent: normalized.filter((d) => d.spatialExtent).length,
    bySource: {} as Record<string, number>,
  }
  for (const d of normalized) {
    report.bySource[d._source] = (report.bySource[d._source] || 0) + 1
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2))

  // Summary
  console.log('\n========== Summary ==========')
  console.log(`DataONE results:     ${raw.length}`)
  console.log(`Duplicates removed:  ${duplicates.length}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With EML metadata:   ${withEml}`)
  console.log(`With DOI:            ${report.withDoi}`)
  console.log(`With abstract:       ${report.withAbstract}`)
  console.log(`With spatial extent: ${report.withSpatialExtent}`)
  console.log('\nBy source:')
  for (const [src, count] of Object.entries(report.bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`)
  }
  console.log(`\nOutput: ${outputPath}`)
  console.log(`Report: ${reportPath}`)
  console.log(`\nNext: review the discovered datasets, then run:`)
  console.log(`  npx tsx scripts/load-to-payload.ts --collection=datasets`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
