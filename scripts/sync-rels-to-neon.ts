/**
 * Additive sync of Payload relationship / array-child tables to Neon.
 *
 * sync-databases.ts pushes parent rows only (plus authors_rels document links),
 * so link rows created by pipeline runs — author↔publication links for newly
 * discovered papers, dataset↔paper links (link-dataset-citations,
 * crosslink-datasets), dataset tags and creators, document categories — never
 * reached production; by 2026-10 Neon lagged by ~1,600 author links, ~3,300
 * dataset tags, etc. sync-publication-children covers publications_authors /
 * publications_keywords separately.
 *
 * Row ids are aligned local ↔ Neon for every referenced table (local is the id
 * authority; checked before the 2026-10 push), so a link is identified by its
 * columns other than its own id and ordering. Local links Neon lacks are
 * inserted when their parent and targets exist on Neon; Neon-only links are
 * reported, never deleted (they may be admin edits). One transaction.
 *
 * Usage:
 *   npx tsx scripts/sync-rels-to-neon.ts [--dry-run] [--table=authors_rels,...]
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const only = args.find((a) => a.startsWith('--table='))?.split('=')[1]?.split(',')

interface RelTable {
  table: string
  parentCol: string
  parentTable: string
  /** link columns → the table each references */
  targets: Record<string, string>
  /** extra identifying columns (array-child tables) */
  keyCols?: string[]
  orderCol: string
  /** array-child tables have a varchar id Payload generates — copy it */
  copyId?: boolean
}

const TABLES: RelTable[] = [
  { table: 'authors_rels', parentCol: 'parent_id', parentTable: 'authors', targets: { publications_id: 'publications', datasets_id: 'datasets', documents_id: 'documents' }, orderCol: 'order' },
  { table: 'datasets_rels', parentCol: 'parent_id', parentTable: 'datasets', targets: { publications_id: 'publications', topics_id: 'topics' }, orderCol: 'order' },
  { table: 'documents_rels', parentCol: 'parent_id', parentTable: 'documents', targets: { topics_id: 'topics' }, orderCol: 'order' },
  { table: 'publications_rels', parentCol: 'parent_id', parentTable: 'publications', targets: { topics_id: 'topics' }, orderCol: 'order' },
  { table: 'datasets_creators', parentCol: '_parent_id', parentTable: 'datasets', targets: {}, keyCols: ['name', 'orcid', 'affiliation'], orderCol: '_order', copyId: true },
]

async function main() {
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, max: 2 })
  console.log(`Additive relationship sync to Neon${dryRun ? ' (dry-run)' : ''}`)

  const idCache = new Map<string, Set<number>>()
  const neonIds = async (table: string) => {
    if (!idCache.has(table)) idCache.set(table, new Set((await neon.query(`SELECT id FROM ${table}`)).rows.map((r) => r.id)))
    return idCache.get(table)!
  }

  // Authors that exist on both sides under DIFFERENT ids: sync-databases matched a
  // local author to an old Neon row (one the local merge repairs deleted) by
  // name/ORCID and updated it instead of inserting. Map local → Neon id for
  // those, matching only against Neon-only rows, so their new links still land.
  const authorRemap = new Map<number, number>()
  {
    const norm = (s: string | null) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
    const L = (await local.query(`SELECT id, display_name, orcid FROM authors`)).rows
    const N = (await neon.query(`SELECT id, display_name, orcid FROM authors`)).rows
    const nIds = new Set(N.map((r) => r.id)), lIds = new Set(L.map((r) => r.id))
    const neonOnly = N.filter((r) => !lIds.has(r.id))
    const byOrcid = new Map(neonOnly.filter((r) => r.orcid).map((r) => [r.orcid, r.id]))
    const byName = new Map<string, number[]>()
    for (const r of neonOnly) byName.set(norm(r.display_name), [...(byName.get(norm(r.display_name)) ?? []), r.id])
    for (const r of L.filter((x) => !nIds.has(x.id))) {
      const viaOrcid = r.orcid ? byOrcid.get(r.orcid) : undefined
      const viaName = byName.get(norm(r.display_name))
      const target = viaOrcid ?? (viaName?.length === 1 ? viaName[0] : undefined)
      if (target != null) authorRemap.set(r.id, target)
    }
    if (authorRemap.size) console.log(`  ${authorRemap.size} authors carry a different id on Neon — their links are remapped`)
  }

  const plan: { cfg: RelTable; rows: any[] }[] = []
  try {
    for (const cfg of TABLES.filter((t) => !only || only.includes(t.table))) {
      const keyCols = [cfg.parentCol, ...(cfg.parentCol === 'parent_id' ? ['path'] : []), ...Object.keys(cfg.targets), ...(cfg.keyCols ?? [])]
      const keyOf = (r: any) => JSON.stringify(keyCols.map((c) => r[c] ?? null))
      const localRows = (await local.query(`SELECT * FROM ${cfg.table}`)).rows
      if (cfg.parentTable === 'authors') for (const r of localRows) if (authorRemap.has(r[cfg.parentCol])) r[cfg.parentCol] = authorRemap.get(r[cfg.parentCol])
      const neonKeys = new Set((await neon.query(`SELECT * FROM ${cfg.table}`)).rows.map(keyOf))
      const localKeys = new Set(localRows.map(keyOf))
      const parents = await neonIds(cfg.parentTable)
      const missing = localRows.filter((r) => !neonKeys.has(keyOf(r)))
      const insertable: any[] = []
      let noParent = 0, noTarget = 0
      for (const r of missing) {
        if (!parents.has(r[cfg.parentCol])) { noParent++; continue }
        let ok = true
        for (const [col, tt] of Object.entries(cfg.targets)) if (r[col] != null && !(await neonIds(tt)).has(r[col])) ok = false
        if (!ok) { noTarget++; continue }
        insertable.push(r)
      }
      // dedupe identical local rows (same key twice)
      const seen = new Set<string>()
      const rows = insertable.filter((r) => (seen.has(keyOf(r)) ? false : (seen.add(keyOf(r)), true)))
      const neonOnly = [...neonKeys].filter((k) => !localKeys.has(k)).length
      console.log(`  ${cfg.table.padEnd(18)} local ${String(localRows.length).padStart(6)}  neon ${String(neonKeys.size).padStart(6)}  → insert ${String(rows.length).padStart(5)}` +
        `${noParent ? `, ${noParent} parent missing on Neon` : ''}${noTarget ? `, ${noTarget} target missing` : ''}; ${neonOnly} Neon-only (left alone)`)
      plan.push({ cfg, rows })
    }
    if (dryRun) { console.log('\n[dry-run] nothing written.'); return }

    const tx = await neon.connect()
    try {
      await tx.query('BEGIN')
      for (const { cfg, rows } of plan) {
        if (!rows.length) continue
        const cols = Object.keys(rows[0]).filter((c) => c !== 'id' || cfg.copyId)
        for (const r of rows) {
          await tx.query(
            `INSERT INTO ${cfg.table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
            cols.map((c) => r[c]),
          )
        }
        if (!cfg.copyId) await tx.query(`SELECT setval('${cfg.table}_id_seq', GREATEST((SELECT max(id) FROM ${cfg.table}), (SELECT last_value FROM ${cfg.table}_id_seq)))`)
      }
      await tx.query('COMMIT')
      console.log(`\n  Inserted ${plan.reduce((n, p) => n + p.rows.length, 0)} rows.`)
    } catch (err) {
      await tx.query('ROLLBACK')
      throw err
    } finally {
      tx.release()
    }
  } finally {
    await local.end()
    await neon.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
