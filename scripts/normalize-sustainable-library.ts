/**
 * Normalize scraped Sustainable Library data into Payload Document schema.
 *
 * Outputs:
 *   - sustainable-library-normalized.json — records ready for Payload import
 *   - topics-seed.json — Topics taxonomy entries to create first
 *
 * The category mapping bridges the source site's categories into the
 * Knowledge Hub's shared Topics taxonomy (from the spec).
 */

import { writeFileSync, readFileSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'
import type { ScrapedDocument, NormalizedDocument } from './lib/types.js'

const INPUT_PATH = `${OUTPUT_DIR}/sustainable-library.json`
const OUTPUT_PATH = `${OUTPUT_DIR}/sustainable-library-normalized.json`
const TOPICS_PATH = `${OUTPUT_DIR}/topics-seed.json`

// ---------------------------------------------------------------------------
// Category → Topics taxonomy mapping
//
// Maps source site categories to our hierarchical Topics taxonomy.
// Format: source slug → { parent topic, child topic (optional) }
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

// Geographic keywords found in tags/titles → geographic scope values
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
// Types
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const scraped: ScrapedDocument[] = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'))
  console.log(`Read ${scraped.length} scraped documents`)

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
  writeFileSync(OUTPUT_PATH, JSON.stringify(normalized, null, 2))
  writeFileSync(TOPICS_PATH, JSON.stringify(topics, null, 2))

  // Stats
  const withDate = normalized.filter((d) => d.dateOriginal).length
  const withGeo = normalized.filter((d) => d.geographicScope.length > 0).length
  const withPdf = normalized.filter((d) => d.sourceFile).length

  console.log(`\nWrote ${normalized.length} normalized documents to ${OUTPUT_PATH}`)
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

main()
