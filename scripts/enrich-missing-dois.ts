/**
 * Re-enrich publications that have journal names but no DOI.
 *
 * Uses a relaxed CrossRef search (+/- 1 year tolerance, lower similarity
 * threshold) to find DOIs that the initial enrichment pass missed.
 * Then runs Unpaywall on newly discovered DOIs to find PDFs.
 *
 * Usage:
 *   npx tsx scripts/enrich-missing-dois.ts [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync } from 'fs'

const CROSSREF_API = 'https://api.crossref.org/works'
const CROSSREF_MAILTO = 'knowledgehub@rmbl.org'
const UNPAYWALL_API = 'https://api.unpaywall.org/v2'
const UNPAYWALL_EMAIL = 'knowledgehub@rmbl.org'
const CONCURRENCY = 3
const DELAY_MS = 350
const OUTPUT_DIR = new URL('./output', import.meta.url).pathname

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

interface NormalizedPublication {
  _sourceId: string
  title: string
  authors: { given: string; family: string }[]
  year: number
  publicationType: string
  journal: string | null
  doi: string | null
  abstract: string | null
  pdfLink: string | null
  externalUrl: string | null
  _crossrefEnriched: boolean
  _unpaywallEnriched: boolean
  _oaStatus: string | null
  [key: string]: unknown
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1

  const wordsA = new Set(na.split(' '))
  const wordsB = new Set(nb.split(' '))
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
  const union = new Set([...wordsA, ...wordsB])
  return intersection.size / union.size
}

async function queryCrossRefRelaxed(
  title: string,
  firstAuthorFamily: string,
  year: number,
): Promise<{ doi: string | null; abstract: string | null }> {
  try {
    const query = encodeURIComponent(title)
    const yearFrom = year - 1
    const yearTo = year + 1
    const url = `${CROSSREF_API}?query.title=${query}&query.author=${encodeURIComponent(firstAuthorFamily)}&filter=from-pub-date:${yearFrom},until-pub-date:${yearTo}&rows=5&select=DOI,title,abstract,author&mailto=${CROSSREF_MAILTO}`

    const res = await fetch(url)
    if (!res.ok) return { doi: null, abstract: null }

    const data = await res.json()
    const items = data?.message?.items
    if (!items || items.length === 0) return { doi: null, abstract: null }

    for (const item of items) {
      const crTitle = Array.isArray(item.title) ? item.title[0] : item.title
      if (!crTitle) continue

      const similarity = titleSimilarity(title, crTitle)
      if (similarity > 0.75) {
        let abstract = item.abstract || null
        if (abstract) abstract = abstract.replace(/<[^>]+>/g, '').trim()
        return { doi: item.DOI, abstract }
      }
    }

    return { doi: null, abstract: null }
  } catch {
    return { doi: null, abstract: null }
  }
}

async function queryUnpaywall(doi: string): Promise<{ pdfUrl: string | null; oaStatus: string | null }> {
  try {
    const res = await fetch(`${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`)
    if (!res.ok) return { pdfUrl: null, oaStatus: null }
    const data = await res.json()
    const oaStatus = data.oa_status || null
    const bestPdf = data.best_oa_location?.url_for_pdf || null
    if (bestPdf) return { pdfUrl: bestPdf, oaStatus }
    if (Array.isArray(data.oa_locations)) {
      for (const loc of data.oa_locations) {
        if (loc.url_for_pdf) return { pdfUrl: loc.url_for_pdf, oaStatus }
      }
    }
    return { pdfUrl: null, oaStatus }
  } catch {
    return { pdfUrl: null, oaStatus: null }
  }
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
      if (completed % 25 === 0 || completed === total) {
        process.stdout.write(`\r  ${label}: ${completed}/${total}`)
      }
    }
  }
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)))
  console.log()
}

async function main() {
  const outputPath = `${OUTPUT_DIR}/publications-normalized.json`
  const pubs: NormalizedPublication[] = JSON.parse(readFileSync(outputPath, 'utf-8'))

  // Find articles with journal name but no DOI
  let candidates = pubs.filter(
    (p) => !p.doi && p.journal && p.title && p.authors.length > 0 &&
    (p.publicationType === 'article' || p.publicationType === 'chapter'),
  )

  console.log(`Found ${candidates.length} articles/chapters with journal but no DOI`)

  if (limit < candidates.length) {
    candidates = candidates.slice(0, limit)
    console.log(`Limited to ${limit}`)
  }

  if (dryRun) {
    console.log('(DRY RUN — no changes will be saved)')
  }

  // Step 1: CrossRef search with relaxed year filter
  console.log(`\nStep 1: CrossRef search (+/- 1 year, 0.75 similarity threshold)...`)
  let newDois = 0
  let newAbstracts = 0

  await runConcurrent(
    candidates,
    CONCURRENCY,
    async (pub) => {
      const result = await queryCrossRefRelaxed(
        pub.title,
        pub.authors[0]?.family || '',
        pub.year,
      )
      if (result.doi) {
        pub.doi = result.doi
        pub._crossrefEnriched = true
        pub.externalUrl = pub.externalUrl || `https://doi.org/${result.doi}`
        newDois++
      }
      if (result.abstract && !pub.abstract) {
        pub.abstract = result.abstract
        newAbstracts++
      }
      await sleep(DELAY_MS)
    },
    'CrossRef (relaxed)',
  )

  console.log(`  Found ${newDois} new DOIs, ${newAbstracts} new abstracts`)

  // Step 2: Unpaywall for newly discovered DOIs
  const newDoiPubs = candidates.filter((p) => p.doi && !p.pdfLink)
  if (newDoiPubs.length > 0) {
    console.log(`\nStep 2: Unpaywall for ${newDoiPubs.length} newly DOI'd publications...`)
    let newPdfs = 0

    await runConcurrent(
      newDoiPubs,
      CONCURRENCY,
      async (pub) => {
        const result = await queryUnpaywall(pub.doi!)
        pub._oaStatus = result.oaStatus
        if (result.pdfUrl) {
          pub.pdfLink = result.pdfUrl
          pub._unpaywallEnriched = true
          newPdfs++
        }
        await sleep(200)
      },
      'Unpaywall',
    )

    console.log(`  Found ${newPdfs} new PDFs`)
  }

  // Save
  if (!dryRun) {
    writeFileSync(outputPath, JSON.stringify(pubs, null, 2))
    console.log(`\nUpdated ${outputPath}`)
  }

  // Summary
  const totalDois = pubs.filter((p) => p.doi).length
  const totalPdfs = pubs.filter((p) => p.pdfLink).length
  const totalAbstracts = pubs.filter((p) => p.abstract).length

  console.log('\n========== Summary ==========')
  console.log(`Total DOIs:      ${totalDois} (+${newDois} this run)`)
  console.log(`Total PDFs:      ${totalPdfs}`)
  console.log(`Total abstracts: ${totalAbstracts} (+${newAbstracts} this run)`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
