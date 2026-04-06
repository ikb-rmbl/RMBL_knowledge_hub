/**
 * RMBL Data Catalog Scraper, Normalizer & Metadata Fetcher
 *
 * 1. Pulls all datasets from the RMBL Data Catalog REST API
 * 2. Parses authors from the Citation field (multiple formats)
 * 3. Validates DOIs (flags placeholders like "pending", "none")
 * 4. Normalizes to Payload Datasets schema
 * 5. Downloads metadata XML/documents and extracts rich text for search indexing
 *
 * Usage:
 *   npx tsx scripts/scrape-catalog.ts [--skip-metadata] [--dry-run] [--limit=N]
 *
 * Outputs:
 *   scripts/output/data-catalog-raw.json              — raw API data (cached)
 *   scripts/output/data-catalog-normalized.json        — Payload-ready records
 *   scripts/output/dataset-metadata-extracted.json     — extracted metadata text
 *   scripts/output/dataset-metadata/*.xml              — raw metadata files
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { JSDOM } from 'jsdom'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR as CONFIG_OUTPUT_DIR, CONCURRENCY as CONCURRENCY_CFG, DELAYS } from './lib/config.js'

const OUTPUT_DIR = CONFIG_OUTPUT_DIR
const META_DIR = `${OUTPUT_DIR}/dataset-metadata`

const skipMetadata = process.argv.includes('--skip-metadata')
const dryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined

const CATALOG_API =
  'https://www.rmbl.org/wp-json/rmbl-data-catalog/v1/catalog?take=500&skip=0&filter%5Bfilters%5D%5B0%5D%5Bfield%5D=id&filter%5Bfilters%5D%5B0%5D%5Boperator%5D=gte&filter%5Bfilters%5D%5B0%5D%5Bvalue%5D=1'

const DATASET_CONCURRENCY = CONCURRENCY_CFG.API_CALLS
const DELAY_MS = DELAYS.METADATA_MS

// ===========================================================================
// CATALOG SCRAPING & NORMALIZATION
// ===========================================================================

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
// Catalog summary
// ---------------------------------------------------------------------------

function printCatalogSummary(datasets: NormalizedDataset[]) {
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

// ===========================================================================
// METADATA FETCHING
// ===========================================================================

interface MetadataResult {
  catalogId: string
  title: string
  fullText: string  // concatenated searchable text
  abstract: string | null
  methods: string | null
  keywords: string[]
  geographicDescription: string | null
  creators: string[]
  source: string
  metadataFormat: string
  fetchStatus: 'ok' | 'failed'
  error: string | null
}

// ---------------------------------------------------------------------------
// XML text extraction helpers
// ---------------------------------------------------------------------------

function xmlText(xml: string, tag: string): string | null {
  // Simple regex extraction — works for well-structured XML
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(re)
  if (!match) return null
  // Strip nested tags
  return match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function xmlTextAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const results: string[] = []
  let match
  while ((match = re.exec(xml))) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text) results.push(text)
  }
  return results
}

// ---------------------------------------------------------------------------
// EML XML parser (DataONE, ESS-DIVE, EDI)
// ---------------------------------------------------------------------------

function parseEml(xml: string): Partial<MetadataResult> {
  const title = xmlText(xml, 'title')
  const abstract = xmlText(xml, 'abstract')
  const methods = xmlTextAll(xml, 'methodStep').join('\n\n') || xmlText(xml, 'methods') || null
  const geoDesc = xmlText(xml, 'geographicDescription')
  const keywords = xmlTextAll(xml, 'keyword')

  const creatorNames: string[] = []
  const creatorBlocks = xml.match(/<creator[^>]*>[\s\S]*?<\/creator>/gi) || []
  for (const block of creatorBlocks) {
    const given = xmlText(block, 'givenName') || ''
    const sur = xmlText(block, 'surName') || ''
    const org = xmlText(block, 'organizationName') || ''
    if (given || sur) creatorNames.push(`${given} ${sur}`.trim())
    else if (org) creatorNames.push(org)
  }

  const parts = [title, abstract, methods, geoDesc, ...keywords].filter(Boolean)

  return {
    abstract,
    methods,
    keywords,
    geographicDescription: geoDesc,
    creators: creatorNames,
    fullText: parts.join('\n\n'),
    metadataFormat: 'EML',
  }
}

// ---------------------------------------------------------------------------
// QGIS XML parser (RMBL SDP S3 metadata)
// ---------------------------------------------------------------------------

function parseQgisXml(xml: string): Partial<MetadataResult> {
  const title = xmlText(xml, 'title')
  const abstract = xmlText(xml, 'abstract')
  const keywords = xmlTextAll(xml, 'keyword')

  const contactName = xmlText(xml, 'name')
  const contactOrg = xmlText(xml, 'organization')
  const creators = contactName ? [`${contactName}${contactOrg ? ' (' + contactOrg + ')' : ''}`] : []

  const license = xmlText(xml, 'license')
  const parts = [title, abstract, license, ...keywords].filter(Boolean)

  return {
    abstract,
    methods: null,
    keywords,
    geographicDescription: null,
    creators,
    fullText: parts.join('\n\n'),
    metadataFormat: 'QGIS-XML',
  }
}

// ---------------------------------------------------------------------------
// Dryad JSON parser
// ---------------------------------------------------------------------------

async function fetchDryadMetadata(url: string): Promise<Partial<MetadataResult>> {
  // Dryad URLs like: https://datadryad.org/stash/dataset/doi:10.7280/D17C7X
  // API: https://datadryad.org/api/v2/datasets/{doi}
  const doiMatch = url.match(/doi[:%]([^&\s]+)/)
  if (!doiMatch) return { metadataFormat: 'Dryad', fullText: '' }

  const doi = decodeURIComponent(doiMatch[1])
  try {
    const res = await fetch(`https://datadryad.org/api/v2/datasets/doi%3A${encodeURIComponent(doi)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { metadataFormat: 'Dryad', fullText: '' }
    const data = await res.json()

    const abstract = data.abstract || null
    const methods = data.methods || null
    const keywords = data.keywords || []
    const creators = (data.authors || []).map((a: any) => `${a.firstName || ''} ${a.lastName || ''}`.trim())

    return {
      abstract,
      methods,
      keywords,
      creators,
      fullText: [data.title, abstract, methods, ...keywords].filter(Boolean).join('\n\n'),
      metadataFormat: 'Dryad-JSON',
    }
  } catch {
    return { metadataFormat: 'Dryad', fullText: '' }
  }
}

// ---------------------------------------------------------------------------
// Fetch and parse a single metadata link
// ---------------------------------------------------------------------------

async function fetchMetadata(entry: RawCatalogEntry): Promise<MetadataResult> {
  const result: MetadataResult = {
    catalogId: entry.id,
    title: entry.DatasetName,
    fullText: '',
    abstract: null,
    methods: null,
    keywords: [],
    geographicDescription: null,
    creators: [],
    source: '',
    metadataFormat: 'unknown',
    fetchStatus: 'failed',
    error: null,
  }

  if (!entry.MetadataLink) {
    result.error = 'No metadata link'
    return result
  }

  const url = entry.MetadataLink
  result.source = url

  try {
    // Dryad — use JSON API
    if (url.includes('datadryad.org')) {
      const parsed = await fetchDryadMetadata(url)
      Object.assign(result, parsed)
      result.fetchStatus = result.fullText.length > 0 ? 'ok' : 'failed'
      return result
    }

    // Fetch the URL
    const res = await fetch(url, {
      headers: { Accept: 'application/xml, text/xml, */*' },
      redirect: 'follow',
    })

    if (!res.ok) {
      result.error = `HTTP ${res.status}`
      return result
    }

    const contentType = res.headers.get('content-type') || ''
    const body = await res.text()

    // XML responses
    if (contentType.includes('xml') || body.trimStart().startsWith('<?xml') || body.trimStart().startsWith('<')) {
      let parsed: Partial<MetadataResult>

      if (body.includes('eml://ecoinformatics.org') || body.includes('<eml:eml') || body.includes('<dataset>')) {
        parsed = parseEml(body)
      } else if (body.includes('<qgis') || body.includes('qgis.dtd')) {
        parsed = parseQgisXml(body)
      } else {
        // Generic XML — extract all text content
        const allText = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        parsed = { fullText: allText, metadataFormat: 'generic-XML' }
      }

      Object.assign(result, parsed)
      result.fetchStatus = result.fullText.length > 0 ? 'ok' : 'failed'

      // Save raw XML
      writeFileSync(`${META_DIR}/${entry.id}.xml`, body)
      return result
    }

    // JSON responses (figshare, etc.)
    if (contentType.includes('json')) {
      try {
        const data = JSON.parse(body)
        const texts = [data.title, data.description, data.abstract, data.methods]
          .filter(Boolean)
          .map((t: string) => t.replace(/<[^>]+>/g, ' ').trim())
        result.fullText = texts.join('\n\n')
        result.abstract = data.description || data.abstract || null
        result.keywords = data.tags?.map((t: any) => t.name || t) || data.keywords || []
        result.metadataFormat = 'JSON'
        result.fetchStatus = result.fullText.length > 0 ? 'ok' : 'failed'
      } catch {
        result.error = 'JSON parse error'
      }
      return result
    }

    // HTML — try to extract meaningful content
    if (contentType.includes('html')) {
      const dom = new JSDOM(body)
      const doc = dom.window.document
      // Try common metadata selectors
      const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content')
        || doc.querySelector('[class*="abstract"]')?.textContent
        || doc.querySelector('[class*="description"]')?.textContent
      if (desc) {
        result.fullText = desc.trim()
        result.abstract = desc.trim()
        result.metadataFormat = 'HTML'
        result.fetchStatus = 'ok'
      } else {
        result.error = 'HTML page — no structured metadata found'
        result.metadataFormat = 'HTML'
      }
      return result
    }

    result.error = `Unexpected content-type: ${contentType}`
  } catch (err: any) {
    result.error = err.message?.slice(0, 200) || String(err)
  }

  return result
}

// ---------------------------------------------------------------------------
// Metadata summary
// ---------------------------------------------------------------------------

function printMetadataSummary(results: MetadataResult[]) {
  const ok = results.filter((r) => r.fetchStatus === 'ok')
  const failed = results.filter((r) => r.fetchStatus === 'failed')

  console.log(`\nResults: ${ok.length} ok, ${failed.length} failed`)

  // By format
  const byFormat = new Map<string, number>()
  for (const r of ok) byFormat.set(r.metadataFormat, (byFormat.get(r.metadataFormat) || 0) + 1)
  console.log('\nBy format:')
  for (const [f, c] of [...byFormat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f}: ${c}`)
  }

  // Content stats
  const withAbstract = ok.filter((r) => r.abstract).length
  const withMethods = ok.filter((r) => r.methods).length
  const withKeywords = ok.filter((r) => r.keywords.length > 0).length
  const withGeo = ok.filter((r) => r.geographicDescription).length
  const avgTextLen = ok.reduce((a, r) => a + r.fullText.length, 0) / Math.max(ok.length, 1)

  console.log('\nContent extracted:')
  console.log(`  With abstract:     ${withAbstract}`)
  console.log(`  With methods:      ${withMethods}`)
  console.log(`  With keywords:     ${withKeywords}`)
  console.log(`  With geo desc:     ${withGeo}`)
  console.log(`  Avg text length:   ${Math.round(avgTextLen)} chars`)

  // Failure reasons
  if (failed.length > 0) {
    const reasons = new Map<string, number>()
    for (const r of failed) reasons.set(r.error || 'unknown', (reasons.get(r.error || 'unknown') || 0) + 1)
    console.log('\nFailure reasons:')
    for (const [r, c] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${r}: ${c}`)
    }
  }

  // Sample
  console.log('\n=== Sample Extracted Metadata ===')
  for (const r of ok.slice(0, 3)) {
    console.log(`\n  [${r.metadataFormat}] ${r.title.slice(0, 60)}`)
    console.log(`  Abstract: ${r.abstract?.slice(0, 100) || '(none)'}...`)
    console.log(`  Methods: ${r.methods?.slice(0, 80) || '(none)'}...`)
    console.log(`  Keywords: ${r.keywords.slice(0, 5).join(', ')}`)
    console.log(`  Text length: ${r.fullText.length} chars`)
  }
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rawPath = `${OUTPUT_DIR}/data-catalog-raw.json`
  const outputPath = `${OUTPUT_DIR}/data-catalog-normalized.json`

  if (dryRun) console.log('(DRY RUN)')

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
  printCatalogSummary(normalized)

  // Step 3: Fetch metadata
  if (!skipMetadata) {
    console.log('\n\nDataset Metadata Scraper')
    console.log('========================')

    mkdirSync(META_DIR, { recursive: true })

    const metadataLimit = limit ?? raw.length
    const candidates = raw.filter((d) => d.MetadataLink).slice(0, metadataLimit)
    console.log(`\nFetching metadata for ${candidates.length} datasets...`)

    const results: MetadataResult[] = []

    await runConcurrent(
      candidates,
      DATASET_CONCURRENCY,
      async (entry) => {
        const result = await fetchMetadata(entry)
        results.push(result)
        await sleep(DELAY_MS)
      },
      'Metadata',
    )

    // Save results
    writeFileSync(`${OUTPUT_DIR}/dataset-metadata-extracted.json`, JSON.stringify(results, null, 2))

    // Summary
    printMetadataSummary(results)
  } else {
    console.log('\nMetadata fetching: Skipped (--skip-metadata)')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
