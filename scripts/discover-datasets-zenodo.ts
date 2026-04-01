/**
 * Zenodo Dataset Discovery
 *
 * Discovers datasets from Zenodo using keyword searches for the
 * Gunnison Basin / RMBL area. Deduplicates against existing datasets
 * and normalizes to the Payload schema.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-zenodo.ts [--dry-run] [--limit=N]
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

const ZENODO_API = 'https://zenodo.org/api/records'

// Multiple targeted queries to maximize recall while reducing noise
// Single combined query — Zenodo uses Elasticsearch syntax
const QUERY = 'Gunnison OR "Crested Butte" OR "Rocky Mountain Biological Laboratory" OR (Gothic AND Colorado AND (ecology OR biology OR hydrology))'

// ---------------------------------------------------------------------------
// Zenodo API
// ---------------------------------------------------------------------------

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

async function queryZenodo(): Promise<ZenodoHit[]> {
  const allHits: ZenodoHit[] = []
  let page = 1
  const maxPages = 20 // safety limit: 20 * 25 = 500 max results

  while (page <= maxPages) {
    const params = new URLSearchParams({
      q: QUERY,
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

// ---------------------------------------------------------------------------
// Relevance filtering — remove false positives
// ---------------------------------------------------------------------------

const RELEVANCE_KEYWORDS = /\b(rmbl|gunnison|crested butte|gothic|east river|colorado|rocky mountain biological|alpine|subalpine|montane|marmot|wildflower|snowmelt)\b/i

function isRelevant(hit: ZenodoHit): boolean {
  const text = [
    hit.metadata.title,
    hit.metadata.description?.slice(0, 500),
    ...(hit.metadata.keywords || []),
    ...(hit.metadata.creators?.map((c) => c.affiliation) || []),
  ]
    .filter(Boolean)
    .join(' ')

  return RELEVANCE_KEYWORDS.test(text)
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(
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

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function mapLicense(license?: { id: string }): string | null {
  if (!license?.id) return null
  const id = license.id.toLowerCase()
  if (id.includes('cc0') || id === 'cc-zero') return 'cc0'
  if (id.includes('cc-by-sa')) return 'cc_by_sa_4'
  if (id.includes('cc-by-nc')) return 'cc_by_nc_4'
  if (id.includes('cc-by')) return 'cc_by_4'
  if (id.includes('mit')) return 'mit'
  return 'other'
}

function stripHtml(s: string): string {
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

  const description = meta.description ? stripHtml(meta.description) : ''

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
    license: mapLicense(meta.license),
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Zenodo Dataset Discovery')
  console.log('========================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/datasets-discovered-zenodo.json`

  // Step 1: Query Zenodo
  console.log('\nStep 1: Querying Zenodo...')
  const raw = await queryZenodo()
  console.log(`  ${raw.length} unique datasets from Zenodo`)

  // Step 2: Filter for relevance
  console.log('\nStep 2: Filtering for relevance...')
  const relevant = raw.filter(isRelevant)
  const filtered = raw.length - relevant.length
  console.log(`  ${relevant.length} relevant, ${filtered} filtered out`)

  if (dryRun && filtered > 0) {
    console.log('  Filtered out (false positives):')
    for (const h of raw.filter((h) => !isRelevant(h)).slice(0, 5)) {
      console.log(`    ${h.metadata.title?.slice(0, 70)}`)
    }
  }

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating against existing datasets...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newHits, duplicates } = deduplicateResults(
    relevant.slice(0, limit),
    existing,
  )
  console.log(`  ${duplicates} duplicates, ${newHits.length} new`)

  if (dryRun) {
    console.log('\n(DRY RUN — not saving)')
    console.log('\nSample new datasets:')
    for (const h of newHits.slice(0, 10)) {
      console.log(`  ${h.metadata.title?.slice(0, 70)} | ${h.metadata.publication_date} | DOI: ${h.doi}`)
    }
    return
  }

  // Step 4: Normalize
  console.log('\nStep 4: Normalizing...')
  const normalized = newHits.map(normalizeZenodoHit)
  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

  console.log('\n========== Summary ==========')
  console.log(`Zenodo results:      ${raw.length}`)
  console.log(`Filtered (noise):    ${filtered}`)
  console.log(`Duplicates removed:  ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`With description:    ${normalized.filter((d) => d.description).length}`)
  console.log(`With keywords:       ${normalized.filter((d) => d.tags.length > 0).length}`)
  console.log(`With creators:       ${normalized.filter((d) => d.creators[0]?.name !== 'Unknown').length}`)
  console.log(`\nOutput: ${outputPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
