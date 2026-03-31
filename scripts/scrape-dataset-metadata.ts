/**
 * Dataset Metadata Scraper
 *
 * Downloads metadata XML/documents for datasets in the Data Catalog.
 * Extracts rich text (abstracts, methods, geographic descriptions, keywords)
 * and stores it for search indexing.
 *
 * Sources handled:
 *   - S3 XML (RMBL SDP): QGIS metadata XML
 *   - DataONE/ESS-DIVE: EML XML
 *   - EDI: EML XML
 *   - Dryad: JSON API
 *   - Others: best-effort HTML scraping
 *
 * Usage:
 *   npx tsx scripts/scrape-dataset-metadata.ts [--limit=N]
 */

import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { JSDOM } from 'jsdom'

const OUTPUT_DIR = new URL('./output', import.meta.url).pathname
const META_DIR = `${OUTPUT_DIR}/dataset-metadata`
const CONCURRENCY = 3
const DELAY_MS = 300

interface RawCatalogEntry {
  id: string
  DatasetName: string
  MetadataLink: string | null
  DOI: string | null
  [key: string]: unknown
}

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
// Concurrency
// ---------------------------------------------------------------------------

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  label: string,
): Promise<void> {
  let completed = 0
  const total = items.length
  async function worker(queue: T[]) {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
      completed++
      if (completed % 10 === 0 || completed === total) {
        process.stdout.write(`\r  ${label}: ${completed}/${total}`)
      }
      await sleep(DELAY_MS)
    }
  }
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)))
  console.log()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Dataset Metadata Scraper')
  console.log('========================')

  mkdirSync(META_DIR, { recursive: true })

  const raw: RawCatalogEntry[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-raw.json`, 'utf-8'))
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
  const limit = limitArg ? parseInt(limitArg) : raw.length

  const candidates = raw.filter((d) => d.MetadataLink).slice(0, limit)
  console.log(`\nFetching metadata for ${candidates.length} datasets...`)

  const results: MetadataResult[] = []

  await runConcurrent(
    candidates,
    CONCURRENCY,
    async (entry) => {
      const result = await fetchMetadata(entry)
      results.push(result)
    },
    'Metadata',
  )

  // Save results
  writeFileSync(`${OUTPUT_DIR}/dataset-metadata-extracted.json`, JSON.stringify(results, null, 2))

  // Summary
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

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
