/**
 * Flatten the three planning-relevant JSONB fields on each frontier into
 * the frontier_planning_items table:
 *   - pushing_the_frontier  → item_type='action' (captures category + effort)
 *   - data_gaps             → item_type='data_gap'
 *   - key_questions         → item_type='question'
 *
 * The corpus is regenerated whenever frontiers themselves change. Since
 * frontier IDs are stable across reruns but the items array order isn't,
 * this script TRUNCATEs and re-inserts (matching the load-frontiers
 * pattern). Downstream embedding + clustering then needs to re-run.
 *
 * Usage:
 *   npx tsx scripts/extract-frontier-planning-items.ts
 *   npx tsx scripts/extract-frontier-planning-items.ts --dry-run
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

async function main() {
  console.log('Extract frontier planning items')
  console.log('===============================')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Preview counts before any mutation
  const { rows: [counts] } = await db.query(`
    SELECT
      (SELECT count(*) FROM frontiers, jsonb_array_elements(pushing_the_frontier)) AS actions,
      (SELECT count(*) FROM frontiers, jsonb_array_elements(data_gaps))             AS data_gaps,
      (SELECT count(*) FROM frontiers, jsonb_array_elements(key_questions))         AS questions
  `)
  const total = Number(counts.actions) + Number(counts.data_gaps) + Number(counts.questions)
  console.log(`  Actions:    ${counts.actions}`)
  console.log(`  Data gaps:  ${counts.data_gaps}`)
  console.log(`  Questions:  ${counts.questions}`)
  console.log(`  Total:      ${total}`)

  if (dryRun) {
    console.log('\nDRY RUN — no rows written')
    await db.end()
    return
  }

  console.log('\nClearing existing items (and their cluster assignments)...')
  // Clusters table is also wiped since cluster IDs depend on the item set;
  // re-clustering must run after this script to regenerate.
  await db.query('TRUNCATE frontier_planning_items, frontier_planning_clusters RESTART IDENTITY CASCADE')

  // SQL-side flattening — one INSERT per item type. Avoids round-tripping
  // ~2K rows through the Node driver.
  console.log('\nInserting actions...')
  const { rowCount: insActions } = await db.query(`
    INSERT INTO frontier_planning_items (frontier_id, item_type, category, effort, text)
    SELECT
      f.id,
      'action',
      a->>'category',
      a->>'effort',
      a->>'action'
    FROM frontiers f, jsonb_array_elements(f.pushing_the_frontier) AS a
    WHERE coalesce(a->>'action', '') <> ''
  `)
  console.log(`  ${insActions} actions`)

  console.log('\nInserting data gaps...')
  const { rowCount: insGaps } = await db.query(`
    INSERT INTO frontier_planning_items (frontier_id, item_type, text)
    SELECT f.id, 'data_gap', g.gap
    FROM frontiers f, jsonb_array_elements_text(f.data_gaps) AS g(gap)
    WHERE coalesce(g.gap, '') <> ''
  `)
  console.log(`  ${insGaps} data gaps`)

  console.log('\nInserting key questions...')
  const { rowCount: insQuestions } = await db.query(`
    INSERT INTO frontier_planning_items (frontier_id, item_type, text)
    SELECT f.id, 'question', q.question
    FROM frontiers f, jsonb_array_elements_text(f.key_questions) AS q(question)
    WHERE coalesce(q.question, '') <> ''
  `)
  console.log(`  ${insQuestions} questions`)

  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM frontier_planning_items')
  console.log(`\nDone: ${n} planning items loaded`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
