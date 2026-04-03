/**
 * DataCite Comprehensive Dataset Discovery
 *
 * Discovers datasets via DataCite's unified API, which indexes all major
 * repositories (Dryad, ESS-DIVE, Zenodo, USGS, NSIDC, EDI, Figshare, etc.)
 * Returns rich metadata including ORCIDs, geographic polygons, funding info,
 * and citation counts.
 *
 * Also harvests ORCID IDs for dataset creators and cross-references them
 * against publication authors for enrichment.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-datacite.ts [--dry-run] [--limit=N]
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

const DATACITE_API = 'https://api.datacite.org/dois'
const PAGE_SIZE = 25 // DataCite max for unauthenticated

// Combined keyword query for the Gunnison Basin / RMBL area
const QUERY = 'Gunnison OR RMBL OR "Crested Butte" OR "Rocky Mountain Biological Laboratory" OR "East River watershed" OR "Gothic Colorado"'

// Bounding box for client-side geographic filtering
const BBOX = { south: 38.5, north: 39.5, west: -107.5, east: -106.5 }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  source: 'dataset' // could extend to 'publication' later
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

// ---------------------------------------------------------------------------
// Query DataCite
// ---------------------------------------------------------------------------

async function queryDataCite(): Promise<DataCiteRecord[]> {
  const allRecords: DataCiteRecord[] = []
  let page = 1
  let total = Infinity
  const maxPages = Math.ceil(limit / PAGE_SIZE)

  while (page <= maxPages && allRecords.length < total) {
    const params = new URLSearchParams({
      query: QUERY,
      'resource-type-id': 'dataset',
      'page[size]': String(PAGE_SIZE),
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

    process.stdout.write(`\r  Fetched ${allRecords.length}/${Math.min(total, limit)}`)

    if (records.length < PAGE_SIZE || allRecords.length >= limit) break
    page++
    await sleep(200)
  }
  console.log()

  return allRecords.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Geographic relevance filtering
// ---------------------------------------------------------------------------

function isGeographicallyRelevant(record: DataCiteRecord): boolean {
  const geos = record.attributes.geoLocations || []

  for (const geo of geos) {
    // Check point
    if (geo.geoLocationPoint) {
      const { pointLatitude: lat, pointLongitude: lon } = geo.geoLocationPoint
      if (lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east) return true
    }
    // Check box
    if (geo.geoLocationBox) {
      const box = geo.geoLocationBox
      const overlaps =
        box.southBoundLatitude <= BBOX.north && box.northBoundLatitude >= BBOX.south &&
        box.westBoundLongitude <= BBOX.east && box.eastBoundLongitude >= BBOX.west
      if (overlaps) return true
    }
    // Check polygon (simplified: check if any vertex is in bbox)
    if (geo.geoLocationPolygon) {
      for (const pt of geo.geoLocationPolygon) {
        const { pointLatitude: lat, pointLongitude: lon } = pt.polygonPoint
        if (lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east) return true
      }
    }
    // Check place name
    if (geo.geoLocationPlace) {
      const place = geo.geoLocationPlace.toLowerCase()
      if (/gunnison|gothic|crested butte|east river|elk mountain|rmbl/.test(place)) return true
    }
  }

  // No geo data — rely on keyword match (already filtered by query)
  return geos.length === 0
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(
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

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function mapLicense(rightsList?: { rightsIdentifier?: string; rights?: string }[]): string | null {
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
    license: mapLicense(attrs.rightsList),
    resourceType: (attrs.types?.resourceTypeGeneral || 'Dataset').toLowerCase() === 'dataset' ? 'dataset' : 'other',
    dataPublisher: publisher,
    _citation: null,
    _source: `DataCite:${publisher}`,
    _metadataLink: `${DATACITE_API}/${encodeURIComponent(attrs.doi)}`,
    _webMapLink: null,
    _metadataFullText: [title, abstract, ...keywords].filter(Boolean).join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('DataCite Comprehensive Dataset Discovery')
  console.log('=========================================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/datasets-discovered-datacite.json`
  const orcidPath = `${OUTPUT_DIR}/orcids-harvested.json`

  // Step 1: Query DataCite
  console.log('\nStep 1: Querying DataCite...')
  const raw = await queryDataCite()
  console.log(`  ${raw.length} datasets from DataCite`)

  // Step 2: Geographic relevance filter
  console.log('\nStep 2: Geographic relevance filtering...')
  const relevant = raw.filter(isGeographicallyRelevant)
  const geoFiltered = raw.length - relevant.length
  console.log(`  ${relevant.length} relevant, ${geoFiltered} filtered out`)

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newRecords, duplicates } = deduplicateResults(relevant, existing)
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

  if (dryRun) {
    console.log('\n(DRY RUN)')
    console.log('\nSample new datasets:')
    for (const r of newRecords.slice(0, 10)) {
      const a = r.attributes
      const orcidCount = a.creators?.filter((c) => c.nameIdentifiers?.some((n) => n.nameIdentifierScheme === 'ORCID' && n.nameIdentifier)).length || 0
      console.log(`  ${a.titles?.[0]?.title?.slice(0, 55)} | ${typeof a.publisher === 'string' ? a.publisher?.slice(0, 15) : a.publisher?.name?.slice(0, 15)} | ${orcidCount} ORCIDs`)
    }
    return
  }

  // Step 5: Normalize
  console.log('\nStep 5: Normalizing...')
  const normalized = newRecords.map(normalizeDataCiteRecord)
  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

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
  console.log(`\nOutput: ${outputPath}`)
  console.log(`ORCIDs: ${orcidPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
