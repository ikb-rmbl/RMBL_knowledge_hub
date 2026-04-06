/**
 * Sustainable Library Scraper & Normalizer
 *
 * 1. Pulls all document records via the Document Library Pro AJAX endpoint
 * 2. Enriches each record by scraping its detail page (tags, date posted)
 * 3. Issues HEAD requests to get PDF file sizes
 * 4. Normalizes scraped data into Payload Document schema
 * 5. Writes enriched JSON and normalized output
 *
 * Usage:
 *   npx tsx scripts/scrape-library.ts [--skip-details] [--skip-sizes] [--skip-normalize]
 *
 * Outputs:
 *   scripts/output/sustainable-library.json            — raw scraped data
 *   scripts/output/sustainable-library-normalized.json  — Payload-ready records
 *   scripts/output/topics-seed.json                     — Topics taxonomy entries
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { JSDOM } from 'jsdom'
import { runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, SUST_LIB_AJAX, CONCURRENCY } from './lib/config.js'
import type { ScrapedDocument, NormalizedDocument } from './lib/types.js'

const AJAX_URL = SUST_LIB_AJAX
const BATCH_SIZE = 50
const DETAIL_CONCURRENCY = CONCURRENCY.DETAIL_PAGES
const HEAD_CONCURRENCY = 20

const skipDetails = process.argv.includes('--skip-details')
const skipSizes = process.argv.includes('--skip-sizes')
const skipNormalize = process.argv.includes('--skip-normalize')

// ===========================================================================
// SCRAPING
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawRecord {
  __attributes: { id: string; class: string }
  title: string
  excerpt: string
  doc_categories: string
  link: string
}

// ---------------------------------------------------------------------------
// AJAX endpoint helpers
// ---------------------------------------------------------------------------

async function fetchNonce(): Promise<{ nonce: string; tableId: string }> {
  const res = await fetch('https://sustainablelibrary.org/all-files/')
  const html = await res.text()

  const nonceMatch = html.match(/"ajax_nonce":"([^"]+)"/)
  const tableIdMatch = html.match(/id="(dlp_[^"]+)"/)

  if (!nonceMatch || !tableIdMatch) {
    throw new Error('Could not extract nonce or table ID from page')
  }

  return { nonce: nonceMatch[1], tableId: tableIdMatch[1] }
}

async function fetchBatch(
  start: number,
  length: number,
  nonce: string,
  tableId: string,
): Promise<{ data: RawRecord[]; recordsTotal: number }> {
  const params = new URLSearchParams({
    action: 'dlp_load_posts',
    _ajax_nonce: nonce,
    draw: '1',
    start: String(start),
    length: String(length),
    table_id: tableId,
    'columns[0][data]': 'title',
    'columns[0][name]': 'title',
    'columns[0][searchable]': 'true',
    'columns[0][orderable]': 'true',
    'columns[1][data]': 'excerpt',
    'columns[1][name]': 'excerpt',
    'columns[1][searchable]': 'true',
    'columns[1][orderable]': 'false',
    'columns[2][data]': 'doc_categories',
    'columns[2][name]': 'doc_categories',
    'columns[2][searchable]': 'true',
    'columns[2][orderable]': 'false',
    'columns[3][data]': 'link',
    'columns[3][name]': 'link',
    'columns[3][searchable]': 'false',
    'columns[3][orderable]': 'false',
    'order[0][column]': '0',
    'order[0][dir]': 'asc',
  })

  const res = await fetch(AJAX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: params.toString(),
  })

  if (!res.ok) {
    throw new Error(`AJAX request failed: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// AJAX record parsing
// ---------------------------------------------------------------------------

function parseRecord(raw: RawRecord): ScrapedDocument {
  const postIdMatch = raw.__attributes.id.match(/post-row-(\d+)/)
  const postId = postIdMatch ? postIdMatch[1] : ''

  const titleDom = new JSDOM(raw.title)
  const titleLink = titleDom.window.document.querySelector('a')
  const title = titleLink?.textContent?.trim() || ''
  const detailUrl = titleLink?.getAttribute('href') || ''

  const excerptDom = new JSDOM(raw.excerpt)
  const summary = excerptDom.window.document.body?.textContent?.trim() || ''

  const catDom = new JSDOM(raw.doc_categories)
  const catLinks = catDom.window.document.querySelectorAll('a[rel="tag"]')
  const categories = Array.from(catLinks).map((a) => {
    const span = a.querySelector('span[data-slug]')
    return {
      name: span?.textContent?.trim() || a.textContent?.trim() || '',
      slug: span?.getAttribute('data-slug') || '',
    }
  })

  const linkDom = new JSDOM(raw.link)
  const downloadLink = linkDom.window.document.querySelector('a.dlp-download-link')
  const pdfUrl = downloadLink?.getAttribute('href') || null

  return {
    postId,
    title,
    detailUrl,
    summary,
    categories,
    tags: [],
    pdfUrl,
    pdfSizeBytes: null,
    datePosted: null,
    fileType: null,
    sourceUrl: detailUrl,
  }
}

// ---------------------------------------------------------------------------
// Detail page scraping
// ---------------------------------------------------------------------------

async function fetchDetailPage(doc: ScrapedDocument): Promise<void> {
  if (!doc.detailUrl) return

  try {
    const res = await fetch(doc.detailUrl)
    if (!res.ok) {
      console.warn(`  WARN: ${res.status} for ${doc.detailUrl}`)
      return
    }
    const html = await res.text()

    // Tags: plain comma-separated text inside .dlp-document-info-tags
    const tagsMatch = html.match(
      /<div class="dlp-document-info-tags">\s*<span[^>]*>Tags:\s*<\/span>\s*([\s\S]*?)<\/div>/,
    )
    if (tagsMatch) {
      doc.tags = tagsMatch[1]
        .trim()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }

    // Date posted: <time class="entry-date" datetime="...">
    const dateMatch = html.match(/<time class="entry-date" datetime="([^"]+)"/)
    if (dateMatch) {
      doc.datePosted = dateMatch[1]
    }

    // File type: inside .dlp-document-info, after "File Type: "
    const fileTypeMatch = html.match(
      /<span class="dlp-document-info-title">File Type:\s*<\/span>\s*(\w+)/,
    )
    if (fileTypeMatch) {
      doc.fileType = fileTypeMatch[1].trim().toLowerCase()
    }
  } catch (err) {
    console.warn(`  WARN: Failed to fetch detail page for "${doc.title}": ${err}`)
  }
}

// ---------------------------------------------------------------------------
// PDF size checking
// ---------------------------------------------------------------------------

async function fetchPdfSize(doc: ScrapedDocument): Promise<void> {
  if (!doc.pdfUrl) return

  try {
    const res = await fetch(doc.pdfUrl, { method: 'HEAD' })
    const contentLength = res.headers.get('content-length')
    if (contentLength) {
      doc.pdfSizeBytes = parseInt(contentLength, 10)
    }
  } catch {
    // non-critical — leave as null
  }
}

// ---------------------------------------------------------------------------
// Scrape summary
// ---------------------------------------------------------------------------

function printScrapeSummary(documents: ScrapedDocument[]) {
  const withPdf = documents.filter((d) => d.pdfUrl).length
  const withTags = documents.filter((d) => d.tags.length > 0).length
  const withDate = documents.filter((d) => d.datePosted).length
  const withSize = documents.filter((d) => d.pdfSizeBytes !== null).length

  console.log('\n========== Summary ==========')
  console.log(`Total documents:    ${documents.length}`)
  console.log(`With PDF URL:       ${withPdf}`)
  console.log(`With tags:          ${withTags}`)
  console.log(`With date posted:   ${withDate}`)
  console.log(`With file size:     ${withSize}`)

  // PDF size stats
  if (withSize > 0) {
    const sizes = documents.map((d) => d.pdfSizeBytes).filter((s): s is number => s !== null)
    const totalBytes = sizes.reduce((a, b) => a + b, 0)
    const avgBytes = totalBytes / sizes.length
    const maxBytes = Math.max(...sizes)
    const minBytes = Math.min(...sizes)

    const fmt = (bytes: number) => {
      if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
      if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
      if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
      return `${bytes} B`
    }

    console.log(`\nPDF Archive Size:`)
    console.log(`  Total:   ${fmt(totalBytes)}`)
    console.log(`  Average: ${fmt(avgBytes)}`)
    console.log(`  Largest: ${fmt(maxBytes)}`)
    console.log(`  Smallest: ${fmt(minBytes)}`)
  }

  // Category breakdown
  const catCounts = new Map<string, number>()
  for (const doc of documents) {
    for (const cat of doc.categories) {
      catCounts.set(cat.name, (catCounts.get(cat.name) || 0) + 1)
    }
  }
  console.log(`\nCategories:`)
  for (const [name, count] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`)
  }

  // Top tags
  const tagCounts = new Map<string, number>()
  for (const doc of documents) {
    for (const tag of doc.tags) {
      const normalized = tag.toLowerCase()
      tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1)
    }
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`\nTop 25 tags (of ${tagCounts.size} unique):`)
  for (const [tag, count] of topTags) {
    console.log(`  ${tag}: ${count}`)
  }
}

// ===========================================================================
// NORMALIZATION
// ===========================================================================

const NORMALIZED_OUTPUT_PATH = `${OUTPUT_DIR}/sustainable-library-normalized.json`
const TOPICS_PATH = `${OUTPUT_DIR}/topics-seed.json`

// ---------------------------------------------------------------------------
// Category -> Topics taxonomy mapping
//
// Maps source site categories to our hierarchical Topics taxonomy.
// Format: source slug -> { parent topic, child topic (optional) }
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, { parent: string; child?: string }> = {
  'community': { parent: 'Community' },
  'energy': { parent: 'Energy' },
  'energy-oil': { parent: 'Energy', child: 'Oil & Gas' },
  'environmental-impacts': { parent: 'Ecology', child: 'Environmental Impacts' },
  'environmental-impacts-air-quality': { parent: 'Ecology', child: 'Air Quality' },
  'klingsmith-documents-water': { parent: 'Water' },
  'land-use': { parent: 'Land Use' },
  'mining': { parent: 'Mining' },
  'molybdenum-mount-emmons': { parent: 'Mining', child: 'Molybdenum / Mt. Emmons' },
  'other': { parent: 'Other' },
  'uranium': { parent: 'Mining', child: 'Uranium' },
  'vegetation': { parent: 'Ecology', child: 'Vegetation' },
  'waste-management': { parent: 'Community', child: 'Waste Management' },
  'water': { parent: 'Water' },
}

// Geographic keywords found in tags/titles -> geographic scope values
const GEO_KEYWORDS: { pattern: RegExp; value: string }[] = [
  { pattern: /\beast river\b/i, value: 'east_river' },
  { pattern: /\bgothic\b/i, value: 'gothic' },
  { pattern: /\bcrested butte\b/i, value: 'crested_butte' },
  { pattern: /\bgunnison\b(?!\s+basin)/i, value: 'gunnison_basin' },
  { pattern: /\bgunnison basin\b/i, value: 'gunnison_basin' },
  { pattern: /\bupper gunnison\b/i, value: 'upper_gunnison' },
  { pattern: /\bwestern colorado\b/i, value: 'western_colorado' },
]

// ---------------------------------------------------------------------------
// Normalization types
// ---------------------------------------------------------------------------

interface TopicEntry {
  name: string
  parent: string | null
}

// ---------------------------------------------------------------------------
// Normalization logic
// ---------------------------------------------------------------------------

function inferDateFromText(title: string, summary: string): string | null {
  // Try to extract a year from the title or summary
  // Common patterns: "(1998)", "- 2000", "_1977", "1982"
  const combined = `${title} ${summary}`
  const yearMatch = combined.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/)
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`
  }
  return null
}

function inferGeographicScope(title: string, summary: string, tags: string[]): string[] {
  const combined = `${title} ${summary} ${tags.join(' ')}`
  const scopes = new Set<string>()

  for (const { pattern, value } of GEO_KEYWORDS) {
    if (pattern.test(combined)) {
      scopes.add(value)
    }
  }

  return [...scopes]
}

function normalizeDocument(doc: ScrapedDocument): NormalizedDocument {
  // Map categories to topic names
  const topicNames = new Set<string>()
  for (const cat of doc.categories) {
    const mapping = CATEGORY_MAP[cat.slug]
    if (mapping) {
      topicNames.add(mapping.child || mapping.parent)
    } else {
      topicNames.add(cat.name)
    }
  }

  // Infer date from title/summary if not explicitly available
  const dateOriginal = inferDateFromText(doc.title, doc.summary)

  // Infer geographic scope from title, summary, and tags
  const geographicScope = inferGeographicScope(doc.title, doc.summary, doc.tags)

  return {
    _sourcePostId: doc.postId,
    title: doc.title,
    summary: doc.summary,
    categories: [...topicNames],
    dateOriginal,
    geographicScope,
    sourceFile: doc.pdfUrl?.includes('wp-content/uploads') ? doc.pdfUrl : null,
    sourceUrl: doc.sourceUrl,
    ingestionDate: new Date().toISOString().split('T')[0],
    _tags: doc.tags,
    _pdfSizeBytes: doc.pdfSizeBytes,
  }
}

function runNormalization(scraped: ScrapedDocument[]) {
  console.log(`\nNormalizing ${scraped.length} scraped documents...`)

  // Normalize
  const normalized = scraped.map(normalizeDocument)

  // Build topics seed from category map
  const topicEntries = new Map<string, TopicEntry>()

  // Add parent topics from spec
  for (const parent of ['Water', 'Mining', 'Climate', 'Ecology', 'Land Use', 'Energy', 'Geology', 'Community', 'Other']) {
    topicEntries.set(parent, { name: parent, parent: null })
  }

  // Add child topics from category mapping
  for (const mapping of Object.values(CATEGORY_MAP)) {
    if (mapping.child) {
      topicEntries.set(mapping.child, { name: mapping.child, parent: mapping.parent })
    }
  }

  const topics = [...topicEntries.values()]

  // Write outputs
  writeFileSync(NORMALIZED_OUTPUT_PATH, JSON.stringify(normalized, null, 2))
  writeFileSync(TOPICS_PATH, JSON.stringify(topics, null, 2))

  // Stats
  const withDate = normalized.filter((d) => d.dateOriginal).length
  const withGeo = normalized.filter((d) => d.geographicScope.length > 0).length
  const withPdf = normalized.filter((d) => d.sourceFile).length

  console.log(`\nWrote ${normalized.length} normalized documents to ${NORMALIZED_OUTPUT_PATH}`)
  console.log(`Wrote ${topics.length} topic entries to ${TOPICS_PATH}`)

  console.log('\n========== Normalized Data Summary ==========')
  console.log(`With inferred date:       ${withDate}/${normalized.length}`)
  console.log(`With geographic scope:    ${withGeo}/${normalized.length}`)
  console.log(`With direct PDF link:     ${withPdf}/${normalized.length}`)

  // Topic distribution
  const topicCounts = new Map<string, number>()
  for (const doc of normalized) {
    for (const topic of doc.categories) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1)
    }
  }
  console.log('\nTopic distribution:')
  for (const [name, count] of [...topicCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`)
  }

  // Geographic scope distribution
  const geoCounts = new Map<string, number>()
  for (const doc of normalized) {
    for (const geo of doc.geographicScope) {
      geoCounts.set(geo, (geoCounts.get(geo) || 0) + 1)
    }
  }
  console.log('\nGeographic scope (inferred from text):')
  for (const [geo, count] of [...geoCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${geo}: ${count}`)
  }

  // Sample records
  console.log('\n========== Sample Records ==========')
  const samples = [normalized[0], normalized[Math.floor(normalized.length / 3)], normalized[Math.floor(normalized.length * 2 / 3)]]
  for (const doc of samples) {
    console.log(`\n  Title: ${doc.title}`)
    console.log(`  Topics: ${doc.categories.join(', ')}`)
    console.log(`  Date: ${doc.dateOriginal || '(none)'}`)
    console.log(`  Geo: ${doc.geographicScope.join(', ') || '(none)'}`)
    console.log(`  PDF: ${doc.sourceFile ? 'yes' : 'no'}`)
    console.log(`  Tags: ${doc._tags.slice(0, 5).join(', ')}${doc._tags.length > 5 ? '...' : ''}`)
  }
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const scrapedOutputPath = `${OUTPUT_DIR}/sustainable-library.json`

  // Step 1: Fetch all records from AJAX endpoint
  console.log('Step 1: Fetching document index via AJAX...')
  const { nonce, tableId } = await fetchNonce()

  const first = await fetchBatch(0, BATCH_SIZE, nonce, tableId)
  const total = first.recordsTotal
  console.log(`  Total records: ${total}`)

  const documents: ScrapedDocument[] = first.data.map(parseRecord)

  for (let start = BATCH_SIZE; start < total; start += BATCH_SIZE) {
    const batch = await fetchBatch(start, BATCH_SIZE, nonce, tableId)
    documents.push(...batch.data.map(parseRecord))
    process.stdout.write(`\r  Fetched ${documents.length}/${total}`)
  }
  console.log(`\n  Done: ${documents.length} records from AJAX endpoint`)

  // Step 2: Enrich with detail page metadata
  if (!skipDetails) {
    console.log(`\nStep 2: Scraping detail pages (concurrency: ${DETAIL_CONCURRENCY})...`)
    await runConcurrent(documents, DETAIL_CONCURRENCY, fetchDetailPage, 'Detail pages')
  } else {
    console.log('\nStep 2: Skipped (--skip-details)')
  }

  // Step 3: Get PDF file sizes
  if (!skipSizes) {
    console.log(`\nStep 3: Checking PDF sizes (concurrency: ${HEAD_CONCURRENCY})...`)
    await runConcurrent(documents, HEAD_CONCURRENCY, fetchPdfSize, 'PDF sizes')
  } else {
    console.log('\nStep 3: Skipped (--skip-sizes)')
  }

  // Write scraped output
  writeFileSync(scrapedOutputPath, JSON.stringify(documents, null, 2))
  console.log(`\nWrote ${documents.length} documents to ${scrapedOutputPath}`)

  // Summary
  printScrapeSummary(documents)

  // Step 4: Normalize
  if (!skipNormalize) {
    runNormalization(documents)
  } else {
    console.log('\nNormalization: Skipped (--skip-normalize)')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
