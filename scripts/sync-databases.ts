/**
 * Bidirectional Database Sync: Local ↔ Neon
 *
 * Supports incremental sync with "remote wins" conflict resolution.
 * Admin edits on Neon take priority over pipeline data.
 *
 * Usage:
 *   npx tsx scripts/sync-databases.ts --direction=pull     # download Neon edits to local
 *   npx tsx scripts/sync-databases.ts --direction=push     # send local changes to Neon
 *   npx tsx scripts/sync-databases.ts --direction=both     # pull then push
 *   npx tsx scripts/sync-databases.ts --direction=both --dry-run
 *   npx tsx scripts/sync-databases.ts --direction=pull --collection=publications
 *   npx tsx scripts/sync-databases.ts --direction=push --since=2026-04-06
 */

import pg from 'pg'
import './lib/config.js' // loads .env
import {
  type MatchIndex,
  buildMatchIndex,
  matchPublication,
  matchDataset,
  matchDocument,
  matchAuthor,
  matchTopic,
  matchProject,
  mergeField,
} from './lib/record-matching.js'

const args = process.argv.slice(2)
const direction = args.find((a) => a.startsWith('--direction='))?.split('=')[1] || 'both'
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1]
const dryRun = args.includes('--dry-run')
const verbose = args.includes('--verbose')
const deleteOrphans = args.includes('--delete-orphans')
const syncReferences = args.includes('--sync-references')
const fullPush = args.includes('--full-push')

const NEON_URL = process.env.NEON_DIRECT_URL
const LOCAL_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub'

if (!NEON_URL) {
  console.error('Error: NEON_DIRECT_URL environment variable is required.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Collection configs: natural keys, field classifications
// ---------------------------------------------------------------------------

interface CollectionConfig {
  table: string
  matchFields: (record: any, candidates: any[], index?: MatchIndex) => { match: any | null; confidence: string }
  pipelineFields: string[]   // local pipeline can overwrite these
  curatedFields: string[]    // remote admin edits win for these
  skipFields: string[]       // never sync these (auto-managed)
}

const COLLECTIONS: Record<string, CollectionConfig> = {
  publications: {
    table: 'publications',
    matchFields: matchPublication,
    pipelineFields: ['external_citation_count', 'citation_count_updated_at', 'embedding', 'search_vector', 'full_text'],
    curatedFields: ['title', 'abstract', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'publisher', 'pdf_link', 'external_url', 'publication_type', 'data_source', 'discovery_method'],
    skipFields: ['id', 'created_at', 'updated_at', 'pdf_available'],
  },
  datasets: {
    table: 'datasets',
    matchFields: matchDataset,
    pipelineFields: ['external_citation_count', 'citation_count_updated_at', 'embedding', 'search_vector', 'full_text'],
    curatedFields: ['title', 'description', 'doi', 'publication_year', 'download_url', 'external_catalog_url', 'spatial_description', 'license', 'resource_type', 'data_publisher', 'repository', 'methods'],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
  documents: {
    table: 'documents',
    matchFields: matchDocument,
    pipelineFields: ['embedding', 'search_vector', 'full_text'],
    curatedFields: ['title', 'summary', 'date_original', 'source_url', 'pdf_link'],
    skipFields: ['id', 'created_at', 'updated_at', 'ingestion_date'],
  },
  authors: {
    table: 'authors',
    matchFields: matchAuthor,
    pipelineFields: ['work_count', 'embedding'],
    curatedFields: ['display_name', 'family_name', 'given_name', 'orcid', 'affiliation'],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
  topics: {
    table: 'topics',
    matchFields: matchTopic,
    pipelineFields: [],
    curatedFields: ['name', 'parent_id'],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
  projects: {
    table: 'projects',
    matchFields: matchProject,
    pipelineFields: ['embedding'],
    curatedFields: ['name', 'description', 'project_type', 'status', 'pi', 'pi_author_id', 'field_of_science', 'research_areas', 'start_year', 'end_year', 'discovery_keywords', 'auto_discovery_enabled', 'parent_project_id'],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
}

// Record matching functions imported from ./lib/record-matching.js

// ---------------------------------------------------------------------------
// Get last sync timestamp
// ---------------------------------------------------------------------------

async function getLastSyncTimestamp(db: pg.Pool, dir: string, collection: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT last_sync_timestamp FROM sync_log
     WHERE sync_direction = $1 AND collection = $2 AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1`,
    [dir, collection],
  )
  return rows[0]?.last_sync_timestamp?.toISOString() || null
}

async function recordSync(
  db: pg.Pool,
  dir: string,
  collection: string,
  stats: { pulled: number; pushed: number; skipped: number; conflicts: number },
  lastTimestamp: string,
) {
  if (dryRun) return
  await db.query(
    `INSERT INTO sync_log (sync_direction, collection, records_pulled, records_pushed, records_skipped, conflicts, started_at, completed_at, last_sync_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7)`,
    [dir, collection, stats.pulled, stats.pushed, stats.skipped, stats.conflicts, lastTimestamp],
  )
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

function mergeRecord(
  localRecord: any,
  remoteRecord: any,
  config: CollectionConfig,
  direction: 'pull' | 'push',
): { merged: Record<string, any>; changed: boolean } {
  const merged: Record<string, any> = {}

  const target = direction === 'pull' ? localRecord : remoteRecord

  for (const field of config.curatedFields) {
    merged[field] = mergeField(localRecord[field], remoteRecord[field], 'curated', direction)
  }

  for (const field of config.pipelineFields) {
    merged[field] = mergeField(localRecord[field], remoteRecord[field], 'pipeline', direction)
  }

  // Check if anything actually changed
  let changed = false
  for (const field of [...config.curatedFields, ...config.pipelineFields]) {
    const targetVal = JSON.stringify(target[field] ?? null)
    const mergedVal = JSON.stringify(merged[field] ?? null)
    if (targetVal !== mergedVal) {
      changed = true
      break
    }
  }

  return { merged, changed }
}

// ---------------------------------------------------------------------------
// Pull: Neon → Local
// ---------------------------------------------------------------------------

async function pullCollection(
  localDb: pg.Pool,
  neonDb: pg.Pool,
  collectionName: string,
  config: CollectionConfig,
  since: string | null,
) {
  // Use parameterized query for since timestamp (avoid SQL injection)
  const matchCols = 'id, doi, title, year, updated_at'
  const remoteChanged = since
    ? (await neonDb.query(`SELECT * FROM ${config.table} WHERE updated_at > $1 ORDER BY id`, [since])).rows
    : (await neonDb.query(`SELECT * FROM ${config.table} ORDER BY id`)).rows

  if (remoteChanged.length === 0) {
    console.log(`    No changes on Neon since last sync`)
    return { pulled: 0, pushed: 0, skipped: 0, conflicts: 0 }
  }

  // Load local records for matching
  const { rows: localRecords } = await localDb.query(`SELECT * FROM ${config.table}`)
  const localIndex = buildMatchIndex(localRecords)

  let pulled = 0
  let skipped = 0
  let conflicts = 0

  for (const remoteRec of remoteChanged) {
    const { match, confidence } = config.matchFields(remoteRec, localRecords, localIndex)

    if (match) {
      // Record exists locally — check if remote is newer
      const remoteUpdated = new Date(remoteRec.updated_at).getTime()
      const localUpdated = new Date(match.updated_at).getTime()

      if (remoteUpdated > localUpdated) {
        // Remote is newer — merge with remote winning
        const { merged, changed } = mergeRecord(match, remoteRec, config, 'pull')
        if (changed && !dryRun) {
          const fields = [...config.curatedFields, ...config.pipelineFields].filter((f) => merged[f] !== undefined)
          const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
          const values = fields.map((f) => merged[f])
          await localDb.query(
            `UPDATE ${config.table} SET ${setClause}, updated_at = NOW() WHERE id = $1`,
            [match.id, ...values],
          )
        }
        if (changed) pulled++
        else skipped++
      } else {
        skipped++
      }
    } else {
      // New record on Neon — insert locally
      if (verbose) console.log(`    NEW from Neon: ${remoteRec.title?.slice(0, 60) || remoteRec.name || remoteRec.id}`)
      if (!dryRun) {
        const fields = [...config.curatedFields, ...config.pipelineFields].filter((f) => remoteRec[f] !== undefined)
        const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')
        const values = fields.map((f) => remoteRec[f])
        try {
          await localDb.query(
            `INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${placeholders})`,
            values,
          )
        } catch (err: any) {
          if (verbose) console.log(`    Insert error: ${err.message?.slice(0, 80)}`)
          conflicts++
          continue
        }
      }
      pulled++
    }
  }

  return { pulled, pushed: 0, skipped, conflicts }
}

// ---------------------------------------------------------------------------
// Push: Local → Neon
// ---------------------------------------------------------------------------

async function pushCollection(
  localDb: pg.Pool,
  neonDb: pg.Pool,
  collectionName: string,
  config: CollectionConfig,
  since: string | null,
) {
  // --full-push ignores the since timestamp and considers every row
  // (use this when the pipeline scripts don't reliably bump updated_at on writes)
  const useSince = since && !fullPush
  const localChanged = useSince
    ? (await localDb.query(`SELECT * FROM ${config.table} WHERE updated_at > $1 ORDER BY id`, [since])).rows
    : (await localDb.query(`SELECT * FROM ${config.table} ORDER BY id`)).rows

  if (localChanged.length === 0) {
    console.log(`    No local changes since last sync`)
    return { pulled: 0, pushed: 0, skipped: 0, conflicts: 0 }
  }

  // Load Neon records for matching
  const { rows: neonRecords } = await neonDb.query(`SELECT * FROM ${config.table}`)
  const neonIndex = buildMatchIndex(neonRecords)

  let pushed = 0
  let skipped = 0
  let conflicts = 0

  for (const localRec of localChanged) {
    const { match, confidence } = config.matchFields(localRec, neonRecords, neonIndex)

    if (match) {
      // Decide whether to attempt a push:
      // - In default mode, only push if local updated_at is newer than Neon's
      // - In --full-push mode, always attempt push (rely on content diff for skip)
      const neonUpdated = new Date(match.updated_at).getTime()
      const localUpdated = new Date(localRec.updated_at).getTime()
      const shouldAttempt = fullPush || localUpdated > neonUpdated

      if (shouldAttempt) {
        const { merged, changed } = mergeRecord(localRec, match, config, 'push')
        // Only update fields that actually differ between local and Neon
        const fields = [...config.curatedFields, ...config.pipelineFields].filter(
          (f) => merged[f] !== undefined && merged[f] !== match[f],
        )
        if (fields.length > 0) {
          if (!dryRun) {
            const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
            const values = fields.map((f) => merged[f])
            await neonDb.query(
              `UPDATE ${config.table} SET ${setClause}, updated_at = NOW() WHERE id = $1`,
              [match.id, ...values],
            )
          }
          pushed++
        } else {
          skipped++
        }
      } else {
        skipped++ // Neon has newer data — don't overwrite (default mode)
      }
    } else {
      // New record locally — insert into Neon
      if (verbose) console.log(`    NEW to Neon: ${localRec.title?.slice(0, 60) || localRec.name || localRec.id}`)
      if (!dryRun) {
        const fields = [...config.curatedFields, ...config.pipelineFields].filter((f) => localRec[f] !== undefined)
        const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')
        const values = fields.map((f) => localRec[f])
        try {
          await neonDb.query(
            `INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${placeholders})`,
            values,
          )
        } catch (err: any) {
          if (verbose) console.log(`    Insert error: ${err.message?.slice(0, 80)}`)
          conflicts++
          continue
        }
      }
      pushed++
    }
  }

  return { pulled: 0, pushed, skipped, conflicts }
}

// ---------------------------------------------------------------------------
// Delete orphans: remove Neon records that no longer exist locally
// (Only deletes records with data_source='discovered' to protect curated rows.)
// ---------------------------------------------------------------------------

async function deleteOrphansFromNeon(
  localDb: pg.Pool,
  neonDb: pg.Pool,
  collectionName: string,
  config: CollectionConfig,
): Promise<{ deleted: number; protected: number }> {
  // Only publications has data_source — other collections don't get orphan deletion for safety
  if (config.table !== 'publications') {
    console.log(`    Orphan deletion only supported for publications (skipping ${config.table})`)
    return { deleted: 0, protected: 0 }
  }

  // Load all local records (we need to know what exists)
  const { rows: localRecords } = await localDb.query(`SELECT id, doi, title, year FROM ${config.table}`)
  const localIndex = buildMatchIndex(localRecords)

  // Load Neon records that are 'discovered' (curated rmbl_database papers are protected)
  const { rows: neonRecords } = await neonDb.query(
    `SELECT id, doi, title, year, data_source FROM ${config.table} WHERE data_source = 'discovered'`,
  )

  let deleted = 0
  let protectedCount = 0
  const toDelete: number[] = []

  for (const neonRec of neonRecords) {
    const { match } = config.matchFields(neonRec, localRecords, localIndex)
    if (!match) {
      toDelete.push(neonRec.id)
      if (verbose) {
        console.log(`    ORPHAN: ${(neonRec.title || '').slice(0, 70)} (doi=${neonRec.doi || 'none'})`)
      }
    } else {
      protectedCount++
    }
  }

  if (toDelete.length === 0) {
    console.log(`    No orphans found (${protectedCount} discovered records still match local)`)
    return { deleted: 0, protected: protectedCount }
  }

  console.log(`    ${toDelete.length} orphan ${config.table} records to delete (${protectedCount} still matched)`)

  if (dryRun) {
    console.log(`    (DRY RUN — no deletes)`)
    return { deleted: toDelete.length, protected: protectedCount }
  }

  // Delete in batches to avoid huge IN clauses
  const BATCH_SIZE = 100
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE)
    await neonDb.query(`DELETE FROM ${config.table} WHERE id = ANY($1)`, [batch])
    deleted += batch.length
    process.stdout.write(`\r    ${deleted}/${toDelete.length} deleted`)
  }
  console.log()

  return { deleted, protected: protectedCount }
}

// ---------------------------------------------------------------------------
// Sync references_cited: push from local to Neon
// Strategy: per source publication, DELETE all Neon refs for that source, then
// INSERT the current local refs. Idempotent and matches the new local pattern.
// ---------------------------------------------------------------------------

async function syncReferencesCited(
  localDb: pg.Pool,
  neonDb: pg.Pool,
): Promise<{ sources: number; rowsDeleted: number; rowsInserted: number }> {
  console.log('\n--- references_cited (push) ---')

  // Build local→neon publication ID map (by DOI, then title)
  const { rows: localPubs } = await localDb.query('SELECT id, doi, title FROM publications')
  const { rows: neonPubs } = await neonDb.query('SELECT id, doi, title FROM publications')

  const neonByDoi = new Map<string, number>()
  const neonByTitle = new Map<string, number>()
  for (const p of neonPubs) {
    if (p.doi) neonByDoi.set(p.doi.toLowerCase(), p.id)
    if (p.title) neonByTitle.set(p.title.toLowerCase(), p.id)
  }

  const localToNeonId = new Map<number, number>()
  for (const p of localPubs) {
    let neonId: number | undefined
    if (p.doi) neonId = neonByDoi.get(p.doi.toLowerCase())
    if (!neonId && p.title) neonId = neonByTitle.get(p.title.toLowerCase())
    if (neonId) localToNeonId.set(p.id, neonId)
  }

  console.log(`    Mapped ${localToNeonId.size}/${localPubs.length} local pubs to Neon IDs`)

  // Same maps for datasets (target_dataset_id translation)
  const { rows: localDatasets } = await localDb.query('SELECT id, doi, title FROM datasets')
  const { rows: neonDatasets } = await neonDb.query('SELECT id, doi, title FROM datasets')
  const neonDsByDoi = new Map<string, number>()
  const neonDsByTitle = new Map<string, number>()
  for (const d of neonDatasets) {
    if (d.doi) neonDsByDoi.set(d.doi.toLowerCase(), d.id)
    if (d.title) neonDsByTitle.set(d.title.toLowerCase(), d.id)
  }
  const localDsToNeonId = new Map<number, number>()
  for (const d of localDatasets) {
    let neonId: number | undefined
    if (d.doi) neonId = neonDsByDoi.get(d.doi.toLowerCase())
    if (!neonId && d.title) neonId = neonDsByTitle.get(d.title.toLowerCase())
    if (neonId) localDsToNeonId.set(d.id, neonId)
  }

  // Get list of source publications that have references locally
  const { rows: sources } = await localDb.query(
    'SELECT DISTINCT source_publication_id FROM references_cited WHERE source_publication_id IS NOT NULL ORDER BY source_publication_id',
  )

  console.log(`    ${sources.length} source publications have references to sync`)

  if (dryRun) {
    console.log('    (DRY RUN — no changes)')
    return { sources: sources.length, rowsDeleted: 0, rowsInserted: 0 }
  }

  let processed = 0
  let totalDeleted = 0
  let totalInserted = 0
  let unmappedSources = 0

  for (const { source_publication_id: localSourceId } of sources) {
    const neonSourceId = localToNeonId.get(localSourceId)
    if (!neonSourceId) {
      unmappedSources++
      continue // source paper doesn't exist on Neon (e.g., we just deleted it as orphan)
    }

    // Load all local refs for this source
    const { rows: localRefs } = await localDb.query(
      `SELECT cited_title, cited_authors, cited_year, cited_doi, cited_journal, raw_citation,
              target_publication_id, target_dataset_id, link_type, match_method, match_confidence, extraction_source
       FROM references_cited WHERE source_publication_id = $1`,
      [localSourceId],
    )

    // Translate target IDs from local → neon
    const translatedRefs = localRefs.map((r) => ({
      ...r,
      target_publication_id: r.target_publication_id ? localToNeonId.get(r.target_publication_id) ?? null : null,
      target_dataset_id: r.target_dataset_id ? localDsToNeonId.get(r.target_dataset_id) ?? null : null,
    }))
    // If translation failed, downgrade to external
    for (const r of translatedRefs) {
      if (!r.target_publication_id && !r.target_dataset_id && r.link_type === 'internal') {
        r.link_type = 'external'
        r.match_method = null
        r.match_confidence = null
      }
    }

    // Atomic replace: delete then insert in a transaction
    const client = await neonDb.connect()
    try {
      await client.query('BEGIN')
      const delResult = await client.query(
        'DELETE FROM references_cited WHERE source_publication_id = $1',
        [neonSourceId],
      )
      totalDeleted += delResult.rowCount || 0

      for (const r of translatedRefs) {
        await client.query(
          `INSERT INTO references_cited
           (source_publication_id, cited_title, cited_authors, cited_year, cited_doi, cited_journal, raw_citation,
            target_publication_id, target_dataset_id, link_type, match_method, match_confidence, extraction_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            neonSourceId,
            r.cited_title,
            r.cited_authors,
            r.cited_year,
            r.cited_doi,
            r.cited_journal,
            r.raw_citation,
            r.target_publication_id,
            r.target_dataset_id,
            r.link_type,
            r.match_method,
            r.match_confidence,
            r.extraction_source,
          ],
        )
        totalInserted++
      }
      await client.query('COMMIT')
    } catch (err: any) {
      await client.query('ROLLBACK')
      console.error(`    Error syncing refs for local pub ${localSourceId}: ${err.message?.slice(0, 100)}`)
    } finally {
      client.release()
    }

    processed++
    if (processed % 50 === 0) {
      process.stdout.write(`\r    ${processed}/${sources.length} sources synced — ${totalInserted} refs inserted`)
    }
  }
  console.log(`\r    ${processed} sources synced — ${totalDeleted} deleted, ${totalInserted} inserted, ${unmappedSources} unmapped`)

  return { sources: processed, rowsDeleted: totalDeleted, rowsInserted: totalInserted }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Bidirectional Database Sync')
  console.log('==========================')
  console.log(`Direction: ${direction}`)
  console.log(`Collection: ${collectionFilter}`)
  if (dryRun) console.log('(DRY RUN)')

  const localDb = new pg.Pool({ connectionString: LOCAL_URL, max: 3 })
  const neonDb = new pg.Pool({ connectionString: NEON_URL, max: 3, connectionTimeoutMillis: 10000 })

  // Verify connectivity
  try {
    await neonDb.query('SELECT 1')
    console.log('Neon: connected')
  } catch (err: any) {
    console.error(`Neon connection failed: ${err.message}`)
    process.exit(1)
  }

  const collectionsToSync = collectionFilter === 'all'
    ? Object.keys(COLLECTIONS)
    : [collectionFilter]

  for (const collName of collectionsToSync) {
    const config = COLLECTIONS[collName]
    if (!config) {
      console.error(`Unknown collection: ${collName}`)
      continue
    }

    console.log(`\n--- ${collName} ---`)

    // Determine since timestamp
    const since = sinceArg || await getLastSyncTimestamp(localDb, direction === 'both' ? 'pull' : direction, collName)
    if (since) console.log(`  Since: ${since}`)
    else console.log('  Since: beginning (first sync)')

    const now = new Date().toISOString()

    if (direction === 'pull' || direction === 'both') {
      console.log('  PULL (Neon → Local):')
      const stats = await pullCollection(localDb, neonDb, collName, config, since)
      console.log(`    ${stats.pulled} pulled, ${stats.skipped} skipped, ${stats.conflicts} conflicts`)
      await recordSync(localDb, 'pull', collName, stats, now)
    }

    if (direction === 'push' || direction === 'both') {
      console.log('  PUSH (Local → Neon):')
      const stats = await pushCollection(localDb, neonDb, collName, config, since)
      console.log(`    ${stats.pushed} pushed, ${stats.skipped} skipped, ${stats.conflicts} conflicts`)
      await recordSync(localDb, 'push', collName, stats, now)
    }

    if (deleteOrphans && (direction === 'push' || direction === 'both')) {
      console.log('  DELETE ORPHANS on Neon:')
      const stats = await deleteOrphansFromNeon(localDb, neonDb, collName, config)
      if (stats.deleted > 0) {
        console.log(`    Removed ${stats.deleted} orphan records`)
      }
    }
  }

  // Sync references_cited if requested (after main collections so target IDs resolve)
  if (syncReferences && (direction === 'push' || direction === 'both')) {
    await syncReferencesCited(localDb, neonDb)
  }

  // Summary: compare counts
  console.log('\n========== Row Counts ==========')
  for (const collName of collectionsToSync) {
    const config = COLLECTIONS[collName]
    if (!config) continue
    const { rows: [local] } = await localDb.query(`SELECT count(*)::int as n FROM ${config.table}`)
    const { rows: [neon] } = await neonDb.query(`SELECT count(*)::int as n FROM ${config.table}`)
    const diff = local.n - neon.n
    const marker = diff === 0 ? '✓' : '✗'
    console.log(`  ${marker} ${collName.padEnd(18)} local: ${String(local.n).padStart(7)}  neon: ${String(neon.n).padStart(7)}${diff !== 0 ? `  (${diff > 0 ? '+' : ''}${diff})` : ''}`)
  }
  if (syncReferences) {
    const { rows: [local] } = await localDb.query('SELECT count(*)::int as n FROM references_cited')
    const { rows: [neon] } = await neonDb.query('SELECT count(*)::int as n FROM references_cited')
    const diff = local.n - neon.n
    const marker = diff === 0 ? '✓' : '✗'
    console.log(`  ${marker} ${'references_cited'.padEnd(18)} local: ${String(local.n).padStart(7)}  neon: ${String(neon.n).padStart(7)}${diff !== 0 ? `  (${diff > 0 ? '+' : ''}${diff})` : ''}`)
  }

  await localDb.end()
  await neonDb.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
