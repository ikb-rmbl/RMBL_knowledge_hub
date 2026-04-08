/**
 * Sync local database to Neon production.
 *
 * Three modes:
 *   full    — Full data sync (truncate + restore). Use for major pipeline runs.
 *   safe    — Run enrichment scripts directly against Neon (non-destructive updates).
 *   schema  — Apply SQL migrations to Neon.
 *
 * Requires NEON_DIRECT_URL in .env (the non-pooler connection string).
 *
 * Usage:
 *   npx tsx scripts/sync-to-neon.ts --mode=full      # Full data sync
 *   npx tsx scripts/sync-to-neon.ts --mode=safe       # Run safe enrichments against Neon
 *   npx tsx scripts/sync-to-neon.ts --mode=schema     # Apply SQL migrations
 *   npx tsx scripts/sync-to-neon.ts --mode=verify     # Compare row counts
 *   npx tsx scripts/sync-to-neon.ts --mode=full --dry-run  # Preview only
 */

import { execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import pg from 'pg'
import './lib/config.js' // loads .env

const args = process.argv.slice(2)
const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1] || 'verify'
const dryRun = args.includes('--dry-run')

// Load NEON_DIRECT_URL from environment
const NEON_URL = process.env.NEON_DIRECT_URL
const LOCAL_DB = 'rmbl_knowledge_hub'
const DUMP_DIR = '/tmp'

if (!NEON_URL) {
  console.error('Error: NEON_DIRECT_URL environment variable is required.')
  console.error('Add it to your .env file (the direct/non-pooler Neon connection string).')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Tables in dependency order (parents before children)
// ---------------------------------------------------------------------------

const TABLES_TRUNCATE_ORDER = [
  'projects_rels', 'projects',
  'authors_rels', 'authors',
  'publications_rels', 'publications_keywords', 'publications_authors', 'publications_editors', 'publications_mentors',
  'references_cited', 'content_chunks',
  'publications',
  'datasets_rels', 'datasets',
  'documents_rels', 'documents',
  'topics',
  'payload_locked_documents_rels', 'payload_locked_documents',
  'payload_preferences_rels', 'payload_preferences',
  'payload_migrations',
  'media', 'users',
]

const COUNT_TABLES = [
  'publications', 'datasets', 'documents', 'authors', 'topics',
  'projects', 'references_cited', 'content_chunks', 'users',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, opts?: { silent?: boolean }): string {
  if (!opts?.silent) console.log(`  $ ${cmd.slice(0, 120)}${cmd.length > 120 ? '...' : ''}`)
  if (dryRun) return '(dry run)'
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim()
}

async function getRowCounts(connString: string): Promise<Map<string, number>> {
  const db = new pg.Pool({ connectionString: connString, max: 1, connectionTimeoutMillis: 10000 })
  const counts = new Map<string, number>()
  for (const table of COUNT_TABLES) {
    try {
      const { rows } = await db.query(`SELECT count(*)::int as n FROM ${table}`)
      counts.set(table, rows[0].n)
    } catch {
      counts.set(table, -1)
    }
  }
  await db.end()
  return counts
}

// ---------------------------------------------------------------------------
// Mode: verify — compare row counts
// ---------------------------------------------------------------------------

async function verify() {
  console.log('\nComparing local vs Neon row counts...\n')

  const [local, neon] = await Promise.all([
    getRowCounts(`postgresql://localhost:5432/${LOCAL_DB}`),
    getRowCounts(NEON_URL!),
  ])

  console.log('  Table                Local      Neon       Diff')
  console.log('  ' + '-'.repeat(55))
  let allMatch = true
  for (const table of COUNT_TABLES) {
    const l = local.get(table) ?? -1
    const n = neon.get(table) ?? -1
    const diff = l - n
    const marker = diff === 0 ? '✓' : '✗'
    console.log(`  ${marker} ${table.padEnd(20)} ${String(l).padStart(8)}  ${String(n).padStart(8)}  ${diff !== 0 ? (diff > 0 ? `+${diff}` : String(diff)) : ''}`)
    if (diff !== 0) allMatch = false
  }
  console.log()
  if (allMatch) console.log('  All counts match!')
  else console.log('  Counts differ — consider running --mode=full to sync.')
}

// ---------------------------------------------------------------------------
// Mode: full — truncate Neon + restore from local dump
// ---------------------------------------------------------------------------

async function fullSync() {
  console.log('\n=== Full Data Sync: Local → Neon ===')
  if (dryRun) console.log('(DRY RUN)')

  // Step 1: Export local data
  const dumpFile = `${DUMP_DIR}/rmbl_neon_sync.dump`
  console.log('\nStep 1: Exporting local database...')
  run(`pg_dump --data-only --format=custom ${LOCAL_DB} -f ${dumpFile}`)
  console.log('  Export complete.')

  // Step 2: Drop circular FK constraints on Neon
  console.log('\nStep 2: Dropping circular foreign keys on Neon...')
  if (!dryRun) {
    const db = new pg.Pool({ connectionString: NEON_URL, max: 1 })
    await db.query('ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_parent_id_topics_id_fk')
    await db.query('ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_parent_project_id_fkey')
    await db.end()
  }
  console.log('  Done.')

  // Step 3: Truncate all tables on Neon
  console.log('\nStep 3: Truncating Neon tables...')
  if (!dryRun) {
    const db = new pg.Pool({ connectionString: NEON_URL, max: 1 })
    await db.query(`TRUNCATE TABLE ${TABLES_TRUNCATE_ORDER.join(', ')} CASCADE`)
    await db.end()
  }
  console.log('  Done.')

  // Step 4: Restore data to Neon
  console.log('\nStep 4: Restoring data to Neon (this may take several minutes)...')
  try {
    run(`pg_restore -d "${NEON_URL}" --data-only --no-owner --no-acl ${dumpFile}`, { silent: true })
  } catch {
    // pg_restore returns non-zero on warnings (circular FK ordering), which is OK
    console.log('  Restore complete (some ordering warnings are normal).')
  }

  // Step 5: Reset sequences
  console.log('\nStep 5: Resetting sequences...')
  if (!dryRun) {
    const db = new pg.Pool({ connectionString: NEON_URL, max: 1 })
    const { rows: seqs } = await db.query(`
      SELECT c.relname as table_name, a.attname as column_name
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid
      JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE c.relkind = 'r' AND d.adbin LIKE '%nextval%'
      AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `)
    for (const seq of seqs) {
      try {
        await db.query(`SELECT setval(pg_get_serial_sequence('${seq.table_name}', '${seq.column_name}'), COALESCE((SELECT MAX(${seq.column_name}) FROM ${seq.table_name}), 1))`)
      } catch { /* skip if table is empty */ }
    }
    await db.end()
  }
  console.log('  Done.')

  // Step 6: Re-add circular FK constraints
  console.log('\nStep 6: Re-adding foreign key constraints...')
  if (!dryRun) {
    const db = new pg.Pool({ connectionString: NEON_URL, max: 1 })
    await db.query('ALTER TABLE topics ADD CONSTRAINT topics_parent_id_topics_id_fk FOREIGN KEY (parent_id) REFERENCES topics(id) ON DELETE SET NULL')
    await db.query('ALTER TABLE projects ADD CONSTRAINT projects_parent_project_id_fkey FOREIGN KEY (parent_project_id) REFERENCES projects(id) ON DELETE SET NULL')
    await db.end()
  }
  console.log('  Done.')

  // Step 7: Verify
  console.log('\nStep 7: Verifying...')
  await verify()
}

// ---------------------------------------------------------------------------
// Mode: safe — run non-destructive enrichments directly against Neon
// ---------------------------------------------------------------------------

async function safeEnrich() {
  console.log('\n=== Safe Enrichment: Running directly against Neon ===')
  if (dryRun) console.log('(DRY RUN)')

  const envPrefix = `DATABASE_URL="${NEON_URL}"`
  const scripts = [
    { name: 'Citation counts', cmd: 'npx tsx scripts/fetch-citation-counts.ts --step=all --stale-days=30' },
    { name: 'Embeddings (new items)', cmd: 'npx tsx scripts/generate-embeddings.ts --collection=all --level=summary' },
  ]

  for (const script of scripts) {
    console.log(`\n--- ${script.name} ---`)
    if (dryRun) {
      console.log(`  Would run: ${envPrefix} ${script.cmd}`)
      continue
    }
    try {
      execSync(`${envPrefix} ${script.cmd}`, { stdio: 'inherit', cwd: process.cwd() })
    } catch (err) {
      console.error(`  ${script.name} failed — continuing`)
    }
  }
}

// ---------------------------------------------------------------------------
// Mode: schema — apply SQL migrations to Neon
// ---------------------------------------------------------------------------

async function applySchema() {
  console.log('\n=== Apply SQL Migrations to Neon ===')
  if (dryRun) console.log('(DRY RUN)')

  const sqlDir = `${process.cwd()}/scripts/sql`
  if (!existsSync(sqlDir)) {
    console.log('  No SQL migrations directory found.')
    return
  }

  const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort()
  console.log(`  Found ${files.length} migration files:`)

  for (const file of files) {
    console.log(`\n  --- ${file} ---`)
    if (dryRun) {
      console.log(`  Would run: psql "$NEON_DIRECT_URL" < scripts/sql/${file}`)
      continue
    }
    try {
      run(`psql "${NEON_URL}" < ${sqlDir}/${file}`)
    } catch (err) {
      console.error(`  Warning: ${file} had errors (may be OK if already applied)`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('RMBL Knowledge Hub — Neon Sync')
  console.log('==============================')
  console.log(`Mode: ${mode}`)
  console.log(`Neon: ${NEON_URL!.replace(/:[^@]+@/, ':***@')}`) // mask password
  if (dryRun) console.log('(DRY RUN)')

  switch (mode) {
    case 'verify':
      await verify()
      break
    case 'full':
      await fullSync()
      break
    case 'safe':
      await safeEnrich()
      break
    case 'schema':
      await applySchema()
      break
    default:
      console.error(`Unknown mode: ${mode}. Use: verify, full, safe, or schema`)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
