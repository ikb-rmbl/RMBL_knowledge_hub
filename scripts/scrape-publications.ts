/**
 * RMBL Publications Scraper & Normalizer
 *
 * 1. Pulls all publications from the RMBL REST API
 * 2. Parses author strings into structured {given, family} objects
 * 3. Enriches DOIs and abstracts via CrossRef API
 * 4. Discovers open-access PDFs via Unpaywall API
 * 5. Normalizes to Payload Publications schema
 *
 * Usage:
 *   npx tsx scripts/scrape-publications.ts [--skip-crossref] [--skip-unpaywall]
 *
 * Outputs:
 *   scripts/output/publications-raw.json      — raw API data
 *   scripts/output/publications-normalized.json — Payload-ready records
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { parseAuthors, parseEditors } from './lib/author-parsing.js'
import { extractDoi } from './lib/doi-utils.js'
import { queryCrossRef, queryUnpaywall } from './lib/crossref-client.js'
import type { NormalizedPublication, RawPublication } from './lib/types.js'
import {
  OUTPUT_DIR,
  RMBL_PUBS_API,
  CONCURRENCY,
  DELAYS,
} from './lib/config.js'

const API_BASE = RMBL_PUBS_API
const BATCH_SIZE = 200

const skipCrossref = process.argv.includes('--skip-crossref')
const skipUnpaywall = process.argv.includes('--skip-unpaywall')

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, string> = {
  ARTICLE: 'article',
  THESIS: 'thesis',
  BOOK: 'book',
  CHAPTER: 'chapter',
  STUDENTPAPER: 'student_paper',
  OTHER: 'other',
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizePublication(raw: RawPublication): NormalizedPublication {
  const doi = extractDoi(raw.restofreference)
  const authors = parseAuthors(raw.authors || '')
  const editors = parseEditors(raw.bookeditors)
  const year = parseInt(raw.year) || 0

  // Parse keywords: stored as semicolon or comma separated
  const keywords: { keyword: string }[] = []
  if (raw.keywords) {
    const kws = raw.keywords.split(/[;,]/).map((k) => k.trim()).filter(Boolean)
    for (const kw of kws) {
      keywords.push({ keyword: kw })
    }
  }

  // Determine external URL
  let externalUrl: string | null = null
  if (raw.restofreference && !raw.restofreference.includes('doi.org')) {
    externalUrl = raw.restofreference
  } else if (raw.bn_url) {
    externalUrl = raw.bn_url
  } else if (raw.fulltext_url) {
    externalUrl = raw.fulltext_url
  } else if (doi) {
    externalUrl = `https://doi.org/${doi}`
  }

  return {
    _sourceId: raw.id,
    title: raw.title?.trim() || '',
    authors,
    year,
    publicationType: TYPE_MAP[raw.reftypename] || 'other',
    journal: raw.journalname || null,
    volume: raw.volume || null,
    issue: raw.journalissue || null,
    pages: raw.pages || null,
    doi,
    publisher: raw.publishername || null,
    abstract: null, // will be enriched via CrossRef
    keywords,
    pdfLink: raw.pdf_url || null,
    externalUrl,
    editors,
    _chaptertitle: raw.chaptertitle || null,
    _degree: raw.degree || null,
    _institution: raw.institution || null,
    _crossrefEnriched: false,
    _unpaywallEnriched: false,
    _oaStatus: null,
    _source: 'rmbl_database',
    _discoveryMethod: 'rmbl_api',
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rawPath = `${OUTPUT_DIR}/publications-raw.json`
  const outputPath = `${OUTPUT_DIR}/publications-normalized.json`

  // Step 1: Fetch all records
  console.log('Step 1: Fetching publications from RMBL API...')
  let allRaw: RawPublication[] = []

  if (existsSync(rawPath)) {
    console.log(`  Found cached ${rawPath}, loading...`)
    allRaw = JSON.parse(readFileSync(rawPath, 'utf-8'))
  } else {
    let total = Infinity
    for (let skip = 0; skip < total; skip += BATCH_SIZE) {
      const res = await fetch(`${API_BASE}?take=${BATCH_SIZE}&skip=${skip}`)
      const data = await res.json()
      total = parseInt(data.total)
      allRaw.push(...data.data)
      process.stdout.write(`\r  Fetched ${allRaw.length}/${total}`)
    }
    console.log()
    writeFileSync(rawPath, JSON.stringify(allRaw, null, 2))
    console.log(`  Saved ${allRaw.length} raw records to ${rawPath}`)
  }

  // Step 2: Normalize all records (parse authors, extract DOIs, map types)
  console.log('\nStep 2: Normalizing records...')
  const normalized = allRaw.map(normalizePublication)

  const preCrossrefDois = normalized.filter((p) => p.doi).length
  console.log(`  ${normalized.length} records normalized`)
  console.log(`  ${preCrossrefDois} already have DOIs from source data`)

  // Step 3: CrossRef enrichment
  if (!skipCrossref) {
    // Only enrich articles and chapters (books/theses/student papers unlikely to match)
    const enrichable = normalized.filter(
      (p) =>
        !p.doi &&
        (p.publicationType === 'article' || p.publicationType === 'chapter') &&
        p.title &&
        p.authors.length > 0,
    )
    console.log(`\nStep 3: CrossRef enrichment for ${enrichable.length} publications without DOIs...`)
    console.log(`  (skipping theses, student papers, and records with no authors)`)

    let found = 0
    let abstracts = 0

    await runConcurrent(
      enrichable,
      CONCURRENCY.API_CALLS,
      async (pub) => {
        const result = await queryCrossRef(
          pub.title,
          pub.authors[0]?.family || '',
          String(pub.year),
        )
        if (result.doi) {
          pub.doi = result.doi
          pub._crossrefEnriched = true
          pub.externalUrl = pub.externalUrl || `https://doi.org/${result.doi}`
          found++
        }
        if (result.abstract) {
          pub.abstract = result.abstract
          abstracts++
        }
        await sleep(DELAYS.CROSSREF_MS)
      },
      'CrossRef lookup',
    )

    console.log(`  Found ${found} new DOIs via CrossRef`)
    console.log(`  Found ${abstracts} abstracts`)
  } else {
    console.log('\nStep 3: Skipped (--skip-crossref)')
  }

  // Step 4: Unpaywall PDF discovery
  if (!skipUnpaywall) {
    const needsPdf = normalized.filter(
      (p) => p.doi && !p.pdfLink,
    )
    console.log(`\nStep 4: Unpaywall PDF discovery for ${needsPdf.length} publications with DOI but no PDF...`)

    let found = 0

    await runConcurrent(
      needsPdf,
      CONCURRENCY.API_CALLS,
      async (pub) => {
        const result = await queryUnpaywall(pub.doi!)
        pub._oaStatus = result.oaStatus
        if (result.pdfUrl) {
          pub.pdfLink = result.pdfUrl
          pub._unpaywallEnriched = true
          found++
        }
        await sleep(DELAYS.UNPAYWALL_MS)
      },
      'Unpaywall lookup',
    )

    console.log(`  Found ${found} open-access PDFs via Unpaywall`)
  } else {
    console.log('\nStep 4: Skipped (--skip-unpaywall)')
  }

  // Write output
  writeFileSync(outputPath, JSON.stringify(normalized, null, 2))
  console.log(`\nWrote ${normalized.length} normalized records to ${outputPath}`)

  // Summary
  printSummary(normalized)
}

function printSummary(pubs: NormalizedPublication[]) {
  const totalDois = pubs.filter((p) => p.doi).length
  const enrichedDois = pubs.filter((p) => p._crossrefEnriched).length
  const unpaywallPdfs = pubs.filter((p) => p._unpaywallEnriched).length
  const withAbstract = pubs.filter((p) => p.abstract).length
  const withPdf = pubs.filter((p) => p.pdfLink).length
  const withKeywords = pubs.filter((p) => p.keywords.length > 0).length

  console.log('\n========== Summary ==========')
  console.log(`Total publications: ${pubs.length}`)
  console.log(`\nBy type:`)
  const typeCounts = new Map<string, number>()
  for (const p of pubs) typeCounts.set(p.publicationType, (typeCounts.get(p.publicationType) || 0) + 1)
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log(`\nField coverage:`)
  console.log(`  With DOI:       ${totalDois} (${enrichedDois} from CrossRef)`)
  console.log(`  With abstract:  ${withAbstract}`)
  console.log(`  With PDF:       ${withPdf} (${unpaywallPdfs} from Unpaywall)`)
  console.log(`  With keywords:  ${withKeywords}`)

  // OA status breakdown
  const oaCounts = new Map<string, number>()
  for (const p of pubs) {
    if (p._oaStatus) oaCounts.set(p._oaStatus, (oaCounts.get(p._oaStatus) || 0) + 1)
  }
  if (oaCounts.size > 0) {
    console.log(`\nOpen access status (from Unpaywall):`)
    for (const [status, count] of [...oaCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`)
    }
  }

  // Year distribution
  const years = pubs.map((p) => p.year).filter((y) => y > 1900)
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  console.log(`  Year range:     ${minYear}–${maxYear}`)

  // Author parsing quality check
  const emptyGiven = pubs.flatMap((p) => p.authors).filter((a) => !a.given).length
  const totalAuthors = pubs.flatMap((p) => p.authors).length
  console.log(`\nAuthor parsing:`)
  console.log(`  Total authors:  ${totalAuthors}`)
  console.log(`  Missing given:  ${emptyGiven}`)

  // Sample records
  console.log('\n========== Sample Records ==========')
  const samples = [
    pubs.find((p) => p.publicationType === 'article' && p.doi),
    pubs.find((p) => p.publicationType === 'thesis'),
    pubs.find((p) => p.publicationType === 'chapter'),
    pubs.find((p) => p._crossrefEnriched),
  ].filter(Boolean)

  for (const pub of samples) {
    if (!pub) continue
    console.log(`\n  [${pub.publicationType}] ${pub.title.slice(0, 70)}...`)
    console.log(`  Authors: ${pub.authors.map((a) => `${a.family}, ${a.given}`).join('; ')}`)
    console.log(`  Year: ${pub.year}`)
    console.log(`  DOI: ${pub.doi || '(none)'}${pub._crossrefEnriched ? ' (CrossRef)' : ''}`)
    console.log(`  Journal: ${pub.journal || '(none)'}`)
    console.log(`  Abstract: ${pub.abstract ? pub.abstract.slice(0, 80) + '...' : '(none)'}`)
    console.log(`  PDF: ${pub.pdfLink ? 'yes' : 'no'}`)
    console.log(`  Keywords: ${pub.keywords.slice(0, 3).map((k) => k.keyword).join(', ')}${pub.keywords.length > 3 ? '...' : ''}`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
