/**
 * Extract references from document full text using pattern matching.
 *
 * For documents where GROBID isn't suitable (OCR'd scans, community
 * documents, policy reports), this script detects reference sections
 * and parses individual citations using regex heuristics.
 *
 * Usage:
 *   npx tsx scripts/extract-references-fulltext.ts [--source=documents|publications] [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { OUTPUT_DIR, STAGING_DIR } from './lib/config.js'
import { extractDoi } from './lib/doi-utils.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const sourceFilter = args.find((a) => a.startsWith('--source='))?.split('=')[1] || 'documents'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedReference {
  citedDoi: string | null
  citedAuthors: string | null
  citedYear: number | null
  citedTitle: string | null
  citedJournal: string | null
  rawCitation: string | null
}

interface DocumentRefs {
  sourceId: string
  sourceType: 'document' | 'publication'
  refCount: number
  references: ParsedReference[]
}

// ---------------------------------------------------------------------------
// Reference section detection
// ---------------------------------------------------------------------------

const REF_SECTION_HEADERS = /^(?:\s*(?:references|literature cited|bibliography|works cited|citations|sources|sources cited))\s*$/mi

function findReferenceSection(text: string): string | null {
  const match = text.match(REF_SECTION_HEADERS)
  if (!match || match.index === undefined) return null

  // Take everything after the header
  const refText = text.slice(match.index + match[0].length)

  // Stop at common section headers that come after references
  const endMatch = refText.match(/^(?:\s*(?:appendix|appendices|figures?|tables?|acknowledgments?|about the author|biographical))\s*$/mi)
  if (endMatch && endMatch.index !== undefined) {
    return refText.slice(0, endMatch.index)
  }

  // If no end marker, take up to 20,000 chars (safety limit)
  return refText.slice(0, 20000)
}

// ---------------------------------------------------------------------------
// Split reference section into individual entries
// ---------------------------------------------------------------------------

function splitReferences(refText: string): string[] {
  const lines = refText.split('\n').map((l) => l.trim()).filter((l) => l.length > 5)

  const refs: string[] = []
  let current = ''

  for (const line of lines) {
    // Detect start of a new reference:
    // - Numbered: "1." or "[1]" or "(1)"
    // - Author start: "LastName, F." or "LastName F."
    // - Indented continuation lines are part of current ref

    const isNewRef =
      /^\d+[\.\)]\s/.test(line) || // numbered
      /^\[\d+\]/.test(line) || // bracketed number
      /^[A-Z][a-z]+,?\s+[A-Z]\./.test(line) || // Author start: "Smith, J." or "Smith J."
      /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line) && /\b(19|20)\d{2}\b/.test(line) // "Firstname Lastname ... year"

    if (isNewRef && current.length > 20) {
      refs.push(current.trim())
      current = line
    } else {
      current += ' ' + line
    }
  }

  if (current.length > 20) {
    refs.push(current.trim())
  }

  return refs.filter((r) => r.length > 20 && r.length < 1000)
}

// ---------------------------------------------------------------------------
// Parse individual reference
// ---------------------------------------------------------------------------

function parseReference(raw: string): ParsedReference {
  // Strip leading numbers
  const cleaned = raw.replace(/^\s*(?:\d+[\.\)]|\[\d+\])\s*/, '').trim()

  // Extract DOI
  const doi = extractDoi(cleaned) || null

  // Extract year
  const yearMatch = cleaned.match(/\b((?:19|20)\d{2})[a-z]?\b/)
  const year = yearMatch ? parseInt(yearMatch[1]) : null

  // Extract authors (before the year)
  let authors: string | null = null
  if (yearMatch && yearMatch.index !== undefined) {
    const beforeYear = cleaned.slice(0, yearMatch.index).trim()
    // Clean up: remove trailing punctuation, parens
    authors = beforeYear.replace(/[,.\(]+$/, '').trim()
    if (authors.length < 3 || authors.length > 200) authors = null
  }

  // Extract title (after year, before journal/italics/period)
  let title: string | null = null
  if (yearMatch && yearMatch.index !== undefined) {
    const afterYear = cleaned.slice(yearMatch.index + yearMatch[0].length).trim()
    // Remove leading punctuation
    const titleStart = afterYear.replace(/^[\.\)\s,]+/, '')
    // Title is usually the first sentence-like chunk
    const titleMatch = titleStart.match(/^(.{15,200}?)[.\?!](?:\s|$)/)
    if (titleMatch) {
      title = titleMatch[1].trim()
    }
  }

  // Extract journal (look for common patterns after title)
  let journal: string | null = null
  if (title) {
    const afterTitle = cleaned.slice(cleaned.indexOf(title) + title.length)
    // Journal often follows in italics context or after a period
    const journalMatch = afterTitle.match(/^\s*[.,]?\s*([A-Z][a-zA-Z\s&:]+?)(?:\s*\d|\s*$)/)
    if (journalMatch && journalMatch[1].length > 3 && journalMatch[1].length < 100) {
      journal = journalMatch[1].trim()
    }
  }

  return {
    citedDoi: doi,
    citedAuthors: authors,
    citedYear: year,
    citedTitle: title,
    citedJournal: journal,
    rawCitation: cleaned.slice(0, 500),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Full-Text Reference Extraction')
  console.log('==============================')
  console.log(`Source: ${sourceFilter}`)
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/references-fulltext.json`

  let textDir: string
  let filePrefix: string
  let sourceType: 'document' | 'publication'

  if (sourceFilter === 'documents') {
    textDir = join(STAGING_DIR, 'documents')
    filePrefix = 'doc_'
    sourceType = 'document'
  } else {
    textDir = join(STAGING_DIR, 'publications')
    filePrefix = 'pub_'
    sourceType = 'publication'
  }

  if (!existsSync(textDir)) {
    console.error('Text directory not found:', textDir)
    process.exit(1)
  }

  const txtFiles = readdirSync(textDir).filter((f) => f.endsWith('.txt')).slice(0, limit)
  console.log(`\nText files to scan: ${txtFiles.length}`)

  // Load existing results for resume
  const existing: DocumentRefs[] = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf-8'))
    : []
  const existingIds = new Set(existing.map((e) => e.sourceId))

  let withRefs = 0
  let totalRefs = 0
  let noSection = 0
  const results: DocumentRefs[] = []
  const examples: { id: string; refCount: number; sample: string }[] = []

  for (let i = 0; i < txtFiles.length; i++) {
    const filename = txtFiles[i]
    const sourceId = filename.replace(filePrefix, '').replace('.txt', '')

    if (existingIds.has(sourceId)) continue

    const text = readFileSync(join(textDir, filename), 'utf-8')
    const refSection = findReferenceSection(text)

    if (!refSection || refSection.trim().length < 50) {
      noSection++
      continue
    }

    const rawRefs = splitReferences(refSection)
    if (rawRefs.length === 0) {
      noSection++
      continue
    }

    const parsed = rawRefs.map(parseReference)
    results.push({
      sourceId,
      sourceType,
      refCount: parsed.length,
      references: parsed,
    })
    withRefs++
    totalRefs += parsed.length

    if (examples.length < 5) {
      examples.push({ id: sourceId, refCount: parsed.length, sample: rawRefs[0].slice(0, 80) })
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  ${i + 1}/${txtFiles.length} (${withRefs} with refs, ${noSection} no section)`)
    }
  }
  console.log(`\r  ${txtFiles.length} scanned (${withRefs} with refs, ${noSection} no ref section)`)

  // Show examples
  if (examples.length > 0) {
    console.log('\nSample documents with references:')
    for (const e of examples) {
      console.log(`  ${filePrefix}${e.id}: ${e.refCount} refs`)
      console.log(`    "${e.sample}"`)
    }
  }

  // Save
  if (!dryRun) {
    const all = [...existing, ...results]
    writeFileSync(outputPath, JSON.stringify(all, null, 2))
    console.log(`\nSaved ${all.length} total to ${outputPath}`)
  }

  // Summary
  const allResults = dryRun ? results : [...existing, ...results]
  const allTotalRefs = allResults.reduce((n, r) => n + r.refCount, 0)
  const withDoi = allResults.reduce((n, r) => n + r.references.filter((ref) => ref.citedDoi).length, 0)
  const withTitle = allResults.reduce((n, r) => n + r.references.filter((ref) => ref.citedTitle).length, 0)
  const withYear = allResults.reduce((n, r) => n + r.references.filter((ref) => ref.citedYear).length, 0)

  console.log('\n========== Summary ==========')
  console.log(`Documents with references: ${allResults.length}`)
  console.log(`Total references:         ${allTotalRefs}`)
  console.log(`  With DOI:               ${withDoi} (${allTotalRefs > 0 ? (withDoi / allTotalRefs * 100).toFixed(0) : 0}%)`)
  console.log(`  With title:             ${withTitle} (${allTotalRefs > 0 ? (withTitle / allTotalRefs * 100).toFixed(0) : 0}%)`)
  console.log(`  With year:              ${withYear} (${allTotalRefs > 0 ? (withYear / allTotalRefs * 100).toFixed(0) : 0}%)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
