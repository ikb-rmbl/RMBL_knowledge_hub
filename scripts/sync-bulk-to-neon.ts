/**
 * Sync bulk tables (neighborhoods, entity_mentions for stories) to Neon.
 * Used after a full sync when pg_restore misses bulk tables due to FK/PK conflicts.
 *
 * Usage:
 *   npx tsx scripts/sync-bulk-to-neon.ts
 */

import pg from 'pg'
import './lib/config.js'

const BATCH = 200

async function main() {
  console.log('Sync Bulk Tables to Neon')
  console.log('========================')

  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, max: 2 })

  try {
    // 1. Neighborhoods
    console.log('\n--- Neighborhoods ---')
    await neon.query('DELETE FROM neighborhood_members')
    await neon.query('DELETE FROM neighborhoods')

    const { rows: nbrs } = await local.query('SELECT * FROM neighborhoods ORDER BY id')
    const nbrCols = Object.keys(nbrs[0])
    const jsonbCols = new Set(['type_counts', 'top_members', 'top_by_type', 'primer_citations'])
    for (const row of nbrs) {
      const vals = nbrCols.map(c => jsonbCols.has(c) && row[c] ? JSON.stringify(row[c]) : row[c] ?? null)
      const placeholders = nbrCols.map((_, i) => `$${i + 1}`)
      await neon.query(`INSERT INTO neighborhoods (${nbrCols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
    }
    console.log(`  ${nbrs.length} neighborhoods`)

    const { rows: members } = await local.query('SELECT * FROM neighborhood_members ORDER BY id')
    const mCols = Object.keys(members[0])
    for (let i = 0; i < members.length; i += BATCH) {
      const batch = members.slice(i, i + BATCH)
      const allVals: any[] = []
      const valueSets: string[] = []
      for (const row of batch) {
        const offset = allVals.length
        valueSets.push('(' + mCols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
        for (const c of mCols) allVals.push(row[c] ?? null)
      }
      await neon.query(`INSERT INTO neighborhood_members (${mCols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
    }
    console.log(`  ${members.length} members`)

    // 2. Story entity mentions
    console.log('\n--- Story entity mentions ---')
    await neon.query("DELETE FROM entity_mentions WHERE collection = 'stories'")
    const { rows: mentions } = await local.query("SELECT * FROM entity_mentions WHERE collection = 'stories' ORDER BY id")
    const emCols = mentions.length > 0 ? Object.keys(mentions[0]) : []
    for (let i = 0; i < mentions.length; i += BATCH) {
      const batch = mentions.slice(i, i + BATCH)
      const allVals: any[] = []
      const valueSets: string[] = []
      for (const row of batch) {
        const offset = allVals.length
        valueSets.push('(' + emCols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
        for (const c of emCols) {
          const v = row[c]
          allVals.push(c === 'metadata' && v ? JSON.stringify(v) : v ?? null)
        }
      }
      await neon.query(`INSERT INTO entity_mentions (${emCols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
    }
    console.log(`  ${mentions.length} story entity mentions`)

    // 3. Reset sequences
    console.log('\n--- Resetting sequences ---')
    for (const t of ['neighborhoods', 'neighborhood_members']) {
      await neon.query(`SELECT setval('${t}_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ${t}))`)
    }
    console.log('  Done')

    // 4. Verify
    console.log('\n--- Verification ---')
    for (const t of ['neighborhoods', 'neighborhood_members', 'entity_mentions', 'stories']) {
      const { rows: [{ n: localN }] } = await local.query(`SELECT count(*)::int as n FROM ${t}`)
      const { rows: [{ n: neonN }] } = await neon.query(`SELECT count(*)::int as n FROM ${t}`)
      const marker = localN === neonN ? '✓' : '✗'
      console.log(`  ${marker} ${t.padEnd(22)} local: ${String(localN).padStart(7)}  neon: ${String(neonN).padStart(7)}`)
    }
  } finally {
    await local.end()
    await neon.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
