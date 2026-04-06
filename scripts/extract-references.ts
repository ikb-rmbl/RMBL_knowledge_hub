/**
 * Consolidated reference extraction script.
 *
 * Merges three extraction methods into a single entry point:
 *   - crossref: Fetches structured reference lists from CrossRef API for pubs with DOIs
 *   - grobid:   Sends PDFs to GROBID's REST API for ML-based reference parsing
 *   - fulltext: Detects reference sections in full text and parses with regex heuristics
 *
 * Usage:
 *   npx tsx scripts/extract-references.ts --method=crossref [--dry-run] [--limit=N]
 *   npx tsx scripts/extract-references.ts --method=grobid   [--dry-run] [--limit=N] [--collection=student_paper|thesis|article|all]
 *   npx tsx scripts/extract-references.ts --method=fulltext  [--dry-run] [--limit=N] [--source=documents|publications]
 *   npx tsx scripts/extract-references.ts --method=all       [--dry-run] [--limit=N] [--source=documents|publications] [--collection=student_paper|thesis|article|all]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, STAGING_DIR, CROSSREF_API, CROSSREF_MAILTO, CONCURRENCY as CFG_CONCURRENCY, DELAYS } from './lib/config.js'
import { extractDoi } from './lib/doi-utils.js'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const methodArg = args.find((a) => a.startsWith('--method='))?.split('=')[1] || 'all'
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'
const sourceFilter = args.find((a) => a.startsWith('--source='))?.split('=')[1] || 'documents'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedReference {
  citedDoi: string | null
  citedAuthors: string | null
  citedYear: number | null
  citedTitle: string | null
  citedJournal: string | null
  rawCitation: string | null
}

interface PublicationRefs {
  sourceId: string
  doi: string | null
  refCount: number
  references: ParsedReference[]
}

interface DocumentRefs {
  sourceId: string
  sourceType: 'document' | 'publication'
  refCount: number
  references: ParsedReference[]
}

interface ExtractOpts {
  dryRun: boolean
  limit: number
}

interface CrossrefOpts extends ExtractOpts {}

interface GrobidOpts extends ExtractOpts {
  collectionFilter: string
}

interface FulltextOpts extends ExtractOpts {
  sourceFilter: string
}

// ===========================================================================
// CROSSREF METHOD
// ===========================================================================

function parseCrossRefReference(ref: any): ParsedReference {
  const doi = ref.DOI || extractDoi(ref.unstructured || '') || null
  const author = ref.author || null
  const year = ref.year ? parseInt(ref.year) : null
  const journal = ref['journal-title'] || null
  const title = ref['article-title'] || null
  const raw = ref.unstructured || null

  return {
    citedDoi: doi,
    citedAuthors: author,
    citedYear: year,
    citedTitle: title,
    citedJournal: journal,
    rawCitation: raw,
  }
}

async function fetchReferences(doi: string): Promise<ParsedReference[] | null> {
  try {
    const url = `${CROSSREF_API}/${encodeURIComponent(doi)}?mailto=${CROSSREF_MAILTO}`
    const res = await fetch(url)
    if (!res.ok) return null

    const data = await res.json()
    const refs = data.message?.reference
    if (!refs || !Array.isArray(refs) || refs.length === 0) return null

    return refs.map(parseCrossRefReference)
  } catch {
    return null
  }
}

function printCrossrefSummary(results: PublicationRefs[]) {
  const totalRefs = results.reduce((n, r) => n + r.refCount, 0)
  const withDoi = results.reduce((n, r) => n + r.references.filter((ref) => ref.citedDoi).length, 0)
  const avgRefs = totalRefs / Math.max(results.length, 1)

  console.log('\n========== CrossRef Summary ==========')
  console.log(`Publications with references: ${results.length}`)
  console.log(`Total references:            ${totalRefs}`)
  console.log(`Average refs per paper:      ${avgRefs.toFixed(1)}`)
  console.log(`References with DOI:         ${withDoi} (${(withDoi / Math.max(totalRefs, 1) * 100).toFixed(0)}%)`)
  console.log(`References without DOI:      ${totalRefs - withDoi}`)
}

export async function extractCrossref(opts: CrossrefOpts): Promise<void> {
  console.log('CrossRef Reference Extraction')
  console.log('=============================')
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/references-crossref.json`

  // Load publications with DOIs (main + discovered)
  const pubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
  const discoveredFiles = readdirSync(OUTPUT_DIR).filter(
    (f) => f.startsWith('publications-discovered-') && f.endsWith('.json'),
  )
  for (const file of discoveredFiles) {
    const discovered = JSON.parse(readFileSync(`${OUTPUT_DIR}/${file}`, 'utf-8'))
    pubs.push(...discovered)
  }
  let candidates = pubs.filter((p) => p.doi)

  console.log(`\nPublications with DOI: ${candidates.length} (from ${pubs.length} total)`)

  // Check for existing cache
  if (existsSync(outputPath)) {
    const existing: PublicationRefs[] = JSON.parse(readFileSync(outputPath, 'utf-8'))
    const existingDois = new Set(existing.map((e) => e.doi))
    const newCandidates = candidates.filter((p) => !existingDois.has(p.doi))
    console.log(`Already cached: ${existing.length}, new to fetch: ${newCandidates.length}`)
    if (newCandidates.length === 0 && !opts.dryRun) {
      console.log('Nothing new to fetch.')
      printCrossrefSummary(existing)
      return
    }
    candidates = newCandidates
  }

  candidates = candidates.slice(0, opts.limit)
  console.log(`Fetching references for ${candidates.length} publications...\n`)

  const results: PublicationRefs[] = []
  let withRefs = 0
  let totalRefs = 0

  await runConcurrent(
    candidates,
    CFG_CONCURRENCY.API_CALLS,
    async (pub) => {
      const refs = await fetchReferences(pub.doi)
      if (refs && refs.length > 0) {
        results.push({
          sourceId: pub._sourceId,
          doi: pub.doi,
          refCount: refs.length,
          references: refs,
        })
        withRefs++
        totalRefs += refs.length
      }
      await sleep(DELAYS.CROSSREF_MS)
    },
    'CrossRef refs',
  )

  // Merge with existing cache
  if (!opts.dryRun) {
    let all = results
    if (existsSync(outputPath)) {
      const existing: PublicationRefs[] = JSON.parse(readFileSync(outputPath, 'utf-8'))
      all = [...existing, ...results]
    }
    writeFileSync(outputPath, JSON.stringify(all, null, 2))
    console.log(`\nSaved ${all.length} publication reference sets to ${outputPath}`)
    printCrossrefSummary(all)
  } else {
    printCrossrefSummary(results)
  }
}

// ===========================================================================
// GROBID METHOD
// ===========================================================================

const GROBID_URL = 'http://localhost:8070'

function parseTeiReferences(xml: string): ParsedReference[] {
  const refs: ParsedReference[] = []

  // Extract each <biblStruct> block
  const biblStructs = xml.match(/<biblStruct[^>]*>[\s\S]*?<\/biblStruct>/g) || []

  for (const block of biblStructs) {
    // Title
    const titleMatch = block.match(/<title level="a"[^>]*>([^<]+)<\/title>/)
    const title = titleMatch ? titleMatch[1].trim() : null

    // Authors
    const authorNames: string[] = []
    const authors = block.match(/<author>[\s\S]*?<\/author>/g) || []
    for (const authorBlock of authors) {
      const surname = authorBlock.match(/<surname>([^<]+)<\/surname>/)?.[1] || ''
      const forenames = authorBlock.match(/<forename[^>]*>([^<]+)<\/forename>/g)?.map(
        (f) => f.replace(/<[^>]+>/g, ''),
      ) || []
      if (surname) {
        authorNames.push(forenames.length > 0 ? `${forenames.join(' ')} ${surname}` : surname)
      }
    }

    // Year
    const yearMatch = block.match(/<date[^>]*when="(\d{4})"/)
    const year = yearMatch ? parseInt(yearMatch[1]) : null

    // Journal
    const journalMatch = block.match(/<title level="j"[^>]*>([^<]+)<\/title>/)
    const journal = journalMatch ? journalMatch[1].trim() : null

    // DOI — check idno tag or look in the text
    let doi: string | null = null
    const idnoMatch = block.match(/<idno type="DOI">([^<]+)<\/idno>/i)
    if (idnoMatch) {
      doi = idnoMatch[1].trim()
    } else {
      // Try extracting from any URL in the block
      doi = extractDoi(block) || null
    }

    // Volume/pages for raw citation
    const volume = block.match(/<biblScope unit="volume">([^<]+)/)?.[1] || ''
    const pages = block.match(/<biblScope unit="page"[^>]*from="([^"]+)"[^>]*to="([^"]+)"/)
    const pageStr = pages ? `${pages[1]}-${pages[2]}` : ''

    // Build raw citation text
    const rawParts = [
      authorNames.join(', '),
      year ? `(${year})` : '',
      title,
      journal,
      volume ? `Vol. ${volume}` : '',
      pageStr,
    ].filter(Boolean)
    const rawCitation = rawParts.join('. ') || null

    refs.push({
      citedDoi: doi,
      citedAuthors: authorNames.length > 0 ? authorNames.join('; ') : null,
      citedYear: year,
      citedTitle: title,
      citedJournal: journal,
      rawCitation,
    })
  }

  return refs
}

async function checkGrobid(): Promise<boolean> {
  try {
    const res = await fetch(`${GROBID_URL}/api/isalive`)
    return res.ok
  } catch {
    return false
  }
}

async function extractRefsFromPdf(pdfPath: string): Promise<ParsedReference[] | null> {
  try {
    const formData = new FormData()
    const pdfBuffer = readFileSync(pdfPath)
    formData.append('input', new Blob([pdfBuffer], { type: 'application/pdf' }), 'paper.pdf')

    const res = await fetch(`${GROBID_URL}/api/processReferences`, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) return null
    const xml = await res.text()
    return parseTeiReferences(xml)
  } catch {
    return null
  }
}

function printGrobidSummary(results: PublicationRefs[]) {
  const totalRefs = results.reduce((n, r) => n + r.refCount, 0)
  const withDoi = results.reduce((n, r) => n + r.references.filter((ref) => ref.citedDoi).length, 0)
  const withTitle = results.reduce((n, r) => n + r.references.filter((ref) => ref.citedTitle).length, 0)
  const avgRefs = totalRefs / Math.max(results.length, 1)

  console.log('\n========== GROBID Summary ==========')
  console.log(`Publications with references: ${results.length}`)
  console.log(`Total references:            ${totalRefs}`)
  console.log(`Average refs per paper:      ${avgRefs.toFixed(1)}`)
  console.log(`References with DOI:         ${withDoi} (${totalRefs > 0 ? (withDoi / totalRefs * 100).toFixed(0) : 0}%)`)
  console.log(`References with title:       ${withTitle} (${totalRefs > 0 ? (withTitle / totalRefs * 100).toFixed(0) : 0}%)`)
}

export async function extractGrobid(opts: GrobidOpts): Promise<void> {
  console.log('GROBID Reference Extraction')
  console.log('===========================')
  if (opts.dryRun) console.log('(DRY RUN)')

  // Check GROBID is running
  const alive = await checkGrobid()
  if (!alive) {
    console.log('GROBID not running — skipping. Start with: docker run --rm -d -p 8070:8070 lfoppiano/grobid:0.8.1')
    return
  }
  console.log('GROBID is running')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/references-grobid.json`

  // Load publications — target those without CrossRef references (main + discovered)
  const pubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
  const grobidDiscoveredFiles = readdirSync(OUTPUT_DIR).filter(
    (f) => f.startsWith('publications-discovered-') && f.endsWith('.json'),
  )
  for (const file of grobidDiscoveredFiles) {
    pubs.push(...JSON.parse(readFileSync(`${OUTPUT_DIR}/${file}`, 'utf-8')))
  }
  const crossrefPath = `${OUTPUT_DIR}/references-crossref.json`
  const crossrefDone = new Set<string>()
  if (existsSync(crossrefPath)) {
    const crossrefRefs: any[] = JSON.parse(readFileSync(crossrefPath, 'utf-8'))
    for (const r of crossrefRefs) crossrefDone.add(r.sourceId)
  }

  // Filter to publications that need GROBID processing
  let candidates = pubs.filter((p) => {
    if (crossrefDone.has(p._sourceId)) return false // already have CrossRef refs
    const pdfPath = join(STAGING_DIR, 'publications', `pub_${p._sourceId}.pdf`)
    if (!existsSync(pdfPath)) return false // no PDF
    return true
  })

  // Apply collection filter
  if (opts.collectionFilter !== 'all') {
    candidates = candidates.filter((p) => p.publicationType === opts.collectionFilter)
  }

  console.log(`\nPublications needing GROBID: ${candidates.length}`)
  console.log(`  (Excluded: ${crossrefDone.size} already have CrossRef refs)`)
  if (opts.collectionFilter !== 'all') console.log(`  Filtered to: ${opts.collectionFilter}`)

  candidates = candidates.slice(0, opts.limit)
  console.log(`Processing: ${candidates.length}`)

  // Load existing GROBID results for resume
  const existing: PublicationRefs[] = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf-8'))
    : []
  const existingIds = new Set(existing.map((e) => e.sourceId))
  const newCandidates = candidates.filter((p) => !existingIds.has(p._sourceId))
  console.log(`Already processed: ${existingIds.size}, new: ${newCandidates.length}`)

  if (newCandidates.length === 0) {
    console.log('Nothing new to process.')
    printGrobidSummary(existing)
    return
  }

  // Process PDFs through GROBID
  const results: PublicationRefs[] = []
  let processed = 0
  let withRefs = 0
  let totalRefs = 0
  let errors = 0

  for (const pub of newCandidates) {
    const pdfPath = join(STAGING_DIR, 'publications', `pub_${pub._sourceId}.pdf`)
    const refs = await extractRefsFromPdf(pdfPath)

    if (refs && refs.length > 0) {
      results.push({
        sourceId: pub._sourceId,
        doi: pub.doi || null,
        refCount: refs.length,
        references: refs,
      })
      withRefs++
      totalRefs += refs.length
    } else if (refs === null) {
      errors++
    }

    processed++
    if (processed % 10 === 0 || processed === newCandidates.length) {
      process.stdout.write(`\r  ${processed}/${newCandidates.length} (${withRefs} with refs, ${errors} errors)`)
    }

    await sleep(500) // don't overload GROBID
  }
  console.log()

  // Merge with existing and save
  if (!opts.dryRun) {
    const all = [...existing, ...results]
    writeFileSync(outputPath, JSON.stringify(all, null, 2))
    console.log(`\nSaved ${all.length} total to ${outputPath}`)
    printGrobidSummary(all)
  } else {
    printGrobidSummary(results)
  }
}

// ===========================================================================
// FULLTEXT METHOD
// ===========================================================================

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

export async function extractFulltext(opts: FulltextOpts): Promise<void> {
  console.log('Full-Text Reference Extraction')
  console.log('==============================')
  console.log(`Source: ${opts.sourceFilter}`)
  if (opts.dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/references-fulltext.json`

  let textDir: string
  let filePrefix: string
  let sourceType: 'document' | 'publication'

  if (opts.sourceFilter === 'documents') {
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

  const txtFiles = readdirSync(textDir).filter((f) => f.endsWith('.txt')).slice(0, opts.limit)
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
  if (!opts.dryRun) {
    const all = [...existing, ...results]
    writeFileSync(outputPath, JSON.stringify(all, null, 2))
    console.log(`\nSaved ${all.length} total to ${outputPath}`)
  }

  // Summary
  const allResults = opts.dryRun ? results : [...existing, ...results]
  const allTotalRefs = allResults.reduce((n, r) => n + r.refCount, 0)
  const withDoi = allResults.reduce((n, r) => n + r.references.filter((ref) => ref.citedDoi).length, 0)
  const withTitle = allResults.reduce((n, r) => n + r.references.filter((ref) => ref.citedTitle).length, 0)
  const withYear = allResults.reduce((n, r) => n + r.references.filter((ref) => ref.citedYear).length, 0)

  console.log('\n========== Fulltext Summary ==========')
  console.log(`Documents with references: ${allResults.length}`)
  console.log(`Total references:         ${allTotalRefs}`)
  console.log(`  With DOI:               ${withDoi} (${allTotalRefs > 0 ? (withDoi / allTotalRefs * 100).toFixed(0) : 0}%)`)
  console.log(`  With title:             ${withTitle} (${allTotalRefs > 0 ? (withTitle / allTotalRefs * 100).toFixed(0) : 0}%)`)
  console.log(`  With year:              ${withYear} (${allTotalRefs > 0 ? (withYear / allTotalRefs * 100).toFixed(0) : 0}%)`)
}

// ===========================================================================
// Main dispatcher
// ===========================================================================

async function main() {
  const validMethods = ['crossref', 'grobid', 'fulltext', 'all']
  if (!validMethods.includes(methodArg)) {
    console.error(`Invalid --method=${methodArg}. Must be one of: ${validMethods.join(', ')}`)
    process.exit(1)
  }

  const methods = methodArg === 'all' ? ['crossref', 'grobid', 'fulltext'] : [methodArg]

  for (const method of methods) {
    if (methods.length > 1) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`Running: ${method}`)
      console.log('='.repeat(60))
    }

    switch (method) {
      case 'crossref':
        await extractCrossref({ dryRun, limit })
        break
      case 'grobid':
        await extractGrobid({ dryRun, limit, collectionFilter })
        break
      case 'fulltext':
        await extractFulltext({ dryRun, limit, sourceFilter })
        break
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
