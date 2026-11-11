/**
 * Classify RMBL student papers: who the students are, their level, and the
 * program they were in. Feeds the participant-based student-author metrics
 * (/metrics "# Pubs with Student Authors" / "# Student Authors on Pubs").
 *
 * Why: publications_authors on a student paper is not "the students" — older
 * records list mentors as co-authors (a naive reading made a PI the most
 * prolific "student"), and nothing recorded whether the work was an NSF REU,
 * RMBL Independent Research, a course, or graduate work.
 *
 * Evidence, best first, per paper:
 *   1. 2026+ ingest (data_source='manual'): students and mentors are already
 *      split by ingest-student-papers.ts; REU from the private cohort roster.
 *   2. Legacy Publications DB program field ("REU paper (NSF Research
 *      Experience for Undergraduates). Mentor: C. Boggs", "Field Ecology",
 *      "Advanced Independent Research"…) — snapshot in the gitignored
 *      scripts/data/private/legacy-student-paper-programs.json (pairs titles with
 *      REU status, so it stays private). Rules below; mentors named there are
 *      removed from the student list.
 *   3. Cover page (the paper's own text): students, mentors, program line,
 *      per-student REU with a verified quote — lib/student-paper-cover.ts, the
 *      same extraction and cache (scripts/output/reu-cohort-cache.json) as
 *      extract-reu-cohort.ts. Used when the legacy field is empty, and for
 *      multi-author papers (to tell students from mentors) when text exists.
 *   4. Nothing: level/program 'unknown', all authors assumed students.
 *
 * Writes SQL-only columns (scripts/sql/z-2026-11-10-01-…): student_paper_level,
 * student_paper_program, student_paper_info {students:[{name,reu}], mentors,
 * program_text, source, notes}, student_paper_classified_at. Recomputed in full
 * each run (cheap: only uncached cover pages call Claude, ~$0.006 each).
 * Report (student names — gitignored): scripts/output/student-paper-classification.csv
 *
 * Usage:
 *   npx tsx scripts/classify-student-papers.ts [--dry-run] [--model=]
 *   npx tsx scripts/classify-student-papers.ts --sync-neon [--dry-run]   # copy local results by id + title
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { runConcurrent } from './lib/concurrency.js'
import { curatedSafe } from './lib/curation.js'
import { readCsvFile } from './lib/csv.js'
import {
  extractCover, normName, personKey, PROGRAM_REU,
  type CoverCacheEntry,
} from './lib/student-paper-cover.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const syncNeon = args.includes('--sync-neon')
const MODEL = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-sonnet-5'

const PRIVATE_DIR = join(import.meta.dirname, 'data', 'private')
const LEGACY = join(PRIVATE_DIR, 'legacy-student-paper-programs.json')
const ROSTER_2026 = join(PRIVATE_DIR, 'reu-roster-2026.csv')
const CACHE = join(import.meta.dirname, 'output', 'reu-cohort-cache.json')
const REPORT = join(import.meta.dirname, 'output', 'student-paper-classification.csv')

type Level = 'undergraduate' | 'graduate' | 'unknown'
type Program = 'reu' | 'urp' | 'independent_research' | 'course' | 'rmbl_undergraduate' | 'external_undergraduate' | 'graduate' | 'unknown'

interface Student { name: string; reu: boolean | null }
interface Result {
  level: Level
  program: Program
  students: Student[]
  mentors: string[]
  programText: string | null
  source: 'ingest_2026' | 'legacy_program' | 'cover_page' | 'legacy_program+cover_page' | 'none'
  notes: string[]
}

// ---------------------------------------------------------------- legacy rules

/** Map the legacy program field (+ keywords/degree) to level and program. Order matters. */
export function legacyProgram(text: string): { level: Level; program: Program; course: string | null } {
  const t = text.trim()
  if (/\bR+EU\b|\bREY paper|research experiences? for undergrad/i.test(t)) return { level: 'undergraduate', program: 'reu', course: null }
  if (/\bURP\b|undergraduate research participant/i.test(t)) return { level: 'undergraduate', program: 'urp', course: null }
  if (/\bM\.?S\.? non-thesis|\bMEM candidate|graduate student|Snyder Memorial Fund/i.test(t)) return { level: 'graduate', program: 'graduate', course: null }
  if (/hono(u)?rs thesis|senior thesis|undergraduate (honors )?thesis|college biology department|^B\.?[AS]\.?$/i.test(t)) {
    return { level: 'undergraduate', program: 'external_undergraduate', course: null }
  }
  if (/indep\w*|idepend\w*|indpend\w*|\bAIR\b|\bSUR\b|\bAUR\b|structured (undergraduate )?research|advanced (independent|undergraduate) research|undergraduate research|research training/i.test(t)) {
    return { level: 'undergraduate', program: 'independent_research', course: null }
  }
  if (/unknown|unidentified|^university of /i.test(t)) return { level: 'unknown', program: 'unknown', course: null }
  if (/^"?student paper"?\.?(\s+mentor\b.*)?$/i.test(t)) return { level: 'undergraduate', program: 'rmbl_undergraduate', course: null }
  // Anything else is a course name ("Field Ecology", "Ornithology (581)", "Botany, professor M. Kelrick.").
  const course = t.replace(/^(course|student paper)\s*:\s*/i, '').split(/[;(]|\.\s|,\s*(prof|instructor)/i)[0].trim()
  return { level: 'undergraduate', program: 'course', course: course || t }
}

/** Mentor/instructor names stated in the legacy field ("Mentor: C. Boggs", "R.L. Willey, mentor"). */
export function legacyMentors(text: string): string[] {
  const out: string[] = []
  const add = (s: string) => s.split(/\s+and\s+|,\s*(?=[A-Z])|&/).map((x) => x.replace(/^(dr|prof|professor)\.?\s+/i, '').replace(/[.\s]+$/, '').trim())
    .filter((x) => /[A-Za-z]{2}/.test(x)).forEach((x) => out.push(x))
  for (const m of text.matchAll(/(?:Mentors?|Advisor|Moderator|Instructors?)\s*:\s*([^.;"]+(?:\.[A-Z][^.;"]*)*)/gi)) add(m[1])
  for (const m of text.matchAll(/;\s*([^;]+?),?\s+mentor\b/gi)) add(m[1])
  for (const m of text.matchAll(/(?:directed by|professor|prof\.)\s+([A-Z][^;,.)]*(?:\.\s*[A-Z][^;,.)]*)*)/gi)) add(m[1])
  for (const m of text.matchAll(/([A-Z][a-z]+(?:\s+[A-Z]\.?)*\s+[A-Z][a-z]+)\s+as mentor/g)) add(m[1])
  return [...new Set(out)]
}

/** Cover-page program line → program. */
export function coverProgram(line: string | null): Program {
  if (!line) return 'rmbl_undergraduate'
  if (PROGRAM_REU.test(line)) return 'reu'
  if (/independ/i.test(line)) return 'independent_research'
  if (/course/i.test(line)) return 'course'
  return 'rmbl_undergraduate'
}

// ---------------------------------------------------------------- admin corrections

/**
 * An admin's per-author Student choices on a student paper: "Not a student"
 * takes the person off the student list (a mentor listed as an author) and
 * records them as a mentor; "Student"/"Student (REU)" adds them or sets their
 * REU status. Returns the confirmed students' keys (exempt from seniority).
 * Shared by the local run and --sync-neon, which re-applies the production
 * admin's choices to what it copies.
 */
export function applyAdminCorrections(
  r: Pick<Result, 'students' | 'mentors' | 'notes'>,
  tags: { name: string; program: string }[],
): Set<string> {
  const confirmed = new Set<string>()
  for (const t of tags) {
    const k = personKey(t.name)
    const i = r.students.findIndex((s) => personKey(s.name) === k)
    if (t.program === 'none') {
      if (i >= 0) { r.students.splice(i, 1); r.notes.push(`admin: ${t.name} is not a student`) }
      if (!r.mentors.some((m) => personKey(m) === k)) r.mentors.push(t.name)
    } else if (t.program === 'reu' || t.program === 'student') {
      const reu = t.program === 'reu'
      if (i >= 0) r.students[i] = { ...r.students[i], reu }
      else { r.students.push({ name: t.name, reu }); r.notes.push(`admin: ${t.name} is a student`) }
      confirmed.add(k)
    }
  }
  return confirmed
}

// ---------------------------------------------------------------- helpers

const normTitle = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const surnameKey = (name: string) => personKey(name).split('|')[0]

function csv(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

// ---------------------------------------------------------------- main

async function classifyLocal() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const { rows: papers } = await db.query<{
      id: number; year: number | null; title: string; data_source: string; full_text: string | null
      authors: string[] | null; mentors: string[] | null
      level: string | null; program: string | null; curated: string[]
      tags: { name: string; program: string }[] | null
    }>(`SELECT p.id, p.year::int AS year, p.title, p.data_source, p.full_text,
               p.student_paper_level AS level, p.student_paper_program AS program,
               coalesce(p.curated_fields, '[]'::jsonb) AS curated,
               -- An admin's per-author Student choices on the paper itself.
               (SELECT json_agg(json_build_object('name', s.author_name, 'program', s.student_program))
                  FROM publication_student_authors s WHERE s.publication_id = p.id AND s.curated) AS tags,
               (SELECT array_agg(trim(coalesce(a.given, '') || ' ' || coalesce(a.family, '')) ORDER BY a._order)
                  FROM publications_authors a WHERE a._parent_id = p.id) AS authors,
               (SELECT array_agg(m.name ORDER BY m._order) FROM publications_mentors m WHERE m._parent_id = p.id) AS mentors
          FROM publications p WHERE p.publication_type = 'student_paper' ORDER BY p.id`)

    const legacy = new Map<string, any>()
    for (const r of JSON.parse(readFileSync(LEGACY, 'utf-8'))) legacy.set(normTitle(r.title ?? ''), r)
    const roster2026 = existsSync(ROSTER_2026) ? readCsvFile(ROSTER_2026) : []
    const reu2026 = new Set(roster2026.map((r) => normName(r.student_last ?? '')))
    const cache: Record<string, CoverCacheEntry> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf-8')) : {}

    // Cover pages still needed: text, no cache, and either no legacy program or several authors.
    const hasText = (p: (typeof papers)[number]) => (p.full_text?.length ?? 0) >= 1000
    const legacyFor = (p: (typeof papers)[number]) => legacy.get(normTitle(p.title))
    const needsCover = papers.filter((p) => p.data_source !== 'manual' && hasText(p) && !cache[p.id] &&
      (!legacyFor(p)?.program || (p.authors?.length ?? 0) > 1))
    console.log(`${papers.length} student papers; ${needsCover.length} cover pages to extract (model ${MODEL})${dryRun ? ' [dry-run: not extracted]' : ''}`)
    if (!dryRun && needsCover.length) {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
      let cost = 0
      const { errors } = await runConcurrent(needsCover, 4, async (p) => {
        const { extraction, verified, cost: c } = await extractCover(apiKey, MODEL, p.full_text!)
        cost += c
        cache[p.id] = { id: p.id, year: p.year ?? 0, extraction, verified }
      }, 'cover')
      writeFileSync(CACHE, JSON.stringify(cache, null, 1))
      console.log(`  cost $${cost.toFixed(2)}${errors ? ` · ${errors} errors (re-run to retry)` : ''}`)
    }

    const results = new Map<number, Result>()
    for (const p of papers) {
      const authors = (p.authors ?? []).filter(Boolean)
      const notes: string[] = []
      const isMentor = (name: string, mentors: string[]) => mentors.some((m) => surnameKey(m) && surnameKey(m) === surnameKey(name))

      // 1. 2026+ ingest: authors are the students already.
      if (p.data_source === 'manual') {
        const students = authors.map((name) => ({ name, reu: reu2026.size ? reu2026.has(normName(name.split(' ').pop() ?? '')) : null }))
        results.set(p.id, {
          level: 'undergraduate', program: students.some((s) => s.reu) ? 'reu' : 'rmbl_undergraduate',
          students, mentors: p.mentors ?? [], programText: null, source: 'ingest_2026', notes,
        })
        continue
      }

      const leg = legacyFor(p)
      const legText = [leg?.program, leg?.degree].filter(Boolean).join(' ')
      const kwReu = /\bREU\b/.test(leg?.keywords ?? '')
      const cover = cache[p.id]?.extraction ?? null

      let level: Level = 'unknown'
      let program: Program = 'unknown'
      let source: Result['source'] = 'none'
      let mentors = [...(p.mentors ?? [])]
      let students: Student[] = authors.map((name) => ({ name, reu: null }))

      if (legText) {
        const lp = legacyProgram(legText)
        level = lp.level
        program = lp.program === 'course' && kwReu ? 'reu' : lp.program
        if (lp.course) notes.push(`course: ${lp.course}`)
        mentors = [...new Set([...mentors, ...legacyMentors(`${leg.program ?? ''} ${leg.comments ?? ''}`)])]
        source = 'legacy_program'
      } else if (kwReu) {
        level = 'undergraduate'; program = 'reu'; source = 'legacy_program'; notes.push('REU from legacy keywords')
      }

      if (cover && (source === 'none' || authors.length > 1)) {
        mentors = [...new Set([...mentors, ...cover.mentors])]
        if (source === 'none') {
          level = 'undergraduate' // the education program's collection is undergraduate work
          program = coverProgram(cover.program_line)
          source = 'cover_page'
        } else {
          source = 'legacy_program+cover_page'
        }
        if (cover.students.length) {
          // Map the cover's student names onto the record's author strings where possible.
          const verified = cache[p.id]?.verified ?? []
          students = cover.students.map((s, i) => {
            const match = authors.find((a) => surnameKey(a) === surnameKey(s.name))
            const reu = verified[i] ? true : program === 'reu' ? true : s.reu === 'no' ? false : null
            return { name: match ?? s.name, reu }
          })
          const missing = cover.students.filter((s) => !authors.some((a) => surnameKey(a) === surnameKey(s.name)))
          if (missing.length) notes.push(`cover student(s) not in author list: ${missing.map((s) => s.name).join('; ')}`)
        }
      }

      // Never count a stated mentor as a student.
      const before = students.length
      students = students.filter((s) => !isMentor(s.name, mentors))
      if (students.length < before) notes.push(`removed ${before - students.length} mentor(s) from the author list`)
      if (students.length === 0 && authors.length) notes.push('every author is a stated mentor — check')
      if (program === 'reu') students = students.map((s) => ({ ...s, reu: s.reu ?? true }))
      if (source === 'none') notes.push('no program evidence; all authors assumed students')
      if (source === 'legacy_program' && authors.length > 1 && !cover) notes.push('multi-author, no text: students = authors minus named mentors')

      results.set(p.id, { level, program, students, mentors, programText: legText || cover?.program_line || null, source, notes })
    }

    // ---------------- admin corrections on the student paper itself
    // Per-author Student select: "Not a student" takes a person off the
    // student list (e.g. a mentor listed as an author); "Student"/"Student
    // (REU)" adds them or sets their REU status. Applied before seniority, which
    // skips names an admin confirmed.
    const confirmed = new Map<number, Set<string>>()
    for (const p of papers) {
      if (!p.tags?.length) continue
      confirmed.set(p.id, applyAdminCorrections(results.get(p.id)!, p.tags))
    }

    // ---------------- seniority
    // Older records list mentors/staff as co-authors, and a cover page can name a
    // PI among a group's authors. On multi-author papers (not the 2026 ingest,
    // which split students from mentors itself), drop a listed student who was
    // already senior that year (Ian's 2026-11-11 review: graduate co-mentors
    // listed as authors on group student papers were being counted):
    //   - listed as a mentor on any student paper up to Y+1 (a grad co-mentor
    //     is often a "student" one summer and a named mentor the next);
    //   - authored a graduate thesis in year T, close enough before it to have
    //     been in graduate school: PhD Y >= T-4, master's/unknown Y >= T-1
    //     (a 2020 REU with a 2023 M.S. was an undergraduate in 2020).
    //     Undergraduate theses (B.A./B.S./honors) don't count. Degrees come
    //     from the legacy database snapshot;
    //   - 3+ RMBL articles by year Y.
    // Judged per year — former students go on to mentor, and must still count
    // for their own student years.
    const mentoredYears = new Map<string, number[]>()
    for (const p of papers) {
      for (const m of results.get(p.id)!.mentors) {
        const k = personKey(m)
        if (p.year && k.length > 2) mentoredYears.set(k, [...(mentoredYears.get(k) ?? []), p.year])
      }
    }
    const degreeByTitle = new Map<string, string>()
    const libFile = readdirSync(PRIVATE_DIR).filter((n) => n.startsWith('legacy-pubs-library-')).sort().pop()
    if (libFile) {
      for (const r of JSON.parse(readFileSync(join(PRIVATE_DIR, libFile), 'utf-8'))) {
        if (r.reftypename === 'THESIS' && r.degree) degreeByTitle.set(normTitle(r.title ?? ''), String(r.degree))
      }
    }
    /** Years before a thesis its author was already a graduate student; null = undergraduate thesis. */
    const gradLead = (degree: string | undefined): number | null => {
      if (!degree) return 1
      if (/ph\.?\s*d/i.test(degree)) return 4
      if (/\bB\.?[AS]\.?\b|honou?rs|undergrad/i.test(degree)) return null
      return 1
    }
    const { rows: thesisRows } = await db.query<{ k: string; year: number; title: string }>(
      `SELECT lower(regexp_replace(coalesce(pa.family, ''), '[^A-Za-z]', '', 'g')) || '|' || lower(left(coalesce(pa.given, ''), 1)) AS k,
              p.year::int AS year, p.title
         FROM publications_authors pa JOIN publications p ON p.id = pa._parent_id
        WHERE p.publication_type = 'thesis' AND p.year IS NOT NULL`)
    /** Per person: the earliest year they were in graduate school, by thesis. */
    const gradFrom = new Map<string, number>()
    for (const t of thesisRows) {
      const lead = gradLead(degreeByTitle.get(normTitle(t.title)))
      if (lead == null) continue
      gradFrom.set(t.k, Math.min(t.year - lead, gradFrom.get(t.k) ?? Infinity))
    }
    const { rows: articleYears } = await db.query<{ k: string; years: number[] }>(
      `SELECT lower(regexp_replace(coalesce(pa.family, ''), '[^A-Za-z]', '', 'g')) || '|' || lower(left(coalesce(pa.given, ''), 1)) AS k,
              array_agg(p.year::int) AS years
         FROM publications_authors pa JOIN publications p ON p.id = pa._parent_id
        WHERE p.rmbl_research = 'yes' AND p.publication_type = 'article' AND p.year IS NOT NULL
        GROUP BY 1`)
    const articlesByKey = new Map(articleYears.map((r) => [r.k, r.years]))
    let seniorRemoved = 0
    for (const p of papers) {
      const r = results.get(p.id)!
      if (r.source === 'ingest_2026' || !p.year || Math.max(r.students.length, (p.authors ?? []).length) < 2) continue
      const senior = (name: string) => {
        const k = personKey(name)
        const articlesByY = (articlesByKey.get(k) ?? []).filter((y) => y <= p.year!).length
        const mentored = (mentoredYears.get(k) ?? []).some((y) => y <= p.year! + 1)
        const nearThesis = p.year! >= (gradFrom.get(k) ?? Infinity)
        return mentored || nearThesis || articlesByY >= 3
      }
      const kept = r.students.filter((s) => confirmed.get(p.id)?.has(personKey(s.name)) || !senior(s.name))
      if (kept.length < r.students.length && kept.length > 0) {
        r.notes.push(`senior co-author(s) not counted as students: ${r.students.filter((s) => senior(s.name)).map((s) => s.name).join('; ')}`)
        seniorRemoved += r.students.length - kept.length
        r.students = kept
      } else if (kept.length === 0 && r.students.length) {
        r.notes.push('every listed student looks senior — check')
      }
    }
    console.log(`seniority: ${seniorRemoved} senior co-authors removed from student lists`)

    // ---------------- report
    const rows = papers.map((p) => {
      const r = results.get(p.id)!
      return {
        id: p.id, year: p.year ?? '', level: r.level, program: r.program, source: r.source,
        students: r.students.map((s) => `${s.name}${s.reu ? ' [REU]' : ''}`).join('; '),
        mentors: r.mentors.join('; '), authors_on_record: (p.authors ?? []).join('; '),
        program_text: r.programText ?? '', notes: r.notes.join(' | '), title: p.title,
      }
    })
    writeFileSync(REPORT, csv(rows))
    const tally = (f: (r: Result) => string) => {
      const m = new Map<string, number>()
      for (const r of results.values()) m.set(f(r), (m.get(f(r)) ?? 0) + 1)
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
    }
    console.log(`\nlevel:   ${tally((r) => r.level)}`)
    console.log(`program: ${tally((r) => r.program)}`)
    console.log(`source:  ${tally((r) => r.source)}`)
    const all = [...results.values()]
    console.log(`students: ${all.reduce((n, r) => n + r.students.length, 0)} on ${all.length} papers ` +
      `(${all.reduce((n, r) => n + r.students.filter((s) => s.reu).length, 0)} REU); ` +
      `mentors removed from author lists on ${all.filter((r) => r.notes.some((n) => n.startsWith('removed'))).length} papers; ` +
      `${all.filter((r) => r.notes.some((n) => n.includes('check'))).length} flagged`)
    console.log(`Report → ${REPORT}`)

    if (!dryRun) {
      // Level/program an admin set in the sidebar stand (curation-tracked).
      for (const [id, r] of results) {
        await db.query(
          `UPDATE publications SET ${curatedSafe('student_paper_level', '$1')}, ${curatedSafe('student_paper_program', '$2')},
                  student_paper_info = $3::jsonb, student_paper_classified_at = now() WHERE id = $4`,
          [r.level, r.program, JSON.stringify({ students: r.students, mentors: r.mentors, program_text: r.programText, source: r.source, notes: r.notes }), id],
        )
      }
      console.log(`Wrote classification for ${results.size} student papers.`)
    } else {
      console.log('[dry-run] nothing written.')
    }
  } finally {
    await db.end()
  }
}

/** Copy local results to Neon, matching by id AND title (ids are shared for these legacy rows). */
async function copyToNeon() {
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL })
  try {
    const { rows } = await local.query(
      `SELECT id, title, student_paper_level, student_paper_program, student_paper_info FROM publications
        WHERE publication_type = 'student_paper' AND student_paper_classified_at IS NOT NULL`)
    let written = 0
    const skipped: number[] = []
    for (const r of rows) {
      if (dryRun) {
        const { rows: n } = await neon.query(`SELECT title FROM publications WHERE id = $1`, [r.id])
        if (n[0] && normTitle(n[0].title) === normTitle(r.title)) written++
        else skipped.push(r.id)
        continue
      }
      // Production admins' corrections win: curated level/program stand, and
      // their per-author Student choices on the paper are re-applied.
      const info = r.student_paper_info ?? { students: [], mentors: [], notes: [] }
      const { rows: neonTags } = await neon.query<{ name: string; program: string }>(
        `SELECT author_name AS name, student_program AS program FROM publication_student_authors WHERE publication_id = $1 AND curated`, [r.id])
      if (neonTags.length) applyAdminCorrections(info, neonTags)
      const res = await neon.query(
        `UPDATE publications SET ${curatedSafe('student_paper_level', '$1')}, ${curatedSafe('student_paper_program', '$2')},
                student_paper_info = $3::jsonb, student_paper_classified_at = now()
          WHERE id = $4 AND regexp_replace(lower(title), '[^a-z0-9]+', ' ', 'g') = regexp_replace(lower($5), '[^a-z0-9]+', ' ', 'g')`,
        [r.student_paper_level, r.student_paper_program, JSON.stringify(info), r.id, r.title],
      )
      if (res.rowCount) written++
      else skipped.push(r.id)
    }
    console.log(`${dryRun ? '[dry-run] would write' : 'Wrote'} ${written}/${rows.length} on Neon` +
      (skipped.length ? `; ${skipped.length} skipped (no id+title match): ${skipped.slice(0, 20).join(', ')}` : ''))
  } finally {
    await local.end()
    await neon.end()
  }
}

;(syncNeon ? copyToNeon() : classifyLocal()).catch((err) => {
  console.error(err)
  process.exit(1)
})
