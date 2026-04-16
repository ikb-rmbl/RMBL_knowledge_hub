/**
 * Load Extraction Results
 *
 * Reads a results.json from `scripts/experiment-extraction.ts` and loads each
 * paper's VLM extraction into the database tables created by Phase 1:
 *
 *   1. entity_candidates  — one row per species/place/protocol/concept (raw VLM output)
 *   2. code_repositories  — one row per code URL extracted from codeAvailability
 *   3. data_repositories  — one row per data URL extracted from dataAvailability,
 *                           with linked_dataset_id populated when external_doi matches
 *                           an internal dataset
 *   4. content_chunks      — one row per publication storing the full VLM extraction
 *                           in metadata jsonb (chunk_method='vlm_extract')
 *
 * What this script does NOT do (deferred to the linker — Phase 5):
 *   - Creating canonical species/places/protocols/concepts rows
 *   - Creating entity_mentions rows
 *   - Filling missing publications metadata (title/abstract/etc) from metadataEnrichment
 *
 * Idempotency: this script is safe to re-run. entity_candidates rows are
 * uniquely identified by (entity_type, source_collection, source_item_id, raw_name).
 * Re-running will skip already-loaded candidates.
 *
 * Usage:
 *   npx tsx scripts/load-extraction-results.ts --results=path/to/results.json
 *   npx tsx scripts/load-extraction-results.ts --results=... --paper=40        # only one paper
 *   npx tsx scripts/load-extraction-results.ts --results=... --dry-run         # report only
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const resultsArg = args.find((a) => a.startsWith('--results='))?.split('=')[1]
const paperArg = args.find((a) => a.startsWith('--paper='))?.split('=')[1]
const collectionArg = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'publications'
const dryRun = args.includes('--dry-run')

if (!resultsArg) {
  console.error('Error: --results=path/to/results.json is required')
  process.exit(1)
}

const targetPaperId = paperArg ? parseInt(paperArg, 10) : null

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

interface LoadStats {
  papers: number
  candidates: { species: number; place: number; protocol: number; concept: number }
  codeRepos: number
  dataRepos: number
  dataReposLinked: number  // linked_dataset_id populated
  contentChunks: number
  duplicates: { species: number; place: number; protocol: number; concept: number; codeRepo: number; dataRepo: number }
  errors: { species: number; place: number; protocol: number; concept: number; codeRepo: number; dataRepo: number }
}

function newStats(): LoadStats {
  return {
    papers: 0,
    candidates: { species: 0, place: 0, protocol: 0, concept: 0 },
    codeRepos: 0,
    dataRepos: 0,
    dataReposLinked: 0,
    contentChunks: 0,
    duplicates: { species: 0, place: 0, protocol: 0, concept: 0, codeRepo: 0, dataRepo: 0 },
    errors: { species: 0, place: 0, protocol: 0, concept: 0, codeRepo: 0, dataRepo: 0 },
  }
}

// ---------------------------------------------------------------------------
// Per-publication loading
// ---------------------------------------------------------------------------

async function loadPaper(
  db: pg.Pool,
  result: any,
  datasetDoiMap: Map<string, number>,
  stats: LoadStats,
): Promise<void> {
  const rawId = String(result.id).replace(/^(dataset_|pub_|doc_)/, '')
  const itemId = parseInt(rawId)
  if (isNaN(itemId)) {
    console.log(`  [${result.collection || collectionArg}:${result.id}] invalid ID — skipping`)
    return
  }
  const collection = result.collection || collectionArg
  const extraction = result.strategy3?.extraction
  if (!extraction) {
    console.log(`  [${collection}:${itemId}] no extraction — skipping`)
    return
  }

  // Verify the item exists in its collection
  const table = collection === 'datasets' ? 'datasets' : collection === 'documents' ? 'documents' : 'publications'
  const { rows: itemRows } = await db.query(`SELECT id, title FROM ${table} WHERE id = $1`, [itemId])
  if (itemRows.length === 0) {
    console.log(`  [${collection}:${itemId}] not found in ${table} — skipping`)
    return
  }

  console.log(`  [${collection}:${itemId}] ${itemRows[0].title?.slice(0, 70)}`)

  // ---------- Species candidates ----------
  for (const sp of extraction.species || []) {
    if (!sp.scientificName) continue
    const r = await insertCandidate(db, 'species', sp.scientificName, sp, itemId, collection)
    if (r === 'inserted') stats.candidates.species++
    else if (r === 'duplicate') stats.duplicates.species++
    else stats.errors.species++
  }

  // ---------- Place candidates ----------
  for (const pl of extraction.places || []) {
    if (!pl.name) continue
    const r = await insertCandidate(db, 'place', pl.name, pl, itemId, collection)
    if (r === 'inserted') stats.candidates.place++
    else if (r === 'duplicate') stats.duplicates.place++
    else stats.errors.place++
  }

  // ---------- Protocol candidates ----------
  for (const pn of extraction.protocolsNamed || []) {
    if (!pn.proposedName) continue
    const r = await insertCandidate(db, 'protocol', pn.proposedName, pn, itemId, collection)
    if (r === 'inserted') stats.candidates.protocol++
    else if (r === 'duplicate') stats.duplicates.protocol++
    else stats.errors.protocol++
  }

  // ---------- Concept candidates ----------
  for (const c of extraction.concepts || []) {
    if (!c.name) continue
    const r = await insertCandidate(db, 'concept', c.name, c, itemId, collection)
    if (r === 'inserted') stats.candidates.concept++
    else if (r === 'duplicate') stats.duplicates.concept++
    else stats.errors.concept++
  }

  // ---------- Code repositories ----------
  for (const code of extraction.codeAvailability || []) {
    if (!code.url) continue
    if (dryRun) { stats.codeRepos++; continue }
    try {
      const result = await db.query(
        `INSERT INTO code_repositories
         (publication_id, url, platform, description, language, license, extraction_method)
         VALUES ($1, $2, $3, $4, $5, $6, 'vlm')
         ON CONFLICT (publication_id, url) DO NOTHING
         RETURNING id`,
        [itemId, code.url, code.platform || null, code.description || null, code.language || null, code.license || null],
      )
      if (result.rowCount && result.rowCount > 0) stats.codeRepos++
      else stats.duplicates.codeRepo++
    } catch (err: any) {
      console.log(`    code_repo error: ${err.message?.slice(0, 100)}`)
      stats.errors.codeRepo++
    }
  }

  // ---------- Data repositories ----------
  for (const data of extraction.dataAvailability || []) {
    if (!data.url) continue
    if (dryRun) { stats.dataRepos++; if (data.doi && datasetDoiMap.has(data.doi.toLowerCase())) stats.dataReposLinked++; continue }
    try {
      const linkedDatasetId = data.doi ? datasetDoiMap.get(data.doi.toLowerCase()) ?? null : null
      const result = await db.query(
        `INSERT INTO data_repositories
         (publication_id, url, platform, description, external_doi, linked_dataset_id, extraction_method)
         VALUES ($1, $2, $3, $4, $5, $6, 'vlm')
         ON CONFLICT (publication_id, url) DO NOTHING
         RETURNING id`,
        [itemId, data.url, data.platform || null, data.description || null, data.doi || null, linkedDatasetId],
      )
      if (result.rowCount && result.rowCount > 0) {
        stats.dataRepos++
        if (linkedDatasetId) stats.dataReposLinked++
      } else {
        stats.duplicates.dataRepo++
      }
    } catch (err: any) {
      console.log(`    data_repo error: ${err.message?.slice(0, 100)}`)
      stats.errors.dataRepo++
    }
  }

  // ---------- Content chunk: full VLM extraction blob ----------
  // Stored in content_chunks with chunk_method='vlm_extract' and metadata=full extraction
  if (!dryRun) {
    try {
      // Use a deterministic chunk_index of 0 for the VLM blob (one per publication)
      // Delete any prior VLM extract blob first to keep this idempotent
      await db.query(
        `DELETE FROM content_chunks WHERE collection = $1 AND item_id = $2 AND chunk_method = 'vlm_extract'`,
        [collection, itemId],
      )
      await db.query(
        `INSERT INTO content_chunks (collection, item_id, chunk_index, chunk_text, chunk_method, metadata)
         VALUES ($4, $1, 0, $2, 'vlm_extract', $3)`,
        [
          itemId,
          // chunk_text gets the abstract (or first 500 chars of methods) for searchability
          (extraction.metadataEnrichment?.abstract || extraction.methods || '').slice(0, 4000),
          JSON.stringify(extraction),
          collection,
        ],
      )
      stats.contentChunks++
    } catch (err: any) {
      console.log(`    content_chunks error: ${err.message?.slice(0, 100)}`)
    }
  } else {
    stats.contentChunks++
  }

  stats.papers++
}

// ---------------------------------------------------------------------------
// Insert helper for entity_candidates
// ---------------------------------------------------------------------------

type InsertResult = 'inserted' | 'duplicate' | 'error'

async function insertCandidate(
  db: pg.Pool,
  entityType: 'species' | 'place' | 'protocol' | 'concept',
  rawName: string,
  rawAttributes: any,
  itemId: number,
  collection: string,
): Promise<InsertResult> {
  if (dryRun) return 'inserted'
  try {
    const { rowCount } = await db.query(
      `INSERT INTO entity_candidates (entity_type, raw_name, raw_attributes, source_collection, source_item_id, confidence)
       SELECT $1::varchar, $2::text, $3::jsonb, $5::varchar, $4::integer, 1.0
       WHERE NOT EXISTS (
         SELECT 1 FROM entity_candidates
         WHERE entity_type = $1::varchar
           AND source_collection = $5::varchar
           AND source_item_id = $4::integer
           AND lower(raw_name) = lower($2::text)
       )`,
      [entityType, rawName, JSON.stringify(rawAttributes), itemId, collection],
    )
    return (rowCount || 0) > 0 ? 'inserted' : 'duplicate'
  } catch (err: any) {
    console.log(`    candidate error (${entityType}/${rawName}): ${err.message?.slice(0, 100)}`)
    return 'error'
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Load Extraction Results')
  console.log('=======================')
  console.log(`Results file: ${resultsArg}`)
  if (targetPaperId) console.log(`Filter: paper id = ${targetPaperId}`)
  if (dryRun) console.log('(DRY RUN — no writes)')
  console.log()

  const data = JSON.parse(readFileSync(resultsArg!, 'utf-8'))
  const results = Array.isArray(data) ? data : [data]
  console.log(`Loaded ${results.length} paper results from file`)

  const filtered = targetPaperId ? results.filter((r) => r.id === targetPaperId) : results
  if (filtered.length === 0) {
    console.error('No matching results to load')
    process.exit(1)
  }
  console.log(`Processing ${filtered.length} papers`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Build dataset DOI lookup once for linked_dataset_id resolution
    const { rows: dsRows } = await db.query('SELECT id, doi FROM datasets WHERE doi IS NOT NULL')
    const datasetDoiMap = new Map<string, number>()
    for (const r of dsRows) datasetDoiMap.set(r.doi.toLowerCase(), r.id)
    console.log(`Indexed ${datasetDoiMap.size} dataset DOIs for cross-link resolution\n`)

    const stats = newStats()
    for (const result of filtered) {
      await loadPaper(db, result, datasetDoiMap, stats)
    }

    console.log('\n========== Summary ==========')
    console.log(`Papers processed: ${stats.papers}`)
    console.log(`Entity candidates inserted (duplicates / errors in parens):`)
    const fmt = (ins: number, dup: number, err: number) =>
      `${ins}${(dup || err) ? ` (dup=${dup}${err ? ', err=' + err : ''})` : ''}`
    console.log(`  species:   ${fmt(stats.candidates.species, stats.duplicates.species, stats.errors.species)}`)
    console.log(`  places:    ${fmt(stats.candidates.place, stats.duplicates.place, stats.errors.place)}`)
    console.log(`  protocols: ${fmt(stats.candidates.protocol, stats.duplicates.protocol, stats.errors.protocol)}`)
    console.log(`  concepts:  ${fmt(stats.candidates.concept, stats.duplicates.concept, stats.errors.concept)}`)
    console.log(`Code repositories: ${fmt(stats.codeRepos, stats.duplicates.codeRepo, stats.errors.codeRepo)}`)
    console.log(`Data repositories: ${fmt(stats.dataRepos, stats.duplicates.dataRepo, stats.errors.dataRepo)}`)
    if (stats.dataRepos > 0) console.log(`  ↳ linked to internal datasets: ${stats.dataReposLinked}/${stats.dataRepos}`)
    console.log(`Content chunks (vlm_extract): ${stats.contentChunks}`)

    const totalErrors = Object.values(stats.errors).reduce((a, b) => a + b, 0)
    if (totalErrors > 0) {
      console.log(`\n⚠ ${totalErrors} insert errors. Inspect script output above.`)
      process.exit(2)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
