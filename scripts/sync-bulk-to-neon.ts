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
const sections = new Set(onlyArg ? onlyArg.split(',').map((s) => s.trim()) : ['neighborhoods', 'entity_mentions', 'frontiers', 'planning'])

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

    if (sections.has('planning')) {
    // 4. Frontier planning tables (items, clusters, themes, long-reach opportunities)
    // Insert order: themes → clusters → items → opportunities. No hard FKs between
    // them at the schema level; soft references (cluster_id, theme_id) are integer
    // pointers, so order matters only for cosmetic consistency.
    console.log('\n--- Frontier planning tables ---')
    // Children-first delete to avoid leftover orphan references
    await neon.query('DELETE FROM frontier_long_reach_opportunities')
    await neon.query('DELETE FROM frontier_planning_items')
    await neon.query('DELETE FROM frontier_planning_clusters')
    await neon.query('DELETE FROM frontier_planning_themes')

    // 4a. themes (parent, simple JSONB cols)
    const { rows: themes } = await local.query('SELECT * FROM frontier_planning_themes ORDER BY id')
    const themeJsonbCols = new Set(['planning_anchors', 'type_distribution', 'long_reach_anchors'])
    if (themes.length > 0) {
      const cols = Object.keys(themes[0])
      for (const row of themes) {
        const vals = cols.map(c => themeJsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontier_planning_themes (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${themes.length} themes`)

    // 4b. clusters (one row at a time — small table, JSONB cols)
    const { rows: clusters } = await local.query('SELECT * FROM frontier_planning_clusters ORDER BY id')
    const clusterJsonbCols = new Set(['type_distribution', 'category_distribution', 'effort_distribution', 'key_items'])
    if (clusters.length > 0) {
      const cols = Object.keys(clusters[0])
      for (const row of clusters) {
        const vals = cols.map(c => clusterJsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontier_planning_clusters (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${clusters.length} clusters`)

    // 4c. items (3,288 rows with vector embeddings — batched, vector cast inline)
    // Vectors come back from local as text in the form '[0.1,0.2,...]'; we cast
    // back to vector on insert. Item rows have no JSONB columns.
    const { rows: items } = await local.query(
      `SELECT id, frontier_id, item_type, category, effort, text,
              embedding::text AS embedding_str, cluster_id, generated_at
       FROM frontier_planning_items ORDER BY id`,
    )
    if (items.length > 0) {
      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH)
        const allVals: any[] = []
        const valueSets: string[] = []
        const cols = ['id', 'frontier_id', 'item_type', 'category', 'effort', 'text', 'embedding', 'cluster_id', 'generated_at']
        for (const row of batch) {
          const offset = allVals.length
          // 9 cols; embedding is the 7th (index 6). Cast that param to vector.
          const ph = cols.map((c, j) => c === 'embedding' ? `$${offset + j + 1}::vector` : `$${offset + j + 1}`)
          valueSets.push('(' + ph.join(',') + ')')
          allVals.push(
            row.id, row.frontier_id, row.item_type, row.category, row.effort, row.text,
            row.embedding_str, row.cluster_id, row.generated_at,
          )
        }
        await neon.query(`INSERT INTO frontier_planning_items (${cols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
        if ((i + BATCH) % 1000 === 0 || i + BATCH >= items.length) {
          process.stdout.write(`\r  items inserted ${Math.min(i + BATCH, items.length)}/${items.length}`)
        }
      }
      process.stdout.write('\n')
    }
    console.log(`  ${items.length} planning items (with vector embeddings)`)

    // 4d. long-reach opportunities
    const { rows: opps } = await local.query('SELECT * FROM frontier_long_reach_opportunities ORDER BY rank')
    const oppJsonbCols = new Set(['contributing_themes'])
    if (opps.length > 0) {
      const cols = Object.keys(opps[0])
      for (const row of opps) {
        const vals = cols.map(c => oppJsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontier_long_reach_opportunities (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${opps.length} long-reach opportunities`)
    }

    // 5. Reset sequences
    console.log('\n--- Resetting sequences ---')
    for (const t of [
      'neighborhoods', 'neighborhood_members', 'frontiers', 'frontier_source_statements',
      'frontier_planning_themes', 'frontier_planning_clusters', 'frontier_planning_items',
      'frontier_long_reach_opportunities',
    ]) {
      try {
        await neon.query(`SELECT setval('${t}_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ${t}))`)
      } catch { /* table or sequence may be absent if section wasn't synced this run */ }
    }
    console.log('  Done')

    // 6. Verify
    console.log('\n--- Verification ---')
    for (const t of [
      'neighborhoods', 'neighborhood_members', 'entity_mentions', 'stories',
      'frontiers', 'frontier_neighborhoods', 'frontier_entities', 'frontier_source_statements',
      'frontier_planning_themes', 'frontier_planning_clusters', 'frontier_planning_items',
      'frontier_long_reach_opportunities',
    ]) {
      try {
        const { rows: [{ n: localN }] } = await local.query(`SELECT count(*)::int as n FROM ${t}`)
        const { rows: [{ n: neonN }] } = await neon.query(`SELECT count(*)::int as n FROM ${t}`)
        const marker = localN === neonN ? '✓' : '✗'
        console.log(`  ${marker} ${t.padEnd(36)} local: ${String(localN).padStart(7)}  neon: ${String(neonN).padStart(7)}`)
      } catch (err: any) {
        console.log(`  · ${t.padEnd(36)} (skipped — ${err.message?.slice(0, 60)})`)
      }
    }
  } finally {
    await local.end()
    await neon.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
