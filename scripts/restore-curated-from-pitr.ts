/**
 * HISTORICAL ONE-SHOT (2026-09-09) — recover curated_fields from a Neon PITR
 * branch after the 2026-09-07 author-registry incident.
 *
 * Background: sync-databases double-encoded curated_fields on every push
 * (fixed on main 2026-09-09), and the 09-07 sync also unioned bogus
 * create-artifact flags (curation-hook create bug, fixed same day) into
 * ~4K pre-existing Neon author rows. Content of author curated_fields on
 * Neon is therefore real-flags ∪ artifacts — indistinguishable in place,
 * but a PITR snapshot from before 2026-09-07 holds the real flags only
 * (author create-artifacts did not exist before that date).
 *
 * What it does, against the target DB (default neon):
 *   1. authors: for rows created before --incident-date, set curated_fields
 *      to the snapshot's (decoded) value for the same id — restoring real
 *      flags and clearing artifact pollution. Rows created on/after the
 *      cutoff are left alone (already handled by merge-duplicate-authors).
 *   2. all other curatable tables: decode double-encoded curated_fields in
 *      place (content unchanged, encoding normalized to a proper array).
 *
 * Inputs:
 *   SNAPSHOT_DATABASE_URL env var — connection string of the PITR branch
 *   (read-only access is enough; created in the Neon console from a
 *   timestamp before 2026-09-07 00:00 UTC).
 *
 * Usage:
 *   SNAPSHOT_DATABASE_URL=postgres://... npx tsx scripts/restore-curated-from-pitr.ts [--dry-run] [--target=neon|local] [--incident-date=2026-09-07]
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] || 'neon'
const incidentDate = args.find((a) => a.startsWith('--incident-date='))?.split('=')[1] || '2026-09-07'

const ENCODING_ONLY_TABLES = ['publications', 'datasets', 'documents', 'stories', 'projects', 'topics']

/** Decode possibly multiply-JSON-encoded curated_fields into a string array */
function decodeCurated(v: unknown): string[] {
  let cur: unknown = v
  for (let i = 0; i < 3 && typeof cur === 'string'; i++) {
    try {
      cur = JSON.parse(cur)
    } catch {
      return []
    }
  }
  return Array.isArray(cur) ? cur.filter((x): x is string => typeof x === 'string') : []
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

async function main() {
  const snapshotUrl = process.env.SNAPSHOT_DATABASE_URL
  if (!snapshotUrl) throw new Error('SNAPSHOT_DATABASE_URL is not set (PITR branch connection string)')
  const targetUrl = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!targetUrl) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)

  const snap = new pg.Pool({ connectionString: snapshotUrl, max: 2 })
  const db = new pg.Pool({ connectionString: targetUrl, max: 2 })

  console.log(`Target: ${target}${dryRun ? ' (dry run)' : ''}; incident cutoff: ${incidentDate}`)

  // Sanity check: the snapshot must predate the incident
  const { rows: snapCheck } = await snap.query(
    `SELECT count(*)::int AS n FROM authors WHERE created_at >= $1::timestamptz`,
    [incidentDate],
  )
  if (snapCheck[0].n > 0) {
    throw new Error(
      `Snapshot contains ${snapCheck[0].n} authors created on/after ${incidentDate} — branch timestamp is too late. Recreate it from before the incident.`,
    )
  }

  // --- 1. Authors: restore real curation from the snapshot ------------------
  const { rows: snapAuthors } = await snap.query(
    `SELECT id, curated_fields FROM authors WHERE curated_fields::text NOT IN ('[]', 'null')`,
  )
  const snapCurated = new Map<number, string[]>()
  for (const r of snapAuthors) {
    const decoded = decodeCurated(r.curated_fields)
    if (decoded.length > 0) snapCurated.set(r.id, decoded)
  }
  console.log(`Snapshot: ${snapCurated.size} authors with real curated flags`)

  const { rows: current } = await db.query(
    `SELECT id, curated_fields FROM authors WHERE created_at < $1::timestamptz`,
    [incidentDate],
  )

  let restored = 0
  let cleared = 0
  let reencoded = 0
  let unchanged = 0
  for (const row of current) {
    const expected = snapCurated.get(row.id) ?? []
    const currentDecoded = decodeCurated(row.curated_fields)
    const wasDoubleEncoded = typeof row.curated_fields === 'string'

    if (sameSet(currentDecoded, expected) && !wasDoubleEncoded) {
      unchanged++
      continue
    }
    if (!dryRun) {
      await db.query(`UPDATE authors SET curated_fields = $2::jsonb WHERE id = $1`, [
        row.id,
        JSON.stringify(expected),
      ])
    }
    if (expected.length > 0 && !sameSet(currentDecoded, expected)) restored++
    else if (expected.length === 0 && currentDecoded.length > 0) cleared++
    else reencoded++
  }
  console.log(
    `Authors: ${restored} restored to snapshot flags, ${cleared} cleared (pure pollution), ${reencoded} re-encoded only, ${unchanged} unchanged`,
  )

  // --- 2. Other tables: fix double-encoding in place (content unchanged) ----
  for (const table of ENCODING_ONLY_TABLES) {
    const { rows } = await db.query(
      `SELECT id, curated_fields FROM ${table} WHERE jsonb_typeof(curated_fields) = 'string'`,
    )
    let fixed = 0
    for (const row of rows) {
      const decoded = decodeCurated(row.curated_fields)
      if (!dryRun) {
        await db.query(`UPDATE ${table} SET curated_fields = $2::jsonb WHERE id = $1`, [
          row.id,
          JSON.stringify(decoded),
        ])
      }
      fixed++
    }
    if (fixed > 0) console.log(`${table}: ${fixed} double-encoded rows normalized`)
  }

  await snap.end()
  await db.end()
  console.log(dryRun ? '\nDry run — no changes made.' : '\nDone.')
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
