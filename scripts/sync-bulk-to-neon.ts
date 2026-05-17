/**
 * Sync bulk SQL-only tables to Neon — neighborhoods, story entity_mentions,
 * and frontiers (frontiers + neighborhoods/entities/source_statements link tables).
 * Used after a full sync when pg_restore misses bulk tables due to FK/PK conflicts.
 *
 * These tables are 100% pipeline-generated (no admin curation), so the safe
 * pattern is DELETE-then-INSERT rather than upsert. For frontiers in particular,
 * cluster IDs are non-deterministic across pipeline reruns so any partial-update
 * scheme would corrupt FKs.
 *
 * Usage:
 *   npx tsx scripts/sync-bulk-to-neon.ts
 *   npx tsx scripts/sync-bulk-to-neon.ts --only=neighborhoods,frontiers
 *
 * Sections: neighborhoods, entity_mentions, frontiers
 */

import pg from 'pg'
import './lib/config.js'

const BATCH = 200

const args = process.argv.slice(2)
const onlyArg = args.find((a) => a.startsWith('--only='))?.split('=')[1]
const sections = new Set(onlyArg ? onlyArg.split(',').map((s) => s.trim()) : ['neighborhoods', 'entity_mentions', 'frontiers'])

async function main() {
  console.log('Sync Bulk Tables to Neon')
  console.log('========================')
  console.log(`Sections: ${[...sections].join(', ')}`)

  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, max: 2 })

  try {
    if (sections.has('neighborhoods')) {
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
    }

    if (sections.has('entity_mentions')) {
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
    }

    if (sections.has('frontiers')) {
    // 3. Frontiers (and child tables: neighborhoods/entities/source_statements links)
    console.log('\n--- Frontiers ---')
    // CASCADE deletes via FK, so truncating frontiers wipes all link tables too.
    await neon.query('TRUNCATE frontiers, frontier_neighborhoods, frontier_entities, frontier_source_statements RESTART IDENTITY CASCADE')

    const { rows: frontiers } = await local.query('SELECT * FROM frontiers ORDER BY id')
    const frJsonbCols = new Set(['key_questions', 'pushing_the_frontier', 'data_gaps'])
    if (frontiers.length > 0) {
      const cols = Object.keys(frontiers[0])
      for (const row of frontiers) {
        const vals = cols.map(c => frJsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontiers (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${frontiers.length} frontiers`)

    const { rows: frNbrs } = await local.query('SELECT * FROM frontier_neighborhoods ORDER BY frontier_id, neighborhood_id')
    if (frNbrs.length > 0) {
      const cols = Object.keys(frNbrs[0])
      for (let i = 0; i < frNbrs.length; i += BATCH) {
        const batch = frNbrs.slice(i, i + BATCH)
        const allVals: any[] = []
        const valueSets: string[] = []
        for (const row of batch) {
          const offset = allVals.length
          valueSets.push('(' + cols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
          for (const c of cols) allVals.push(row[c] ?? null)
        }
        await neon.query(`INSERT INTO frontier_neighborhoods (${cols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
      }
    }
    console.log(`  ${frNbrs.length} frontier↔neighborhood links`)

    const { rows: frEnts } = await local.query('SELECT * FROM frontier_entities ORDER BY frontier_id, entity_type, entity_id')
    if (frEnts.length > 0) {
      const cols = Object.keys(frEnts[0])
      for (let i = 0; i < frEnts.length; i += BATCH) {
        const batch = frEnts.slice(i, i + BATCH)
        const allVals: any[] = []
        const valueSets: string[] = []
        for (const row of batch) {
          const offset = allVals.length
          valueSets.push('(' + cols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
          for (const c of cols) allVals.push(row[c] ?? null)
        }
        await neon.query(`INSERT INTO frontier_entities (${cols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
      }
    }
    console.log(`  ${frEnts.length} frontier↔entity links`)

    const { rows: frStmts } = await local.query('SELECT * FROM frontier_source_statements ORDER BY id')
    const stmtJsonbCols = new Set(['concepts', 'protocols', 'datasets_needed'])
    if (frStmts.length > 0) {
      const cols = Object.keys(frStmts[0])
      for (let i = 0; i < frStmts.length; i += BATCH) {
        const batch = frStmts.slice(i, i + BATCH)
        const allVals: any[] = []
        const valueSets: string[] = []
        for (const row of batch) {
          const offset = allVals.length
          valueSets.push('(' + cols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
          for (const c of cols) {
            const v = row[c]
            allVals.push(stmtJsonbCols.has(c) && v != null ? JSON.stringify(v) : v ?? null)
          }
        }
        await neon.query(`INSERT INTO frontier_source_statements (${cols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
      }
    }
    console.log(`  ${frStmts.length} source statements`)
    }

    // 4. Reset sequences
    console.log('\n--- Resetting sequences ---')
    for (const t of ['neighborhoods', 'neighborhood_members', 'frontiers', 'frontier_source_statements']) {
      await neon.query(`SELECT setval('${t}_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ${t}))`)
    }
    console.log('  Done')

    // 5. Verify
    console.log('\n--- Verification ---')
    for (const t of ['neighborhoods', 'neighborhood_members', 'entity_mentions', 'stories', 'frontiers', 'frontier_neighborhoods', 'frontier_entities', 'frontier_source_statements']) {
      const { rows: [{ n: localN }] } = await local.query(`SELECT count(*)::int as n FROM ${t}`)
      const { rows: [{ n: neonN }] } = await neon.query(`SELECT count(*)::int as n FROM ${t}`)
      const marker = localN === neonN ? '✓' : '✗'
      console.log(`  ${marker} ${t.padEnd(28)} local: ${String(localN).padStart(7)}  neon: ${String(neonN).padStart(7)}`)
    }
  } finally {
    await local.end()
    await neon.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
