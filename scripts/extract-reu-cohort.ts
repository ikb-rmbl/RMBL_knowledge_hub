/**
 * Derive REU cohorts from RMBL student papers → scripts/data/private/reu-roster-derived.csv
 *
 * The official REU roster (reu-roster-1991-2020.csv) stops at 2020. RMBL
 * student papers carry the signal for later cohorts, mostly on the cover page
 * rather than in acknowledgments: a program line ("Program: REU, Independent
 * Research and Course", "Full Time Independent Research/REU Program 2018")
 * and usually the mentors — exactly what tag-reu-authors.ts needs to match a
 * student onto peer-reviewed papers.
 *
 * Claude reads each student paper's opening + acknowledgment windows and
 * returns, per student author: REU yes/no/unclear, a verbatim quote, the
 * program line, and mentor names. A 'yes' needs its quote found in the text.
 *
 * Keyword search alone is not enough: a paper may only cite someone else's
 * "REU supplement proposal", and a cover page reading "Independent Research
 * (REU)" is not airtight (the REU coordinator's notes flag one such student
 * as not an REU) — so the output is a review-able derived roster, and
 * --calibrate scores it against the official roster for the overlap years.
 *
 * Output is student PII: written only under the gitignored scripts/data/private/.
 *
 * Usage:
 *   npx tsx scripts/extract-reu-cohort.ts [--from=2015] [--to=2025] [--dry-run] [--model=...]
 *   npx tsx scripts/extract-reu-cohort.ts --calibrate   # score 2015–2019 vs the official roster (reads the cache)
 *
 * Results are cached per paper in scripts/output/reu-cohort-cache.json, so
 * re-runs only call Claude for new papers.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js' // .env auto-load
import { callClaude, parseJsonResponse } from './lib/claude-api.js'
import { runConcurrent } from './lib/concurrency.js'
import { readCsvFile } from './lib/csv.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const calibrate = args.includes('--calibrate')
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const FROM = Number(arg('from') ?? 2015)
const TO = Number(arg('to') ?? 2025)
const MODEL = arg('model') ?? 'claude-sonnet-5'
const CONCURRENCY = 4

const PRIVATE_DIR = join(import.meta.dirname, 'data', 'private')
const ROSTER_CSV = join(PRIVATE_DIR, 'reu-roster-1991-2020.csv')
const DERIVED_CSV = join(PRIVATE_DIR, 'reu-roster-derived.csv')
const OUTPUT_DIR = join(import.meta.dirname, 'output')
const CACHE = join(OUTPUT_DIR, 'reu-cohort-cache.json')

const PROGRAM_REU = /\bREU\b|research experiences? for undergrad/i
// Students the REU coordinator's own notes say were NOT REUs despite an REU
// program line ("Donovan Hughes was not an REU", REU pub list, June 2024).
const NOT_REU = new Set(['donovanhughes'])

const OPENING = 2500
const WINDOW = 500
const CUE = /\bREU\b|research experiences? for undergrad|acknowledg|national science foundation|\bNSF\b/gi

interface Extraction {
  students: { name: string; reu: 'yes' | 'no' | 'unclear'; quote: string | null }[]
  program_line: string | null
  mentors: string[]
}
interface CacheEntry { id: number; year: number; extraction: Extraction | null; verified: boolean[] }

const PROMPT = `This is the opening and acknowledgment excerpts of a student research paper written at the Rocky Mountain Biological Laboratory (RMBL). RMBL student papers usually open with a cover block: title, student author(s), mentor(s), and a program line such as "Program: REU, Independent Research and Course" or "Full Time Independent Research/REU Program 2018".

Extract:
- students: each STUDENT author (not mentors). For each, reu = "yes" only if the text states THIS student was in the NSF Research Experiences for Undergraduates (REU) program or was supported by an REU award/supplement; "no" if the text states a different program and no REU; "unclear" otherwise. A citation of someone else's REU proposal, or REU mentioned only in passing, is NOT evidence. When reu is "yes", quote the shortest span that proves it, copied EXACTLY from the text; otherwise quote is null.
- program_line: the program line exactly as written, or null.
- mentors: mentor / advisor names as written (people named as mentor, advisor, or supervisor of this project), [] if none.

Return only JSON: {"students": [{"name": "...", "reu": "yes"|"no"|"unclear", "quote": "..."|null}], "program_line": "..."|null, "mentors": ["..."]}`

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
/** Quote words in order, mostly contiguous (cover blocks wrap mid-line). */
function quoteFound(quote: string, text: string): boolean {
  const q = words(quote)
  if (!q.length) return false
  const t = words(text)
  for (let s = 0; s < t.length; s++) {
    if (t[s] !== q[0]) continue
    let qi = 1
    for (let ci = s + 1; qi < q.length && ci < t.length && ci - s < q.length * 3; ci++) if (t[ci] === q[qi]) qi++
    if (qi === q.length) return true
  }
  return false
}

function excerpt(text: string): string {
  const flat = text.replace(/[ \t]+/g, ' ')
  const parts = [flat.slice(0, OPENING)]
  let last = OPENING
  for (const m of flat.matchAll(CUE)) {
    if (m.index! < last) continue
    parts.push(flat.slice(Math.max(last, m.index! - WINDOW), m.index! + WINDOW))
    last = m.index! + WINDOW
    if (parts.length > 6) break
  }
  return parts.join('\n…\n')
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
/** Compound surnames ("Ortiz Ross", "Vilá Terrada") match on any part. */
const surnameMatch = (a: string, b: string) => {
  const parts = (x: string) => new Set([norm(x), ...x.split(/[\s-]+/).map(norm)].filter((p) => p.length > 1))
  const pb = parts(b)
  return [...parts(a)].some((p) => pb.has(p))
}
/** "Dr. Juliana Jiranek" / "J. Jiranek" → "jiranek|j" */
function personKey(name: string): string {
  const { first, last } = splitName(name.replace(/\b(dr|prof|professor)\.?\s+/gi, ''))
  return `${norm(last)}|${norm(first).charAt(0)}`
}

function splitName(full: string): { first: string; last: string } {
  const w = full.replace(/\(.*?\)/g, '').replace(/[,.]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return { first: w[0] ?? '', last: w.length > 1 ? w[w.length - 1] : '' }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const cache: Record<string, CacheEntry> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}

  if (!calibrate) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    const { rows } = await db.query<{ id: number; year: number; full_text: string }>(
      `SELECT id, year::int AS year, full_text FROM publications
        WHERE publication_type = 'student_paper' AND year BETWEEN $1 AND $2 AND length(full_text) >= 1000
        ORDER BY year, id`,
      [FROM, TO],
    )
    await db.end()
    const todo = rows.filter((r) => !cache[r.id])
    console.log(`${rows.length} student papers ${FROM}–${TO} with text; ${todo.length} not yet extracted (model ${MODEL})${dryRun ? ' [dry-run]' : ''}`)
    if (!dryRun && todo.length) {
      let cost = 0
      const { errors } = await runConcurrent(todo, CONCURRENCY, async (r) => {
        const ex = excerpt(r.full_text)
        const res = await callClaude({ apiKey, model: MODEL, maxTokens: 2000, messages: [{ role: 'user', content: `${PROMPT}\n\n<paper>\n${ex}\n</paper>` }] })
        cost += res.cost
        const parsed = parseJsonResponse<Extraction>(res.text)
        if (!parsed) throw new Error(`unparseable response for #${r.id}`)
        parsed.students = (parsed.students ?? []).filter((s) => s?.name)
        parsed.mentors = (parsed.mentors ?? []).filter(Boolean)
        const verified = parsed.students.map((s) => s.reu === 'yes' && !!s.quote && quoteFound(s.quote, ex))
        cache[r.id] = { id: r.id, year: r.year, extraction: parsed, verified }
      }, 'extract')
      writeFileSync(CACHE, JSON.stringify(cache, null, 1))
      console.log(`  cost $${cost.toFixed(2)}${errors ? ` · ${errors} errors (retry next run)` : ''}`)
    }
  }

  // Derived roster: REU students, cohort = paper year. A student counts when
  // Claude verified a quote, OR the paper's program line names REU. Calibration
  // (2015–2019 vs the official roster) showed the model reads program lines
  // like "Full-time Independent Research/REU" as ambiguous, yet roster
  // students carry exactly those lines — RMBL's program names put REU
  // students in the Independent Research track.
  // Never derive a mentor or PI as an REU student: group papers put the grad
  // student / postdoc lead in the author block under an "…/REU" program line
  // (e.g. a research-plan PI listed first on a 2024 group paper). Keyed on
  // the FIRST year someone was senior — former REUs go on to mentor later
  // cohorts, and must still count for their own REU year.
  const seniorFrom = new Map<string, number>()
  const senior = (key: string, year: number) => seniorFrom.set(key, Math.min(year, seniorFrom.get(key) ?? Infinity))
  for (const c of Object.values(cache)) c.extraction?.mentors.forEach((m) => senior(personKey(m), c.year))
  if (process.env.DATABASE_URL) {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    const { rows } = await db.query<{ pi: string; start_year: number | null }>(`SELECT pi, min(start_year)::int AS start_year FROM projects WHERE pi IS NOT NULL GROUP BY pi`)
    rows.forEach((r) => senior(personKey(r.pi), r.start_year ?? 0))
    await db.end()
  }

  const derived = new Map<string, { first: string; last: string; year: number; mentors: Set<string>; evidence: string; pubId: number }>()
  for (const c of Object.values(cache)) {
    if (!c.extraction) continue
    const programReu = PROGRAM_REU.test(c.extraction.program_line ?? '')
    c.extraction.students.forEach((s, i) => {
      if (!c.verified[i] && !programReu) return
      if (NOT_REU.has(norm(s.name))) return
      // The senior exclusion guards only program-line inferences: an explicit,
      // verified REU statement wins (an REU can peer-mentor a post-bacc the
      // same summer and still be an REU).
      if (!c.verified[i] && (seniorFrom.get(personKey(s.name)) ?? Infinity) <= c.year) return
      const { first, last } = splitName(s.name)
      if (!last) return
      const key = `${norm(last)}|${norm(first).charAt(0)}|${c.year}`
      const evidence = c.verified[i] ? s.quote ?? '' : `program: ${c.extraction!.program_line}`
      const cur = derived.get(key) ?? { first, last, year: c.year, mentors: new Set<string>(), evidence, pubId: c.id }
      c.extraction!.mentors.forEach((m) => cur.mentors.add(m.replace(/\s+/g, ' ').trim()))
      derived.set(key, cur)
    })
  }

  if (calibrate) {
    const roster = readCsvFile(ROSTER_CSV).map((r) => ({ first: norm(r.student_first), last: r.student_last, year: Number(r.cohort_year) }))
    const all = Object.values(cache).filter((c) => c.extraction)
    for (let y = FROM; y <= Math.min(TO, 2019); y++) {
      const inYear = roster.filter((r) => r.year === y)
      const papers = all.filter((c) => c.year === y || c.year === y + 1)
      const authorOf = (r: { first: string; last: string }) =>
        papers.flatMap((c) => c.extraction!.students.map((s, i) => ({ s, ok: c.verified[i] || PROGRAM_REU.test(c.extraction!.program_line ?? '') })))
          .filter(({ s }) => { const n = splitName(s.name); return surnameMatch(s.name.replace(n.first, ''), r.last) && norm(n.first).charAt(0) === r.first.charAt(0) })
      const withPaper = inYear.filter((r) => authorOf(r).length)
      const found = withPaper.filter((r) => authorOf(r).some((a) => a.ok))
      const flagged = [...derived.values()].filter((d) => d.year === y)
      const extra = flagged.filter((d) => !roster.some((r) => Math.abs(r.year - y) <= 1 && surnameMatch(d.last, r.last) && r.first.charAt(0) === norm(d.first).charAt(0)))
      console.log(
        `${y}: roster ${inYear.length} · with a student paper ${withPaper.length} · recovered ${found.length}` +
          ` (${withPaper.length ? Math.round((found.length / withPaper.length) * 100) : 0}%) · flagged ${flagged.length}, not on roster ${extra.length}` +
          (extra.length ? ` [${extra.map((d) => `${d.first} ${d.last}`).join(', ')}]` : ''),
      )
    }
    return
  }

  // Only cohorts after the official roster go to the derived roster file;
  // earlier years stay calibration-only (the official roster is better).
  const rowsOut = [...derived.values()].filter((d) => d.year > 2020).sort((a, b) => a.year - b.year || a.last.localeCompare(b.last))
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [
    'student_first,student_last,cohort_year,supplement,college,mentor,mentor_first,mentor_last,source_publication_id,evidence',
    ...rowsOut.map((d) => [d.first, d.last, String(d.year), '', '', [...d.mentors].join(' / '), '', '', String(d.pubId), d.evidence.replace(/\s+/g, ' ')].map(cell).join(',')),
  ]
  if (!dryRun) writeFileSync(DERIVED_CSV, lines.join('\n') + '\n')
  const byYear = new Map<number, number>()
  rowsOut.forEach((d) => byYear.set(d.year, (byYear.get(d.year) ?? 0) + 1))
  console.log(
    `Derived roster (post-2020): ${rowsOut.length} REU students — ` +
      [...byYear.entries()].map(([y, n]) => `${y}: ${n}`).join(', ') +
      `; ${rowsOut.filter((d) => !d.mentors.size).length} without a named mentor` +
      (dryRun ? ' [dry-run, not written]' : ` → scripts/data/private/reu-roster-derived.csv`),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
