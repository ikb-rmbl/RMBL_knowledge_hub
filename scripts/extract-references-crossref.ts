/**
 * Extract reference lists from CrossRef for publications with DOIs.
 *
 * Fetches structured reference lists from the CrossRef API, parses each
 * reference into {citedDoi, citedAuthors, citedYear, citedJournal, rawCitation},
 * and caches results for the matching pipeline.
 *
 * Usage:
 *   npx tsx scripts/extract-references-crossref.ts [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, CROSSREF_API, CROSSREF_MAILTO, CONCURRENCY, DELAYS } from './lib/config.js'
import { extractDoi } from './lib/doi-utils.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

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
  doi: string
  refCount: number
  references: ParsedReference[]
}

// ---------------------------------------------------------------------------
// CrossRef reference parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('CrossRef Reference Extraction')
  console.log('=============================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = `${OUTPUT_DIR}/references-crossref.json`

  // Load publications with DOIs
  const pubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
  let candidates = pubs.filter((p) => p.doi)

  console.log(`\nPublications with DOI: ${candidates.length}`)

  // Check for existing cache
  if (existsSync(outputPath)) {
    const existing: PublicationRefs[] = JSON.parse(readFileSync(outputPath, 'utf-8'))
    const existingDois = new Set(existing.map((e) => e.doi))
    const newCandidates = candidates.filter((p) => !existingDois.has(p.doi))
    console.log(`Already cached: ${existing.length}, new to fetch: ${newCandidates.length}`)
    if (newCandidates.length === 0 && !dryRun) {
      console.log('Nothing new to fetch.')
      printSummary(existing)
      return
    }
    candidates = newCandidates
  }

  candidates = candidates.slice(0, limit)
  console.log(`Fetching references for ${candidates.length} publications...\n`)

  const results: PublicationRefs[] = []
  let withRefs = 0
  let totalRefs = 0

  await runConcurrent(
    candidates,
    CONCURRENCY.API_CALLS,
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
  if (!dryRun) {
    let all = results
    if (existsSync(outputPath)) {
      const existing: PublicationRefs[] = JSON.parse(readFileSync(outputPath, 'utf-8'))
      all = [...existing, ...results]
    }
    writeFileSync(outputPath, JSON.stringify(all, null, 2))
    console.log(`\nSaved ${all.length} publication reference sets to ${outputPath}`)
    printSummary(all)
  } else {
    printSummary(results)
  }
}

function printSummary(results: PublicationRefs[]) {
  const totalRefs = results.reduce((n, r) => n + r.refCount, 0)
  const withDoi = results.reduce((n, r) => n + r.references.filter((ref) => ref.citedDoi).length, 0)
  const avgRefs = totalRefs / Math.max(results.length, 1)

  console.log('\n========== Summary ==========')
  console.log(`Publications with references: ${results.length}`)
  console.log(`Total references:            ${totalRefs}`)
  console.log(`Average refs per paper:      ${avgRefs.toFixed(1)}`)
  console.log(`References with DOI:         ${withDoi} (${(withDoi / totalRefs * 100).toFixed(0)}%)`)
  console.log(`References without DOI:      ${totalRefs - withDoi}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
