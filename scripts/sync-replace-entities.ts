/**
 * Replace entity tables on Neon with local data (DELETE + INSERT).
 *
 * For entity tables that were fully rebuilt locally (species, places, protocols,
 * concepts), the row-by-row upsert sync is too slow and can't handle cascading
 * FK conflicts (places referencing parents that don't exist on Neon yet).
 *
 * This script does a simple DELETE + batch INSERT for each table.
 * Safe because entity_mentions has no FK constraints to these tables.
 *
 * Usage:
 *   npx tsx scripts/sync-replace-entities.ts [--dry-run] [--table=places]
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const tableFilter = args.find((a) => a.startsWith('--table='))?.split('=')[1] || 'all'

const TABLES = ['species', 'places', 'protocols', 'concepts']

async function main() {
  console.log('Replace Entity Tables on Neon')
  console.log('=============================')
  if (dryRun) console.log('(DRY RUN)')

  const localDb = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub', max: 2 })
  const neonDb = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, ssl: { rejectUnauthorized: false }, max: 2 })

  try {
    await neonDb.query('SELECT 1')
    console.log('Neon: connected\n')
  } catch (err: any) {
    console.error(`Neon connection failed: ${err.message}`)
    process.exit(1)
  }

  const tables = tableFilter === 'all' ? TABLES : TABLES.filter((t) => t === tableFilter)
  if (tables.length === 0) { console.error(`Unknown table: ${tableFilter}`); process.exit(1) }

  // Detect JSONB columns from schema
  async function getJsonbCols(db: pg.Pool, table: string): Promise<Set<string>> {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND udt_name = 'jsonb'`,
      [table],
    )
    return new Set(rows.map((r: any) => r.column_name))
  }

  for (const table of tables) {
    const startTime = Date.now()
    console.log(`--- ${table} ---`)

    const { rows: [{ n: localCount }] } = await localDb.query(`SELECT count(*)::int as n FROM ${table}`)
    const { rows: [{ n: neonCount }] } = await neonDb.query(`SELECT count(*)::int as n FROM ${table}`)
    console.log(`  Local: ${localCount}, Neon: ${neonCount}`)

    if (dryRun) {
      console.log(`  Would DELETE ${neonCount} Neon rows, INSERT ${localCount} local rows`)
      continue
    }

    // For places: NULL out parent_place_id to avoid self-referencing FK during delete
    if (table === 'places') {
      await neonDb.query('UPDATE places SET parent_place_id = NULL WHERE parent_place_id IS NOT NULL')
      console.log('  Cleared parent_place_id on Neon')
    }

    // Delete all on Neon
    await neonDb.query(`DELETE FROM ${table}`)
    console.log(`  Deleted ${neonCount} rows on Neon`)

    // Fetch all local rows — for places, NULL out parent_place_id for initial insert
    const parentField = table === 'places' ? 'parent_place_id'
      : table === 'species' ? 'parent_taxon_id'
      : table === 'concepts' ? 'parent_concept_id'
      : table === 'protocols' ? 'parent_protocol_id' : null
    const { rows: localRows } = await localDb.query(`SELECT * FROM ${table} ORDER BY id`)
    const parentValues = new Map<number, number | null>() // id → original parent
    if (parentField) {
      for (const row of localRows) {
        if (row[parentField] != null) {
          parentValues.set(row.id, row[parentField])
          row[parentField] = null // NULL for initial insert
        }
      }
      if (parentValues.size > 0) console.log(`  Deferred ${parentValues.size} parent references for post-insert update`)
    }
    if (localRows.length === 0) { console.log('  No local rows'); continue }

    const columns = Object.keys(localRows[0])
    const jsonbCols = await getJsonbCols(localDb, table)
    if (jsonbCols.size > 0) console.log(`  JSONB columns: ${[...jsonbCols].join(', ')}`)

    // Batch insert
    const BATCH = 500
    let inserted = 0
    for (let i = 0; i < localRows.length; i += BATCH) {
      const batch = localRows.slice(i, i + BATCH)
      const valueSets: string[] = []
      const allValues: any[] = []
      for (const row of batch) {
        const placeholders = columns.map((_, ci) => `$${allValues.length + ci + 1}`).join(', ')
        valueSets.push(`(${placeholders})`)
        for (const col of columns) {
          const v = row[col]
          allValues.push(jsonbCols.has(col) && v !== null ? JSON.stringify(v) : v)
        }
      }
      try {
        await neonDb.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valueSets.join(', ')}`, allValues)
        inserted += batch.length
      } catch (err: any) {
        console.log(`  Batch ${Math.floor(i / BATCH) + 1} error: ${err.message?.slice(0, 120)}`)
        // Fall back to row-by-row
        for (const row of batch) {
          const ph = columns.map((_, ci) => `$${ci + 1}`).join(', ')
          const vals = columns.map((c) => { const v = row[c]; return jsonbCols.has(c) && v !== null ? JSON.stringify(v) : v })
          try {
            await neonDb.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${ph})`, vals)
            inserted++
          } catch (rowErr: any) {
            console.log(`    Row ${row.id} error: ${rowErr.message?.slice(0, 100)}`)
          }
        }
      }
      if ((i + BATCH) % 2000 === 0 || i + BATCH >= localRows.length) {
        process.stdout.write(`\r  Inserted ${inserted}/${localRows.length}`)
      }
    }

    // Restore parent references
    if (parentField && parentValues.size > 0) {
      console.log(`  Restoring ${parentValues.size} parent references...`)
      let parentUpdated = 0
      const entries = [...parentValues.entries()]
      const PARENT_BATCH = 200
      for (let i = 0; i < entries.length; i += PARENT_BATCH) {
        const batch = entries.slice(i, i + PARENT_BATCH)
        const ids = batch.map(([id]) => id)
        const parents = batch.map(([, p]) => p)
        try {
          await neonDb.query(
            `UPDATE ${table} SET ${parentField} = t.parent_id
             FROM unnest($1::int[], $2::int[]) AS t(id, parent_id)
             WHERE ${table}.id = t.id`,
            [ids, parents],
          )
          parentUpdated += batch.length
        } catch (err: any) {
          console.log(`    Parent batch error: ${err.message?.slice(0, 100)}`)
        }
      }
      console.log(`  Updated ${parentUpdated} parent references`)
    }

    // Reset sequence
    try {
      await neonDb.query(`SELECT setval('${table}_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ${table}))`)
    } catch { /* sequence may not exist */ }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\r  Inserted ${inserted}/${localRows.length} (${elapsed}s)`)

    // Verify
    const { rows: [{ n: finalCount }] } = await neonDb.query(`SELECT count(*)::int as n FROM ${table}`)
    const marker = finalCount === localCount ? '✓' : '✗'
    console.log(`  ${marker} Neon: ${finalCount} (expected ${localCount})\n`)
  }

  await localDb.end()
  await neonDb.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
