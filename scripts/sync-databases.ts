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
  matchSpecies,
  matchPlace,
  matchProtocol,
  matchConcept,
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
const syncEntities = args.includes('--sync-entities')
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
    curatedFields: ['title', 'abstract', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'publisher', 'pdf_link', 'external_url', 'publication_type', 'data_source', 'discovery_method', 'pdf_restricted', 'pdf_source_description', 'pdf_acquired_at'],
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
    curatedFields: ['title', 'summary', 'date_original', 'source_url', 'pdf_link', 'pdf_restricted', 'pdf_source_description', 'pdf_acquired_at'],
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

// Entity collections: all fields are pipeline-managed (no curation conflicts)
const ENTITY_COLLECTIONS: Record<string, CollectionConfig> = {
  species: {
    table: 'species',
    matchFields: matchSpecies,
    pipelineFields: ['canonical_name', 'rank', 'scientific_name', 'authority', 'common_names', 'synonyms', 'parent_taxon_id', 'kingdom', 'phylum', 'class_name', 'order_name', 'family', 'conservation_status', 'native_to_rmbl', 'ecological_roles', 'description', 'external_ids', 'mention_count', 'publication_count', 'embedding'],
    curatedFields: [],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
  places: {
    table: 'places',
    matchFields: matchPlace,
    pipelineFields: ['name', 'place_type', 'scale', 'parent_place_id', 'lat', 'lon', 'elevation_m', 'elevation_min_m', 'elevation_max_m', 'habitat_types', 'aliases', 'description', 'external_ids', 'mention_count', 'publication_count', 'embedding'],
    curatedFields: [],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
  protocols: {
    table: 'protocols',
    matchFields: matchProtocol,
    pipelineFields: ['name', 'slug', 'category', 'subcategory', 'description', 'typical_equipment', 'output_measurements', 'standardized', 'standard_reference', 'disciplines', 'mention_count', 'publication_count', 'embedding'],
    curatedFields: ['approved'],
    skipFields: ['id', 'created_at', 'updated_at'],
  },
  concepts: {
    table: 'concepts',
    matchFields: matchConcept,
    pipelineFields: ['name', 'concept_type', 'definition', 'scope', 'aliases', 'disciplines', 'mention_count', 'publication_count', 'embedding'],
    curatedFields: [],
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

/**
 * Value-based equality that handles Date objects (which fail strict ===
 * even when they represent the same moment) and other reference types.
 * Used to detect whether a field actually differs between local and remote.
 */
function valuesEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  // Date: compare by epoch ms
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Date || b instanceof Date) {
    // One is Date, one is something else (likely a string from JSON parse)
    const ta = a instanceof Date ? a.getTime() : new Date(a).getTime()
    const tb = b instanceof Date ? b.getTime() : new Date(b).getTime()
    return !isNaN(ta) && !isNaN(tb) && ta === tb
  }
  // Arrays / objects: structural equality via JSON
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

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
  let localChanged = useSince
    ? (await localDb.query(`SELECT * FROM ${config.table} WHERE updated_at > $1 ORDER BY id`, [since])).rows
    : (await localDb.query(`SELECT * FROM ${config.table} ORDER BY id`)).rows

  // For self-referencing tables (places, protocols, concepts, species with parent FK),
  // topological sort so parents are always inserted before their children
  if (config.table === 'places' || config.table === 'protocols' || config.table === 'concepts' || config.table === 'species') {
    const parentField = config.table === 'places' ? 'parent_place_id'
      : config.table === 'protocols' ? 'parent_protocol_id'
      : config.table === 'concepts' ? 'parent_concept_id'
      : 'parent_taxon_id'
    const byId = new Map(localChanged.map((r) => [r.id, r]))
    const sorted: any[] = []
    const visited = new Set<number>()
    function visit(rec: any) {
      if (visited.has(rec.id)) return
      visited.add(rec.id)
      if (rec[parentField] != null && byId.has(rec[parentField])) {
        visit(byId.get(rec[parentField]))
      }
      sorted.push(rec)
    }
    for (const r of localChanged) visit(r)
    localChanged = sorted
  }

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
  const deferred: { localRec: any; match: any | null }[] = [] // FK failures retried in second pass

  for (const localRec of localChanged) {
    const { match, confidence } = config.matchFields(localRec, neonRecords, neonIndex)

    if (match) {
      const neonUpdated = new Date(match.updated_at).getTime()
      const localUpdated = new Date(localRec.updated_at).getTime()
      const shouldAttempt = fullPush || localUpdated > neonUpdated

      if (shouldAttempt) {
        const { merged } = mergeRecord(localRec, match, config, 'push')
        const fields = [...config.curatedFields, ...config.pipelineFields].filter(
          (f) => merged[f] !== undefined && !valuesEqual(merged[f], match[f]),
        )
        if (fields.length > 0) {
          if (!dryRun) {
            const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
            const values = fields.map((f) => merged[f])
            try {
              await neonDb.query(
                `UPDATE ${config.table} SET ${setClause}, updated_at = NOW() WHERE id = $1`,
                [match.id, ...values],
              )
            } catch (err: any) {
              if (err.code === '23503') { // FK violation — defer to second pass
                deferred.push({ localRec, match })
                continue
              }
              throw err
            }
          }
          pushed++
        } else {
          skipped++
        }
      } else {
        skipped++
      }
    } else {
      if (verbose) console.log(`    NEW to Neon: ${localRec.title?.slice(0, 60) || localRec.name || localRec.canonical_name || localRec.id}`)
      if (!dryRun) {
        const fields = ['id', ...config.curatedFields, ...config.pipelineFields].filter((f) => localRec[f] !== undefined)
        const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')
        const values = fields.map((f) => localRec[f])
        try {
          await neonDb.query(
            `INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${placeholders})
             ON CONFLICT (id) DO NOTHING`,
            values,
          )
        } catch (err: any) {
          if (err.code === '23503') { // FK violation — defer to second pass
            deferred.push({ localRec, match: null })
            continue
          }
          if (verbose) console.log(`    Insert error: ${err.message?.slice(0, 80)}`)
          conflicts++
          continue
        }
      }
      pushed++
    }
  }

  // Second pass: retry deferred FK failures (parents should exist now)
  if (deferred.length > 0) {
    console.log(`    Retrying ${deferred.length} deferred FK records...`)
    for (const { localRec, match } of deferred) {
      try {
        if (match) {
          const { merged } = mergeRecord(localRec, match, config, 'push')
          const fields = [...config.curatedFields, ...config.pipelineFields].filter(
            (f) => merged[f] !== undefined && !valuesEqual(merged[f], match[f]),
          )
          if (fields.length > 0 && !dryRun) {
            const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
            const values = fields.map((f) => merged[f])
            await neonDb.query(`UPDATE ${config.table} SET ${setClause}, updated_at = NOW() WHERE id = $1`, [match.id, ...values])
          }
          pushed++
        } else {
          const fields = ['id', ...config.curatedFields, ...config.pipelineFields].filter((f) => localRec[f] !== undefined)
          const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')
          const values = fields.map((f) => localRec[f])
          if (!dryRun) {
            await neonDb.query(`INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values)
          }
          pushed++
        }
      } catch (err: any) {
        if (verbose) console.log(`    Deferred retry failed: ${err.message?.slice(0, 80)}`)
        conflicts++
      }
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

// ---------------------------------------------------------------------------
// Sync entity tables (bulk): entity_mentions, entity_candidates, etc.
// Strategy: DELETE all rows from Neon, then bulk INSERT from local using
// batched INSERT VALUES (not COPY, which Neon restricts).
// Tables are synced in FK-safe order.
// ---------------------------------------------------------------------------

async function syncEntityBulkTables(
  localDb: pg.Pool,
  neonDb: pg.Pool,
): Promise<void> {
  // Tables in insert order (parents first, then children)
  const INSERT_ORDER = [
    'neighborhoods',
    'neighborhood_members',
    'entity_mentions',
    'entity_candidates',
    'code_repositories',
    'data_repositories',
    'content_chunks',
  ]
  // Delete in reverse (children first)
  const DELETE_ORDER = [...INSERT_ORDER].reverse()

  // Phase 1: Delete all in child-first order
  console.log('\n  Phase 1: Clearing Neon tables (children first)...')
  const skippedTables = new Set<string>()
  for (const table of DELETE_ORDER) {
    const { rows: [{ n }] } = await neonDb.query(`SELECT count(*)::int as n FROM ${table}`)
    if (n > 0) {
      const { rows: [{ n: localN }] } = await localDb.query(`SELECT count(*)::int as n FROM ${table}`)
      if (localN > 0 && localN < n * 0.5) {
        console.log(`    ⚠ ${table}: SKIPPED delete (local ${localN} < 50% of Neon ${n})`)
        skippedTables.add(table)
        continue
      }
      await neonDb.query(`DELETE FROM ${table}`)
      console.log(`    ${table}: cleared ${n} rows`)
    } else {
      console.log(`    ${table}: already empty`)
    }
  }

  // Phase 2: Insert all in parent-first order
  console.log('\n  Phase 2: Inserting data (parents first)...')
  for (const table of INSERT_ORDER) {
    if (skippedTables.has(table)) {
      console.log(`\n  --- ${table} --- skipped (delete was skipped)`)
      continue
    }

    console.log(`\n  --- ${table} ---`)

    const { rows: [{ n: localCount }] } = await localDb.query(`SELECT count(*)::int as n FROM ${table}`)
    if (localCount === 0) {
      console.log('    Skipping (empty locally)')
      continue
    }
    console.log(`    Local: ${localCount} rows`)

    if (dryRun) { console.log('    (dry run)'); continue }

    // Fetch local rows and insert in batches
    const { rows: localRows } = await localDb.query(`SELECT * FROM ${table} ORDER BY id`)
    if (localRows.length === 0) continue

    // Detect JSONB columns from schema (runtime detection fails for JSON arrays)
    const columns = Object.keys(localRows[0])
    const { rows: colInfo } = await localDb.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND udt_name = 'jsonb'`,
      [table],
    )
    const jsonbCols = new Set<string>(colInfo.map((c: any) => c.column_name))
    if (jsonbCols.size > 0) console.log(`    JSONB columns: ${[...jsonbCols].join(', ')}`)

    const BATCH = 500
    let inserted = 0
    let batchErrors = 0
    let rowErrors = 0

    for (let i = 0; i < localRows.length; i += BATCH) {
      const batch = localRows.slice(i, i + BATCH)
      const valueSets: string[] = []
      const allValues: any[] = []

      for (const row of batch) {
        const placeholders = columns.map((_, ci) => `$${allValues.length + ci + 1}`).join(', ')
        valueSets.push(`(${placeholders})`)
        for (const col of columns) {
          const val = row[col]
          allValues.push(jsonbCols.has(col) && val !== null ? JSON.stringify(val) : val)
        }
      }

      try {
        await neonDb.query(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valueSets.join(', ')}`,
          allValues,
        )
        inserted += batch.length
      } catch (err: any) {
        batchErrors++
        console.log(`    Batch ${Math.floor(i / BATCH) + 1} failed (${err.code || '?'}): ${err.message?.slice(0, 120)}`)
        // Fall back to row-by-row on batch failure
        for (const row of batch) {
          const vals = columns.map((c) => {
            const v = row[c]
            return jsonbCols.has(c) && v !== null ? JSON.stringify(v) : v
          })
          const ph = columns.map((_, ci) => `$${ci + 1}`).join(', ')
          try {
            await neonDb.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${ph})`, vals)
            inserted++
          } catch (rowErr: any) {
            rowErrors++
            if (rowErrors <= 3) {
              console.log(`    Row ${row.id || '?'} failed (${rowErr.code || '?'}): ${rowErr.message?.slice(0, 120)}`)
            }
          }
        }
      }

      if ((i + BATCH) % 5000 === 0 || i + BATCH >= localRows.length) {
        process.stdout.write(`\r    Inserted ${inserted}/${localRows.length}`)
      }
    }
    const errorSuffix = (batchErrors || rowErrors) ? ` (${batchErrors} batch errors, ${rowErrors} row errors)` : ''
    console.log(`\r    Inserted ${inserted}/${localRows.length}${errorSuffix}`)
  }
}

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

    // Dedupe in TS first to avoid in-statement duplicate-key issues from latent
    // local collisions (e.g., refs pointing to local datasets that share a DOI).
    const seenKeys = new Set<string>()
    const dedupedRefs = translatedRefs.filter((r) => {
      const key = `${r.target_publication_id ?? 0}|${r.target_dataset_id ?? 0}|${(r.cited_doi || '').toLowerCase()}|${(r.cited_title || '').toLowerCase()}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

    // Atomic replace: delete then bulk insert in a transaction
    const client = await neonDb.connect()
    try {
      await client.query('BEGIN')
      const delResult = await client.query(
        'DELETE FROM references_cited WHERE source_publication_id = $1',
        [neonSourceId],
      )
      totalDeleted += delResult.rowCount || 0

      // Bulk insert all refs in one query (chunked if very large)
      // Postgres bind param limit is 65535; with 13 cols/row that's ~5000 rows max.
      // Largest source has ~165 refs, so one query is almost always enough.
      const COLS_PER_ROW = 13
      const MAX_ROWS_PER_INSERT = 1000
      for (let chunkStart = 0; chunkStart < dedupedRefs.length; chunkStart += MAX_ROWS_PER_INSERT) {
        const chunk = dedupedRefs.slice(chunkStart, chunkStart + MAX_ROWS_PER_INSERT)
        const placeholders = chunk
          .map((_, i) => {
            const base = i * COLS_PER_ROW
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`
          })
          .join(', ')
        const values: any[] = []
        for (const r of chunk) {
          values.push(
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
          )
        }
        const result = await client.query(
          `INSERT INTO references_cited
           (source_publication_id, cited_title, cited_authors, cited_year, cited_doi, cited_journal, raw_citation,
            target_publication_id, target_dataset_id, link_type, match_method, match_confidence, extraction_source)
           VALUES ${placeholders}
           ON CONFLICT DO NOTHING`,
          values,
        )
        totalInserted += result.rowCount || 0
      }
      await client.query('COMMIT')
    } catch (err: any) {
      await client.query('ROLLBACK')
      console.error(`    Error syncing refs for local pub ${localSourceId}: ${err.message?.slice(0, 100)}`)
    } finally {
      client.release()
    }

    processed++
    if (processed % 100 === 0 || processed === sources.length) {
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

  // Pre-flight snapshot: record Neon row counts before any changes
  // This enables post-sync validation and rollback detection
  const preflightCounts = new Map<string, number>()
  const allTables = [
    ...Object.values(COLLECTIONS).map((c) => c.table),
    ...Object.values(ENTITY_COLLECTIONS).map((c) => c.table),
    'neighborhoods', 'neighborhood_members',
    'entity_mentions', 'entity_candidates', 'code_repositories', 'data_repositories', 'content_chunks', 'references_cited',
    'authors_rels', 'datasets_rels', 'projects_rels', 'datasets_creators',
  ]
  for (const table of [...new Set(allTables)]) {
    try {
      const { rows: [{ n }] } = await neonDb.query(`SELECT count(*)::int as n FROM ${table}`)
      preflightCounts.set(table, n)
    } catch { /* table may not exist */ }
  }
  console.log(`Pre-flight: ${preflightCounts.size} tables snapshotted on Neon`)

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

  // Sync entity collections if requested (row-by-row upsert for species/places/protocols/concepts)
  if (syncEntities && (direction === 'push' || direction === 'both')) {
    console.log('\n--- Entity Collections (push) ---')
    for (const [collName, config] of Object.entries(ENTITY_COLLECTIONS)) {
      if (collectionFilter !== 'all' && collectionFilter !== collName) continue
      console.log(`\n--- ${collName} ---`)
      const stats = await pushCollection(localDb, neonDb, collName, config, null) // always full push for entities
      console.log(`    ${stats.pushed} pushed, ${stats.skipped} skipped, ${stats.conflicts} conflicts`)
      // Reset sequence to max ID to prevent future PK conflicts
      if (!dryRun && stats.pushed > 0) {
        try {
          await neonDb.query(`SELECT setval('${config.table}_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ${config.table}))`)
        } catch { /* sequence may not exist */ }
      }
    }

    // Bulk sync for entity_mentions, entity_candidates, etc.
    console.log('\n--- Bulk Entity Tables ---')
    await syncEntityBulkTables(localDb, neonDb)
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
  if (syncEntities) {
    for (const [collName, config] of Object.entries(ENTITY_COLLECTIONS)) {
      const { rows: [local] } = await localDb.query(`SELECT count(*)::int as n FROM ${config.table}`)
      const { rows: [neon] } = await neonDb.query(`SELECT count(*)::int as n FROM ${config.table}`)
      const diff = local.n - neon.n
      const marker = diff === 0 ? '✓' : '✗'
      console.log(`  ${marker} ${collName.padEnd(18)} local: ${String(local.n).padStart(7)}  neon: ${String(neon.n).padStart(7)}${diff !== 0 ? `  (${diff > 0 ? '+' : ''}${diff})` : ''}`)
    }
    for (const bulk of ['neighborhoods', 'neighborhood_members', 'entity_mentions', 'entity_candidates', 'code_repositories', 'data_repositories', 'content_chunks']) {
      const { rows: [local] } = await localDb.query(`SELECT count(*)::int as n FROM ${bulk}`)
      const { rows: [neon] } = await neonDb.query(`SELECT count(*)::int as n FROM ${bulk}`)
      const diff = local.n - neon.n
      const marker = diff === 0 ? '✓' : '✗'
      console.log(`  ${marker} ${bulk.padEnd(18)} local: ${String(local.n).padStart(7)}  neon: ${String(neon.n).padStart(7)}${diff !== 0 ? `  (${diff > 0 ? '+' : ''}${diff})` : ''}`)
    }
  }

  // Post-sync safety check: verify no table lost >50% of its rows unexpectedly
  if (!dryRun) {
    console.log('\n========== Post-Sync Safety Check ==========')
    let warnings = 0
    for (const [table, priorCount] of preflightCounts) {
      if (priorCount === 0) continue
      try {
        const { rows: [{ n: currentCount }] } = await neonDb.query(`SELECT count(*)::int as n FROM ${table}`)
        if (currentCount < priorCount * 0.5) {
          console.log(`  ⚠ WARNING: ${table} dropped from ${priorCount} to ${currentCount} rows!`)
          warnings++
        }
      } catch { /* skip */ }
    }
    if (warnings === 0) console.log('  All tables healthy.')
    else console.log(`  ${warnings} table(s) may need attention.`)
  }

  await localDb.end()
  await neonDb.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
