/**
 * Discover Publications via OpenAlex + CrossRef
 *
 * Searches for papers about the Gunnison Basin and surrounding area
 * using geographic keyword searches. OpenAlex provides broad coverage
 * across all types; CrossRef supplements with journal articles that
 * OpenAlex may miss.
 *
 * Usage:
 *   npx tsx scripts/discover-publications.ts [--dry-run] [--limit=N] [--source=openalex|crossref|all]
 */

import { mkdirSync } from 'fs'
import { sleep } from './lib/concurrency.js'
import {
  OUTPUT_DIR,
  OPENALEX_API,
  OPENALEX_MAILTO,
  CROSSREF_API,
  CROSSREF_MAILTO,
  DELAYS,
} from './lib/config.js'
import {
  loadExistingPublications,
  buildPubDedupIndex,
  isPubDuplicate,
  saveDiscoveredPublications,
  normalizeOpenAlexWork,
  normalizeCrossRefWork,
  isRelevantPublication,
} from './lib/publication-discovery.js'
import type { NormalizedPublication } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1] || 'all'

// ---------------------------------------------------------------------------
// Search terms — geographic keywords for the Gunnison Basin area
// ---------------------------------------------------------------------------

const SEARCH_TERMS = [
  // Core Gunnison Basin
  '"Gunnison Basin"',
  '"Crested Butte" Colorado',
  '"Gothic Colorado"',           // exact phrase to avoid Gothic literature noise
  '"Gothic Townsite"',
  '"East River" Colorado watershed',
  '"Rocky Mountain Biological Laboratory"',
  'RMBL Colorado',
  '"Upper Gunnison"',
  '"Gunnison County" Colorado',
  '"Black Canyon" Gunnison',
  // Adjacent geographies
  '"West Elk" Colorado',
  '"Grand Mesa" Colorado',
  '"Roaring Fork" Colorado',
  '"Arkansas Valley" Colorado',
  '"Browns Canyon" Colorado',
  '"South Park" Colorado ecology',
  'Paonia Colorado ecology',
  '"Uncompahgre" Colorado',
  '"Powderhorn" Colorado',
  '"Lake Fork" Gunnison',
  '"Pitkin County" Colorado',
  '"Independence Pass" Colorado',
  '"Cottonwood Pass" Colorado',
  'Saguache Colorado',
  '"Cochetopa" Colorado',
  '"Curecanti" Colorado',
  '"Sapinero" Colorado',
  '"Kebler Pass" Colorado',
]

// CrossRef search terms — more targeted phrases for bibliographic search
const CROSSREF_SEARCH_TERMS = [
  '"Gunnison Basin" Colorado',
  '"Crested Butte" Colorado',
  '"Gothic Colorado"',           // exact phrase to avoid Gothic literature
  '"Gothic Townsite"',
  '"East River" Colorado',
  '"Rocky Mountain Biological Laboratory"',
  '"Upper Gunnison"',
  '"Gunnison County"',
  '"Black Canyon" Gunnison',
  '"Grand Mesa" Colorado',
  '"Roaring Fork" Colorado',
  '"Uncompahgre" Colorado',
  '"Pitkin County" Colorado',
  'Saguache Colorado',
  '"Cochetopa" Colorado',
  '"Curecanti"',
]

// ---------------------------------------------------------------------------
// Relevance filter — uses tiered logic from publication-discovery.ts
// (Tier A strong terms, Tier B weak terms requiring Colorado context, Tier C exclusions)
// ---------------------------------------------------------------------------

function isRelevantOpenAlex(work: any): boolean {
  const title = work.title || work.display_name || ''
  const abstract = work.abstract_inverted_index
    ? Object.keys(work.abstract_inverted_index).join(' ')
    : ''
  const affiliations = (work.authorships || [])
    .flatMap((a: any) => a.institutions?.map((i: any) => i.display_name) || [])
    .join(' ')
  const journal = work.primary_location?.source?.display_name || work.host_venue?.display_name || ''
  return isRelevantPublication({ title, abstract, affiliations, journal })
}

function isRelevantCrossRef(item: any): boolean {
  const title = Array.isArray(item.title) ? item.title[0] : (item.title || '')
  const abstract = item.abstract?.replace(/<[^>]+>/g, '') || ''
  const journal = Array.isArray(item['container-title']) ? item['container-title'][0] : (item['container-title'] || '')
  return isRelevantPublication({ title, abstract, journal })
}

// ---------------------------------------------------------------------------
// OpenAlex API
// ---------------------------------------------------------------------------

interface OpenAlexPage {
  results: any[]
  meta: { count: number; next_cursor: string | null }
}

async function fetchOpenAlexPage(
  searchTerm: string,
  cursor: string = '*',
): Promise<OpenAlexPage | null> {
  const params = new URLSearchParams({
    search: searchTerm,
    filter: 'type:journal-article|book-chapter|dissertation|book|review|proceedings-article',
    per_page: '200',
    cursor,
    mailto: OPENALEX_MAILTO,
  })

  try {
    const res = await fetch(`${OPENALEX_API}/works?${params}`)
    if (!res.ok) {
      console.error(`  OpenAlex returned ${res.status} for "${searchTerm}"`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error(`  Fetch error for "${searchTerm}":`, err)
    return null
  }
}

async function searchOpenAlex(searchTerm: string, maxResults: number): Promise<any[]> {
  const results: any[] = []
  let cursor = '*'
  let pages = 0

  while (results.length < maxResults) {
    const page = await fetchOpenAlexPage(searchTerm, cursor)
    if (!page || !page.results || page.results.length === 0) break

    results.push(...page.results)
    pages++

    if (!page.meta.next_cursor) break
    cursor = page.meta.next_cursor

    // Safety limit: 50 pages max per search term (10,000 results)
    if (pages >= 50) break

    await sleep(DELAYS.OPENALEX_MS)
  }

  return results.slice(0, maxResults)
}

// ---------------------------------------------------------------------------
// CrossRef API — top N results per term (relevance-ranked)
// ---------------------------------------------------------------------------

const CROSSREF_PER_TERM = 300 // take top 300 per search term

async function searchCrossRef(searchTerm: string, maxResults: number): Promise<any[]> {
  const results: any[] = []
  let offset = 0
  const rows = Math.min(maxResults, CROSSREF_PER_TERM)

  while (results.length < maxResults) {
    const batchSize = Math.min(rows - results.length, 50)
    const url = `${CROSSREF_API}?query.bibliographic=${encodeURIComponent(searchTerm)}&filter=type:journal-article&rows=${batchSize}&offset=${offset}&select=DOI,title,author,abstract,published-print,published-online,issued,container-title,volume,issue,page,type,publisher,subject&mailto=${CROSSREF_MAILTO}`

    try {
      const res = await fetch(url)
      if (!res.ok) break

      const data = await res.json()
      const items = data?.message?.items
      if (!items || items.length === 0) break

      results.push(...items)
      offset += items.length

      if (items.length < batchSize) break // no more results
    } catch {
      break
    }

    await sleep(DELAYS.CROSSREF_MS)
  }

  return results.slice(0, maxResults)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('Discover Publications via OpenAlex + CrossRef')
  console.log('=============================================')
  if (dryRun) console.log('(DRY RUN)')
  console.log(`Source: ${sourceArg}`)

  // Load existing publications for deduplication
  console.log('\nLoading existing publications for deduplication...')
  const existing = loadExistingPublications()
  const dedupIndex = buildPubDedupIndex(existing)
  console.log(`  ${existing.length} existing publications (${dedupIndex.doiSet.size} with DOI)`)

  const allNormalized: NormalizedPublication[] = []

  // --- OpenAlex ---
  if (sourceArg === 'openalex' || sourceArg === 'all') {
    console.log('\n--- OpenAlex Discovery ---')
    const allResults = new Map<string, any>()

    for (const term of SEARCH_TERMS) {
      process.stdout.write(`  "${term}"...`)
      const results = await searchOpenAlex(term, limit)
      let newForTerm = 0

      for (const work of results) {
        const oaId = work.id
        if (!oaId || allResults.has(oaId)) continue
        allResults.set(oaId, work)
        newForTerm++
      }

      console.log(` ${results.length} results (${newForTerm} new)`)
    }

    console.log(`  Total unique from OpenAlex: ${allResults.size}`)

    // Dedup against existing
    let oaDupes = 0
    const oaNew: any[] = []
    for (const [, work] of allResults) {
      const doi = work.doi?.replace('https://doi.org/', '') || null
      const title = work.title || work.display_name || ''
      if (!title) continue

      if (isPubDuplicate({ doi, title, year: work.publication_year }, dedupIndex)) {
        oaDupes++
        continue
      }

      oaNew.push(work)
      if (doi) dedupIndex.doiSet.add(doi.toLowerCase())
      dedupIndex.titles.push({ title, year: work.publication_year || 0 })
    }

    // Relevance filter
    const oaRelevant = oaNew.filter(isRelevantOpenAlex)
    console.log(`  After dedup: ${oaNew.length} (${oaDupes} duplicates)`)
    console.log(`  After relevance filter: ${oaRelevant.length} (${oaNew.length - oaRelevant.length} filtered)`)

    const oaNormalized = oaRelevant.map(normalizeOpenAlexWork)
    allNormalized.push(...oaNormalized)
  }

  // --- CrossRef ---
  if (sourceArg === 'crossref' || sourceArg === 'all') {
    console.log('\n--- CrossRef Discovery (journal articles) ---')
    const crResults = new Map<string, any>() // dedup by DOI across search terms

    for (const term of CROSSREF_SEARCH_TERMS) {
      process.stdout.write(`  "${term}"...`)
      const results = await searchCrossRef(term, CROSSREF_PER_TERM)

      let newForTerm = 0
      for (const item of results) {
        if (!item.DOI) continue
        if (crResults.has(item.DOI)) continue
        crResults.set(item.DOI, item)
        newForTerm++
      }

      console.log(` ${results.length} results (${newForTerm} new)`)
    }

    console.log(`  Total unique from CrossRef: ${crResults.size}`)

    // Dedup against existing + OpenAlex results already added
    let crDupes = 0
    const crNew: any[] = []
    for (const [, item] of crResults) {
      const doi = item.DOI
      const title = Array.isArray(item.title) ? item.title[0] : (item.title || '')
      if (!title) continue

      const dateParts = item['published-print']?.['date-parts']?.[0]
        || item['published-online']?.['date-parts']?.[0]
        || item.issued?.['date-parts']?.[0]
      const year = dateParts?.[0] || 0

      if (isPubDuplicate({ doi, title, year }, dedupIndex)) {
        crDupes++
        continue
      }

      crNew.push(item)
      if (doi) dedupIndex.doiSet.add(doi.toLowerCase())
      dedupIndex.titles.push({ title, year })
    }

    // Relevance filter
    const crRelevant = crNew.filter(isRelevantCrossRef)
    console.log(`  After dedup: ${crNew.length} (${crDupes} duplicates)`)
    console.log(`  After relevance filter: ${crRelevant.length} (${crNew.length - crRelevant.length} filtered)`)

    const crNormalized = crRelevant.map(normalizeCrossRefWork)
    allNormalized.push(...crNormalized)
  }

  if (allNormalized.length === 0) {
    console.log('\nNo new publications discovered.')
    return
  }

  // Summary stats
  const byType = new Map<string, number>()
  const byDecade = new Map<string, number>()
  const bySource = new Map<string, number>()
  let withDoi = 0
  let withAbstract = 0
  let withPdf = 0

  for (const pub of allNormalized) {
    byType.set(pub.publicationType, (byType.get(pub.publicationType) || 0) + 1)
    const decade = pub.year > 0 ? `${Math.floor(pub.year / 10) * 10}s` : 'unknown'
    byDecade.set(decade, (byDecade.get(decade) || 0) + 1)
    bySource.set(pub._discoveryMethod, (bySource.get(pub._discoveryMethod) || 0) + 1)
    if (pub.doi) withDoi++
    if (pub.abstract) withAbstract++
    if (pub.pdfLink) withPdf++
  }

  // Save
  if (!dryRun) {
    saveDiscoveredPublications('openalex', allNormalized)
  }

  // Print summary
  console.log('\n========== Summary ==========')
  console.log(`New publications discovered: ${allNormalized.length}`)
  console.log(`  With DOI:      ${withDoi}`)
  console.log(`  With abstract: ${withAbstract}`)
  console.log(`  With PDF link: ${withPdf}`)

  console.log('\nBy discovery source:')
  for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`)
  }

  console.log('\nBy type:')
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nBy decade:')
  for (const [decade, count] of [...byDecade.entries()].sort()) {
    console.log(`  ${decade}: ${count}`)
  }

  // Show samples
  console.log('\nSample discoveries:')
  for (const pub of allNormalized.slice(0, 5)) {
    console.log(`  [${pub.publicationType}] ${pub.title.slice(0, 80)}`)
    console.log(`    ${pub.year} | ${pub.journal || 'unknown journal'} | DOI: ${pub.doi || 'none'}`)
  }
  // Show CrossRef-specific samples if both sources used
  if (sourceArg === 'all') {
    const crSamples = allNormalized.filter((p) => p._discoveryMethod === 'crossref_affiliation').slice(0, 5)
    if (crSamples.length > 0) {
      console.log('\nSample CrossRef-only discoveries:')
      for (const pub of crSamples) {
        console.log(`  [${pub.publicationType}] ${pub.title.slice(0, 80)}`)
        console.log(`    ${pub.year} | ${pub.journal || 'unknown journal'} | DOI: ${pub.doi || 'none'}`)
      }
    }
  }

  if (dryRun) {
    console.log('\n(DRY RUN — no files were saved)')
  } else {
    console.log(`\nNext steps:`)
    console.log(`  1. Review publications-discovered-openalex.json`)
    console.log(`  2. npx tsx scripts/load-to-payload.ts  (load into Payload)`)
    console.log(`  3. npx tsx scripts/manage-topics.ts    (assign topics)`)
    console.log(`  4. npx tsx scripts/build-authors.ts    (update author registry)`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
