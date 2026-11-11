/**
 * Import the legacy Publications Database's student signals, which the
 * original load dropped:
 *
 *   1. The "Student" tag (tag id 5) and the per-record `student` flag mark a
 *      publication as having a student author — the signal behind the
 *      previously reported "articles with undergraduate authors" figures.
 *      → publications.legacy_student_flag = TRUE (publication level; the old
 *        database did not say which author). Counted toward "# Pubs with
 *        Student Authors" (Ian, 2026-11-11), not toward author counts.
 *   2. Asterisks in recent author lists ("Smith AB, Doe JQ*") name
 *      the student authors.
 *      → publication_student_authors rows, detection_method = 'legacy_asterisk',
 *        student_program = 'student_paper' (an REU tag from tag-reu-authors.ts
 *        takes precedence for the same author).
 *
 * Inputs (gitignored, from old.rmbl.org via cloudflared — see
 * scrape-legacy-research-plans.ts for access):
 *   scripts/data/private/legacy-pubs-library-<date>.json
 *   scripts/data/private/legacy-pubs-tags-<date>.json
 *
 * Records are matched to the target database by title (exact after
 * normalisation, else trigram >= 0.9 within a year, preferring reviewed RMBL
 * records), so the same run works against Neon without relying on ids.
 * Idempotent: the flag and 'legacy_asterisk' rows are re-derived each run;
 * curated rows are never touched.
 *
 * Usage:
 *   npx tsx scripts/import-legacy-student-signals.ts [--dry-run] [--target=neon]
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { personKey } from './lib/student-paper-cover.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

const PRIVATE_DIR = join(import.meta.dirname, 'data', 'private')
const latest = (prefix: string) => {
  const f = readdirSync(PRIVATE_DIR).filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort().pop()
  if (!f) throw new Error(`No ${prefix}*.json in ${PRIVATE_DIR}`)
  return join(PRIVATE_DIR, f)
}

/** Record types that are not student papers (those are handled by classify-student-papers.ts). */
const PUBLICATION_TYPES = new Set(['ARTICLE', 'CHAPTER', 'BOOK', 'OTHER', 'THESIS'])

/** "Doe JQ*" / "de Valpine P" → personKey form "doe|j". */
function legacyAuthorKey(raw: string): string {
  const n = raw.replace(/\*/g, '').trim()
  const toks = n.split(/\s+/)
  const initials = /^[A-Z]{1,3}\.?$/.test(toks[toks.length - 1] ?? '') ? toks.pop()! : ''
  return personKey(`${initials.charAt(0)}. ${toks.join(' ')}`)
}

async function main() {
  const library: any[] = JSON.parse(readFileSync(latest('legacy-pubs-library-'), 'utf-8'))
  const tagFile = JSON.parse(readFileSync(latest('legacy-pubs-tags-'), 'utf-8'))
  const studentTagged = new Set<string>((tagFile.tags?.Student ?? []).map(String))

  const flagged = library.filter((r) => PUBLICATION_TYPES.has(r.reftypename) && (studentTagged.has(String(r.id)) || r.student === 'T'))
  const starred = library.filter((r) => PUBLICATION_TYPES.has(r.reftypename) && (r.authors ?? '').includes('*'))
  const records = [...new Map([...flagged, ...starred].map((r) => [String(r.id), r])).values()]
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  console.log(`Legacy: ${flagged.length} publications flagged/tagged Student, ${starred.length} with asterisked authors (${records.length} distinct)`)

  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  const client = await db.connect()
  try {
    // ---------------- match legacy records to publications
    const match = new Map<string, number>()
    const unmatched: any[] = []
    for (const r of records) {
      const { rows } = await client.query<{ id: number }>(
        `SELECT id FROM publications
          WHERE publication_type <> 'student_paper'
            AND (regexp_replace(lower(title), '[^a-z0-9]+', ' ', 'g') = regexp_replace(lower($1), '[^a-z0-9]+', ' ', 'g')
                 OR (similarity(lower(title), lower($1)) >= 0.9 AND ($2::int IS NULL OR abs(year - $2::int) <= 1)))
          ORDER BY (regexp_replace(lower(title), '[^a-z0-9]+', ' ', 'g') = regexp_replace(lower($1), '[^a-z0-9]+', ' ', 'g')) DESC,
                   (rmbl_research = 'yes') DESC NULLS LAST, similarity(lower(title), lower($1)) DESC
          LIMIT 1`,
        [r.title ?? '', /^\d{4}$/.test(String(r.year)) ? Number(r.year) : null],
      )
      if (rows[0]) match.set(String(r.id), rows[0].id)
      else unmatched.push(r)
    }
    const flaggedIds = [...new Set(flagged.map((r) => match.get(String(r.id))).filter((x): x is number => x != null))]
    console.log(`Matched ${match.size}/${records.length}; ${flaggedIds.length} publications to flag`)
    for (const r of unmatched) console.log(`  unmatched: ${r.year} ${r.reftypename} "${String(r.title).slice(0, 70)}"`)

    // ---------------- asterisked authors → registry authors on the matched publication
    const tags: { pub: number; authorId: number; name: string; legacyId: string }[] = []
    const unresolved: string[] = []
    for (const r of starred) {
      const pub = match.get(String(r.id))
      if (!pub) continue
      const { rows: authors } = await client.query<{ id: number; name: string }>(
        `SELECT a.id, a.display_name AS name FROM authors_rels ar JOIN authors a ON a.id = ar.parent_id WHERE ar.publications_id = $1`,
        [pub],
      )
      for (const raw of String(r.authors).split(',').map((s: string) => s.trim()).filter((s: string) => s.includes('*'))) {
        const hit = authors.find((a) => personKey(a.name) === legacyAuthorKey(raw))
        if (hit) tags.push({ pub, authorId: hit.id, name: hit.name, legacyId: String(r.id) })
        else unresolved.push(`#${pub} ${raw}`)
      }
    }
    console.log(`Asterisks: ${tags.length} student authors on ${new Set(tags.map((t) => t.pub)).size} publications` +
      (unresolved.length ? `; ${unresolved.length} not found among the publication's authors: ${unresolved.join(', ')}` : ''))

    if (dryRun) {
      const { rows: [now] } = await client.query(`SELECT count(*) FILTER (WHERE legacy_student_flag)::int AS flagged FROM publications`)
      console.log(`[dry-run] currently flagged: ${now.flagged}; nothing written.`)
      return
    }

    await client.query('BEGIN')
    await client.query(`UPDATE publications SET legacy_student_flag = NULL WHERE legacy_student_flag IS NOT NULL AND NOT (id = ANY($1))`, [flaggedIds])
    const set = await client.query(`UPDATE publications SET legacy_student_flag = TRUE WHERE id = ANY($1) AND legacy_student_flag IS NOT TRUE`, [flaggedIds])
    const del = await client.query(`DELETE FROM publication_student_authors WHERE detection_method = 'legacy_asterisk' AND NOT curated`)
    let written = 0
    for (const t of tags) {
      // An asterisk is direct evidence, so it replaces an inferred participant
      // tag; REU, curated and structural rows stand.
      const res = await client.query(
        `INSERT INTO publication_student_authors (publication_id, author_id, author_name, student_program, detection_method, evidence)
         VALUES ($1, $2, $3, 'student_paper', 'legacy_asterisk', $4::jsonb)
         ON CONFLICT (publication_id, author_name) DO UPDATE SET detection_method = 'legacy_asterisk', evidence = EXCLUDED.evidence
           WHERE NOT publication_student_authors.curated
             AND publication_student_authors.detection_method = 'participant'
             AND publication_student_authors.student_program = 'student_paper'`,
        [t.pub, t.authorId, t.name, JSON.stringify({ legacy_id: t.legacyId })],
      )
      written += res.rowCount ?? 0
    }
    await client.query('COMMIT')
    console.log(`Flagged ${flaggedIds.length} publications (${set.rowCount} newly); asterisk tags: ${del.rowCount} replaced with ${written} ` +
      `(the rest already held an REU or curated tag)`)
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
