/**
 * Repair content_flags rows whose `item_id` references a record that no
 * longer exists. Surfaces when a canonical table gets rebuilt (most
 * recently: link-species-places.ts wiped + reinserted the species table
 * during the entity-pipeline work in PR #75, which shifted all canonical
 * species IDs). See GitHub issue #81.
 *
 * Strategy: match the flag's preserved `item_title` against the current
 * canonical record (exact name → common-name → synonym → trigram-fuzzy).
 * Reports the proposed mapping; commits with `--apply`.
 *
 * Defaults to Neon (content_flags is admin-side, lives on Neon). Override
 * with --target=local.
 *
 *   npx tsx scripts/fix-orphan-flag-links.ts                # report only
 *   npx tsx scripts/fix-orphan-flag-links.ts --apply
 *   npx tsx scripts/fix-orphan-flag-links.ts --target=local --apply
 *   npx tsx scripts/fix-orphan-flag-links.ts --collection=species
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'neon'
const collFilter = args.find(a => a.startsWith('--collection='))?.split('=')[1] || ''

interface MatchResult {
  newId: number | null
  method: string
  candidate: string | null
}

const TABLES: Record<string, { table: string; name: string; commonNames?: string; synonyms?: string }> = {
  species:       { table: 'species',       name: 'canonical_name', commonNames: 'common_names', synonyms: 'synonyms' },
  authors:       { table: 'authors',       name: 'display_name' },
  documents:     { table: 'documents',     name: 'title' },
  publications:  { table: 'publications',  name: 'title' },
  neighborhoods: { table: 'neighborhoods', name: 'title' },
  protocols:     { table: 'protocols',     name: 'name' },
  places:        { table: 'places',        name: 'name',           commonNames: 'aliases' },
  concepts:      { table: 'concepts',      name: 'name',           commonNames: 'aliases' },
  stakeholders:  { table: 'stakeholders',  name: 'name',           commonNames: 'aliases' },
  datasets:      { table: 'datasets',      name: 'title' },
}

async function findMatch(db: pg.Pool, collection: string, itemTitle: string): Promise<MatchResult> {
  const cfg = TABLES[collection]
  if (!cfg) return { newId: null, method: 'unsupported-collection', candidate: null }
  const title = itemTitle.trim()
  if (!title) return { newId: null, method: 'no-item-title', candidate: null }

  // 1. Exact canonical/title/name match
  const { rows: exact } = await db.query(
    `SELECT id, ${cfg.name} AS name FROM ${cfg.table} WHERE lower(${cfg.name}) = lower($1) LIMIT 2`,
    [title],
  )
  if (exact.length === 1) return { newId: exact[0].id, method: 'exact-name', candidate: exact[0].name }
  if (exact.length > 1)  return { newId: null, method: 'ambiguous-exact', candidate: exact.map(r => `#${r.id} ${r.name}`).join(' | ') }

  // 2. Exact match against common_names / aliases array
  if (cfg.commonNames) {
    const { rows: cn } = await db.query(
      `SELECT id, ${cfg.name} AS name FROM ${cfg.table}
        WHERE EXISTS (SELECT 1 FROM unnest(${cfg.commonNames}) AS x WHERE lower(x) = lower($1))
        LIMIT 2`,
      [title],
    )
    if (cn.length === 1) return { newId: cn[0].id, method: 'exact-common-name', candidate: cn[0].name }
    if (cn.length > 1)  return { newId: null, method: 'ambiguous-common-name', candidate: cn.map(r => `#${r.id} ${r.name}`).join(' | ') }
  }

  // 3. Exact match against synonyms array (species-only)
  if (cfg.synonyms) {
    const { rows: sn } = await db.query(
      `SELECT id, ${cfg.name} AS name FROM ${cfg.table}
        WHERE EXISTS (SELECT 1 FROM unnest(${cfg.synonyms}) AS x WHERE lower(x) = lower($1))
        LIMIT 2`,
      [title],
    )
    if (sn.length === 1) return { newId: sn[0].id, method: 'exact-synonym', candidate: sn[0].name }
    if (sn.length > 1)  return { newId: null, method: 'ambiguous-synonym', candidate: sn.map(r => `#${r.id} ${r.name}`).join(' | ') }
  }

  // 4. ILIKE fallback — substring match either direction. Conservative:
  // only commits if exactly one row matches. (Skipping pg_trgm because
  // Neon doesn't have the extension enabled by default.)
  const { rows: ilike } = await db.query(
    `SELECT id, ${cfg.name} AS name FROM ${cfg.table}
      WHERE ${cfg.name} ILIKE $1 OR $2 ILIKE '%' || ${cfg.name} || '%'
      LIMIT 3`,
    [`%${title}%`, title],
  )
  if (ilike.length === 1) return { newId: ilike[0].id, method: 'ilike-substr', candidate: ilike[0].name }
  if (ilike.length > 1)  return { newId: null, method: 'ambiguous-ilike', candidate: ilike.map(r => `#${r.id} ${r.name}`).join(' | ') }
  return { newId: null, method: 'no-match', candidate: null }
}

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) { console.error(`Target ${target} has no URL`); process.exit(1) }
  const db = new pg.Pool({
    connectionString: url,
    ssl: target === 'neon' ? { rejectUnauthorized: false } : undefined,
  })

  console.log(`Fix orphan flag links — target=${target}, apply=${apply}, collection=${collFilter || '(all)'}`)
  console.log('')

  let where = `item_id IS NOT NULL`
  if (collFilter) where += ` AND collection = '${collFilter.replace(/'/g, "''")}'`
  // Find flags whose item_id no longer resolves in the appropriate table.
  // Easiest: pull all flags + check each in the loop, since cross-table FK
  // checks are awkward in a single SQL.
  const { rows: flags } = await db.query<{
    id: number; collection: string; item_id: number; item_title: string | null; status: string
  }>(
    `SELECT id, collection, item_id, item_title, status FROM content_flags
      WHERE ${where} ORDER BY id`,
  )

  const summary = { total: flags.length, intact: 0, broken: 0, repaired: 0, unmatched: 0, ambiguous: 0 }
  const repairs: Array<{ flagId: number; collection: string; oldId: number; newId: number; method: string; title: string }> = []
  const unresolved: Array<{ flagId: number; collection: string; oldId: number; title: string; method: string; candidate: string | null }> = []

  for (const f of flags) {
    const cfg = TABLES[f.collection]
    if (!cfg) continue
    const { rows: [exist] } = await db.query<{ id: number }>(
      `SELECT id FROM ${cfg.table} WHERE id = $1`, [f.item_id],
    )
    if (exist) { summary.intact++; continue }
    summary.broken++
    const m = await findMatch(db, f.collection, f.item_title || '')
    if (m.newId != null) {
      summary.repaired++
      repairs.push({ flagId: f.id, collection: f.collection, oldId: f.item_id, newId: m.newId, method: m.method, title: f.item_title || '' })
    } else {
      if (m.method.startsWith('ambiguous')) summary.ambiguous++; else summary.unmatched++
      unresolved.push({ flagId: f.id, collection: f.collection, oldId: f.item_id, title: f.item_title || '', method: m.method, candidate: m.candidate })
    }
  }

  console.log('--- Repairs proposed ---')
  for (const r of repairs) {
    console.log(`  flag #${r.flagId} [${r.collection}] id=${r.oldId} → ${r.newId}  (${r.method})`)
    console.log(`     "${r.title.slice(0, 70)}"`)
  }
  console.log('')
  console.log('--- Unresolved ---')
  for (const u of unresolved) {
    console.log(`  flag #${u.flagId} [${u.collection}] id=${u.oldId}  (${u.method})`)
    console.log(`     flagged: "${u.title.slice(0, 70)}"`)
    if (u.candidate) console.log(`     near:     ${u.candidate.slice(0, 90)}`)
  }
  console.log('')
  console.log(`Total ${summary.total}  intact=${summary.intact}  broken=${summary.broken}  repairable=${summary.repaired}  ambiguous=${summary.ambiguous}  unmatched=${summary.unmatched}`)

  if (apply && repairs.length > 0) {
    console.log('')
    console.log('Applying...')
    for (const r of repairs) {
      await db.query('UPDATE content_flags SET item_id = $1, updated_at = now() WHERE id = $2', [r.newId, r.flagId])
    }
    console.log(`  ✓ ${repairs.length} flag(s) re-pointed`)
  } else if (!apply) {
    console.log('')
    console.log('(dry-run — re-run with --apply to commit)')
  }
  await db.end()
}
main().catch(e => { console.error(e); process.exit(1) })
