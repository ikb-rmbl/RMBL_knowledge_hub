/**
 * Copy the legacy rmbl.org rescue to Neon: the rescued documents
 * (provenance.discoveryMethod = 'wayback_rescue'), their topic links, the
 * topics they introduced, tombstones of rescued rows deleted locally, and the
 * species created from the rescued checklists (load-checklists.ts).
 *
 * Why not sync-databases.ts: it doesn't carry documents_rels (topic links),
 * and it walks every collection in both directions. This copies exactly the
 * rescue, keeping LOCAL ids (local is the id authority; species and topic ids
 * are aligned local ↔ Neon, which entity_mentions and checklist_entries rely
 * on). Rows already on Neon (same id) are left alone, so it is safe to re-run.
 *
 * Columns are the intersection of the local and Neon tables, minus generated
 * ones (search_vector is rebuilt by Neon's trigger; embeddings are re-made by
 * generate-embeddings.ts). Afterwards the Neon sequences for these tables are
 * moved to the disjoint ≥100M range if they are below it, so a row created on
 * Neon can never take an id local will push later.
 *
 * Prerequisites on Neon: z-2026-11-12-01-document-provenance.sql (the
 * provenance column). Then: z-2026-11-18-01-checklists.sql +
 * load-checklists.ts --target=neon (creates no species once these are copied).
 *
 * Usage:
 *   npx tsx scripts/push-rescued-documents.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')
const RESCUED = `provenance->>'discoveryMethod' = 'wayback_rescue'`
const NEON_SEQUENCE_FLOOR = 100_000_000

async function columnTypes(db: pg.Pool, table: string): Promise<Map<string, string>> {
  const { rows } = await db.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])
  return new Map(rows.map((r) => [r.column_name, r.data_type]))
}
const columns = async (db: pg.Pool, table: string) => [...(await columnTypes(db, table)).keys()]

/** Copy rows (by query on local) into Neon with their ids; skips ids Neon already has. */
async function copy(local: pg.Pool, neon: pg.PoolClient, table: string, where: string, params: unknown[], skip: string[] = []) {
  const lt = await columnTypes(local, table)
  const nc = new Set(await columns(neon as unknown as pg.Pool, table))
  const cols = [...lt.keys()].filter((c) => nc.has(c) && !skip.includes(c))
  // json/jsonb values (curated_fields is a JSON array) must be serialised;
  // text[] columns (common_names, synonyms) are passed as JS arrays.
  const isJson = (c: string) => lt.get(c) === 'jsonb' || lt.get(c) === 'json'
  const { rows } = await local.query(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table} WHERE ${where}`, params)
  if (!rows.length) return { found: 0, inserted: 0 }
  const { rows: existing } = await neon.query(`SELECT id FROM ${table} WHERE id = ANY($1)`, [rows.map((r) => r.id)])
  const have = new Set(existing.map((r) => r.id))
  const todo = rows.filter((r) => !have.has(r.id))
  if (!dryRun) {
    for (const r of todo) {
      const vals = cols.map((c) => (isJson(c) && r[c] !== null ? JSON.stringify(r[c]) : r[c]))
      await neon.query(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals)
    }
  }
  return { found: rows.length, inserted: todo.length }
}

async function main() {
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const neonPool = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL })
  const neon = await neonPool.connect()
  try {
    if (!(await columns(neonPool, 'documents')).includes('provenance')) {
      throw new Error('Neon documents.provenance is missing — apply scripts/sql/z-2026-11-12-01-document-provenance.sql first')
    }
    console.log(`Pushing the legacy rmbl.org rescue to Neon${dryRun ? ' (dry-run)' : ''}`)
    await neon.query('BEGIN')

    // 1. Topics the rescued documents use that Neon lacks (same id + name).
    const { rows: topicIds } = await local.query(
      `SELECT DISTINCT r.topics_id AS id FROM documents_rels r JOIN documents d ON d.id = r.parent_id
        WHERE d.${RESCUED} AND r.topics_id IS NOT NULL`)
    const { rows: clash } = await neon.query(
      `SELECT n.id, n.name FROM topics n WHERE n.name = ANY($1) AND n.id <> ALL($2)`,
      [(await local.query(`SELECT name FROM topics WHERE id = ANY($1)`, [topicIds.map((t) => t.id)])).rows.map((r) => r.name), topicIds.map((t) => t.id)])
    if (clash.length) throw new Error(`Topic names already on Neon under other ids: ${clash.map((c) => `${c.id} ${c.name}`).join('; ')}`)
    const topics = await copy(local, neon, 'topics', `id = ANY($1)`, [topicIds.map((t) => t.id)])
    console.log(`  topics:     ${topics.inserted} new of ${topics.found} used`)

    // 2. Documents, with local ids.
    const docs = await copy(local, neon, 'documents', RESCUED, [], ['search_vector', 'embedding'])
    console.log(`  documents:  ${docs.inserted} new of ${docs.found}`)

    // 3. Their topic links (documents_rels ids are per-database; let Neon assign).
    const { rows: rels } = await local.query(
      `SELECT r."order", r.parent_id, r.path, r.topics_id FROM documents_rels r JOIN documents d ON d.id = r.parent_id WHERE d.${RESCUED}`)
    let relsNew = 0
    for (const r of rels) {
      const { rowCount } = await neon.query(
        `INSERT INTO documents_rels ("order", parent_id, path, topics_id)
         SELECT $1::int, $2::int, $3::varchar, $4::int
          WHERE NOT EXISTS (SELECT 1 FROM documents_rels WHERE parent_id = $2::int AND path = $3::varchar AND topics_id IS NOT DISTINCT FROM $4::int)
            AND EXISTS (SELECT 1 FROM documents WHERE id = $2::int)`,
        [r.order, r.parent_id, r.path, r.topics_id])
      relsNew += rowCount ?? 0
    }
    console.log(`  topic links: ${relsNew} new of ${rels.length}${dryRun ? ' (dry-run: documents not inserted, so links count as 0)' : ''}`)

    // 4. Tombstones of rescued rows deleted locally (wayback source URLs).
    const { rows: tombs } = await local.query(
      `SELECT collection, keys, notes FROM duplicate_tombstones WHERE collection = 'documents' AND keys->>'source_url' LIKE 'https://web.archive.org/%'`)
    let tombNew = 0
    for (const t of tombs) {
      const { rowCount } = await neon.query(
        `INSERT INTO duplicate_tombstones (collection, keys, notes)
         SELECT $1::varchar, $2::jsonb, $3::text WHERE NOT EXISTS (SELECT 1 FROM duplicate_tombstones WHERE collection = $1::varchar AND keys = $2::jsonb)`,
        [t.collection, JSON.stringify(t.keys), t.notes])
      tombNew += rowCount ?? 0
    }
    console.log(`  tombstones: ${tombNew} new of ${tombs.length}`)

    // 5. Species created from the rescued checklists, with local ids.
    const species = await copy(local, neon, 'species', `external_ids->>'source' = 'rmbl-legacy-checklists'`, [], ['embedding'])
    console.log(`  species:    ${species.inserted} new of ${species.found}`)

    // 6. Keep Neon-created ids out of local's range.
    for (const seq of ['documents_id_seq', 'topics_id_seq', 'species_id_seq']) {
      const { rows: [s] } = await neon.query(`SELECT last_value FROM ${seq}`)
      if (Number(s.last_value) < NEON_SEQUENCE_FLOOR) {
        if (!dryRun) await neon.query(`SELECT setval('${seq}', $1)`, [NEON_SEQUENCE_FLOOR])
        console.log(`  ${seq}: ${s.last_value} → ${NEON_SEQUENCE_FLOOR}`)
      }
    }

    if (dryRun) { await neon.query('ROLLBACK'); return }
    await neon.query('COMMIT')
    const { rows: [n] } = await neon.query(
      `SELECT (SELECT count(*) FROM documents WHERE ${RESCUED})::int AS docs,
              (SELECT count(*) FROM species WHERE external_ids->>'source' = 'rmbl-legacy-checklists')::int AS species`)
    console.log(`Neon now: ${n.docs} rescued documents, ${n.species} checklist species.`)
  } catch (err) {
    await neon.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    neon.release()
    await neonPool.end()
    await local.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
