/**
 * STATUS: On-demand tool — re-run after changes to the relevance filter in
 *         lib/publication-discovery.ts. Not part of the daily pipeline.
 *
 * Cleanup Off-Target Discovered Publications
 *
 * Applies the current relevance filter (from publication-discovery.ts) to
 * publications with data_source='discovered' and removes any that fail.
 * Protects rmbl_database papers — never deletes those.
 *
 * Usage:
 *   npx tsx scripts/cleanup-discovered.ts [--dry-run] [--limit=N]
 */

import pg from 'pg'
import './lib/config.js'
import { isOffTargetPublication } from './lib/publication-discovery.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

async function main() {
  console.log('Cleanup Discovered Publications')
  console.log('===============================')
  if (dryRun) console.log('(DRY RUN — no deletions)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Load all discovered publications with the fields we need for the filter
    const { rows } = await db.query(`
      SELECT id, title, abstract, journal, year, doi, publication_type, discovery_method
      FROM publications
      WHERE data_source = 'discovered'
      ORDER BY id
    `)

    console.log(`\nLoaded ${rows.length} discovered publications`)

    const failed: typeof rows = []
    for (const row of rows) {
      const offTarget = isOffTargetPublication({
        title: row.title || '',
        abstract: row.abstract || '',
        journal: row.journal || '',
      })
      if (offTarget) failed.push(row)
    }

    console.log(`\n${failed.length} flagged as off-target (${Math.round((100 * failed.length) / rows.length)}%)`)

    // Group by journal for visibility
    const byJournal = new Map<string, number>()
    for (const f of failed) {
      const j = f.journal || '(no journal)'
      byJournal.set(j, (byJournal.get(j) || 0) + 1)
    }
    const topJournals = [...byJournal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    console.log('\nTop journals among failed papers:')
    for (const [j, n] of topJournals) {
      console.log(`  ${n.toString().padStart(4)}  ${j.slice(0, 80)}`)
    }

    // Show a sample to verify
    const showAll = args.includes('--show-all')
    const sample = showAll ? failed : failed.slice(0, 30)
    console.log(showAll ? '\nAll papers to be removed:' : '\nSample of papers to be removed (first 30):')
    for (const f of sample) {
      console.log(`  [${f.year || '----'}] ${(f.title || '').slice(0, 90)}`)
      console.log(`         journal=${(f.journal || '').slice(0, 60)} method=${f.discovery_method}`)
    }

    if (dryRun) {
      console.log(`\n(DRY RUN) Would delete ${failed.length} publications`)
      return
    }

    if (limit !== Infinity) {
      console.log(`\nLimiting deletion to first ${limit} publications`)
    }

    const toDelete = failed.slice(0, limit)
    console.log(`\nDeleting ${toDelete.length} publications (cascade will remove related references_cited and authors_rels rows)...`)

    let deleted = 0
    for (const f of toDelete) {
      await db.query('DELETE FROM publications WHERE id = $1', [f.id])
      deleted++
      if (deleted % 50 === 0) process.stdout.write(`\r  ${deleted}/${toDelete.length} deleted`)
    }
    console.log(`\r  ${deleted} publications deleted`)

    // Final stats
    const { rows: after } = await db.query(`
      SELECT data_source, COUNT(*) FROM publications GROUP BY data_source ORDER BY 1
    `)
    console.log('\nFinal counts by data_source:')
    for (const r of after) {
      console.log(`  ${r.data_source}: ${r.count}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
