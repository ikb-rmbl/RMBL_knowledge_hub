/**
 * Compare local vs Neon row counts for neighborhoods + frontier tables.
 * Quick pre-flight before syncing frontiers to Neon.
 */

import pg from 'pg'
import './lib/config.js'

async function main() {
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, max: 1, connectionTimeoutMillis: 15000 })
  const local = new pg.Pool({ connectionString: 'postgresql://localhost:5432/rmbl_knowledge_hub', max: 1 })

  const tables = [
    'neighborhoods', 'neighborhood_members',
    'frontiers', 'frontier_neighborhoods', 'frontier_entities', 'frontier_source_statements',
    'frontier_planning_items', 'frontier_planning_clusters',
    'frontier_planning_themes', 'frontier_long_reach_opportunities',
  ]
  console.log('Table'.padEnd(32), 'Local'.padStart(8), 'Neon'.padStart(8))
  console.log('-'.repeat(50))
  for (const t of tables) {
    let l = 'n/a', n = 'n/a'
    try { const { rows } = await local.query(`SELECT count(*)::int as c FROM ${t}`); l = String(rows[0].c) } catch { l = 'missing' }
    try { const { rows } = await neon.query(`SELECT count(*)::int as c FROM ${t}`); n = String(rows[0].c) } catch { n = 'missing' }
    const marker = l === n ? '✓' : '·'
    console.log(`${marker} ${t.padEnd(30)}`, l.padStart(8), n.padStart(8))
  }
  await neon.end()
  await local.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
