/**
 * RMBL-Research auto-assignment prototype (roadmap item 1 follow-on)
 *
 * Scores publications on how likely they are to be "RMBL research", so the
 * manual triage queue can be pre-ranked (and eventually auto-assigned at the
 * high-confidence end). Read-only: writes a ranked CSV, never the database.
 *
 * Signals (all computable at ingest time):
 *   1. author_overlap — how many of the paper's authors (family + first
 *      initial) appear on OTHER publications already marked rmbl_research=
 *      'yes'. Leave-self-out so evaluation on known papers isn't circular.
 *   2. text_strong / text_weak — RMBL markers in title+abstract+fullText:
 *      strong = "Rocky Mountain Biological" / "RMBL";
 *      weak   = Gothic / East River / Crested Butte / Gunnison place names.
 *   3. pi_match — an author matches a project PI (projects.pi).
 *
 * score = 2·min(authorMatches,3)/3 + 2·strong + 0.5·weak(cap 1) + 1.5·pi
 *
 * Modes:
 *   --evaluate  score the curated ground truth (rmbl_research='yes' papers
 *               from the 2026 curated list years) and report recall at
 *               thresholds
 *   default     rank the triage queue (rmbl_research IS NULL) into
 *               scripts/output/rmbl-research-triage.csv
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { OUTPUT_DIR } from './lib/config.js'

const evaluate = process.argv.includes('--evaluate')

const STRONG_RE = /rocky mountain biological|\brmbl\b/i
const WEAK_RE = /gothic,? colorado|east river|crested butte|gunnison/i

interface Row {
  id: number
  title: string
  year: number | null
  text: string
  authors: { family: string; initial: string }[]
}

function nameKey(family: string, given: string | null): string {
  return `${family.trim().toLowerCase()}|${(given ?? '').trim().slice(0, 1).toLowerCase()}`
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // Known-RMBL author name → set of yes-paper ids they appear on
    const { rows: yesAuthors } = await db.query(`
      SELECT pa.family, pa.given, pa._parent_id AS pub_id
      FROM publications_authors pa
      JOIN publications p ON p.id = pa._parent_id
      WHERE p.rmbl_research = 'yes'
    `)
    const knownAuthors = new Map<string, Set<number>>()
    for (const a of yesAuthors) {
      const k = nameKey(a.family, a.given)
      if (!knownAuthors.has(k)) knownAuthors.set(k, new Set())
      knownAuthors.get(k)!.add(a.pub_id)
    }

    // Project PI names
    const { rows: pis } = await db.query(`SELECT pi FROM projects WHERE pi IS NOT NULL AND pi <> ''`)
    const piKeys = new Set<string>()
    for (const { pi } of pis) {
      for (const name of String(pi).split(/[,;&]| and /)) {
        const parts = name.trim().split(/\s+/)
        if (parts.length >= 2) piKeys.add(nameKey(parts[parts.length - 1], parts[0]))
      }
    }

    const scopeWhere = evaluate
      ? `p.rmbl_research = 'yes' AND p.year >= 2025`
      : `p.rmbl_research IS NULL`
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
    console.log(`${rows.length} papers to score (${evaluate ? 'evaluation: known-yes 2025+' : 'triage queue'})`)

    const scored = rows.map((r: any) => {
      const authors: { family: string; given: string | null }[] = r.authors
      let authorMatches = 0
      let piMatch = 0
      for (const a of authors) {
        const k = nameKey(a.family, a.given)
        const pubs = knownAuthors.get(k)
        // leave-self-out: the author must appear on some OTHER yes paper
        if (pubs && (pubs.size > 1 || !pubs.has(r.id))) authorMatches++
        if (piKeys.has(k)) piMatch = 1
      }
      const strong = STRONG_RE.test(r.text) ? 1 : 0
      const weak = WEAK_RE.test(r.text) ? 1 : 0
      const score = 2 * Math.min(authorMatches, 3) / 3 + 2 * strong + 0.5 * weak + 1.5 * piMatch
      return { id: r.id, year: r.year, title: r.title, authorMatches, strong, weak, piMatch, score }
    })
    scored.sort((a, b) => b.score - a.score)

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
    } else {
      console.log(`\nTriage-queue banding (n=${scored.length}):`)
      for (const t of thresholds) {
        const n = scored.filter((s) => s.score >= t).length
        console.log(`  score >= ${t.toFixed(1)}: ${n}`)
      }
      const path = join(OUTPUT_DIR, 'rmbl-research-triage.csv')
      const esc = (v: unknown) => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      writeFileSync(
        path,
        'id,score,author_matches,strong_text,weak_text,pi_match,year,title\n' +
          scored.map((s) => [s.id, s.score.toFixed(2), s.authorMatches, s.strong, s.weak, s.piMatch, s.year, esc(s.title)].join(',')).join('\n') + '\n',
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
