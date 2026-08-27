/**
 * Student-author auto-detection → publication_student_authors
 *
 * Seeds student tags from structural signals; manual/roster rows (curated or
 * detection_method != 'publication_type') are never touched, so re-runs are
 * safe after any pipeline change.
 *
 * Signals (v1):
 *   - publication_type = 'student_paper' → every author is a student
 *     (program 'student_paper'; RMBL student papers are course/summer work)
 *   - publication_type = 'thesis'        → every author is a student
 *     (program 'thesis')
 *
 * REU tagging needs an external cohort roster (no signal exists in the DB) —
 * load it later with detection_method='roster', student_program='reu'.
 *
 * Usage:
 *   npx tsx scripts/tag-student-authors.ts [--dry-run] [--target=neon]
 *
 * Writes directly to PostgreSQL — no dev server needed.
 */

import pg from 'pg'
import './lib/config.js' // .env auto-load

const dryRun = process.argv.includes('--dry-run')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })
  try {
    // Refresh author_id links that went stale after an authors rebuild
    // (author_id nulled by ON DELETE SET NULL; recover by exact name).
    const relink = await db.query(`
      UPDATE publication_student_authors sa
      SET author_id = a.id
      FROM authors a
      WHERE sa.author_id IS NULL AND a.display_name = sa.author_name
    `)
    if (relink.rowCount) console.log(`  ${relink.rowCount} stale author links repaired by name`)

    // Structural seed: authors of student papers + theses, via authors_rels
    // (the authoritative author↔publication link).
    const seedSql = `
      SELECT DISTINCT p.id AS publication_id, a.id AS author_id, a.display_name AS author_name,
             p.publication_type
      FROM publications p
      JOIN authors_rels ar ON ar.publications_id = p.id
      JOIN authors a ON a.id = ar.parent_id
      WHERE p.publication_type IN ('student_paper', 'thesis')
    `
    const { rows: candidates } = await db.query(seedSql)
    console.log(`  ${candidates.length} author-publication pairs from student papers + theses`)

    let inserted = 0
    for (const c of candidates) {
      if (dryRun) continue
      const res = await db.query(
        `INSERT INTO publication_student_authors
           (publication_id, author_id, author_name, student_program, detection_method)
         VALUES ($1, $2, $3, $4, 'publication_type')
         ON CONFLICT (publication_id, author_name) DO NOTHING`,
        [c.publication_id, c.author_id, c.author_name, c.publication_type],
      )
      inserted += res.rowCount ?? 0
    }

    const { rows: [stats] } = await db.query(`
      SELECT count(*)::int AS total,
             count(DISTINCT publication_id)::int AS pubs,
             count(DISTINCT author_id)::int AS authors,
             count(*) FILTER (WHERE student_program = 'reu')::int AS reu,
             count(*) FILTER (WHERE curated)::int AS curated
      FROM publication_student_authors
    `)
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Done: ${inserted} inserted this run. ` +
        `Table now: ${stats.total} tags across ${stats.pubs} publications / ${stats.authors} authors ` +
        `(${stats.reu} REU, ${stats.curated} curated).`,
    )
    if (stats.reu === 0) {
      console.log(`  Note: REU tagging awaits the cohort roster (detection_method='roster').`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
