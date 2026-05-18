/**
 * Load per-publication protocol steps from the VLM extraction results
 * into the `publication_protocol_steps` table.
 *
 * Source: scripts/output/extraction-full/results.json, the output of
 * experiment-extraction.ts strategy 3. Each publication has a
 * `protocolSteps` array; entity_mentions.metadata.protocolStepIndices
 * already references indices into it, so this load unlocks the
 * "show canonical method from introducing paper" rendering on the
 * protocol detail page.
 *
 * Idempotent: TRUNCATE-then-INSERT pattern. Re-runs are safe.
 *
 * Usage:
 *   npx tsx scripts/load-protocol-steps.ts
 *   npx tsx scripts/load-protocol-steps.ts --input=path/to/results.json
 *   npx tsx scripts/load-protocol-steps.ts --dry-run
 */

import { readFileSync } from 'fs'
import pg from 'pg'
import './lib/config.js'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const inputPath = args.find((a) => a.startsWith('--input='))?.split('=')[1]
  || `${OUTPUT_DIR}/extraction-full/results.json`

const BATCH = 500

interface ProtocolStep {
  step?: number
  action?: string
  details?: string
  quantities?: string
  duration?: string
  conditions?: string
  equipment?: string[]
}

async function main() {
  console.log('Load publication protocol steps')
  console.log('===============================')
  console.log(`  input: ${inputPath}${dryRun ? '  (DRY RUN)' : ''}`)

  const raw = readFileSync(inputPath, 'utf-8')
  const results: any[] = JSON.parse(raw)
  console.log(`  ${results.length} extraction records loaded from file`)

  // Build (pub_id, step) rows from each record's strategy3.extraction.protocolSteps
  type Row = {
    publication_id: number
    step_index: number
    action: string | null
    details: string | null
    quantities: string | null
    duration: string | null
    conditions: string | null
    equipment: string[]
  }
  const rows: Row[] = []
  let pubsWithSteps = 0
  for (const r of results) {
    const pubId = r.id ?? r.publication_id
    const steps: ProtocolStep[] = r?.strategy3?.extraction?.protocolSteps
    if (!pubId || !Array.isArray(steps) || steps.length === 0) continue
    pubsWithSteps++
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i] || {}
      // Use the explicit step number if present; fall back to 1-based index.
      const idx = typeof s.step === 'number' && s.step >= 1 ? s.step : i + 1
      rows.push({
        publication_id: pubId,
        step_index: idx,
        action: s.action || null,
        details: s.details || null,
        quantities: s.quantities || null,
        duration: s.duration || null,
        conditions: s.conditions || null,
        equipment: Array.isArray(s.equipment) ? s.equipment.filter((e): e is string => typeof e === 'string') : [],
      })
    }
  }
  console.log(`  ${pubsWithSteps} publications have steps`)
  console.log(`  ${rows.length} total step rows to insert`)

  if (dryRun) {
    console.log('\nDRY RUN — sample of first 3 rows:')
    for (const r of rows.slice(0, 3)) {
      console.log(`  pub=${r.publication_id} step=${r.step_index} action="${(r.action || '').slice(0, 80)}…"`)
    }
    return
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })
  try {
    console.log('\nTRUNCATEing publication_protocol_steps...')
    await db.query('TRUNCATE publication_protocol_steps RESTART IDENTITY')

    console.log('Inserting...')
    const cols = ['publication_id', 'step_index', 'action', 'details', 'quantities', 'duration', 'conditions', 'equipment']
    let inserted = 0
    let skippedFK = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const allVals: any[] = []
      const valueSets: string[] = []
      for (const r of batch) {
        const offset = allVals.length
        valueSets.push('(' + cols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
        allVals.push(r.publication_id, r.step_index, r.action, r.details, r.quantities, r.duration, r.conditions, r.equipment)
      }
      try {
        await db.query(`INSERT INTO publication_protocol_steps (${cols.join(',')}) VALUES ${valueSets.join(',')} ON CONFLICT (publication_id, step_index) DO NOTHING`, allVals)
        inserted += batch.length
      } catch (err: any) {
        // FK violation if a pub_id in results.json isn't in the DB; fall back to row-by-row to skip just those
        if (err.code === '23503') {
          for (const r of batch) {
            try {
              await db.query(
                `INSERT INTO publication_protocol_steps (publication_id, step_index, action, details, quantities, duration, conditions, equipment)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
                [r.publication_id, r.step_index, r.action, r.details, r.quantities, r.duration, r.conditions, r.equipment],
              )
              inserted++
            } catch (rowErr: any) {
              if (rowErr.code === '23503') skippedFK++
              else throw rowErr
            }
          }
        } else throw err
      }
      if ((i + BATCH) % 2000 === 0 || i + BATCH >= rows.length) {
        process.stdout.write(`\r  inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
      }
    }
    process.stdout.write('\n')

    const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM publication_protocol_steps')
    console.log(`\nDone: ${inserted} inserted, ${skippedFK} skipped (publication FK missing), ${n} rows in table`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
