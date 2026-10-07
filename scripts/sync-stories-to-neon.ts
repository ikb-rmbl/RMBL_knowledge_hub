/**
 * Push local stories that Neon doesn't have yet — new scraper loads and
 * LexisNexis batches — keeping their local ids.
 *
 * No other sync path covers story rows: sync-databases leaves stories out of
 * its collections, and sync-to-neon --mode=full truncates everything. Story ids
 * are aligned local ↔ Neon (local is the id authority), so rows are copied
 * with their ids and Neon's sequence is advanced past them.
 *
 * Refuses to run if any story to push already exists on Neon under another id
 * (same source_url or title) — that means the two sides diverged and needs a
 * look, not an insert. Oral histories (story_type='oral_history') are never
 * pushed: they stay local until release forms are confirmed. Stories that have
 * participants or relationship rows are skipped and listed (none so far).
 *
 * One transaction. Afterwards run load-story-extractions.ts --target=neon
 * (candidates, mentions, story_type) or sync-bulk-to-neon --only=entity_mentions.
 *
 * Usage:
 *   npx tsx scripts/sync-stories-to-neon.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, max: 2 })
  console.log(`Push new stories to Neon${dryRun ? ' (dry-run)' : ''}`)
  try {
    const neonRows = (await neon.query(`SELECT id, coalesce(source_url, '') AS u, lower(title) AS t FROM stories`)).rows
    const neonIds = new Set(neonRows.map((r) => r.id))
    const neonUrls = new Set(neonRows.map((r) => r.u).filter(Boolean))
    const neonTitles = new Set(neonRows.map((r) => r.t))

    const { rows: candidates } = await local.query(
      `SELECT s.*,
              (SELECT count(*)::int FROM stories_participants p WHERE p._parent_id = s.id)
            + (SELECT count(*)::int FROM stories_rels r WHERE r.parent_id = s.id) AS child_rows
         FROM stories s
        WHERE s.story_type IS DISTINCT FROM 'oral_history'
        ORDER BY s.id`,
    )
    const toPush = candidates.filter((r) => !neonIds.has(r.id))
    const collisions = toPush.filter((r) => (r.source_url && neonUrls.has(r.source_url)) || neonTitles.has(String(r.title).toLowerCase()))
    const withChildren = toPush.filter((r) => r.child_rows > 0)
    const rows = toPush.filter((r) => r.child_rows === 0)

    console.log(`  Neon: ${neonRows.length} stories; local (excl. oral histories): ${candidates.length}`)
    console.log(`  To push: ${rows.length}${withChildren.length ? ` (${withChildren.length} with child rows skipped: ${withChildren.map((r) => r.id).join(', ')})` : ''}`)
    if (collisions.length) {
      console.error(`\n  ✗ ${collisions.length} stories already exist on Neon under another id — refusing:`)
      for (const r of collisions.slice(0, 20)) console.error(`    local ${r.id}: ${String(r.title).slice(0, 70)}`)
      process.exit(1)
    }
    if (!rows.length) { console.log('  Nothing to push.'); return }
    console.log(`  ids ${rows[0].id}…${rows[rows.length - 1].id}`)
    if (dryRun) { console.log('\n[dry-run] nothing written.'); return }

    const cols = Object.keys(rows[0]).filter((c) => c !== 'child_rows')
    const tx = await neon.connect()
    try {
      await tx.query('BEGIN')
      for (const r of rows) {
        await tx.query(
          `INSERT INTO stories (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
          cols.map((c) => r[c]),
        )
      }
      await tx.query(`SELECT setval('stories_id_seq', GREATEST((SELECT max(id) FROM stories), (SELECT last_value FROM stories_id_seq)))`)
      await tx.query('COMMIT')
    } catch (err) {
      await tx.query('ROLLBACK')
      throw err
    } finally {
      tx.release()
    }
    const { rows: [n] } = await neon.query(`SELECT count(*)::int AS n FROM stories`)
    console.log(`\n  Pushed ${rows.length} stories; Neon now has ${n.n}.`)
  } finally {
    await local.end()
    await neon.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
