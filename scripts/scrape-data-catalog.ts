/**
 * RMBL Data Catalog Scraper & Normalizer
 *
 * 1. Pulls all datasets from the RMBL Data Catalog REST API
 * 2. Parses authors from the Citation field (multiple formats)
 * 3. Validates DOIs (flags placeholders like "pending", "none")
 * 4. Normalizes to Payload Datasets schema
 *
 * Usage:
 *   npx tsx scripts/scrape-data-catalog.ts
 *
 * Outputs:
 *   scripts/output/data-catalog-raw.json         — raw API data (cached)
 *   scripts/output/data-catalog-normalized.json   — Payload-ready records
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'

const CATALOG_API =
  'https://www.rmbl.org/wp-json/rmbl-data-catalog/v1/catalog?take=500&skip=0&filter%5Bfilters%5D%5B0%5D%5Bfield%5D=id&filter%5Bfilters%5D%5B0%5D%5Boperator%5D=gte&filter%5Bfilters%5D%5B0%5D%5Bvalue%5D=1'
const OUTPUT_DIR = new URL('./output', import.meta.url).pathname

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawCatalogEntry {
  id: string
  DatasetName: string
  ShortDescription: string
  LongDescription: string | null
  Source: string
  TermsOfUse: string | null
  Citation: string | null
  DOI: string | null
  DatasetLink: string | null
  MetadataLink: string | null
  WebMapLink: string | null
  LatitudeMin: string | null
  LatitudeMax: string | null
  LongitudeMin: string | null
  LongitudeMax: string | null
  DateCollectedMin: { date: string } | null
  DateCollectedMax: { date: string } | null
  Authors_id: number
  Authors_Name: string
  Image_URL: string | null
  Tags: { Tag: string }[]
  DateCreated: string | null
  [key: string]: unknown
}

interface ParsedCreator {
  name: string
  orcid: string | null
  affiliation: string | null
}

interface NormalizedDataset {
  _sourceId: string
  title: string
  description: string
  creators: ParsedCreator[]
  datePublished: string | null
  publicationYear: number
  spatialExtent: {
    westBoundLongitude: number
    eastBoundLongitude: number
    southBoundLatitude: number
    northBoundLatitude: number
  } | null
  temporalExtent: { start: string | null; end: string | null }
  downloadUrl: string | null
  doi: string | null
  _doiStatus: 'valid' | 'pending' | 'none' | 'invalid'
  repository: string | null
  externalCatalogUrl: string | null
  spatialDescription: string
  tags: string[]
  license: string | null
  resourceType: string
  dataPublisher: string
  _citation: string | null
  _source: string
  _metadataLink: string | null
  _webMapLink: string | null
}

// ---------------------------------------------------------------------------
// DOI validation
// ---------------------------------------------------------------------------

interface DoiResult {
  doi: string | null
  status: 'valid' | 'pending' | 'none' | 'invalid'
}

function validateDoi(raw: string | null): DoiResult {
  if (!raw || raw.trim() === '') return { doi: null, status: 'none' }

  const cleaned = raw.trim()

  // Placeholder values
  if (/^(pending|tbd|n\/?a|none|not yet assigned)$/i.test(cleaned)) {
    return { doi: null, status: 'pending' }
  }

  // Extract the actual DOI (10.XXXX/...) from various formats
  let doi: string | null = null

  // "doi:10.xxxx/yyyy"
  const doiPrefixMatch = cleaned.match(/^doi:\s*(10\.\S+)/i)
  if (doiPrefixMatch) doi = doiPrefixMatch[1]

  // "https://doi.org/10.xxxx/yyyy" or "doi.org/10.xxxx/yyyy"
  if (!doi) {
    const urlMatch = cleaned.match(/doi\.org\/(10\.\S+)/i)
    if (urlMatch) doi = urlMatch[1]
  }

  // Bare "10.xxxx/yyyy"
  if (!doi) {
    const bareMatch = cleaned.match(/^(10\.\d{4,}\/\S+)/)
    if (bareMatch) doi = bareMatch[1]
  }

  // Malformed: missing leading "1" (e.g., "0.6073/...")
  if (!doi) {
    const malformedMatch = cleaned.match(/^(0\.\d{4,}\/\S+)/)
    if (malformedMatch) doi = '1' + malformedMatch[1]
  }

  if (doi) {
    // Clean trailing punctuation/whitespace
    doi = doi.replace(/[.,;)\s]+$/, '')
    return { doi, status: 'valid' }
  }

  return { doi: null, status: 'invalid' }
}

// ---------------------------------------------------------------------------
// Author parsing from citation strings
// ---------------------------------------------------------------------------

function parseAuthorsFromCitation(citation: string | null, fallbackName: string): ParsedCreator[] {
  if (!citation || /^(pending|none)$/i.test(citation.trim())) {
    return [{ name: fallbackName, orcid: null, affiliation: null }]
  }

  // Extract the author portion: everything before the year
  // Common patterns:
  //   "LastName, I.N., I.N. LastName, and I.N. LastName. YEAR."
  //   "FirstName LastName and FirstName LastName. YEAR."
  //   "LastName I.N. ; LastName I.N. (YEAR):"
  //   "LastName, I.N., YEAR, ..."

  const text = citation.trim()

  // Try to find where authors end and title/year begins
  let authorPart = extractAuthorPortion(text)

  if (!authorPart || authorPart.length < 2) {
    return [{ name: fallbackName, orcid: null, affiliation: null }]
  }

  // Now parse the author portion into individual names
  const authors = splitAuthors(authorPart)

  if (authors.length === 0) {
    return [{ name: fallbackName, orcid: null, affiliation: null }]
  }

  return authors.map((name) => ({ name: name.trim(), orcid: null, affiliation: null }))
}

function extractAuthorPortion(text: string): string | null {
  // Pattern 1: Semicolon-separated authors with (YEAR): at end
  //   "Carroll R ; Bill M ; Dong W ; Williams K  (2019):"
  const semicolonMatch = text.match(/^(.+?)\s*\(\d{4}\)\s*:/)
  if (semicolonMatch && semicolonMatch[1].includes(';')) {
    return semicolonMatch[1]
  }

  // Pattern 2: Authors followed by ". YEAR." or ", YEAR,"
  //   "Lynn, J.S., M.R. Kazenel, ... and J.A. Rudgers. 2019."
  //   "Briggs, M.A., ..., 2018, ..."
  const dotYearMatch = text.match(/^(.+?)\.\s*(?:19|20)\d{2}[.,\s]/)
  if (dotYearMatch) {
    return dotYearMatch[1]
  }

  // Pattern 3: Authors followed by " (YEAR)" or " (YEAR,"
  //   "Irwin, R., Inouye, B. D., ... (2018, December 4)."
  const parenYearMatch = text.match(/^(.+?)\s*\((?:19|20)\d{2}[,)]/)
  if (parenYearMatch) {
    return parenYearMatch[1]
  }

  // Pattern 4: "FirstName LastName and FirstName LastName. YEAR."
  const simpleMatch = text.match(/^(.+?)\.\s*(?:19|20)\d{2}/)
  if (simpleMatch) {
    return simpleMatch[1]
  }

  return null
}

function splitAuthors(authorStr: string): string[] {
  let cleaned = authorStr.trim()

  // Remove trailing punctuation
  cleaned = cleaned.replace(/[.,;&]+$/, '').trim()

  // Semicolon-separated: "Carroll R ; Bill M ; Dong W"
  if (cleaned.includes(';')) {
    return cleaned.split(/\s*;\s*/).filter(Boolean).map(normalizeAuthorName)
  }

  // "and"/"&" separated with no commas: "Haruko Wainwright and Kenneth Williams"
  if (!cleaned.includes(',') && /\band\b|&/.test(cleaned)) {
    return cleaned.split(/\s+(?:and|&)\s+/).filter(Boolean).map(normalizeAuthorName)
  }

  // APA-style with commas and "&": "LastName, I.N., LastName, I.N., & LastName, I.N."
  // or: "LastName, I.N., I.N. LastName, and I.N. LastName"
  // This is trickier — we need to handle "LastName, Initials" pairs

  // Strategy: split on ", and " or ", & " first to get the last author
  let parts: string[] = []
  const lastAuthorSplit = cleaned.split(/,\s*(?:and|&)\s+/)
  if (lastAuthorSplit.length === 2) {
    const mainPart = lastAuthorSplit[0]
    const lastAuthor = lastAuthorSplit[1]
    parts = splitCommaAuthors(mainPart)
    parts.push(lastAuthor)
  } else {
    parts = splitCommaAuthors(cleaned)
  }

  return parts.filter(Boolean).map(normalizeAuthorName)
}

function splitCommaAuthors(str: string): string[] {
  // Handle "LastName, I.N., I.N. LastName, I.N. LastName" format
  // Key insight: "LastName, I.N." has a comma after surname followed by initials
  // While "I.N. LastName, I.N. LastName" uses commas as separators

  const parts = str.split(',').map((p) => p.trim()).filter(Boolean)

  // If we have pairs like ["Lynn", "J.S.", "M.R. Kazenel", "S.N. Kivlin"]
  // the first two are one author (LastName, Initials), rest are separate authors
  const authors: string[] = []
  let i = 0
  while (i < parts.length) {
    const current = parts[i]
    const next = parts[i + 1]

    // Check if next part looks like initials for current surname
    if (next && isInitialsOrGiven(next) && !next.includes(' ')) {
      // "LastName, I.N." or "LastName, FirstName"
      authors.push(`${current}, ${next}`)
      i += 2
    } else {
      authors.push(current)
      i += 1
    }
  }

  return authors
}

function isInitialsOrGiven(str: string): boolean {
  const s = str.trim()
  // Matches: "J.S.", "J. S.", "J.S", "John", "J", "B.D.", "P.J."
  return /^[A-Z]\.?\s*[A-Z]?\.?\s*[A-Z]?\.?$/.test(s) || /^[A-Z][a-z]+$/.test(s)
}

function normalizeAuthorName(raw: string): string {
  let name = raw.trim()
  // Remove trailing/leading punctuation
  name = name.replace(/^[.,;:&\s]+|[.,;:&\s]+$/g, '')
  // Remove "et al"
  name = name.replace(/\bet al\.?$/i, '').trim()
  // Normalize multiple spaces
  name = name.replace(/\s+/g, ' ')
  return name
}

// ---------------------------------------------------------------------------
// License parsing
// ---------------------------------------------------------------------------

function parseLicense(termsOfUse: string | null): string | null {
  if (!termsOfUse) return null
  const t = termsOfUse.toLowerCase()
  if (t.includes('cc0') || t.includes('cc 0') || t.includes('public domain')) return 'cc0'
  if (t.includes('cc by-sa') || t.includes('cc by sa')) return 'cc_by_sa_4'
  if (t.includes('cc by-nc') || t.includes('cc by nc')) return 'cc_by_nc_4'
  if (t.includes('cc by') || t.includes('cc-by') || t.includes('attribution')) return 'cc_by_4'
  if (t.includes('mit')) return 'mit'
  return 'other'
}

// ---------------------------------------------------------------------------
// Repository mapping
// ---------------------------------------------------------------------------

function mapRepository(source: string): string {
  const s = source.toLowerCase()
  if (s.includes('ess-dive') || s.includes('ess_dive') || s.includes('ess - dive')) return 'ess_dive'
  if (s.includes('spatial data platform') || s.includes('rmbl')) return 's3'
  return 'other'
}

// ---------------------------------------------------------------------------
// Year extraction
// ---------------------------------------------------------------------------

function extractYear(entry: RawCatalogEntry): number {
  // Try DateCreated first
  if (entry.DateCreated) {
    const y = parseInt(entry.DateCreated.slice(0, 4))
    if (y > 1900) return y
  }
  // Try citation
  if (entry.Citation) {
    const yearMatch = entry.Citation.match(/(?:19|20)\d{2}/)
    if (yearMatch) return parseInt(yearMatch[0])
  }
  // Try date collected max
  if (entry.DateCollectedMax?.date) {
    const y = parseInt(entry.DateCollectedMax.date.slice(0, 4))
    if (y > 1900) return y
  }
  return 0
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeEntry(entry: RawCatalogEntry): NormalizedDataset {
  const doiResult = validateDoi(entry.DOI)
  const creators = parseAuthorsFromCitation(entry.Citation, entry.Authors_Name)
  const year = extractYear(entry)

  // Parse spatial extent
  let spatialExtent = null
  if (entry.LatitudeMin && entry.LongitudeMin) {
    const south = parseFloat(entry.LatitudeMin)
    const north = parseFloat(entry.LatitudeMax || entry.LatitudeMin)
    const west = parseFloat(entry.LongitudeMin)
    const east = parseFloat(entry.LongitudeMax || entry.LongitudeMin)
    if (!isNaN(south) && !isNaN(west)) {
      spatialExtent = {
        southBoundLatitude: south,
        northBoundLatitude: north,
        westBoundLongitude: west,
        eastBoundLongitude: east,
      }
    }
  }

  // Parse temporal extent
  const tempStart = entry.DateCollectedMin?.date?.slice(0, 10) || null
  const tempEnd = entry.DateCollectedMax?.date?.slice(0, 10) || null

  // Tags
  const tags = (entry.Tags || []).map((t) => t.Tag)

  return {
    _sourceId: entry.id,
    title: entry.DatasetName,
    description: entry.LongDescription || entry.ShortDescription || '',
    creators,
    datePublished: entry.DateCreated?.slice(0, 10) || null,
    publicationYear: year,
    spatialExtent,
    temporalExtent: { start: tempStart, end: tempEnd },
    downloadUrl: entry.DatasetLink || null,
    doi: doiResult.doi,
    _doiStatus: doiResult.status,
    repository: mapRepository(entry.Source),
    externalCatalogUrl: entry.MetadataLink || null,
    spatialDescription: 'Upper East River / Gunnison Basin, Colorado',
    tags,
    license: parseLicense(entry.TermsOfUse),
    resourceType: 'dataset',
    dataPublisher: 'RMBL',
    _citation: entry.Citation || null,
    _source: entry.Source,
    _metadataLink: entry.MetadataLink || null,
    _webMapLink: entry.WebMapLink || null,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rawPath = `${OUTPUT_DIR}/data-catalog-raw.json`
  const outputPath = `${OUTPUT_DIR}/data-catalog-normalized.json`

  // Step 1: Fetch (or load cached)
  let raw: RawCatalogEntry[]
  if (existsSync(rawPath)) {
    console.log('Loading cached raw data...')
    raw = JSON.parse(readFileSync(rawPath, 'utf-8'))
  } else {
    console.log('Fetching data catalog from API...')
    const res = await fetch(CATALOG_API)
    if (!res.ok) throw new Error(`API request failed: ${res.status}`)
    raw = await res.json()
    writeFileSync(rawPath, JSON.stringify(raw, null, 2))
  }
  console.log(`  ${raw.length} catalog entries`)

  // Step 2: Normalize
  console.log('\nNormalizing...')
  const normalized = raw.map(normalizeEntry)

  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))
  console.log(`Wrote ${normalized.length} records to ${outputPath}`)

  // Summary
  printSummary(normalized)
}

function printSummary(datasets: NormalizedDataset[]) {
  console.log('\n========== Summary ==========')
  console.log(`Total datasets: ${datasets.length}`)

  // DOI status
  const doiCounts = { valid: 0, pending: 0, none: 0, invalid: 0 }
  for (const d of datasets) doiCounts[d._doiStatus]++
  console.log('\nDOI status:')
  console.log(`  Valid DOI:   ${doiCounts.valid}`)
  console.log(`  Pending:     ${doiCounts.pending}`)
  console.log(`  None:        ${doiCounts.none}`)
  console.log(`  Invalid:     ${doiCounts.invalid}`)

  // Field coverage
  const withSpatial = datasets.filter((d) => d.spatialExtent).length
  const withTemporal = datasets.filter((d) => d.temporalExtent.start).length
  const withLicense = datasets.filter((d) => d.license).length
  const withDownload = datasets.filter((d) => d.downloadUrl).length
  const withMultipleAuthors = datasets.filter((d) => d.creators.length > 1).length

  console.log('\nField coverage:')
  console.log(`  With valid DOI:       ${doiCounts.valid}`)
  console.log(`  With spatial extent:  ${withSpatial}`)
  console.log(`  With temporal extent: ${withTemporal}`)
  console.log(`  With license:         ${withLicense}`)
  console.log(`  With download URL:    ${withDownload}`)
  console.log(`  With multiple authors: ${withMultipleAuthors}`)

  // Author stats
  const authorCounts = datasets.map((d) => d.creators.length)
  const totalAuthors = authorCounts.reduce((a, b) => a + b, 0)
  const maxAuthors = Math.max(...authorCounts)
  console.log(`\nAuthor parsing:`)
  console.log(`  Total creators:  ${totalAuthors}`)
  console.log(`  Avg per dataset: ${(totalAuthors / datasets.length).toFixed(1)}`)
  console.log(`  Max per dataset: ${maxAuthors}`)
  console.log(`  Single-author (fallback): ${datasets.filter((d) => d.creators.length === 1).length}`)

  // Repository distribution
  const repoCounts = new Map<string, number>()
  for (const d of datasets) {
    const r = d.repository || 'unknown'
    repoCounts.set(r, (repoCounts.get(r) || 0) + 1)
  }
  console.log('\nBy repository:')
  for (const [r, c] of [...repoCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${c}`)
  }

  // License distribution
  const licenseCounts = new Map<string, number>()
  for (const d of datasets) {
    const l = d.license || '(none)'
    licenseCounts.set(l, (licenseCounts.get(l) || 0) + 1)
  }
  console.log('\nBy license:')
  for (const [l, c] of [...licenseCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l}: ${c}`)
  }

  // Sample records
  console.log('\n========== Sample Records ==========')
  const samples = [
    datasets.find((d) => d._doiStatus === 'valid' && d.creators.length > 2),
    datasets.find((d) => d._doiStatus === 'pending'),
    datasets.find((d) => d.repository === 'ess_dive'),
  ]
  for (const d of samples) {
    if (!d) continue
    console.log(`\n  ${d.title.slice(0, 70)}...`)
    console.log(`  Creators: ${d.creators.map((c) => c.name).join('; ')}`)
    console.log(`  DOI: ${d.doi || '(' + d._doiStatus + ')'}`)
    console.log(`  Year: ${d.publicationYear}`)
    console.log(`  Repository: ${d._source}`)
    console.log(`  Tags: ${d.tags.join(', ')}`)
    console.log(`  License: ${d.license}`)
    console.log(`  Spatial: ${d.spatialExtent ? 'yes' : 'no'}`)
    console.log(`  Temporal: ${d.temporalExtent.start || '?'} – ${d.temporalExtent.end || '?'}`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
