/**
 * RMBL-Research auto-assignment scoring (see lib/rmbl-research-score.ts for
 * the signal definitions and calibration numbers).
 *
 * Modes:
 *   (default)   rank the triage queue (rmbl_research IS NULL) into
 *               scripts/output/rmbl-research-triage.csv — read-only
 *   --apply     write scores to publications.rmbl_research_score for papers
 *               awaiting a determination (run by pipeline.ts after LOAD so
 *               new discoveries land pre-ranked); bumps updated_at
 *   --evaluate  score known rmbl_research='yes' papers (2025+) and report
 *               recall at thresholds — the calibration check
 *
 * Flags: --target=neon with --apply for production.
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { OUTPUT_DIR } from './lib/config.js'
import { buildScoringContext, scorePublication } from './lib/rmbl-research-score.js'

const evaluate = process.argv.includes('--evaluate')
const apply = process.argv.includes('--apply')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}
if (target === 'neon' && !apply) {
  console.error('--target=neon only makes sense with --apply')
  process.exit(1)
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString })
  try {
    const ctx = await buildScoringContext(db)
    const scopeWhere = evaluate ? `p.rmbl_research = 'yes' AND p.year >= 2025` : `p.rmbl_research IS NULL`
    const { rows } = await db.query(`
      SELECT p.id, p.title, p.year,
             coalesce(p.title,'') || ' ' || coalesce(p.abstract,'') || ' ' || left(coalesce(p.full_text,''), 100000) AS text,
             coalesce(json_agg(json_build_object('family', pa.family, 'given', pa.given))
                      FILTER (WHERE pa.family IS NOT NULL), '[]') AS authors
      FROM publications p
      LEFT JOIN publications_authors pa ON pa._parent_id = p.id
      WHERE ${scopeWhere}
      GROUP BY p.id
    `)
    console.log(
      `Target: ${target} — ${rows.length} papers to score (${evaluate ? 'evaluation: known-yes 2025+' : 'triage queue'})`,
    )

    const scored = rows
      .map((r: any) => ({ id: r.id, year: r.year, title: r.title, ...scorePublication(r.id, r.text, r.authors, ctx) }))
      .sort((a, b) => b.score - a.score)

    const thresholds = [0.5, 1.0, 1.5, 2.0, 2.5]
    if (evaluate) {
      console.log(`\nRecall on known RMBL-research papers (2025+, n=${scored.length}):`)
      for (const t of thresholds) {
        const n = scored.filter((s) => s.score >= t).length
        console.log(`  score >= ${t.toFixed(1)}: ${n} (${((100 * n) / scored.length).toFixed(0)}%)`)
      }
      const zero = scored.filter((s) => s.score === 0)
      console.log(`  score = 0 (missed entirely): ${zero.length}`)
      for (const z of zero.slice(0, 8)) console.log(`    [${z.year}] ${z.title.slice(0, 65)}`)
      return
    }

    console.log(`\nTriage-queue banding (n=${scored.length}):`)
    for (const t of thresholds) {
      console.log(`  score >= ${t.toFixed(1)}: ${scored.filter((s) => s.score >= t).length}`)
    }

    if (apply) {
      let written = 0
      for (const s of scored) {
        const res = await db.query(
          `UPDATE publications SET rmbl_research_score = $1,
             updated_at = CASE WHEN rmbl_research_score IS DISTINCT FROM $1 THEN NOW() ELSE updated_at END
           WHERE id = $2 AND rmbl_research_score IS DISTINCT FROM $1`,
          [Math.round(s.score * 100) / 100, s.id],
        )
        written += res.rowCount ?? 0
      }
      console.log(`\n${written} scores written (${scored.length - written} unchanged).`)
    } else {
      const path = join(OUTPUT_DIR, 'rmbl-research-triage.csv')
      const esc = (v: unknown) => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      writeFileSync(
        path,
        'id,score,author_matches,strong_text,weak_text,pi_match,year,title\n' +
          scored
            .map((s) => [s.id, s.score.toFixed(2), s.authorMatches, s.strong, s.weak, s.piMatch, s.year, esc(s.title)].join(','))
            .join('\n') + '\n',
      )
      console.log(`\nRanked triage list → ${path}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
