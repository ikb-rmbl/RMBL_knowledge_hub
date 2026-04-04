/**
 * Reference Matching Pipeline
 *
 * Matches extracted references against publications and datasets in
 * the Knowledge Hub. Classifies as internal (in our DB) or external.
 * Loads matched references into the PostgreSQL references_cited table.
 *
 * Usage:
 *   npx tsx scripts/match-references.ts [--dry-run] [--limit=N]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'
import { titleSimilarity } from './lib/doi-utils.js'
import pg from 'pg'

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
  references: ParsedReference[]
}

interface MatchedReference extends ParsedReference {
  sourcePublicationId: number | null
  targetPublicationId: number | null
  targetDatasetId: number | null
  linkType: 'internal' | 'external'
  matchMethod: string | null
  matchConfidence: number | null
  extractionSource: string
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Reference Matching Pipeline')
  console.log('==========================')
  if (dryRun) console.log('(DRY RUN)')

  // Load CrossRef references
  const refsPath = `${OUTPUT_DIR}/references-all-pubs.json`
  if (!existsSync(refsPath)) {
    console.error('No references file found. Run extract-references-crossref.ts first.')
    process.exit(1)
  }

  let allPubRefs: PublicationRefs[] = JSON.parse(readFileSync(refsPath, 'utf-8'))
  console.log(`\nLoaded ${allPubRefs.length} publications with references`)
  const totalRefs = allPubRefs.reduce((n, r) => n + r.references.length, 0)
  console.log(`Total references to match: ${totalRefs}`)

  allPubRefs = allPubRefs.slice(0, limit)

  // Connect to database
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub' })

  // Build lookup indices from database
  console.log('\nBuilding lookup indices...')

  // Publication DOIs
  const { rows: pubRows } = await db.query('SELECT id, doi, title FROM publications WHERE doi IS NOT NULL')
  const pubByDoi = new Map<string, number>()
  const pubTitles: { id: number; title: string }[] = []
  for (const row of pubRows) {
    if (row.doi) pubByDoi.set(row.doi, row.id)
    pubTitles.push({ id: row.id, title: row.title })
  }
  // Also add pubs without DOI for title matching
  const { rows: pubNoDoi } = await db.query('SELECT id, title FROM publications WHERE doi IS NULL')
  for (const row of pubNoDoi) pubTitles.push({ id: row.id, title: row.title })

  // Dataset DOIs
  const { rows: dsRows } = await db.query('SELECT id, doi, title FROM datasets WHERE doi IS NOT NULL')
  const dsByDoi = new Map<string, number>()
  for (const row of dsRows) {
    if (row.doi) dsByDoi.set(row.doi, row.id)
  }

  // Source publication IDs by sourceId
  const { rows: sourcePubs } = await db.query('SELECT id, title FROM publications')
  const sourceByTitle = new Map<string, number>()
  for (const row of sourcePubs) sourceByTitle.set(row.title, row.id)

  // Load normalized pubs for title lookup by sourceId
  const normalizedPubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
  const titleBySourceId = new Map(normalizedPubs.map((p) => [p._sourceId, p.title]))

  console.log(`  ${pubByDoi.size} publication DOIs, ${pubTitles.length} titles, ${dsByDoi.size} dataset DOIs`)

  // Match references
  console.log('\nMatching references...')
  let doiMatches = 0
  let titleMatches = 0
  let external = 0
  let totalProcessed = 0
  const matched: MatchedReference[] = []

  for (const pubRef of allPubRefs) {
    const sourceTitle = titleBySourceId.get(pubRef.sourceId)
    const sourcePubId = sourceTitle ? sourceByTitle.get(sourceTitle) || null : null

    for (const ref of pubRef.references) {
      totalProcessed++
      const entry: MatchedReference = {
        ...ref,
        sourcePublicationId: sourcePubId,
        targetPublicationId: null,
        targetDatasetId: null,
        linkType: 'external',
        matchMethod: null,
        matchConfidence: null,
        extractionSource: 'crossref',
      }

      // Step 1: DOI exact match
      if (ref.citedDoi) {
        const pubId = pubByDoi.get(ref.citedDoi)
        if (pubId) {
          entry.targetPublicationId = pubId
          entry.linkType = 'internal'
          entry.matchMethod = 'doi'
          entry.matchConfidence = 1.0
          doiMatches++
        } else {
          const dsId = dsByDoi.get(ref.citedDoi)
          if (dsId) {
            entry.targetDatasetId = dsId
            entry.linkType = 'internal'
            entry.matchMethod = 'doi'
            entry.matchConfidence = 1.0
            doiMatches++
          }
        }
      }

      // Step 2: Title similarity match (for refs without DOI or unmatched DOI)
      if (entry.linkType === 'external' && ref.citedTitle) {
        let bestMatch: { id: number; score: number } | null = null
        for (const pub of pubTitles) {
          const score = titleSimilarity(ref.citedTitle, pub.title)
          if (score > 0.85 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { id: pub.id, score }
          }
        }
        if (bestMatch) {
          entry.targetPublicationId = bestMatch.id
          entry.linkType = 'internal'
          entry.matchMethod = 'title'
          entry.matchConfidence = bestMatch.score
          titleMatches++
        }
      }

      // Step 3: Raw citation text title search (for refs with unstructured citation only)
      if (entry.linkType === 'external' && !ref.citedTitle && ref.rawCitation) {
        // Try to extract a rough title from the raw citation
        // Pattern: after year, the next sentence-like phrase is often the title
        const yearMatch = ref.rawCitation.match(/(?:19|20)\d{2}[).,]\s*(.{20,100}?)[.,]/)
        if (yearMatch) {
          const roughTitle = yearMatch[1].trim()
          for (const pub of pubTitles) {
            const score = titleSimilarity(roughTitle, pub.title)
            if (score > 0.85) {
              entry.targetPublicationId = pub.id
              entry.linkType = 'internal'
              entry.matchMethod = 'title'
              entry.matchConfidence = score
              titleMatches++
              break
            }
          }
        }
      }

      if (entry.linkType === 'external') external++

      matched.push(entry)
    }

    if (totalProcessed % 5000 === 0) {
      process.stdout.write(`\r  ${totalProcessed} refs processed (${doiMatches} DOI, ${titleMatches} title, ${external} external)`)
    }
  }
  console.log(`\r  ${totalProcessed} refs processed (${doiMatches} DOI, ${titleMatches} title, ${external} external)`)

  // Load into database
  if (!dryRun) {
    console.log('\nLoading into database...')
    let loaded = 0
    for (let i = 0; i < matched.length; i++) {
      const ref = matched[i]
      if (!ref.sourcePublicationId) continue

      await db.query(
        `INSERT INTO references_cited
         (source_publication_id, cited_title, cited_authors, cited_year, cited_doi, cited_journal, raw_citation,
          target_publication_id, target_dataset_id, link_type, match_method, match_confidence, extraction_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          ref.sourcePublicationId,
          ref.citedTitle?.slice(0, 500) || null,
          ref.citedAuthors?.slice(0, 200) || null,
          ref.citedYear,
          ref.citedDoi,
          ref.citedJournal?.slice(0, 200) || null,
          ref.rawCitation?.slice(0, 1000) || null,
          ref.targetPublicationId,
          ref.targetDatasetId,
          ref.linkType,
          ref.matchMethod,
          ref.matchConfidence,
          ref.extractionSource,
        ],
      )
      loaded++
      if (loaded % 5000 === 0) process.stdout.write(`\r  ${loaded} loaded`)
    }
    console.log(`\r  ${loaded} references loaded into database`)
  }

  // Summary
  const internal = doiMatches + titleMatches
  console.log('\n========== Summary ==========')
  console.log(`Publications processed: ${allPubRefs.length}`)
  console.log(`Total references:      ${totalProcessed}`)
  console.log(`Internal matches:      ${internal} (${(internal / totalProcessed * 100).toFixed(1)}%)`)
  console.log(`  By DOI:              ${doiMatches}`)
  console.log(`  By title:            ${titleMatches}`)
  console.log(`External:              ${external}`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
