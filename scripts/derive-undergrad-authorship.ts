/**
 * Publication-level undergraduate authorship — the last step of the student
 * tagging chain (classify-student-papers → tag-student-authors →
 * tag-reu-authors → import-legacy-student-signals → this).
 *
 *   undergrad_author = 'yes' when any author carries an undergraduate-program
 *     tag (UNDERGRAD_TAGS in src/services/reporting-metrics.ts) or the legacy
 *     Publications Database marked the paper (legacy_student_flag); NULL
 *     otherwise. An admin's 'yes'/'no' (curated_fields 'undergradAuthor') is
 *     never overwritten — that is how a flag-only paper is confirmed or a wrong
 *     one overruled. Drives "# Pubs with Student Authors" and the public
 *     "Undergraduate author" search filter.
 *   reu_author = an REU-tagged author is on the paper (admin-only display).
 *
 * Student papers and theses are skipped: their authors are students by
 * definition, and the metrics count peer-reviewed work.
 *
 * Usage:
 *   npx tsx scripts/derive-undergrad-authorship.ts [--dry-run] [--target=neon]
 */

import pg from 'pg'
import './lib/config.js'
import { curatedSafe } from './lib/curation.js'
import { UNDERGRAD_TAGS } from '../src/services/reporting-metrics.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  const client = await db.connect()
  try {
    const derived = `
      SELECT p.id,
             (p.legacy_student_flag IS TRUE OR EXISTS (
                SELECT 1 FROM publication_student_authors s WHERE s.publication_id = p.id AND ${UNDERGRAD_TAGS})) AS undergrad,
             EXISTS (SELECT 1 FROM publication_student_authors s WHERE s.publication_id = p.id AND s.student_program = 'reu') AS reu
        FROM publications p
       WHERE p.publication_type NOT IN ('student_paper', 'thesis')`
    const { rows: [before] } = await client.query(
      `SELECT count(*) FILTER (WHERE d.undergrad)::int AS auto_yes,
              count(*) FILTER (WHERE d.reu)::int AS reu,
              count(*) FILTER (WHERE p.curated_fields @> '["undergradAuthor"]')::int AS curated,
              count(*) FILTER (WHERE p.curated_fields @> '["undergradAuthor"]' AND p.undergrad_author = 'yes')::int AS curated_yes,
              count(*) FILTER (WHERE p.curated_fields @> '["undergradAuthor"]' AND p.undergrad_author = 'no')::int AS curated_no
         FROM (${derived}) d JOIN publications p ON p.id = d.id`)
    console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
    console.log(`  evidence of an undergraduate author on ${before.auto_yes} publications (${before.reu} with an REU author)`)
    console.log(`  admin-curated: ${before.curated} (${before.curated_yes} yes, ${before.curated_no} no) — left as set`)
    if (dryRun) return

    await client.query('BEGIN')
    const res = await client.query(
      `UPDATE publications p
          SET ${curatedSafe('undergrad_author', `CASE WHEN d.undergrad THEN 'yes' END`, 'undergradAuthor')},
              reu_author = d.reu
         FROM (${derived}) d
        WHERE p.id = d.id
          AND (p.undergrad_author IS DISTINCT FROM (CASE WHEN p.curated_fields @> '["undergradAuthor"]' THEN p.undergrad_author
                                                        WHEN d.undergrad THEN 'yes' END)
               OR p.reu_author IS DISTINCT FROM d.reu)`,
    )
    await client.query('COMMIT')
    const { rows: [after] } = await client.query(
      `SELECT count(*) FILTER (WHERE undergrad_author = 'yes')::int AS yes, count(*) FILTER (WHERE reu_author)::int AS reu FROM publications`)
    console.log(`Updated ${res.rowCount}; now ${after.yes} publications marked "Undergraduate author", ${after.reu} with an REU author.`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
