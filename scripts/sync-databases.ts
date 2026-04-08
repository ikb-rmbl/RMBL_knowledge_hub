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
import { titleSimilarity } from './lib/doi-utils.js'

const args = process.argv.slice(2)
const direction = args.find((a) => a.startsWith('--direction='))?.split('=')[1] || 'both'
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1]
const dryRun = args.includes('--dry-run')
const verbose = args.includes('--verbose')

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

// ---------------------------------------------------------------------------
// Record matching functions
// ---------------------------------------------------------------------------

// Pre-built index for O(1) lookups instead of O(N) linear scans
interface MatchIndex {
  byDoi: Map<string, any>
  bySourceUrl: Map<string, any>
  byOrcid: Map<string, any>
  byName: Map<string, any>
  byFamilyGiven: Map<string, any>
  all: any[]
}

function buildMatchIndex(candidates: any[]): MatchIndex {
  const byDoi = new Map<string, any>()
  const bySourceUrl = new Map<string, any>()
  const byOrcid = new Map<string, any>()
  const byName = new Map<string, any>()
  const byFamilyGiven = new Map<string, any>()

  for (const c of candidates) {
    if (c.doi) byDoi.set(c.doi.toLowerCase(), c)
    if (c.source_url) bySourceUrl.set(c.source_url, c)
    if (c.orcid) byOrcid.set(c.orcid, c)
    if (c.name) byName.set(c.name.toLowerCase(), c)
    if (c.family_name) {
      const key = `${c.family_name.toLowerCase()}|${(c.given_name || '').toLowerCase()}`
      byFamilyGiven.set(key, c)
    }
  }

  return { byDoi, bySourceUrl, byOrcid, byName, byFamilyGiven, all: candidates }
}

function matchPublication(record: any, _candidates: any[], index?: MatchIndex): { match: any | null; confidence: string } {
  const idx = index!
  // Tier 1: DOI exact match (O(1))
  if (record.doi) {
    const doiMatch = idx.byDoi.get(record.doi.toLowerCase())
    if (doiMatch) return { match: doiMatch, confidence: 'exact' }
  }

  // Tier 2: Title + year (must scan, but only for non-DOI matches)
  if (record.title) {
    let bestMatch: any = null
    let bestScore = 0
    for (const c of idx.all) {
      if (!c.title) continue
      const yearClose = !record.year || !c.year || Math.abs(record.year - c.year) <= 1
      if (!yearClose) continue
      const sim = titleSimilarity(record.title, c.title)
      if (sim > 0.9 && sim > bestScore) {
        bestMatch = c
        bestScore = sim
      }
    }
    if (bestMatch) return { match: bestMatch, confidence: bestScore > 0.95 ? 'high' : 'fuzzy' }

    // Tier 3: Title only, very high threshold
    for (const c of idx.all) {
      if (!c.title) continue
      const sim = titleSimilarity(record.title, c.title)
      if (sim > 0.95) return { match: c, confidence: 'fuzzy' }
    }
  }

  return { match: null, confidence: 'none' }
}

function matchDataset(record: any, _candidates: any[], index?: MatchIndex): { match: any | null; confidence: string } {
  const idx = index!
  if (record.doi) {
    const doiMatch = idx.byDoi.get(record.doi.toLowerCase())
    if (doiMatch) return { match: doiMatch, confidence: 'exact' }
  }
  if (record.title) {
    for (const c of idx.all) {
      if (c.title && titleSimilarity(record.title, c.title) > 0.9) {
        return { match: c, confidence: 'high' }
      }
    }
  }
  return { match: null, confidence: 'none' }
}

function matchDocument(record: any, _candidates: any[], index?: MatchIndex): { match: any | null; confidence: string } {
  const idx = index!
  if (record.source_url) {
    const urlMatch = idx.bySourceUrl.get(record.source_url)
    if (urlMatch) return { match: urlMatch, confidence: 'exact' }
  }
  if (record.title) {
    for (const c of idx.all) {
      if (c.title && titleSimilarity(record.title, c.title) > 0.9) {
        return { match: c, confidence: 'high' }
      }
    }
  }
  return { match: null, confidence: 'none' }
}

function matchAuthor(record: any, _candidates: any[], index?: MatchIndex): { match: any | null; confidence: string } {
  const idx = index!
  if (record.orcid) {
    const orcidMatch = idx.byOrcid.get(record.orcid)
    if (orcidMatch) return { match: orcidMatch, confidence: 'exact' }
  }
  if (record.family_name) {
    const key = `${record.family_name.toLowerCase()}|${(record.given_name || '').toLowerCase()}`
    const nameMatch = idx.byFamilyGiven.get(key)
    if (nameMatch) return { match: nameMatch, confidence: 'high' }
  }
  return { match: null, confidence: 'none' }
}

function matchTopic(record: any, _candidates: any[], index?: MatchIndex): { match: any | null; confidence: string } {
  const nameMatch = index!.byName.get(record.name?.toLowerCase())
  return nameMatch ? { match: nameMatch, confidence: 'exact' } : { match: null, confidence: 'none' }
}

function matchProject(record: any, _candidates: any[], index?: MatchIndex): { match: any | null; confidence: string } {
  const nameMatch = index!.byName.get(record.name?.toLowerCase())
  return nameMatch ? { match: nameMatch, confidence: 'exact' } : { match: null, confidence: 'none' }
}

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
  let changed = false

  const source = direction === 'pull' ? remoteRecord : localRecord
  const target = direction === 'pull' ? localRecord : remoteRecord

  for (const field of config.curatedFields) {
    if (direction === 'pull') {
      // Remote wins for curated fields
      merged[field] = remoteRecord[field] ?? localRecord[field]
    } else {
      // Push: only overwrite if remote is null/empty and local has data
      if ((remoteRecord[field] === null || remoteRecord[field] === undefined) && localRecord[field] != null) {
        merged[field] = localRecord[field]
        changed = true
      } else {
        merged[field] = remoteRecord[field]
      }
    }
  }

  for (const field of config.pipelineFields) {
    if (direction === 'push') {
      // Local pipeline data can overwrite remote
      merged[field] = localRecord[field] ?? remoteRecord[field]
    } else {
      // Pull: keep local pipeline data unless remote has it too
      merged[field] = localRecord[field] ?? remoteRecord[field]
    }
  }

  // Check if anything actually changed
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
  // Use parameterized query for since timestamp
  const localChanged = since
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
      // Record exists on Neon — only push if Neon hasn't been curated more recently
      const neonUpdated = new Date(match.updated_at).getTime()
      const localUpdated = new Date(localRec.updated_at).getTime()

      if (localUpdated > neonUpdated) {
        // Local is newer — push, but respect curated fields (only fill nulls)
        const { merged, changed } = mergeRecord(localRec, match, config, 'push')
        if (changed && !dryRun) {
          const fields = [...config.curatedFields, ...config.pipelineFields].filter((f) => merged[f] !== undefined && merged[f] !== match[f])
          if (fields.length > 0) {
            const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
            const values = fields.map((f) => merged[f])
            await neonDb.query(
              `UPDATE ${config.table} SET ${setClause}, updated_at = NOW() WHERE id = $1`,
              [match.id, ...values],
            )
          }
        }
        if (changed) pushed++
        else skipped++
      } else {
        skipped++ // Neon has newer data — don't overwrite
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
    console.log(`  ${marker} ${collName.padEnd(15)} local: ${String(local.n).padStart(6)}  neon: ${String(neon.n).padStart(6)}${diff !== 0 ? `  (${diff > 0 ? '+' : ''}${diff})` : ''}`)
  }

  await localDb.end()
  await neonDb.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
