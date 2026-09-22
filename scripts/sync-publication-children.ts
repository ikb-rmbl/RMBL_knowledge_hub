/**
 * Sync the Payload child tables `publications_authors` and
 * `publications_keywords` from local to Neon.
 *
 * Why this exists: neither sync path covers these tables. `sync-databases.ts`
 * walks per-collection column lists on the parent row only, and
 * `sync-bulk-to-neon.ts` covers the custom SQL tables (neighborhoods,
 * entity_mentions, frontiers, ...). So the only things that ever populated
 * them on Neon were `load-to-payload.ts` runs and full restores — and they
 * have drifted apart (2026-09-22: Neon missing author rows for ~419
 * publications and keyword rows for ~399).
 *
 * That drift was invisible until author names and keywords entered
 * `publications.search_vector` and the Advanced Search Author/Keyword fields
 * started querying these tables directly.
 *
 * Safety:
 *  - Publications are matched by id AND title hash; an id whose title differs
 *    across the two databases is skipped and reported, never overwritten.
 *  - Neither `authors` nor `keywords` is in the publications curatable
 *    allowlist (src/collections/shared/curatableFields.ts), so a replace
 *    can't discard a tracked admin curation.
 *  - Per-publication replace (DELETE + INSERT) only for publications whose
 *    child rows actually differ; untouched parents are left alone.
 *  - The AFTER triggers from z-2026-09-22-01 rebuild each touched
 *    publication's search_vector automatically.
 *
 * Usage:
 *   npx tsx scripts/sync-publication-children.ts --dry-run
 *   npx tsx scripts/sync-publication-children.ts --target=neon
 */

import pg from 'pg'
import './lib/config.js' // loads .env

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] || 'neon'

const LOCAL_URL = process.env.DATABASE_URL
const NEON_URL = process.env.NEON_DIRECT_URL

if (target !== 'neon') {
  console.error(`Unsupported target "${target}" — this script only pushes local -> neon.`)
  process.exit(1)
}
if (!LOCAL_URL || !NEON_URL) {
  console.error('Both DATABASE_URL and NEON_DIRECT_URL must be set in .env.')
  process.exit(1)
}

type ChildTable = 'publications_authors' | 'publications_keywords'

const COLUMNS: Record<ChildTable, string[]> = {
  publications_authors: ['_order', '_parent_id', 'id', 'given', 'family', 'orcid'],
  publications_keywords: ['_order', '_parent_id', 'id', 'keyword'],
}

/** Order-sensitive signature of one publication's child rows, so we only
 *  rewrite parents that actually differ. */
function signature(rows: any[], cols: string[]): string {
  return rows.map((r) => cols.map((c) => String(r[c] ?? '')).join('\u0001')).join('\u0002')
}

function groupByParent(rows: any[]): Map<number, any[]> {
  const m = new Map<number, any[]>()
  for (const r of rows) {
    if (!m.has(r._parent_id)) m.set(r._parent_id, [])
    m.get(r._parent_id)!.push(r)
  }
  return m
}

async function syncTable(
  local: pg.Pool,
  neon: pg.Pool,
  table: ChildTable,
  eligible: Set<number>,
): Promise<void> {
  const cols = COLUMNS[table]
  const colList = cols.map((c) => `"${c}"`).join(', ')

  const [{ rows: localRows }, { rows: neonRows }] = await Promise.all([
    local.query(`SELECT ${colList} FROM ${table} ORDER BY _parent_id, _order`),
    neon.query(`SELECT ${colList} FROM ${table} ORDER BY _parent_id, _order`),
  ])

  const localByParent = groupByParent(localRows)
  const neonByParent = groupByParent(neonRows)

  const toReplace: number[] = []
  for (const [parentId, rows] of localByParent) {
    if (!eligible.has(parentId)) continue
    const existing = neonByParent.get(parentId) || []
    if (signature(rows, cols) !== signature(existing, cols)) toReplace.push(parentId)
  }

  // Parents that exist on Neon with rows but have none locally are left
  // alone: that's more likely local data loss than an intended deletion.
  const orphanedOnNeon = [...neonByParent.keys()].filter(
    (id) => eligible.has(id) && !localByParent.has(id),
  )

  console.log(`\n${table}`)
  console.log(`  local rows: ${localRows.length}   neon rows: ${neonRows.length}`)
  console.log(`  publications to replace: ${toReplace.length}`)
  console.log(`  neon-only parents left untouched: ${orphanedOnNeon.length}`)

  if (toReplace.length === 0 || dryRun) return

  let done = 0
  const BATCH = 100
  for (let i = 0; i < toReplace.length; i += BATCH) {
    const batch = toReplace.slice(i, i + BATCH)
    const client = await neon.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM ${table} WHERE _parent_id = ANY($1)`, [batch])

      const values: any[] = []
      const tuples: string[] = []
      for (const parentId of batch) {
        for (const r of localByParent.get(parentId)!) {
          const placeholders = cols.map((_, k) => `$${values.length + k + 1}`)
          tuples.push(`(${placeholders.join(', ')})`)
          values.push(...cols.map((c) => r[c] ?? null))
        }
      }
      if (tuples.length > 0) {
        await client.query(
          `INSERT INTO ${table} (${colList}) VALUES ${tuples.join(', ')}`,
          values,
        )
      }
      await client.query('COMMIT')
      done += batch.length
      process.stdout.write(`\r  replaced ${done}/${toReplace.length} publications`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  console.log('')
}

async function main() {
  console.log('Publication child-table sync (local -> Neon)')
  if (dryRun) console.log('(DRY RUN — no writes)')

  const local = new pg.Pool({ connectionString: LOCAL_URL })
  const neon = new pg.Pool({ connectionString: NEON_URL })

  try {
    // Only touch publications that exist on BOTH sides with the same title.
    const [{ rows: localPubs }, { rows: neonPubs }] = await Promise.all([
      local.query(`SELECT id, md5(title) AS h FROM publications`),
      neon.query(`SELECT id, md5(title) AS h FROM publications`),
    ])
    const neonMap = new Map<number, string>(neonPubs.map((r: any) => [r.id, r.h]))

    const eligible = new Set<number>()
    const mismatched: number[] = []
    let localOnly = 0
    for (const r of localPubs as any[]) {
      const h = neonMap.get(r.id)
      if (h === undefined) { localOnly++; continue }
      if (h !== r.h) { mismatched.push(r.id); continue }
      eligible.add(r.id)
    }

    console.log(`\n  publications  local: ${localPubs.length}  neon: ${neonPubs.length}`)
    console.log(`  eligible (same id + title): ${eligible.size}`)
    console.log(`  local-only (not yet on Neon, skipped): ${localOnly}`)
    console.log(`  id present both sides but title differs (skipped): ${mismatched.length}`)
    if (mismatched.length > 0) {
      console.log(`    ids: ${mismatched.slice(0, 20).join(', ')}${mismatched.length > 20 ? ' ...' : ''}`)
    }

    await syncTable(local, neon, 'publications_authors', eligible)
    await syncTable(local, neon, 'publications_keywords', eligible)

    if (!dryRun) {
      const { rows: [check] } = await neon.query(
        `SELECT count(*)::int AS n FROM publications WHERE search_vector IS NULL`,
      )
      console.log(`\n  neon publications with NULL search_vector: ${check.n}`)
    }
    console.log(dryRun ? '\nDry run complete.' : '\nSync complete.')
  } finally {
    await local.end()
    await neon.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
