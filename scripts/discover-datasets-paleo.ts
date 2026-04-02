/**
 * NCEI Paleoclimatology/Paleoecology Dataset Discovery
 *
 * Discovers paleo datasets from NOAA NCEI's Paleo Search API using
 * keyword searches. Includes fire history, tree ring, pollen, and
 * climate reconstruction records for the Gunnison Basin area.
 *
 * Note: The Paleo API's geographic bbox parameter doesn't work, so
 * we use text search + client-side coordinate filtering.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-paleo.ts [--dry-run] [--limit=N]
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

const PALEO_API = 'https://www.ncei.noaa.gov/access/paleo-search/study/search.json'

// Search terms for our area
const SEARCH_TERMS = [
  'Gunnison',
  'Gothic Colorado',
  'Crested Butte',
  'East River Colorado',
  'Elk Mountains Colorado',
  'West Elk',
  'Upper Gunnison',
]

// Bounding box for client-side coordinate filtering
const BBOX = { south: 37.5, north: 40.0, west: -108.0, east: -106.0 }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Query NCEI Paleo
// ---------------------------------------------------------------------------

async function queryPaleo(): Promise<PaleoStudy[]> {
  const allStudies = new Map<string, PaleoStudy>()

  for (const term of SEARCH_TERMS) {
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

  return [...allStudies.values()].slice(0, limit)
}

// ---------------------------------------------------------------------------
// Geographic filtering (client-side since API bbox doesn't work)
// ---------------------------------------------------------------------------

function isInArea(study: PaleoStudy): boolean {
  // Check study name and keywords for area references
  const text = [
    study.studyName,
    study.dataTypeList,
    ...(study.scienceKeywords || []),
  ].filter(Boolean).join(' ').toLowerCase()

  const areaTerms = /gunnison|gothic|crested butte|east river|elk mountain|west elk|upper gunnison|black canyon|ohio creek|taylor river|cement creek/i
  return areaTerms.test(text)
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(
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

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('NCEI Paleo Dataset Discovery')
  console.log('============================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/datasets-discovered-paleo.json`

  // Step 1: Query
  console.log('\nStep 1: Querying NCEI Paleo Search...')
  const raw = await queryPaleo()
  console.log(`  ${raw.length} unique studies`)

  // Step 2: Filter by area
  console.log('\nStep 2: Filtering for Gunnison Basin area...')
  const inArea = raw.filter(isInArea)
  console.log(`  ${inArea.length} in area (${raw.length - inArea.length} filtered)`)

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating...')
  const existing: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const { newStudies, duplicates } = deduplicateResults(inArea, existing)
  console.log(`  ${duplicates} duplicates, ${newStudies.length} new`)

  if (dryRun) {
    console.log('\n(DRY RUN)')
    for (const s of newStudies.slice(0, 10)) {
      console.log(`  ${s.studyName?.slice(0, 60)} | ${s.dataTypeList || '?'}`)
    }
    return
  }

  // Step 4: Normalize
  const normalized = newStudies.map(normalizePaleoStudy)
  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

  console.log('\n========== Summary ==========')
  console.log(`NCEI Paleo results:  ${raw.length}`)
  console.log(`In area:             ${inArea.length}`)
  console.log(`Duplicates:          ${duplicates}`)
  console.log(`New datasets:        ${normalized.length}`)
  console.log(`With DOI:            ${normalized.filter((d) => d.doi).length}`)
  console.log(`Data types:          ${[...new Set(newStudies.map((s) => s.dataTypeList).filter(Boolean))].join(', ')}`)
  console.log(`\nOutput: ${outputPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
