/**
 * Resolve unresolved species/place candidates to EXISTING entities — the
 * additive replacement for link-species-places.ts.
 *
 * link-species-places.ts deletes every species/place and all their mentions,
 * then rebuilds from UNRESOLVED candidates only (the bug fixed for
 * concepts/protocols in #118, never fixed there) — running it would wipe the
 * registry and reassign every id. This script only adds: it matches each
 * unresolved candidate by exact name/alias (lib/entity-name-match: canonical →
 * scientific → common names for species; ambiguous common names skipped), sets
 * resolved_entity_id, and inserts entity_mentions with
 * extraction_method='cand_resolve'. No entity is created, deleted or
 * renumbered; unmatched candidates stay unresolved for a later deliberate pass.
 *
 * Stories are skipped — load-story-extractions.ts owns story candidates (and
 * replaces them on every run).
 *
 * Reversible: DELETE FROM entity_mentions WHERE extraction_method = 'cand_resolve'
 * (and reset resolved_entity_id for the candidates listed in the run report).
 *
 * Usage:
 *   npx tsx scripts/resolve-candidates-additive.ts [--type=species|place] [--dry-run] [--place-aliases]
 *
 * Local only: Neon receives the mentions through sync-bulk-to-neon
 * --only=entity_mentions after sync-replace-entities (raw-copied ids).
 */

import pg from 'pg'
import './lib/config.js'
import { buildResolvers, resolveSpeciesRef, type EntityType } from './lib/entity-name-match.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyType = args.find((a) => a.startsWith('--type='))?.split('=')[1] as EntityType | undefined
const TYPES: EntityType[] = onlyType ? [onlyType] : ['species', 'place']
// Place aliases from the April clustering include wrong merges ("Arkansas" is an alias
// of Kansas, "Mt. Crested Butte" of Crested Butte), so places resolve by primary name
// unless --place-aliases. Species common names are guarded by resolveSpeciesRef.
const placeAliases = args.includes('--place-aliases')
if (TYPES.some((t) => t !== 'species' && t !== 'place')) throw new Error('--type must be species or place')

interface Cand { id: number; entity_type: EntityType; raw_name: string; raw_attributes: any; source_collection: string; source_item_id: number }

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  console.log(`Target: local${dryRun ? ' (dry-run)' : ''} — types: ${TYPES.join(', ')}`)
  try {
    const resolve = {
      ...(TYPES.includes('species') ? await buildResolvers(db, ['species']) : {}),
      ...(TYPES.includes('place') ? await buildResolvers(db, ['place'], { aliases: placeAliases }) : {}),
    }
    const { rows } = await db.query<Cand>(
      `SELECT id, entity_type, raw_name, raw_attributes, source_collection, source_item_id
         FROM entity_candidates
        WHERE entity_type = ANY($1) AND resolved_entity_id IS NULL AND source_collection <> 'stories'`,
      [TYPES],
    )
    const hits: { candId: number; type: EntityType; entityId: number; collection: string; itemId: number; role: string }[] = []
    const tally = new Map<string, { total: number; resolved: number }>()
    for (const c of rows) {
      const a = c.raw_attributes ?? {}
      const id = c.entity_type === 'species'
        // Extractors sometimes put a common name in scientificName ("switchgrass"),
        // so every name field goes through all species tiers.
        ? resolveSpeciesRef(resolve.species!, a, c.raw_name)
        : resolve.place!(c.raw_name) ?? resolve.place!(a.name)
      const k = `${c.entity_type}/${c.source_collection}`
      const t = tally.get(k) ?? { total: 0, resolved: 0 }
      t.total++
      if (id != null) {
        t.resolved++
        hits.push({ candId: c.id, type: c.entity_type, entityId: id, collection: c.source_collection, itemId: c.source_item_id, role: String(a.role || 'mentioned').slice(0, 30) })
      }
      tally.set(k, t)
    }
    for (const [k, t] of [...tally].sort()) console.log(`  ${k.padEnd(24)} ${t.resolved}/${t.total} unresolved candidates now match (${Math.round((100 * t.resolved) / t.total)}%)`)
    const newMentions = new Set(hits.map((h) => `${h.type}|${h.entityId}|${h.collection}|${h.itemId}|${h.role}`)).size
    console.log(`  → ${hits.length} candidates to resolve, up to ${newMentions} distinct mentions (existing ones are kept, not duplicated)`)
    if (dryRun) { console.log('\n[dry-run] nothing written.'); return }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const CHUNK = 5000
      let inserted = 0
      for (let i = 0; i < hits.length; i += CHUNK) {
        const part = hits.slice(i, i + CHUNK)
        await client.query(
          `UPDATE entity_candidates c SET resolved_entity_id = x.e
             FROM unnest($1::int[], $2::int[]) AS x(id, e)
            WHERE c.id = x.id AND c.resolved_entity_id IS NULL`,
          [part.map((h) => h.candId), part.map((h) => h.entityId)],
        )
        const res = await client.query(
          `INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
           SELECT t, e, c, i, r, 0.8, 'cand_resolve'
             FROM unnest($1::text[], $2::int[], $3::text[], $4::int[], $5::text[]) AS x(t, e, c, i, r)
           ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING`,
          [part.map((h) => h.type), part.map((h) => h.entityId), part.map((h) => h.collection), part.map((h) => h.itemId), part.map((h) => h.role)],
        )
        inserted += res.rowCount ?? 0
      }
      await client.query('COMMIT')
      console.log(`\nResolved ${hits.length} candidates; inserted ${inserted} new mentions (extraction_method='cand_resolve').`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
