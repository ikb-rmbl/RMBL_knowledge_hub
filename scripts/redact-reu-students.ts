/**
 * Remove REU students' names from the documents rescued from the legacy
 * rmbl.org website (provenance.discoveryMethod = 'wayback_rescue').
 *
 * The old site published REU cohort rosters ("Metadata from the REU Students,
 * Summer 2003: student, mentor, paper") and one metadata page per student
 * project ("REU Project Metadata by …"). The Knowledge Commons does not publish
 * lists of students (Ian, 2026-11-11 and 2026-11-18), so the students' names
 * are replaced with "[REU student]". Mentors, project titles and abstracts stay.
 *
 *   1. Every rescued document that mentions REU is read by Claude (the text,
 *      or windows around each REU mention for long pages), which lists the
 *      people the text identifies as REU students or participants — not
 *      mentors, faculty or staff. A name is kept only if it occurs verbatim.
 *   2. Every rescued document (not only the REU ones: indexes and newsletters
 *      repeat the names) has each name replaced in its title, summary and full
 *      text, in the forms "First Last", "First M. Last" and "Last, First".
 *      Per-student metadata pages are retitled from their project title.
 *
 * The name list is PII and goes to the gitignored
 * scripts/data/private/reu-rescue-students.json (re-used by --target=neon and
 * re-runs; --refresh re-reads with Claude). The rescue export itself
 * (~/code/RMBL_metadata_rescue) still holds the names: a re-load that replaced
 * these rows would need this script again (the hub loader dedupes on
 * source_url, so a re-load does not overwrite them).
 *
 * Usage:
 *   npx tsx scripts/redact-reu-students.ts [--dry-run] [--target=neon] [--refresh] [--model=]
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { callClaude, parseJsonResponse } from './lib/claude-api.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const refresh = args.includes('--refresh')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)
const MODEL = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-sonnet-5'

const NAMES_FILE = join(import.meta.dirname, 'data', 'private', 'reu-rescue-students.json')
const REU = /\bREU\b|research experiences? for undergrad/i
const TOKEN = '[REU student]'
const RESCUED = `provenance->>'discoveryMethod' = 'wayback_rescue'`

const PROMPT = `Below is text from the Rocky Mountain Biological Laboratory's old website (2000-2014). List every person the text identifies as an REU student — an undergraduate in the NSF Research Experiences for Undergraduates program at RMBL (e.g. in an REU roster, "REU Project Metadata by X", "REU student X presented"). Do NOT include mentors, faculty, investigators, staff, trustees, or students not identified as REU participants. Copy each name exactly as written (keep "Last, First" order if the text uses it). Return only JSON: {"students": ["..."]} ([] if none).`

/** Text Claude reads: the whole page, or windows around each REU mention for long ones. */
function excerpt(text: string): string {
  if (text.length <= 12000) return text
  const parts: string[] = []
  let last = -1
  for (const m of text.matchAll(new RegExp(REU.source, 'gi'))) {
    if (m.index! < last) continue
    parts.push(text.slice(Math.max(0, m.index! - 1500), m.index! + 2500))
    last = m.index! + 2500
    if (parts.length >= 8) break
  }
  return parts.join('\n…\n')
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Regexes for the forms a name takes on the old site. */
export function namePatterns(name: string): RegExp[] {
  // "Doe,JQ; Roe,RS" — a co-author list: the student is listed first.
  const clean = name.split(';')[0].replace(/\s+/g, ' ').trim()
  let first: string, last: string
  if (clean.includes(',')) {
    ;[last, first] = clean.split(',').map((s) => s.trim())
  } else {
    const t = clean.split(' ')
    first = t[0]
    last = t[t.length - 1]
  }
  // (?![A-Za-z]) rather than \b: a name may end in "." ("Doe, J.").
  const END = '(?![A-Za-z])'
  if (!first || !last || first === last) return [new RegExp(`\\b${esc(clean)}${END}`, 'g')]
  const F = esc(first.split(' ')[0])
  const L = esc(last)
  return [
    new RegExp(`\\b${F}(?:\\s+[A-Z]\\.?)*\\s+${L}${END}`, 'g'), // First [M.] Last
    new RegExp(`\\b${L},\\s*${F}${END}`, 'g'), // Last, First
  ]
}

export function redact(text: string | null, names: string[]): { text: string | null; n: number } {
  if (!text) return { text, n: 0 }
  let n = 0
  let out = text
  for (const name of names) {
    for (const re of namePatterns(name)) {
      out = out.replace(re, () => {
        n++
        return TOKEN
      })
    }
  }
  return { text: out, n }
}

async function findNames(db: pg.Pool): Promise<string[]> {
  if (existsSync(NAMES_FILE) && !refresh) return JSON.parse(readFileSync(NAMES_FILE, 'utf-8')).students
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const { rows } = await db.query<{ id: number; title: string; full_text: string }>(
    `SELECT id, title, full_text FROM documents WHERE ${RESCUED} AND (full_text ~* $1 OR title ~* $1) ORDER BY id`,
    ['\\mREU\\M|research experiences? for undergrad'],
  )
  console.log(`Reading ${rows.length} rescued documents that mention REU (${MODEL})...`)
  const names = new Set<string>()
  let cost = 0
  for (const r of rows) {
    const text = excerpt(`${r.title}\n${r.full_text}`)
    const res = await callClaude({ apiKey, model: MODEL, maxTokens: 2000, messages: [{ role: 'user', content: `${PROMPT}\n\n<page>\n${text}\n</page>` }] })
    cost += res.cost
    const parsed = parseJsonResponse<{ students: string[] }>(res.text)
    for (const s of parsed?.students ?? []) {
      const name = s.replace(/\s+/g, ' ').trim()
      // Verbatim check (whitespace-tolerant), and at least two name parts.
      if (name.split(/[\s,]+/).filter(Boolean).length < 2) continue
      if (!new RegExp(esc(name).replace(/ /g, '\\s+')).test(text)) continue
      names.add(name)
    }
  }
  // "REU Project Metadata by <Name>" is unambiguous; make sure none is missed.
  const { rows: meta } = await db.query<{ m: string }>(
    `SELECT (regexp_match(full_text, 'REU Project Metadata by ([A-Z][^\\n]{2,40})'))[1] AS m FROM documents WHERE ${RESCUED}`)
  for (const { m } of meta) if (m) names.add(m.trim())
  const list = [...names].sort()
  writeFileSync(NAMES_FILE, JSON.stringify({ generated: new Date().toISOString(), model: MODEL, students: list }, null, 1))
  console.log(`  ${list.length} REU student names (Claude cost $${cost.toFixed(2)}) → ${NAMES_FILE}`)
  return list
}

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  try {
    const names = await findNames(db)
    const { rows: docs } = await db.query<{ id: number; title: string; summary: string | null; full_text: string | null }>(
      `SELECT id, title, summary, full_text FROM documents WHERE ${RESCUED}`)
    const updates: { id: number; title: string; summary: string | null; full_text: string | null; n: number }[] = []
    for (const d of docs) {
      const t = redact(d.title, names)
      const s = redact(d.summary, names)
      const f = redact(d.full_text, names)
      const n = t.n + s.n + f.n
      if (!n) continue
      let title = t.text!
      // "Metadata: [REU student]" → the project title (first line after the heading).
      if (/^Metadata: \[REU student\]$/.test(title)) {
        const project = (d.full_text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)[1]
        title = project && !project.includes(TOKEN) ? `REU project metadata: ${project.slice(0, 180)}` : 'REU project metadata'
      }
      updates.push({ id: d.id, title, summary: s.text, full_text: f.text, n })
    }
    const total = updates.reduce((a, u) => a + u.n, 0)
    console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}: ${total} occurrences in ${updates.length} documents`)
    for (const u of updates.slice(0, 60)) console.log(`  #${u.id} ×${u.n}  ${u.title.slice(0, 90)}`)
    if (dryRun) return

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      for (const u of updates) {
        await client.query(
          `UPDATE documents SET title = $2, summary = $3, full_text = $4,
                  provenance = jsonb_set(provenance, '{redactions,reu_students}',
                                         to_jsonb(coalesce((provenance->'redactions'->>'reu_students')::int, 0) + $5::int)),
                  updated_at = NOW()
            WHERE id = $1`,
          [u.id, u.title, u.summary, u.full_text, u.n])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    // Residual check with the same patterns: nothing should match any more.
    const { rows: after } = await db.query<{ title: string; summary: string | null; full_text: string | null }>(
      `SELECT title, summary, full_text FROM documents WHERE ${RESCUED}`)
    const left = after.filter((d) => redact(`${d.title}\n${d.summary ?? ''}\n${d.full_text ?? ''}`, names).n > 0).length
    console.log(`Redacted ${total} occurrences in ${updates.length} documents; ${left} documents still match a listed name.`)
  } finally {
    await db.end()
  }
}

if (process.argv[1]?.endsWith('redact-reu-students.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
