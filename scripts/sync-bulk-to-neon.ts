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
 *   npx tsx scripts/sync-bulk-to-neon.ts --only=era_primers
 *
 * Sections: neighborhoods, entity_mentions, frontiers, planning, era_primers
 *
 * Note on era_primers: this is NOT a DELETE+INSERT bulk section. The eras
 * table is admin-editable, so era_primers UPDATEs only the five primer
 * columns (primer, primer_generated_at, primer_model, primer_key_themes,
 * primer_open_questions), keyed on slug.
 */

import pg from 'pg'
import './lib/config.js'

const BATCH = 200

const args = process.argv.slice(2)
const onlyArg = args.find((a) => a.startsWith('--only='))?.split('=')[1]
const sections = new Set(onlyArg ? onlyArg.split(',').map((s) => s.trim()) : ['neighborhoods', 'entity_mentions', 'frontiers', 'planning', 'era_primers', 'futures'])

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
    // CASCADE deletes via FK wipe the link tables when we truncate frontiers.
    // The grounded-pipeline tables (extraction_runs, validation_runs,
    // statement_papers, snapshots) need explicit truncates too — they're
    // referenced *by* the run-id columns on frontiers but ALSO reference
    // frontiers / source_statements themselves, so the truncate order is:
    //   1. snapshots         (no children)
    //   2. statement_papers  (children of source_statements)
    //   3. frontiers + link tables (CASCADE drops source_statements too)
    //   4. validation_runs   (referenced from frontiers.last_validation_run_id, now NULL)
    //   5. extraction_runs   (referenced from frontiers.extraction_run_id, now NULL)
    await neon.query('TRUNCATE frontier_snapshots, frontier_statement_papers RESTART IDENTITY CASCADE')
    await neon.query('TRUNCATE frontiers, frontier_neighborhoods, frontier_entities, frontier_source_statements RESTART IDENTITY CASCADE')
    await neon.query('TRUNCATE frontier_validation_runs, frontier_extraction_runs RESTART IDENTITY CASCADE')

    // Insert extraction_runs + validation_runs *first* so the FKs from
    // frontiers / source_statements / snapshots resolve.
    const { rows: extRuns } = await local.query('SELECT * FROM frontier_extraction_runs ORDER BY id')
    if (extRuns.length > 0) {
      const cols = Object.keys(extRuns[0])
      for (const row of extRuns) {
        const vals = cols.map(c => row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontier_extraction_runs (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${extRuns.length} extraction runs`)

    const { rows: valRuns } = await local.query('SELECT * FROM frontier_validation_runs ORDER BY id')
    if (valRuns.length > 0) {
      const cols = Object.keys(valRuns[0])
      for (const row of valRuns) {
        const vals = cols.map(c => row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontier_validation_runs (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${valRuns.length} validation runs`)

    const { rows: frontiers } = await local.query('SELECT * FROM frontiers ORDER BY id')
    // `data_gaps` and `key_questions` are jsonb columns that hold *either*
    // a string[] (legacy) or a structured object[] (grounded). Both round-
    // trip cleanly through JSON.stringify. `question_currency_summary` is
    // a plain jsonb object on grounded rows; same treatment.
    const frJsonbCols = new Set(['key_questions', 'pushing_the_frontier', 'data_gaps', 'question_currency_summary', 'curated_fields'])
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

    // Grounded-pipeline join tables — statement-paper cite rows and
    // historical snapshots. Both reference rows already inserted above.
    const { rows: frStmtPapers } = await local.query('SELECT * FROM frontier_statement_papers ORDER BY id')
    if (frStmtPapers.length > 0) {
      const cols = Object.keys(frStmtPapers[0])
      for (let i = 0; i < frStmtPapers.length; i += BATCH) {
        const batch = frStmtPapers.slice(i, i + BATCH)
        const allVals: any[] = []
        const valueSets: string[] = []
        for (const row of batch) {
          const offset = allVals.length
          valueSets.push('(' + cols.map((_, j) => `$${offset + j + 1}`).join(',') + ')')
          for (const c of cols) allVals.push(row[c] ?? null)
        }
        await neon.query(`INSERT INTO frontier_statement_papers (${cols.join(',')}) VALUES ${valueSets.join(',')}`, allVals)
      }
    }
    console.log(`  ${frStmtPapers.length} statement-paper cites`)

    const { rows: frSnaps } = await local.query('SELECT * FROM frontier_snapshots ORDER BY id')
    const snapJsonbCols = new Set(['key_questions', 'pushing_the_frontier', 'data_gaps', 'question_currency_summary'])
    if (frSnaps.length > 0) {
      const cols = Object.keys(frSnaps[0])
      for (const row of frSnaps) {
        const vals = cols.map(c => snapJsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO frontier_snapshots (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${frSnaps.length} frontier snapshots`)
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

    if (sections.has('futures')) {
    // Future Scenarios + companion narratives. Both tables are pure SQL
    // (no Payload collection), populated by scripts/load-futures.ts from
    // the markdown artifacts under specification/scenarios/ and stories/.
    // TRUNCATE+INSERT, mirroring the central-set pattern. The
    // scenario_stories table has a FK to scenarios(slug) so deletion
    // must cascade — the truncate handles that.
    console.log('\n--- Futures (scenarios + scenario_stories) ---')
    await neon.query('TRUNCATE scenarios, scenario_stories RESTART IDENTITY CASCADE')

    const { rows: scenariosRows } = await local.query('SELECT * FROM scenarios ORDER BY id')
    const scJsonbCols = new Set(['frontier_portfolio'])
    if (scenariosRows.length > 0) {
      const cols = Object.keys(scenariosRows[0])
      for (const row of scenariosRows) {
        const vals = cols.map(c => scJsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO scenarios (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${scenariosRows.length} scenarios`)

    const { rows: storiesRows } = await local.query('SELECT * FROM scenario_stories ORDER BY id')
    if (storiesRows.length > 0) {
      const cols = Object.keys(storiesRows[0])
      for (const row of storiesRows) {
        const vals = cols.map(c => row[c] ?? null)
        const placeholders = cols.map((_, i) => `$${i + 1}`)
        await neon.query(`INSERT INTO scenario_stories (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals)
      }
    }
    console.log(`  ${storiesRows.length} scenario_stories`)
    }

    if (sections.has('era_primers')) {
    // Era primers — narrow targeted UPDATE by slug.
    //
    // The eras table is admin-editable (name/description/sort_order/curated_fields),
    // so we can't DELETE+INSERT like the other bulk sections; we patch only the
    // five primer columns produced by scripts/generate-era-primers.ts and key on
    // slug (stable across both sides). Rows on Neon that don't exist locally are
    // ignored; rows on Neon whose slug we can't match get a console warning.
    console.log('\n--- Era primers ---')
    const { rows: eras } = await local.query(`
      SELECT slug, primer, primer_generated_at, primer_model,
             primer_key_themes, primer_open_questions
        FROM eras
       WHERE primer IS NOT NULL
       ORDER BY start_year`)
    let updated = 0
    let unmatched = 0
    for (const row of eras) {
      const { rowCount } = await neon.query(
        `UPDATE eras
            SET primer               = $1,
                primer_generated_at  = $2,
                primer_model         = $3,
                primer_key_themes    = $4::jsonb,
                primer_open_questions = $5::jsonb
          WHERE slug = $6`,
        [
          row.primer,
          row.primer_generated_at,
          row.primer_model,
          JSON.stringify(row.primer_key_themes ?? []),
          JSON.stringify(row.primer_open_questions ?? []),
          row.slug,
        ],
      )
      if (rowCount && rowCount > 0) {
        updated++
      } else {
        unmatched++
        console.log(`  ⚠ slug "${row.slug}" not on Neon (skipped)`)
      }
    }
    console.log(`  ${updated} era primer(s) patched${unmatched > 0 ? `, ${unmatched} unmatched` : ''}`)
    }

    // 5. Reset sequences
    console.log('\n--- Resetting sequences ---')
    for (const t of [
      'neighborhoods', 'neighborhood_members', 'frontiers', 'frontier_source_statements',
      'frontier_planning_themes', 'frontier_planning_clusters', 'frontier_planning_items',
      'frontier_long_reach_opportunities',
      'scenarios', 'scenario_stories',
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
