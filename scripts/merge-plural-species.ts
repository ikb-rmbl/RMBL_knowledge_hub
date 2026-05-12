/**
 * Merge fragmented species rows where one canonical_name is the plural of
 * another (or differs only by a trailing 's' and case). The pair-finding
 * audit query missed these initially — see project memory for context.
 *
 * For each pair:
 *  - The row with more mentions becomes the canonical.
 *  - Re-point entity_mentions from the fragment to the canonical, deleting
 *    rows that would violate the (entity_type, entity_id, collection,
 *    item_id, role) unique index.
 *  - Fold common_names and synonyms (and the fragment's canonical_name)
 *    into the canonical's lists.
 *  - Delete the fragment.
 *  - Recompute mention_count and publication_count on the canonical.
 *
 * Idempotent: re-running is a no-op once all pairs collapse.
 *
 * Usage:
 *   npx tsx scripts/merge-plural-species.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  // Find pairs. Use trim(trailing 's') equality (case-insensitive) to detect
  // plural/singular collisions. length >= 4 on the singular form avoids
  // matching short generic terms like "elk" / "elks".
  const { rows: pairs } = await db.query(`
    SELECT
      CASE WHEN a.mention_count >= b.mention_count THEN a.id ELSE b.id END AS keep_id,
      CASE WHEN a.mention_count >= b.mention_count THEN b.id ELSE a.id END AS drop_id,
      CASE WHEN a.mention_count >= b.mention_count THEN a.canonical_name ELSE b.canonical_name END AS keep_name,
      CASE WHEN a.mention_count >= b.mention_count THEN b.canonical_name ELSE a.canonical_name END AS drop_name,
      a.mention_count AS a_mc, b.mention_count AS b_mc
    FROM species a JOIN species b ON a.id < b.id
    WHERE lower(trim(trailing 's' FROM a.canonical_name)) = lower(trim(trailing 's' FROM b.canonical_name))
      AND a.canonical_name <> b.canonical_name
      AND length(trim(trailing 's' FROM a.canonical_name)) >= 4
    ORDER BY (a.mention_count + b.mention_count) DESC
  `)

  console.log(`Found ${pairs.length} plural/singular species pairs`)
  if (dryRun) console.log('(DRY RUN — no changes will be written)')

  let merged = 0

  for (const p of pairs) {
    console.log(`  [${p.keep_name}] ← [${p.drop_name}] (${p.a_mc}/${p.b_mc} mentions)`)
    if (dryRun) continue

    await db.query('BEGIN')
    try {
      // 1. Remove mentions from the fragment that would collide with existing
      //    canonical mentions on the same (collection, item_id, role).
      await db.query(`
        DELETE FROM entity_mentions src
        WHERE src.entity_type = 'species' AND src.entity_id = $1
          AND EXISTS (
            SELECT 1 FROM entity_mentions dst
            WHERE dst.entity_type = 'species' AND dst.entity_id = $2
              AND dst.collection = src.collection
              AND dst.item_id = src.item_id
              AND dst.role IS NOT DISTINCT FROM src.role
          )
      `, [p.drop_id, p.keep_id])

      // 2. Re-point the rest of the fragment's mentions.
      await db.query(`
        UPDATE entity_mentions SET entity_id = $1
        WHERE entity_type = 'species' AND entity_id = $2
      `, [p.keep_id, p.drop_id])

      // 3. Fold common_names + synonyms; add the fragment's canonical_name as
      //    a synonym on the canonical so future search/backfill still finds it.
      await db.query(`
        UPDATE species SET
          common_names = (
            SELECT array_agg(DISTINCT cn) FROM (
              SELECT unnest(coalesce(common_names, ARRAY[]::text[])) AS cn FROM species WHERE id IN ($1, $2)
            ) m WHERE cn IS NOT NULL AND cn <> ''
          ),
          synonyms = (
            SELECT array_agg(DISTINCT s) FROM (
              SELECT unnest(coalesce(synonyms, ARRAY[]::text[])) AS s FROM species WHERE id IN ($1, $2)
              UNION SELECT canonical_name FROM species WHERE id = $2
            ) m WHERE s IS NOT NULL AND s <> ''
          )
        WHERE id = $1
      `, [p.keep_id, p.drop_id])

      // 4. Delete the fragment row.
      await db.query('DELETE FROM species WHERE id = $1', [p.drop_id])

      // 5. Recompute counts on the canonical.
      await db.query(`
        UPDATE species s SET
          mention_count = (SELECT count(*)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id),
          publication_count = (SELECT count(DISTINCT item_id)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id AND collection = 'publications')
        WHERE s.id = $1
      `, [p.keep_id])

      await db.query('COMMIT')
      merged++
    } catch (err) {
      await db.query('ROLLBACK')
      console.error(`    FAILED: ${(err as Error).message}`)
    }
  }

  console.log('')
  console.log(`==== Summary ====`)
  console.log(`  Pairs found:  ${pairs.length}`)
  console.log(`  Pairs merged: ${merged}`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
