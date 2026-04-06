/**
 * Consolidated Dataset Discovery
 *
 * Discovers datasets from 7 sources for the Gunnison Basin / RMBL area:
 *   DataONE, Zenodo, DataCite, unmatched DOIs, NCEI, ScienceBase, NCEI Paleo
 *
 * Usage:
 *   npx tsx scripts/discover-datasets.ts --source=all [--dry-run] [--limit=N] [--since=YYYY-MM-DD]
 *   npx tsx scripts/discover-datasets.ts --source=dataone [--dry-run] [--limit=N] [--since=YYYY-MM-DD]
 *   npx tsx scripts/discover-datasets.ts --source=zenodo [--dry-run] [--limit=N]
 *   npx tsx scripts/discover-datasets.ts --source=datacite [--dry-run] [--limit=N]
 *   npx tsx scripts/discover-datasets.ts --source=dois [--dry-run] [--limit=N]
 *   npx tsx scripts/discover-datasets.ts --source=ncei [--dry-run] [--limit=N]
 *   npx tsx scripts/discover-datasets.ts --source=sciencebase [--dry-run] [--limit=N]
 *   npx tsx scripts/discover-datasets.ts --source=paleo [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, CONCURRENCY, DELAYS } from './lib/config.js'
import { titleSimilarity } from './lib/doi-utils.js'
import { parseEml } from './lib/eml-parser.js'
import type { NormalizedDataset } from './lib/types.js'
import {
  loadExistingDatasets,
  buildDedupIndex,
  isDuplicate,
  saveDiscoveredDatasets,
  normalizeLicense,
  stripHtml,
} from './lib/dataset-discovery.js'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1]
const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1] || 'all'

const VALID_SOURCES = ['dataone', 'zenodo', 'datacite', 'dois', 'ncei', 'sciencebase', 'paleo', 'all'] as const
type Source = (typeof VALID_SOURCES)[number]

if (!VALID_SOURCES.includes(sourceArg as Source)) {
  console.error(`Invalid --source value: "${sourceArg}"`)
  console.error(`Valid values: ${VALID_SOURCES.join(', ')}`)
  process.exit(1)
}

interface DiscoveryOpts {
  dryRun: boolean
  limit: number
  since?: string
}

// ============================================================================
//  DATAONE
// ============================================================================

const DATAONE_SOLR = 'https://cn.dataone.org/cn/v2/query/solr/'
const DATAONE_OBJECT = 'https://cn.dataone.org/cn/v2/object/'
const DATAONE_PAGE_SIZE = 50

// Simple keywords get wrapped with text: prefix in the query builder.
// Compound queries (with AND) are inserted as-is — they already include text: prefixes.
const DATAONE_SIMPLE_KEYWORDS = [
  'Gunnison',
  'RMBL',
  '"Crested Butte"',
  '"Rocky Mountain Biological"',
  'Gothic',
  '"West Elk"',
  '"Grand Mesa"',
  '"Roaring Fork"',
  '"Uncompahgre"',
  'Saguache',
  '"Cochetopa"',
  '"Independence Pass"',
  '"Curecanti"',
  '"Sapinero"',
  '"Kebler Pass"',
]
const DATAONE_COMPOUND_QUERIES = [
  '(text:"East River" AND text:Colorado)',
  '(text:Paonia AND text:Colorado)',
  '(text:"Lake Fork" AND text:Gunnison)',
  '(text:Aspen AND text:Colorado AND text:ecology)',
  '(text:"Cottonwood Pass" AND text:Colorado)',
]

const DATAONE_GEO_FILTER = [
  'northBoundCoord:[37.9 TO 39.5]',
  'southBoundCoord:[37.9 TO 39.5]',
  'eastBoundCoord:[-108.2 TO -106.0]',
  'westBoundCoord:[-108.2 TO -106.0]',
]

const DATAONE_SOLR_FIELDS = [
  'id', 'title', 'abstract', 'author', 'datePublished',
  'keywords', 'datasource', 'formatType', 'seriesId',
  'northBoundCoord', 'southBoundCoord', 'eastBoundCoord', 'westBoundCoord',
  'beginDate', 'endDate',
].join(',')

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

async function queryDataOne(opts: DiscoveryOpts): Promise<DataOneResult[]> {
  const simpleTerms = DATAONE_SIMPLE_KEYWORDS.map((kw) => `text:${kw}`)
  const allTerms = [...simpleTerms, ...DATAONE_COMPOUND_QUERIES]
  const q = encodeURIComponent(`(${allTerms.join(' OR ')})`)
  const fq = DATAONE_GEO_FILTER.map((f) => `&fq=${encodeURIComponent(f)}`).join('')
  const sinceFilter = opts.since ? `&fq=${encodeURIComponent(`datePublished:[${opts.since}T00:00:00Z TO NOW]`)}` : ''

  const allResults: DataOneResult[] = []
  let start = 0
  let total = Infinity

  while (start < total) {
    const url = `${DATAONE_SOLR}?q=${q}${fq}${sinceFilter}&fl=${DATAONE_SOLR_FIELDS}&rows=${DATAONE_PAGE_SIZE}&start=${start}&wt=json&sort=datePublished+desc`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`DataONE query failed: ${res.status}`)
    const data = await res.json()

    total = data.response.numFound
    const docs = data.response.docs as DataOneResult[]
    allResults.push(...docs)

    process.stdout.write(`\r  Fetched ${allResults.length}/${total}`)
    start += DATAONE_PAGE_SIZE

    if (allResults.length >= opts.limit) break
    await sleep(100)
  }
  console.log()

  return allResults.slice(0, opts.limit)
}

function extractDoiFromSeriesId(seriesId?: string): string | null {
  if (!seriesId) return null
  const match = seriesId.match(/10\.\d{4,}\/\S+/)
  return match ? match[0].replace(/[.,;)\s]+$/, '') : null
}

function dataoneDeduplicateResults(
  results: DataOneResult[],
  existing: NormalizedDataset[],
): { newResults: DataOneResult[]; duplicates: { dataoneId: string; existingTitle: string; matchType: string }[] } {
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

function dataoneMapRepository(datasource?: string): string {
  if (!datasource) return 'other'
  const s = datasource.toLowerCase()
  if (s.includes('ess_dive') || s.includes('ess-dive')) return 'ess_dive'
  if (s.includes('dryad')) return 'other'
  return 'other'
}

function dataoneMapLicense(license?: string | null): string | null {
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
    repository: dataoneMapRepository(result.datasource),
    externalCatalogUrl: `https://search.dataone.org/view/${encodeURIComponent(result.id)}`,
    spatialDescription: eml?.geographicDescription || 'Gunnison Basin, Colorado',
    tags: keywords,
    license: dataoneMapLicense(eml?.license),
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

export async function discoverDataone(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('DataONE Dataset Discovery')
  console.log('=========================')
  if (opts.dryRun) console.log('(DRY RUN)')
  if (opts.since) console.log(`Since: ${opts.since}`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rawPath = `${OUTPUT_DIR}/dataone-discovery-raw.json`
  const reportPath = `${OUTPUT_DIR}/dataone-discovery-report.json`

  // Step 1: Query DataONE
  console.log('\nStep 1: Querying DataONE Solr (keywords + geographic filter)...')
  let raw: DataOneResult[]

  if (existsSync(rawPath) && !opts.since) {
    console.log(`  Found cached ${rawPath}, loading...`)
    raw = JSON.parse(readFileSync(rawPath, 'utf-8'))
    if (opts.limit < raw.length) raw = raw.slice(0, opts.limit)
  } else {
    raw = await queryDataOne(opts)
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

  const { newResults, duplicates } = dataoneDeduplicateResults(raw, existing)
  console.log(`  ${duplicates.length} duplicates found (${duplicates.filter((d) => d.matchType === 'DOI').length} DOI, ${duplicates.filter((d) => d.matchType === 'title').length} title)`)
  console.log(`  ${newResults.length} new datasets to process`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN — skipping metadata fetch and normalization)')
    console.log(`\nSample new datasets:`)
    for (const r of newResults.slice(0, 10)) {
      console.log(`  ${r.title?.slice(0, 70)} | ${r.datasource} | ${r.datePublished?.slice(0, 10) || '?'}`)
    }
    return []
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

  saveDiscoveredDatasets('dataone', normalized)

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

  return normalized
}

// ============================================================================
//  ZENODO
// ============================================================================

const ZENODO_API = 'https://zenodo.org/api/records'
const ZENODO_QUERY = 'Gunnison OR "Crested Butte" OR "Rocky Mountain Biological Laboratory" OR (Gothic AND Colorado AND (ecology OR biology OR hydrology)) OR "Grand Mesa" OR "Roaring Fork" OR Uncompahgre OR "West Elk" OR Saguache OR Cochetopa OR (Aspen AND Colorado AND ecology)'

interface ZenodoHit {
  id: number
  doi: string
  metadata: {
    title: string
    description?: string
    publication_date?: string
    creators?: { name: string; affiliation?: string; orcid?: string }[]
    keywords?: string[]
    license?: { id: string }
    resource_type?: { type: string; subtype?: string }
    related_identifiers?: { identifier: string; relation: string }[]
    notes?: string
  }
  links?: { self?: string }
}

async function queryZenodo(opts: DiscoveryOpts): Promise<ZenodoHit[]> {
  const allHits: ZenodoHit[] = []
  let page = 1
  const maxPages = 20 // safety limit: 20 * 25 = 500 max results

  while (page <= maxPages) {
    const params = new URLSearchParams({
      q: ZENODO_QUERY,
      type: 'dataset',
      size: '25',
      page: String(page),
      sort: 'mostrecent',
    })

    const res = await fetch(`${ZENODO_API}?${params.toString()}`)
    if (!res.ok) {
      const body = await res.text()
      console.warn(`  Zenodo query failed (page ${page}): ${res.status} ${body.slice(0, 200)}`)
      break
    }

    const data = await res.json()
    const hits = (data.hits?.hits || []) as ZenodoHit[]
    allHits.push(...hits)

    const total = data.hits?.total || 0
    process.stdout.write(`\r  Fetched ${allHits.length}/${total}`)

    if (allHits.length >= total || hits.length === 0) break
    page++
    await sleep(200)
  }
  console.log()

  return allHits
}

const ZENODO_RELEVANCE_KEYWORDS = /\b(rmbl|gunnison|crested butte|gothic|east river|colorado|rocky mountain biological|alpine|subalpine|montane|marmot|wildflower|snowmelt|grand mesa|roaring fork|uncompahgre|west elk|paonia|hotchkiss|powderhorn|lake fork|browns canyon|south park|arkansas valley|aspen|independence pass|cottonwood pass|saguache|cochetopa|black canyon|curecanti|sapinero|kebler pass)\b/i

function zenodoIsRelevant(hit: ZenodoHit): boolean {
  const text = [
    hit.metadata.title,
    hit.metadata.description?.slice(0, 500),
    ...(hit.metadata.keywords || []),
    ...(hit.metadata.creators?.map((c) => c.affiliation) || []),
  ]
    .filter(Boolean)
    .join(' ')

  return ZENODO_RELEVANCE_KEYWORDS.test(text)
}

function zenodoDeduplicateResults(
  hits: ZenodoHit[],
  existing: NormalizedDataset[],
): { newHits: ZenodoHit[]; duplicates: number } {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => d.title)

  let duplicates = 0
  const newHits: ZenodoHit[] = []

  for (const hit of hits) {
    if (hit.doi && existingDois.has(hit.doi)) {
      duplicates++
      continue
    }

    const isDupTitle = existingTitles.some(
      (t) => titleSimilarity(hit.metadata.title || '', t) > 0.8,
    )
    if (isDupTitle) {
      duplicates++
      continue
    }

    newHits.push(hit)
  }

  return { newHits, duplicates }
}

function zenodoMapLicense(license?: { id: string }): string | null {
  if (!license?.id) return null
  const id = license.id.toLowerCase()
  if (id.includes('cc0') || id === 'cc-zero') return 'cc0'
  if (id.includes('cc-by-sa')) return 'cc_by_sa_4'
  if (id.includes('cc-by-nc')) return 'cc_by_nc_4'
  if (id.includes('cc-by')) return 'cc_by_4'
  if (id.includes('mit')) return 'mit'
  return 'other'
}

function zenodoStripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeZenodoHit(hit: ZenodoHit): NormalizedDataset {
  const meta = hit.metadata
  const dateStr = meta.publication_date || null
  const year = dateStr ? new Date(dateStr).getUTCFullYear() : 0

  const creators = (meta.creators || []).map((c) => ({
    name: c.name,
    orcid: c.orcid || null,
    affiliation: c.affiliation || null,
  }))

  const description = meta.description ? zenodoStripHtml(meta.description) : ''

  return {
    _sourceId: `zenodo:${hit.id}`,
    title: meta.title || 'Untitled',
    description,
    creators: creators.length > 0 ? creators : [{ name: 'Unknown', orcid: null, affiliation: null }],
    datePublished: dateStr || null,
    publicationYear: year,
    spatialExtent: null, // Zenodo doesn't provide bounding box
    temporalExtent: { start: null, end: null },
    downloadUrl: null,
    doi: hit.doi || null,
    _doiStatus: hit.doi ? 'valid' : 'none',
    repository: 'other',
    externalCatalogUrl: `https://zenodo.org/records/${hit.id}`,
    spatialDescription: 'Gunnison Basin, Colorado',
    tags: meta.keywords || [],
    license: zenodoMapLicense(meta.license),
    resourceType: 'dataset',
    dataPublisher: 'Zenodo',
    _citation: null,
    _source: 'Zenodo',
    _metadataLink: `https://zenodo.org/api/records/${hit.id}`,
    _webMapLink: null,
    _methods: undefined,
    _metadataFullText: [meta.title, description, ...(meta.keywords || [])].filter(Boolean).join('\n\n'),
  }
}

export async function discoverZenodo(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('Zenodo Dataset Discovery')
  console.log('========================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Step 1: Query Zenodo
  console.log('\nStep 1: Querying Zenodo...')
  const raw = await queryZenodo(opts)
  console.log(`  ${raw.length} unique datasets from Zenodo`)

  // Step 2: Filter for relevance
  console.log('\nStep 2: Filtering for relevance...')
  const relevant = raw.filter(zenodoIsRelevant)
  const filtered = raw.length - relevant.length
  console.log(`  ${relevant.length} relevant, ${filtered} filtered out`)

  if (opts.dryRun && filtered > 0) {
    console.log('  Filtered out (false positives):')
    for (const h of raw.filter((h) => !zenodoIsRelevant(h)).slice(0, 5)) {
      console.log(`    ${h.metadata.title?.slice(0, 70)}`)
    }
  }

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating against existing datasets...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newHits, duplicates } = zenodoDeduplicateResults(
    relevant.slice(0, opts.limit),
    existing,
  )
  console.log(`  ${duplicates} duplicates, ${newHits.length} new`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN — not saving)')
    console.log('\nSample new datasets:')
    for (const h of newHits.slice(0, 10)) {
      console.log(`  ${h.metadata.title?.slice(0, 70)} | ${h.metadata.publication_date} | DOI: ${h.doi}`)
    }
    return []
  }

  // Step 4: Normalize
  console.log('\nStep 4: Normalizing...')
  const normalized = newHits.map(normalizeZenodoHit)
  saveDiscoveredDatasets('zenodo', normalized)

  console.log('\n========== Summary ==========')
  console.log(`Zenodo results:      ${raw.length}`)
  console.log(`Filtered (noise):    ${filtered}`)
  console.log(`Duplicates removed:  ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`With description:    ${normalized.filter((d) => d.description).length}`)
  console.log(`With keywords:       ${normalized.filter((d) => d.tags.length > 0).length}`)
  console.log(`With creators:       ${normalized.filter((d) => d.creators[0]?.name !== 'Unknown').length}`)

  return normalized
}

// ============================================================================
//  DATACITE
// ============================================================================

const DATACITE_API = 'https://api.datacite.org/dois'
const DATACITE_PAGE_SIZE = 25 // DataCite max for unauthenticated
const DATACITE_QUERY = 'Gunnison OR RMBL OR "Crested Butte" OR "Rocky Mountain Biological Laboratory" OR "East River watershed" OR "Gothic Colorado" OR "Grand Mesa" OR "Roaring Fork" OR Uncompahgre OR "West Elk" OR Saguache OR Cochetopa OR "Aspen Colorado"'
const DATACITE_BBOX = { south: 37.9, north: 39.5, west: -108.2, east: -106.0 }

interface DataCiteRecord {
  id: string
  attributes: {
    doi: string
    titles: { title: string }[]
    creators: {
      name: string
      nameType?: string
      givenName?: string
      familyName?: string
      affiliation?: (string | { name: string })[]
      nameIdentifiers?: { nameIdentifier: string; nameIdentifierScheme: string; schemeUri?: string }[]
    }[]
    publisher: string | { name: string }
    publicationYear: number
    types: { resourceTypeGeneral: string; resourceType?: string }
    descriptions: { description: string; descriptionType: string }[]
    subjects: { subject: string }[]
    dates: { date: string; dateType: string }[]
    geoLocations: {
      geoLocationPlace?: string
      geoLocationPoint?: { pointLatitude: number; pointLongitude: number }
      geoLocationBox?: {
        westBoundLongitude: number; eastBoundLongitude: number
        southBoundLatitude: number; northBoundLatitude: number
      }
      geoLocationPolygon?: { polygonPoint: { pointLatitude: number; pointLongitude: number } }[]
    }[]
    rightsList: { rights?: string; rightsIdentifier?: string; rightsUri?: string }[]
    relatedIdentifiers: { relatedIdentifier: string; relationType: string; relatedIdentifierType: string }[]
    fundingReferences: { funderName: string; awardNumber?: string }[]
    formats: string[]
    sizes: string[]
    url: string
    citationCount: number
    viewCount: number
    downloadCount: number
    container: { type?: string; identifier?: string; title?: string }
  }
}

// ---------------------------------------------------------------------------
// ORCID harvesting
// ---------------------------------------------------------------------------

interface OrcidEntry {
  name: string
  orcid: string
  affiliation: string | null
  source: 'dataset'
}

function harvestOrcids(record: DataCiteRecord): OrcidEntry[] {
  const orcids: OrcidEntry[] = []
  for (const creator of record.attributes.creators || []) {
    const orcidId = creator.nameIdentifiers?.find(
      (n) => n.nameIdentifierScheme === 'ORCID' && n.nameIdentifier,
    )
    if (orcidId?.nameIdentifier) {
      const affiliation = creator.affiliation?.[0]
      orcids.push({
        name: creator.name,
        orcid: orcidId.nameIdentifier.replace('https://orcid.org/', ''),
        affiliation: typeof affiliation === 'string' ? affiliation : affiliation?.name || null,
        source: 'dataset',
      })
    }
  }
  return orcids
}

async function queryDataCite(opts: DiscoveryOpts): Promise<DataCiteRecord[]> {
  const allRecords: DataCiteRecord[] = []
  let page = 1
  let total = Infinity
  const maxPages = Math.ceil(opts.limit / DATACITE_PAGE_SIZE)

  while (page <= maxPages && allRecords.length < total) {
    const params = new URLSearchParams({
      query: DATACITE_QUERY,
      'resource-type-id': 'dataset',
      'page[size]': String(DATACITE_PAGE_SIZE),
      'page[number]': String(page),
      sort: '-created',
    })

    const res = await fetch(`${DATACITE_API}?${params}`)
    if (!res.ok) {
      console.warn(`  DataCite query failed (page ${page}): ${res.status}`)
      break
    }

    const data = await res.json()
    total = data.meta?.total || 0
    const records = (data.data || []) as DataCiteRecord[]
    allRecords.push(...records)

    process.stdout.write(`\r  Fetched ${allRecords.length}/${Math.min(total, opts.limit)}`)

    if (records.length < DATACITE_PAGE_SIZE || allRecords.length >= opts.limit) break
    page++
    await sleep(200)
  }
  console.log()

  return allRecords.slice(0, opts.limit)
}

// Publishers known to produce false positives (e.g., USC matches a person named "Gunnison")
const DATACITE_EXCLUDED_PUBLISHERS = /university of southern california|usc digital library/i

function dataciteIsGeographicallyRelevant(record: DataCiteRecord): boolean {
  // Exclude known false-positive publishers
  const rawPub = record.attributes.publisher
  const publisher = typeof rawPub === 'string' ? rawPub : rawPub?.name || ''
  if (DATACITE_EXCLUDED_PUBLISHERS.test(publisher)) return false

  const geos = record.attributes.geoLocations || []

  for (const geo of geos) {
    // Check point
    if (geo.geoLocationPoint) {
      const { pointLatitude: lat, pointLongitude: lon } = geo.geoLocationPoint
      if (lat >= DATACITE_BBOX.south && lat <= DATACITE_BBOX.north && lon >= DATACITE_BBOX.west && lon <= DATACITE_BBOX.east) return true
    }
    // Check box
    if (geo.geoLocationBox) {
      const box = geo.geoLocationBox
      const overlaps =
        box.southBoundLatitude <= DATACITE_BBOX.north && box.northBoundLatitude >= DATACITE_BBOX.south &&
        box.westBoundLongitude <= DATACITE_BBOX.east && box.eastBoundLongitude >= DATACITE_BBOX.west
      if (overlaps) return true
    }
    // Check polygon (simplified: check if any vertex is in bbox)
    if (geo.geoLocationPolygon) {
      for (const pt of geo.geoLocationPolygon) {
        const { pointLatitude: lat, pointLongitude: lon } = pt.polygonPoint
        if (lat >= DATACITE_BBOX.south && lat <= DATACITE_BBOX.north && lon >= DATACITE_BBOX.west && lon <= DATACITE_BBOX.east) return true
      }
    }
    // Check place name
    if (geo.geoLocationPlace) {
      const place = geo.geoLocationPlace.toLowerCase()
      if (/gunnison|gothic|crested butte|east river|elk mountain|rmbl|grand mesa|roaring fork|uncompahgre|paonia|hotchkiss|powderhorn|lake fork|browns canyon|south park|arkansas valley|aspen|independence pass|cottonwood pass|saguache|cochetopa|black canyon|curecanti|sapinero|kebler pass/.test(place)) return true
    }
  }

  // No geo data — rely on keyword match (already filtered by query)
  return geos.length === 0
}

function dataciteDeduplicateResults(
  records: DataCiteRecord[],
  existing: NormalizedDataset[],
): { newRecords: DataCiteRecord[]; duplicates: number } {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => d.title)

  let duplicates = 0
  const newRecords: DataCiteRecord[] = []

  for (const record of records) {
    const doi = record.attributes.doi
    if (doi && existingDois.has(doi)) { duplicates++; continue }

    const title = record.attributes.titles?.[0]?.title || ''
    if (existingTitles.some((t) => titleSimilarity(title, t) > 0.8)) { duplicates++; continue }

    newRecords.push(record)
  }

  return { newRecords, duplicates }
}

function dataciteMapLicense(rightsList?: { rightsIdentifier?: string; rights?: string }[]): string | null {
  if (!rightsList?.length) return null
  const id = (rightsList[0].rightsIdentifier || rightsList[0].rights || '').toLowerCase()
  if (id.includes('cc0') || id.includes('cc-zero') || id.includes('public-domain')) return 'cc0'
  if (id.includes('cc-by-sa')) return 'cc_by_sa_4'
  if (id.includes('cc-by-nc')) return 'cc_by_nc_4'
  if (id.includes('cc-by')) return 'cc_by_4'
  if (id.includes('mit')) return 'mit'
  return 'other'
}

function normalizeDataCiteRecord(record: DataCiteRecord): NormalizedDataset {
  const attrs = record.attributes
  const title = attrs.titles?.[0]?.title || 'Untitled'

  const abstract = attrs.descriptions?.find((d) => d.descriptionType === 'Abstract')?.description
    || attrs.descriptions?.[0]?.description || ''

  const creators = (attrs.creators || []).map((c) => {
    const orcidEntry = c.nameIdentifiers?.find((n) => n.nameIdentifierScheme === 'ORCID')
    const orcid = orcidEntry?.nameIdentifier?.replace('https://orcid.org/', '') || null
    const aff = c.affiliation?.[0]
    return {
      name: c.name,
      orcid,
      affiliation: typeof aff === 'string' ? aff : aff?.name || null,
    }
  })

  const geo = attrs.geoLocations?.[0]
  const spatialExtent = geo?.geoLocationBox || null
  const spatialDescription = geo?.geoLocationPlace || null

  const datePublished = attrs.dates?.find((d) => d.dateType === 'Issued')?.date
    || attrs.dates?.find((d) => d.dateType === 'Created')?.date || null

  const keywords = (attrs.subjects || []).map((s) => s.subject)
  const publisher = typeof attrs.publisher === 'string' ? attrs.publisher : attrs.publisher?.name || 'Unknown'

  return {
    _sourceId: `datacite:${attrs.doi}`,
    title,
    description: abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    creators: creators.length > 0 ? creators : [{ name: publisher, orcid: null, affiliation: null }],
    datePublished: datePublished?.slice(0, 10) || null,
    publicationYear: attrs.publicationYear || 0,
    spatialExtent,
    temporalExtent: { start: null, end: null },
    downloadUrl: attrs.url || null,
    doi: attrs.doi,
    _doiStatus: 'valid',
    repository: 'other',
    externalCatalogUrl: `https://doi.org/${attrs.doi}`,
    spatialDescription: spatialDescription || 'Gunnison Basin, Colorado',
    tags: keywords,
    license: dataciteMapLicense(attrs.rightsList),
    resourceType: (attrs.types?.resourceTypeGeneral || 'Dataset').toLowerCase() === 'dataset' ? 'dataset' : 'other',
    dataPublisher: publisher,
    _citation: null,
    _source: `DataCite:${publisher}`,
    _metadataLink: `${DATACITE_API}/${encodeURIComponent(attrs.doi)}`,
    _webMapLink: null,
    _metadataFullText: [title, abstract, ...keywords].filter(Boolean).join('\n\n'),
  }
}

export async function discoverDatacite(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('DataCite Comprehensive Dataset Discovery')
  console.log('=========================================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const orcidPath = `${OUTPUT_DIR}/orcids-harvested.json`

  // Step 1: Query DataCite
  console.log('\nStep 1: Querying DataCite...')
  const raw = await queryDataCite(opts)
  console.log(`  ${raw.length} datasets from DataCite`)

  // Step 2: Geographic relevance filter
  console.log('\nStep 2: Geographic relevance filtering...')
  const relevant = raw.filter(dataciteIsGeographicallyRelevant)
  const geoFiltered = raw.length - relevant.length
  console.log(`  ${relevant.length} relevant, ${geoFiltered} filtered out`)

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newRecords, duplicates } = dataciteDeduplicateResults(relevant, existing)
  console.log(`  ${duplicates} duplicates, ${newRecords.length} new`)

  // Step 4: Harvest ORCIDs from ALL records (including duplicates — we want the IDs)
  console.log('\nStep 4: Harvesting ORCIDs...')
  const allOrcids: OrcidEntry[] = []
  for (const record of raw) {
    allOrcids.push(...harvestOrcids(record))
  }
  // Dedupe by ORCID
  const uniqueOrcids = new Map<string, OrcidEntry>()
  for (const entry of allOrcids) {
    if (!uniqueOrcids.has(entry.orcid)) uniqueOrcids.set(entry.orcid, entry)
  }
  console.log(`  ${uniqueOrcids.size} unique ORCIDs harvested from ${allOrcids.length} creator entries`)

  // Load existing ORCIDs and merge
  const existingOrcids: OrcidEntry[] = existsSync(orcidPath)
    ? JSON.parse(readFileSync(orcidPath, 'utf-8'))
    : []
  const existingOrcidSet = new Set(existingOrcids.map((o) => o.orcid))
  const newOrcids = [...uniqueOrcids.values()].filter((o) => !existingOrcidSet.has(o.orcid))
  const mergedOrcids = [...existingOrcids, ...newOrcids]
  writeFileSync(orcidPath, JSON.stringify(mergedOrcids, null, 2))
  console.log(`  ${newOrcids.length} new ORCIDs (${mergedOrcids.length} total in registry)`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN)')
    console.log('\nSample new datasets:')
    for (const r of newRecords.slice(0, 10)) {
      const a = r.attributes
      const orcidCount = a.creators?.filter((c) => c.nameIdentifiers?.some((n) => n.nameIdentifierScheme === 'ORCID' && n.nameIdentifier)).length || 0
      console.log(`  ${a.titles?.[0]?.title?.slice(0, 55)} | ${typeof a.publisher === 'string' ? a.publisher?.slice(0, 15) : a.publisher?.name?.slice(0, 15)} | ${orcidCount} ORCIDs`)
    }
    return []
  }

  // Step 5: Normalize
  console.log('\nStep 5: Normalizing...')
  const normalized = newRecords.map(normalizeDataCiteRecord)
  saveDiscoveredDatasets('datacite', normalized)

  // Summary
  const withOrcid = normalized.filter((d) => d.creators.some((c) => c.orcid)).length
  const withGeo = normalized.filter((d) => d.spatialExtent).length
  const withDesc = normalized.filter((d) => d.description).length
  const withKeywords = normalized.filter((d) => d.tags.length > 0).length

  const bySrc = new Map<string, number>()
  for (const d of normalized) bySrc.set(d.dataPublisher, (bySrc.get(d.dataPublisher) || 0) + 1)

  console.log('\n========== Summary ==========')
  console.log(`DataCite results:    ${raw.length}`)
  console.log(`Geo-filtered:        ${geoFiltered}`)
  console.log(`Duplicates removed:  ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With ORCIDs:         ${withOrcid}`)
  console.log(`With geo extent:     ${withGeo}`)
  console.log(`With description:    ${withDesc}`)
  console.log(`With keywords:       ${withKeywords}`)
  console.log(`ORCIDs harvested:    ${uniqueOrcids.size} unique`)
  console.log('\nBy publisher:')
  for (const [s, c] of [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${s}: ${c}`)
  }
  console.log(`\nORCIDs: ${orcidPath}`)

  return normalized
}

// ============================================================================
//  FROM DOIS (unmatched DOIs from crosslinks)
// ============================================================================

interface DoiDataCiteAttrs {
  doi: string
  titles: { title: string }[]
  creators: { name: string; nameIdentifiers?: { nameIdentifier: string; nameIdentifierScheme: string }[]; affiliation?: { name: string }[] }[]
  publisher: string
  publicationYear: number
  types: { resourceTypeGeneral: string; resourceType?: string }
  descriptions: { description: string; descriptionType: string }[]
  subjects: { subject: string }[]
  dates: { date: string; dateType: string }[]
  geoLocations: { geoLocationBox?: { westBoundLongitude: number; eastBoundLongitude: number; southBoundLatitude: number; northBoundLatitude: number }; geoLocationPlace?: string }[]
  rightsList: { rights: string; rightsIdentifier?: string }[]
  relatedIdentifiers: { relatedIdentifier: string; relationType: string; relatedIdentifierType: string }[]
  formats: string[]
  sizes: string[]
  url: string
}

function getUnmatchedDois(opts: DiscoveryOpts): { doi: string; citedBy: number }[] {
  const reportPath = `${OUTPUT_DIR}/crosslinks-report.json`
  if (!existsSync(reportPath)) {
    console.error('No crosslinks report found. Run crosslink-datasets.ts first.')
    process.exit(1)
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
  const raw: [string, number][] = report.unmatchedDois || []

  return raw
    .filter(([doi]) => {
      // Must have proper prefix/suffix structure
      if (!doi.match(/^10\.\d{4,}\/.{5,}$/)) return false
      // No truncated base prefixes
      if (doi.match(/\/(dryad|figshare|zenodo|pasta|WTR)\/?$/i)) return false
      // No zero-width spaces
      if (/[\u200B\u200C\u200D]/.test(doi)) return false
      // No trailing dots or parens
      if (doi.endsWith('.') || doi.endsWith(')')) return false
      return true
    })
    .map(([doi, count]) => ({ doi: doi.replace(/[.,;)]+$/, ''), citedBy: count }))
    .slice(0, opts.limit)
}

async function resolveDoiMetadata(doi: string): Promise<DoiDataCiteAttrs | null> {
  try {
    const res = await fetch(`${DATACITE_API}/${encodeURIComponent(doi)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.attributes || null
  } catch {
    return null
  }
}

function doisMapLicense(rightsList?: { rightsIdentifier?: string; rights?: string }[]): string | null {
  if (!rightsList?.length) return null
  const id = (rightsList[0].rightsIdentifier || rightsList[0].rights || '').toLowerCase()
  if (id.includes('cc0') || id.includes('public-domain')) return 'cc0'
  if (id.includes('cc-by-sa')) return 'cc_by_sa_4'
  if (id.includes('cc-by-nc')) return 'cc_by_nc_4'
  if (id.includes('cc-by')) return 'cc_by_4'
  return 'other'
}

function normalizeDoiDataCite(attrs: DoiDataCiteAttrs): NormalizedDataset {
  const title = attrs.titles?.[0]?.title || 'Untitled'
  const abstract = attrs.descriptions?.find((d) => d.descriptionType === 'Abstract')?.description
    || attrs.descriptions?.[0]?.description || ''

  const creators = (attrs.creators || []).map((c) => {
    const orcid = c.nameIdentifiers?.find((n) => n.nameIdentifierScheme === 'ORCID')?.nameIdentifier || null
    return {
      name: c.name,
      orcid,
      affiliation: c.affiliation?.[0]?.name || null,
    }
  })

  const geo = attrs.geoLocations?.[0]
  const spatialExtent = geo?.geoLocationBox || null
  const spatialDescription = geo?.geoLocationPlace || null

  const keywords = (attrs.subjects || []).map((s) => s.subject)

  const datePublished = attrs.dates?.find((d) => d.dateType === 'Issued')?.date
    || attrs.dates?.[0]?.date || null

  return {
    _sourceId: `datacite:${attrs.doi}`,
    title,
    description: abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    creators: creators.length > 0 ? creators : [{ name: attrs.publisher || 'Unknown', orcid: null, affiliation: null }],
    datePublished: datePublished?.slice(0, 10) || null,
    publicationYear: attrs.publicationYear || 0,
    spatialExtent,
    temporalExtent: { start: null, end: null },
    downloadUrl: attrs.url || null,
    doi: attrs.doi,
    _doiStatus: 'valid',
    repository: 'other',
    externalCatalogUrl: `https://doi.org/${attrs.doi}`,
    spatialDescription: spatialDescription || 'Gunnison Basin, Colorado',
    tags: keywords,
    license: doisMapLicense(attrs.rightsList),
    resourceType: (attrs.types?.resourceTypeGeneral || 'Dataset').toLowerCase() === 'dataset' ? 'dataset' : 'other',
    dataPublisher: attrs.publisher || 'Unknown',
    _citation: null,
    _source: `DataCite:${attrs.publisher || 'unknown'}`,
    _metadataLink: `${DATACITE_API}/${encodeURIComponent(attrs.doi)}`,
    _webMapLink: null,
    _metadataFullText: [title, abstract, ...keywords].filter(Boolean).join('\n\n'),
  }
}

function doisDeduplicateResults(
  resolved: { doi: string; attrs: DoiDataCiteAttrs; citedBy: number }[],
  existing: NormalizedDataset[],
): { newDatasets: { doi: string; attrs: DoiDataCiteAttrs; citedBy: number }[]; duplicates: number } {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => d.title)

  let duplicates = 0
  const newDatasets: { doi: string; attrs: DoiDataCiteAttrs; citedBy: number }[] = []

  for (const item of resolved) {
    if (existingDois.has(item.doi)) { duplicates++; continue }
    const title = item.attrs.titles?.[0]?.title || ''
    if (existingTitles.some((t) => titleSimilarity(title, t) > 0.8)) { duplicates++; continue }
    newDatasets.push(item)
  }

  return { newDatasets, duplicates }
}

export async function discoverFromDois(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('Dataset Discovery from Unmatched DOIs (DataCite)')
  console.log('=================================================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Step 1: Get unmatched DOIs
  console.log('\nStep 1: Loading unmatched DOIs from crosslinks report...')
  const dois = getUnmatchedDois(opts)
  console.log(`  ${dois.length} valid DOIs to resolve`)

  // Step 2: Resolve via DataCite
  console.log(`\nStep 2: Resolving DOIs via DataCite API...`)
  const resolved: { doi: string; attrs: DoiDataCiteAttrs; citedBy: number }[] = []
  let notFound = 0

  await runConcurrent(
    dois,
    CONCURRENCY.API_CALLS,
    async (item) => {
      const attrs = await resolveDoiMetadata(item.doi)
      if (attrs) {
        resolved.push({ doi: item.doi, attrs, citedBy: item.citedBy })
      } else {
        notFound++
      }
      await sleep(DELAYS.METADATA_MS)
    },
    'DataCite resolve',
  )

  console.log(`  ${resolved.length} resolved, ${notFound} not found`)

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newDatasets, duplicates } = doisDeduplicateResults(resolved, existing)
  console.log(`  ${duplicates} duplicates, ${newDatasets.length} new`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN)')
    for (const d of newDatasets.slice(0, 10)) {
      console.log(`  ${d.attrs.titles?.[0]?.title?.slice(0, 55)} | ${d.attrs.publisher?.slice(0, 20)} | cited by ${d.citedBy}`)
    }
    return []
  }

  // Step 4: Normalize
  const normalized = newDatasets.map((d) => normalizeDoiDataCite(d.attrs))
  saveDiscoveredDatasets('dois', normalized)

  // Summary
  console.log('\n========== Summary ==========')
  console.log(`DOIs resolved:       ${resolved.length}`)
  console.log(`Not found:           ${notFound}`)
  console.log(`Duplicates:          ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With description:    ${normalized.filter((d) => d.description).length}`)
  console.log(`With spatial extent: ${normalized.filter((d) => d.spatialExtent).length}`)
  console.log(`With keywords:       ${normalized.filter((d) => d.tags.length > 0).length}`)

  const bySrc = new Map<string, number>()
  for (const d of normalized) bySrc.set(d.dataPublisher, (bySrc.get(d.dataPublisher) || 0) + 1)
  console.log('\nBy publisher:')
  for (const [s, c] of [...bySrc.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`)
  }

  return normalized
}

// ============================================================================
//  NCEI
// ============================================================================

const NCEI_GEOPORTAL_API = 'https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/search'
const NCEI_QUERY = 'Gunnison OR "Crested Butte" OR "East River" OR RMBL OR "Rocky Mountain Biological" OR Gothic OR SAIL OR "Grand Mesa" OR "Roaring Fork" OR Uncompahgre OR Saguache OR Cochetopa'
const NCEI_BBOX = '-108.2,37.9,-106.0,39.5'
const NCEI_PAGE_SIZE = 25

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

async function queryNcei(opts: DiscoveryOpts): Promise<NceiResult[]> {
  const allResults: NceiResult[] = []
  let start = 1
  let total = Infinity

  while (start <= total && allResults.length < opts.limit) {
    const params = new URLSearchParams({
      f: 'json',
      q: NCEI_QUERY,
      bbox: NCEI_BBOX,
      max: String(NCEI_PAGE_SIZE),
      start: String(start),
    })

    const res = await fetch(`${NCEI_GEOPORTAL_API}?${params}`)
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
    start += NCEI_PAGE_SIZE
    await sleep(200)
  }
  console.log()

  return allResults.slice(0, opts.limit)
}

async function fetchNceiXmlMetadata(nceiId: string, links: { href: string; type: string }[]): Promise<{ doi: string | null; keywords: string[] }> {
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

function nceiDeduplicateResults(
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

export async function discoverNcei(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('NOAA NCEI Dataset Discovery')
  console.log('===========================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Step 1: Query NCEI geoportal
  console.log('\nStep 1: Querying NCEI geoportal (keywords + bbox)...')
  const raw = await queryNcei(opts)
  console.log(`  ${raw.length} results from NCEI`)

  // Step 2: Deduplicate
  console.log('\nStep 2: Deduplicating against existing datasets...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newResults, duplicates } = nceiDeduplicateResults(raw, existing)
  console.log(`  ${duplicates} duplicates, ${newResults.length} new`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN — skipping metadata fetch)')
    console.log('\nSample new datasets:')
    for (const r of newResults.slice(0, 10)) {
      console.log(`  ${r.title?.slice(0, 65)} | ${r.published?.slice(0, 10)} | ${r.id}`)
    }
    return []
  }

  // Step 3: Fetch XML metadata for DOIs and keywords
  console.log(`\nStep 3: Fetching XML metadata for ${newResults.length} datasets...`)
  const xmlCache = new Map<string, { doi: string | null; keywords: string[] }>()

  await runConcurrent(
    newResults,
    CONCURRENCY.API_CALLS,
    async (result) => {
      const meta = await fetchNceiXmlMetadata(result.id, result.links || [])
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

  saveDiscoveredDatasets('ncei', normalized)

  console.log('\n========== Summary ==========')
  console.log(`NCEI results:        ${raw.length}`)
  console.log(`Duplicates removed:  ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`With description:    ${normalized.filter((d) => d.description).length}`)
  console.log(`With keywords:       ${normalized.filter((d) => d.tags.length > 0).length}`)

  return normalized
}

// ============================================================================
//  SCIENCEBASE
// ============================================================================

const SCIENCEBASE_API = 'https://www.sciencebase.gov/catalog/items'

const SCIENCEBASE_QUERIES = [
  'Gunnison',
  'East River Colorado',
  'Crested Butte',
  'Rocky Mountain Biological',
  'Gothic Colorado',
  'Grand Mesa Colorado',
  'Roaring Fork Colorado',
  'Uncompahgre Colorado',
  'Saguache Colorado',
  'Black Canyon Colorado',
]

const SCIENCEBASE_PAGE_SIZE = 20
const SCIENCEBASE_FIELDS = 'title,summary,dates,spatial,contacts,webLinks,tags,browseCategories,identifiers,body'

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

async function queryScienceBase(): Promise<ScienceBaseItem[]> {
  const allItems = new Map<string, ScienceBaseItem>() // dedupe by ScienceBase ID

  for (const query of SCIENCEBASE_QUERIES) {
    let offset = 0
    while (true) {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        max: String(SCIENCEBASE_PAGE_SIZE),
        s: String(offset),
        fields: SCIENCEBASE_FIELDS,
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

      if (offset + SCIENCEBASE_PAGE_SIZE >= total || items.length === 0) break
      offset += SCIENCEBASE_PAGE_SIZE
      await sleep(200)
    }
    process.stdout.write(`\r  "${query}": ${allItems.size} unique results so far`)
    await sleep(200)
  }
  console.log()

  return [...allItems.values()]
}

const SCIENCEBASE_RELEVANCE_KEYWORDS = /\b(rmbl|gunnison|crested butte|gothic|east river|colorado|rocky mountain biological|alpine|subalpine|montane|upper colorado|elk mountains|grand mesa|roaring fork|uncompahgre|paonia|hotchkiss|powderhorn|lake fork|browns canyon|south park|arkansas valley|aspen|independence pass|cottonwood pass|saguache|cochetopa|black canyon|curecanti|sapinero|kebler pass)\b/i

function sciencebaseIsRelevant(item: ScienceBaseItem): boolean {
  const text = [
    item.title,
    item.summary?.slice(0, 500),
    item.body?.slice(0, 500),
    ...(item.tags?.map((t) => t.name) || []),
    ...(item.contacts?.map((c) => c.name) || []),
  ]
    .filter(Boolean)
    .join(' ')

  return SCIENCEBASE_RELEVANCE_KEYWORDS.test(text)
}

function sciencebaseDeduplicateResults(
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

function sciencebaseStripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeScienceBaseItem(item: ScienceBaseItem): NormalizedDataset {
  const doi = item.identifiers?.find((i) => i.type === 'doi')?.key || null
  const dateStr = item.dates?.find((d) => d.type === 'Publication')?.dateString || null
  const year = dateStr ? new Date(dateStr).getUTCFullYear() : 0

  const description = item.summary ? sciencebaseStripHtml(item.summary) : ''
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

export async function discoverSciencebase(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('USGS ScienceBase Dataset Discovery')
  console.log('===================================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Step 1: Query ScienceBase
  console.log('\nStep 1: Querying ScienceBase (keywords + browseCategory=Data)...')
  const raw = await queryScienceBase()
  console.log(`  ${raw.length} results from ScienceBase`)

  // Step 2: Filter for relevance
  console.log('\nStep 2: Filtering for relevance...')
  const relevant = raw.filter(sciencebaseIsRelevant)
  const filtered = raw.length - relevant.length
  console.log(`  ${relevant.length} relevant, ${filtered} filtered out`)

  if (opts.dryRun && filtered > 0) {
    console.log('  Filtered out (false positives):')
    for (const item of raw.filter((i) => !sciencebaseIsRelevant(i)).slice(0, 5)) {
      console.log(`    ${item.title?.slice(0, 70)}`)
    }
  }

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating against existing datasets...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newItems, duplicates } = sciencebaseDeduplicateResults(
    relevant.slice(0, opts.limit),
    existing,
  )
  console.log(`  ${duplicates} duplicates, ${newItems.length} new`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN — not saving)')
    console.log('\nSample new datasets:')
    for (const item of newItems.slice(0, 10)) {
      const doi = item.identifiers?.find((i) => i.type === 'doi')?.key || 'no DOI'
      const date = item.dates?.find((d) => d.type === 'Publication')?.dateString || 'no date'
      console.log(`  ${item.title?.slice(0, 65)} | ${date} | ${doi}`)
    }
    return []
  }

  // Step 4: Normalize
  console.log('\nStep 4: Normalizing...')
  const normalized = newItems.map(normalizeScienceBaseItem)
  saveDiscoveredDatasets('sciencebase', normalized)

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

  return normalized
}

// ============================================================================
//  NCEI PALEO
// ============================================================================

const PALEO_API = 'https://www.ncei.noaa.gov/access/paleo-search/study/search.json'

const PALEO_SEARCH_TERMS = [
  'Gunnison',
  'Gothic Colorado',
  'Crested Butte',
  'East River Colorado',
  'Elk Mountains Colorado',
  'West Elk',
  'Upper Gunnison',
  'Grand Mesa Colorado',
  'Roaring Fork Colorado',
  'Uncompahgre',
  'Saguache',
  'Cochetopa',
  'Aspen Colorado',
]

interface PaleoStudy {
  NOAAStudyId?: number
  xmlId?: string
  studyName: string
  doi?: string
  investigators?: string
  dataType?: string
  dataTypeList?: string
  scienceKeywords?: string[]
  earliestYearCE?: number
  mostRecentYearCE?: number
  onlineResourceLink?: string
  studyCode?: string
  [key: string]: unknown
}

async function queryPaleo(): Promise<PaleoStudy[]> {
  const allStudies = new Map<string, PaleoStudy>()

  for (const term of PALEO_SEARCH_TERMS) {
    try {
      const res = await fetch(`${PALEO_API}?searchText=${encodeURIComponent(term)}`)
      if (!res.ok) continue

      const text = await res.text()
      if (!text.trim()) continue

      const data = JSON.parse(text)
      for (const study of data.study || []) {
        const id = String(study.NOAAStudyId || study.xmlId || study.studyName)
        allStudies.set(id, study)
      }
    } catch {
      // Some searches may return malformed JSON
    }

    process.stdout.write(`\r  "${term}": ${allStudies.size} unique studies`)
    await sleep(300)
  }
  console.log()

  return [...allStudies.values()]
}

function paleoIsInArea(study: PaleoStudy): boolean {
  // Check study name and keywords for area references
  const text = [
    study.studyName,
    study.dataTypeList,
    ...(study.scienceKeywords || []),
  ].filter(Boolean).join(' ').toLowerCase()

  const areaTerms = /gunnison|gothic|crested butte|east river|elk mountain|west elk|upper gunnison|black canyon|ohio creek|taylor river|cement creek|grand mesa|roaring fork|uncompahgre|paonia|hotchkiss|powderhorn|lake fork|browns canyon|south park|arkansas valley|aspen|independence pass|cottonwood pass|saguache|cochetopa|curecanti|sapinero|kebler pass/i
  return areaTerms.test(text)
}

function paleoDeduplicateResults(
  studies: PaleoStudy[],
  existing: NormalizedDataset[],
): { newStudies: PaleoStudy[]; duplicates: number } {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => d.title)

  let duplicates = 0
  const newStudies: PaleoStudy[] = []

  for (const study of studies) {
    // Check DOI
    if (study.doi && existingDois.has(study.doi.replace('https://doi.org/', ''))) {
      duplicates++
      continue
    }

    // Check title
    const isDup = existingTitles.some(
      (t) => titleSimilarity(study.studyName || '', t) > 0.8,
    )
    if (isDup) {
      duplicates++
      continue
    }

    newStudies.push(study)
  }

  return { newStudies, duplicates }
}

function normalizePaleoStudy(study: PaleoStudy): NormalizedDataset {
  const doi = study.doi?.includes('doi.org/')
    ? study.doi.replace(/.*doi\.org\//, '').replace(/[.,;)\s]+$/, '')
    : study.doi || null

  const creators = study.investigators
    ? study.investigators.split(/;\s*/).map((name) => ({
        name: name.trim(),
        orcid: null,
        affiliation: null,
      }))
    : [{ name: 'NOAA NCEI', orcid: null, affiliation: null }]

  const keywords = [
    study.dataType,
    study.dataTypeList,
    ...(study.scienceKeywords || []),
  ].filter(Boolean) as string[]

  const description = [
    study.studyName,
    study.dataTypeList ? `Data types: ${study.dataTypeList}` : null,
    study.earliestYearCE && study.mostRecentYearCE
      ? `Temporal range: ${study.earliestYearCE} CE to ${study.mostRecentYearCE} CE`
      : null,
  ].filter(Boolean).join('. ')

  return {
    _sourceId: `ncei-paleo:${study.NOAAStudyId || study.xmlId || study.studyCode}`,
    title: study.studyName || 'Untitled',
    description,
    creators,
    datePublished: null,
    publicationYear: 0,
    spatialExtent: null,
    temporalExtent: {
      start: study.earliestYearCE ? String(study.earliestYearCE) : null,
      end: study.mostRecentYearCE ? String(study.mostRecentYearCE) : null,
    },
    downloadUrl: study.onlineResourceLink || null,
    doi,
    _doiStatus: doi ? 'valid' : 'none',
    repository: 'other',
    externalCatalogUrl: study.NOAAStudyId
      ? `https://www.ncei.noaa.gov/access/paleo-search/study/${study.NOAAStudyId}`
      : null,
    spatialDescription: 'Gunnison Basin, Colorado',
    tags: keywords,
    license: null,
    resourceType: 'dataset',
    dataPublisher: 'NOAA NCEI Paleoclimatology',
    _citation: null,
    _source: 'NCEI-Paleo',
    _metadataLink: null,
    _webMapLink: null,
    _metadataFullText: [study.studyName, description, ...keywords].filter(Boolean).join('\n\n'),
  }
}

export async function discoverPaleo(opts: DiscoveryOpts): Promise<NormalizedDataset[]> {
  console.log('NCEI Paleo Dataset Discovery')
  console.log('============================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Step 1: Query
  console.log('\nStep 1: Querying NCEI Paleo Search...')
  const raw = await queryPaleo()
  console.log(`  ${raw.length} unique studies`)

  // Step 2: Filter by area
  console.log('\nStep 2: Filtering for Gunnison Basin area...')
  const inArea = raw.filter(paleoIsInArea)
  console.log(`  ${inArea.length} in area (${raw.length - inArea.length} filtered)`)

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newStudies, duplicates } = paleoDeduplicateResults(inArea, existing)
  console.log(`  ${duplicates} duplicates, ${newStudies.length} new`)

  if (opts.dryRun) {
    console.log('\n(DRY RUN)')
    for (const s of newStudies.slice(0, 10)) {
      console.log(`  ${s.studyName?.slice(0, 60)} | ${s.dataTypeList || '?'}`)
    }
    return []
  }

  // Step 4: Normalize
  const normalized = newStudies.map(normalizePaleoStudy)
  saveDiscoveredDatasets('paleo', normalized)

  console.log('\n========== Summary ==========')
  console.log(`NCEI Paleo results:  ${raw.length}`)
  console.log(`In area:             ${inArea.length}`)
  console.log(`Duplicates:          ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`Data types:          ${[...new Set(newStudies.map((s) => s.dataTypeList).filter(Boolean))].join(', ')}`)

  return normalized
}

// ============================================================================
//  MAIN — dispatch to selected source(s)
// ============================================================================

const SOURCE_FUNCTIONS: Record<string, (opts: DiscoveryOpts) => Promise<NormalizedDataset[]>> = {
  dataone: discoverDataone,
  zenodo: discoverZenodo,
  datacite: discoverDatacite,
  dois: discoverFromDois,
  ncei: discoverNcei,
  sciencebase: discoverSciencebase,
  paleo: discoverPaleo,
}

async function main() {
  const opts: DiscoveryOpts = { dryRun, limit, since: sinceArg }

  if (sourceArg === 'all') {
    console.log('Consolidated Dataset Discovery — ALL SOURCES')
    console.log('=============================================')
    if (opts.dryRun) console.log('(DRY RUN)')
    console.log()

    let totalNew = 0
    for (const [name, fn] of Object.entries(SOURCE_FUNCTIONS)) {
      try {
        const results = await fn(opts)
        totalNew += results.length
        console.log()
      } catch (err) {
        console.error(`\nError in ${name}:`, err)
        console.log('Continuing with next source...\n')
      }
    }

    console.log('=============================================')
    console.log(`Total new datasets across all sources: ${totalNew}`)
    console.log(`\nNext: review the discovered datasets, then run:`)
    console.log(`  npx tsx scripts/load-to-payload.ts --collection=datasets`)
  } else {
    const fn = SOURCE_FUNCTIONS[sourceArg]
    if (!fn) {
      console.error(`Unknown source: ${sourceArg}`)
      process.exit(1)
    }

    const results = await fn(opts)

    console.log(`\nNext: review the discovered datasets, then run:`)
    console.log(`  npx tsx scripts/load-to-payload.ts --collection=datasets`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
