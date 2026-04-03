/**
 * Dataset Discovery from Unmatched DOIs
 *
 * Takes unmatched dataset DOIs discovered by the cross-linking script
 * and resolves them through the DataCite API to get structured metadata.
 * Works for DOIs from any repository (Dryad, ESS-DIVE, Zenodo, NSIDC, etc.)
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-from-dois.ts [--dry-run] [--limit=N]
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

// ---------------------------------------------------------------------------
// Filter valid DOIs from crosslinks report
// ---------------------------------------------------------------------------

function getUnmatchedDois(): { doi: string; citedBy: number }[] {
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
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// DataCite API
// ---------------------------------------------------------------------------

interface DataCiteAttrs {
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

async function resolveDoiMetadata(doi: string): Promise<DataCiteAttrs | null> {
  try {
    const res = await fetch(`${DATACITE_API}/${encodeURIComponent(doi)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.attributes || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function mapLicense(rightsList?: { rightsIdentifier?: string; rights?: string }[]): string | null {
  if (!rightsList?.length) return null
  const id = (rightsList[0].rightsIdentifier || rightsList[0].rights || '').toLowerCase()
  if (id.includes('cc0') || id.includes('public-domain')) return 'cc0'
  if (id.includes('cc-by-sa')) return 'cc_by_sa_4'
  if (id.includes('cc-by-nc')) return 'cc_by_nc_4'
  if (id.includes('cc-by')) return 'cc_by_4'
  return 'other'
}

function normalizeDataCite(attrs: DataCiteAttrs): NormalizedDataset {
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
    license: mapLicense(attrs.rightsList),
    resourceType: (attrs.types?.resourceTypeGeneral || 'Dataset').toLowerCase() === 'dataset' ? 'dataset' : 'other',
    dataPublisher: attrs.publisher || 'Unknown',
    _citation: null,
    _source: `DataCite:${attrs.publisher || 'unknown'}`,
    _metadataLink: `${DATACITE_API}/${encodeURIComponent(attrs.doi)}`,
    _webMapLink: null,
    _metadataFullText: [title, abstract, ...keywords].filter(Boolean).join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(
  resolved: { doi: string; attrs: DataCiteAttrs }[],
  existing: NormalizedDataset[],
): { newDatasets: { doi: string; attrs: DataCiteAttrs }[]; duplicates: number } {
  const existingDois = new Set(existing.map((d) => d.doi).filter(Boolean))
  const existingTitles = existing.map((d) => d.title)

  let duplicates = 0
  const newDatasets: { doi: string; attrs: DataCiteAttrs }[] = []

  for (const item of resolved) {
    if (existingDois.has(item.doi)) { duplicates++; continue }
    const title = item.attrs.titles?.[0]?.title || ''
    if (existingTitles.some((t) => titleSimilarity(title, t) > 0.8)) { duplicates++; continue }
    newDatasets.push(item)
  }

  return { newDatasets, duplicates }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Dataset Discovery from Unmatched DOIs (DataCite)')
  console.log('=================================================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/datasets-discovered-dois.json`

  // Step 1: Get unmatched DOIs
  console.log('\nStep 1: Loading unmatched DOIs from crosslinks report...')
  const dois = getUnmatchedDois()
  console.log(`  ${dois.length} valid DOIs to resolve`)

  // Step 2: Resolve via DataCite
  console.log(`\nStep 2: Resolving DOIs via DataCite API...`)
  const resolved: { doi: string; attrs: DataCiteAttrs; citedBy: number }[] = []
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
  const { newDatasets, duplicates } = deduplicateResults(resolved, existing)
  console.log(`  ${duplicates} duplicates, ${newDatasets.length} new`)

  if (dryRun) {
    console.log('\n(DRY RUN)')
    for (const d of newDatasets.slice(0, 10)) {
      console.log(`  ${d.attrs.titles?.[0]?.title?.slice(0, 55)} | ${d.attrs.publisher?.slice(0, 20)} | cited by ${d.citedBy}`)
    }
    return
  }

  // Step 4: Normalize
  const normalized = newDatasets.map((d) => normalizeDataCite(d.attrs))
  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

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

  console.log(`\nOutput: ${outputPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
