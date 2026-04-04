/**
 * Extract references from PDFs using GROBID.
 *
 * Sends PDFs to GROBID's REST API for ML-based reference parsing.
 * Targets publications without CrossRef references: student papers,
 * theses, and older articles.
 *
 * Requires: docker run --rm -d -p 8070:8070 lfoppiano/grobid:0.8.1
 *
 * Usage:
 *   npx tsx scripts/extract-references-grobid.ts [--dry-run] [--limit=N] [--collection=student_paper|thesis|article|all]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { sleep } from './lib/concurrency.js'
import { OUTPUT_DIR, STAGING_DIR } from './lib/config.js'
import { extractDoi } from './lib/doi-utils.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'

const GROBID_URL = 'http://localhost:8070'
const CONCURRENCY = 2 // GROBID is CPU-heavy, don't overload

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

interface PublicationRefs {
  sourceId: string
  doi: string | null
  refCount: number
  references: ParsedReference[]
}

// ---------------------------------------------------------------------------
// TEI XML parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GROBID API
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('GROBID Reference Extraction')
  console.log('===========================')
  if (dryRun) console.log('(DRY RUN)')

  // Check GROBID is running
  const alive = await checkGrobid()
  if (!alive) {
    console.error('GROBID not running. Start with: docker run --rm -d -p 8070:8070 lfoppiano/grobid:0.8.1')
    process.exit(1)
  }
  console.log('GROBID is running')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/references-grobid.json`

  // Load publications — target those without CrossRef references
  const pubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
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
  if (collectionFilter !== 'all') {
    candidates = candidates.filter((p) => p.publicationType === collectionFilter)
  }

  console.log(`\nPublications needing GROBID: ${candidates.length}`)
  console.log(`  (Excluded: ${crossrefDone.size} already have CrossRef refs)`)
  if (collectionFilter !== 'all') console.log(`  Filtered to: ${collectionFilter}`)

  candidates = candidates.slice(0, limit)
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
    printSummary(existing)
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
  if (!dryRun) {
    const all = [...existing, ...results]
    writeFileSync(outputPath, JSON.stringify(all, null, 2))
    console.log(`\nSaved ${all.length} total to ${outputPath}`)
    printSummary(all)
  } else {
    printSummary(results)
  }
}

function printSummary(results: PublicationRefs[]) {
  const totalRefs = results.reduce((n, r) => n + r.refCount, 0)
  const withDoi = results.reduce((n, r) => n + r.references.filter((ref) => ref.citedDoi).length, 0)
  const withTitle = results.reduce((n, r) => n + r.references.filter((ref) => ref.citedTitle).length, 0)
  const avgRefs = totalRefs / Math.max(results.length, 1)

  // By publication type
  console.log('\n========== Summary ==========')
  console.log(`Publications with references: ${results.length}`)
  console.log(`Total references:            ${totalRefs}`)
  console.log(`Average refs per paper:      ${avgRefs.toFixed(1)}`)
  console.log(`References with DOI:         ${withDoi} (${totalRefs > 0 ? (withDoi / totalRefs * 100).toFixed(0) : 0}%)`)
  console.log(`References with title:       ${withTitle} (${totalRefs > 0 ? (withTitle / totalRefs * 100).toFixed(0) : 0}%)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
