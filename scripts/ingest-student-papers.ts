/**
 * Student papers ingest — one RMBL cohort's final papers from S3 → publications
 *
 * Source: the cohort folder RMBL's education program drops in the archive
 * bucket, one sub-folder per student (paper + data + metadata + code), e.g.
 *   s3://rmbl-archive/OvationTransfer/2026 RMBL Student Data (uncurated)/
 * Only papers are ingested here; datasets are a separate job (each student's
 * EDI metadata doc records whether the data may be public).
 *
 * Stages (each cached per paper under scripts/output/student-papers-<year>/):
 *   1. pick each student's final paper (folders are sometimes duplicated with
 *      different casing; appendices/metadata are skipped; PDF preferred over
 *      Word when both exist), download it
 *   2. Word → PDF with LibreOffice (headless) — past student papers are
 *      public PDFs, so every paper gets one
 *   3. text via pdftotext
 *   4. Claude reads the cover block + abstract: title, student authors,
 *      mentors, program line, abstract, stated keywords. Title and abstract
 *      must be found in the text (whitespace-insensitive) or the paper is
 *      held for review rather than guessed.
 *   5. load (local, or --target=neon): publication_type 'student_paper',
 *      rmbl_research 'yes', data_source 'manual', public PDF (rmbl_owned),
 *      full text, authors + mentors. Idempotent: an existing student paper
 *      of that year with a ≥0.9 similar title is left alone; tombstones are
 *      honored.
 *   6. publish PDFs to the public serving bucket under
 *      publications/student-papers/<year>/<Last>_<First>.pdf — named by
 *      student, not by row id, because ids differ between local and Neon and
 *      both must store the same URL.
 *
 * Usage:
 *   npx tsx scripts/ingest-student-papers.ts --year=2026 --source="s3://…/" [--dry-run] [--target=neon] [--model=…]
 *
 * Follow with: tag-student-authors.ts, generate-embeddings.ts (local and
 * --target=neon as applicable). Author pages pick the papers up at the next
 * build-authors run; publication pages link author names immediately.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, basename, extname } from 'path'
import pg from 'pg'
import './lib/config.js' // .env auto-load
import { callClaude, parseJsonResponse } from './lib/claude-api.js'
import { runConcurrent, sleep } from './lib/concurrency.js'
import { extractKeys, matchesAnyTombstone, type TombstoneKeys } from './lib/dedup-keys.js'

const args = process.argv.slice(2)
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const dryRun = args.includes('--dry-run')
const target = arg('target') ?? 'local'
const YEAR = Number(arg('year'))
const SOURCE = arg('source')?.replace(/\/?$/, '/')
const MODEL = arg('model') ?? 'claude-sonnet-5'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)
if (!YEAR || !SOURCE?.startsWith('s3://')) throw new Error('--year=YYYY and --source=s3://bucket/prefix/ are required')

const WORK = join(import.meta.dirname, 'output', `student-papers-${YEAR}`)
const SERVING_BUCKET = 's3://rmbl-hub-pdfs'
const SERVING_BASE = 'https://rmbl-hub-pdfs.s3.amazonaws.com'
const servingKey = (key: string) => `publications/student-papers/${YEAR}/${key}.pdf`
const SOFFICE = ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/opt/homebrew/bin/soffice'].find(existsSync)

interface Paper { key: string; folder: string; file: string; s3: string }
interface Extraction {
  title: string
  students: { given: string; family: string }[]
  mentors: string[]
  program_line: string | null
  abstract: string | null
  keywords: string[]
}

// ---------------------------------------------------------------------------
// 1. Pick papers
// ---------------------------------------------------------------------------

const PAPER_FILE = /(final[ _-]*(rmbl[ _-]*)?paper|_paper|_final)[^/]*\.(pdf|docx?)$/i
const NOT_PAPER = /metadata|appendix|abstract|supplement|protocol|data/i

// Capitalize without flattening internal capitals ("VillanuevaAstilleros"),
// but title-case names written in all caps ("GIZA_JANE").
const cap = (s: string) => s.split('-')
  .map((w) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  .join('-')
const NOT_A_NAME = /^(final|paper|data|metadata|rmbl)/i

/**
 * The student, as "Last_First", from the file name when it follows
 * Last_First_… ("Castellon-Davis_Evanjelina_FinalPaper.docx"), else the
 * folder ("Beehler_Elle_2026", "PollanCaroline2026"). File first: one folder
 * name misspells the student's first name.
 */
function studentKey(folder: string, file: string): string {
  const [last, first] = basename(file, extname(file)).split('_')
  if (last && first && !NOT_A_NAME.test(first) && /^[A-Za-z-]+$/.test(last) && /^[A-Za-z]+$/.test(first)) return `${cap(last)}_${cap(first)}`
  const f = folder.replace(/[_ -]*\d{4}[_ ]*$/, '')
  const underscored = f.match(/^([A-Za-z-]+)_([A-Za-z]+)$/)
  if (underscored) return `${cap(underscored[1])}_${cap(underscored[2])}`
  const camel = f.match(/^([A-Z][a-z-]+)([A-Z][a-z]+)$/)
  if (camel) return `${camel[1]}_${camel[2]}`
  return cap(f.replace(/[^A-Za-z-]/g, ''))
}

function listPapers(): { papers: Paper[]; reuDoc: string | null; skipped: string[] } {
  const out = execFileSync('aws', ['s3', 'ls', SOURCE!, '--recursive'], { encoding: 'utf8', maxBuffer: 64 << 20 })
  const prefix = SOURCE!.replace(/^s3:\/\/[^/]+\//, '')
  const bucket = SOURCE!.match(/^s3:\/\/([^/]+)\//)![1]
  const files = out.split('\n').map((l) => l.match(/^\S+ \S+\s+\d+ (.*)$/)?.[1]).filter((p): p is string => !!p && p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
  const reuDoc = files.find((f) => /reu abstracts/i.test(f) && /\.docx?$/i.test(f)) ?? null
  const byKey = new Map<string, Paper>()
  const skipped: string[] = []
  for (const f of files) {
    const [folder, ...rest] = f.split('/')
    const file = rest.join('/')
    if (!file || !PAPER_FILE.test(file) || NOT_PAPER.test(file.replace(/final[ _-]*paper/i, ''))) continue
    if (/reu abstracts/i.test(folder)) continue
    const key = studentKey(folder, file)
    const cand: Paper = { key, folder, file, s3: `s3://${bucket}/${prefix}${f}` }
    const cur = byKey.get(key)
    // Duplicate folders carry the same file; when a student sent both, the
    // PDF they produced wins over the Word source.
    if (!cur || (extname(file).toLowerCase() === '.pdf' && extname(cur.file).toLowerCase() !== '.pdf')) byKey.set(key, cand)
    else skipped.push(`${folder}/${file} (duplicate of ${cur.folder}/${cur.file})`)
  }
  return { papers: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)), reuDoc: reuDoc ? `s3://${bucket}/${prefix}${reuDoc}` : null, skipped }
}

// ---------------------------------------------------------------------------
// 2–3. Download, convert, extract text (cached)
// ---------------------------------------------------------------------------

function prepare(p: Paper): { pdf: string; text: string } {
  const dir = join(WORK, p.key)
  mkdirSync(dir, { recursive: true })
  const ext = extname(p.file).toLowerCase()
  const original = join(dir, `original${ext}`)
  if (!existsSync(original)) execFileSync('aws', ['s3', 'cp', '--only-show-errors', p.s3, original])
  let pdf = join(dir, 'paper.pdf')
  if (!existsSync(pdf)) {
    if (ext === '.pdf') writeFileSync(pdf, readFileSync(original))
    else {
      if (!SOFFICE) throw new Error('LibreOffice not found — brew install --cask libreoffice')
      execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', dir, original], { stdio: 'ignore', timeout: 180_000 })
      const converted = join(dir, 'original.pdf')
      if (!existsSync(converted)) throw new Error(`conversion failed for ${p.key}`)
      writeFileSync(pdf, readFileSync(converted))
    }
  }
  const txt = join(dir, 'paper.txt')
  // Reading order, not -layout: -layout interleaves two-column pages line by line.
  if (!existsSync(txt)) execFileSync('pdftotext', [pdf, txt])
  return { pdf, text: readFileSync(txt, 'utf8') }
}

// ---------------------------------------------------------------------------
// 4. Metadata extraction (cached)
// ---------------------------------------------------------------------------

const PROMPT = `This is the beginning of a student research paper from the Rocky Mountain Biological Laboratory (RMBL). It usually opens with a cover block: title, author line, mentor(s), and a program line (e.g. "Full-time Independent Research/REU").

Extract, copying text EXACTLY as written (fix only line-break hyphenation and spacing):
- title: the paper title.
- students: the STUDENT authors, in order, split into given and family names. Mentors / faculty / advisors are NOT students — in author lines like "Katie Adler and Logan Young, Daniel T. Blumstein" the trailing senior researcher is usually the mentor; use any "Mentor:" label, "Dr."/"Prof." title, or context. If unsure whether someone is a student, list them as a student.
- mentors: mentor / advisor names as written (without "Dr."), [] if none named.
- program_line: the program line exactly, or null.
- abstract: the abstract text exactly (the whole abstract, not the heading), or null if the paper has none.
- keywords: only keywords the paper itself lists (e.g. "Keywords: ..."), else [].

Return only JSON: {"title": "...", "students": [{"given": "...", "family": "..."}], "mentors": ["..."], "program_line": "..."|null, "abstract": "..."|null, "keywords": ["..."]}`

// NFKD, not NFD: PDF text carries ligatures ("Intraspeci\uFB01c") that must fold to letters.
const words = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
/** All words of `needle` in order within the text, mostly contiguous. */
function found(needle: string, hay: string[]): boolean {
  const q = words(needle)
  if (!q.length) return false
  const maxMissing = Math.floor(q.length * 0.05)
  for (let s = 0; s < hay.length; s++) {
    if (hay[s] !== q[0]) continue
    let qi = 1
    let missing = 0
    let ci = s + 1
    while (qi < q.length && ci < hay.length && ci - s < q.length * 2 + 20) {
      if (hay[ci] === q[qi]) { qi++; ci++ } else if (missing < maxMissing && hay.slice(ci, ci + 6).indexOf(q[qi]) < 0) { missing++; qi++ } else ci++
    }
    if (qi >= q.length) return true
  }
  return false
}

/** Checks re-run on every load, so a fixed check applies to cached extractions. */
function validate(ex: Extraction | null, text: string): string[] {
  if (!ex?.title) return ['no title extracted']
  const problems: string[] = []
  const hay = words(text)
  if (!found(ex.title, hay)) problems.push(`title not found in text: "${ex.title.slice(0, 80)}"`)
  if (ex.abstract && !found(ex.abstract.slice(0, 600), hay)) problems.push('abstract not found in text')
  return problems
}

async function extract(p: Paper, text: string, apiKey: string): Promise<{ ex: Extraction | null; problems: string[]; cost: number }> {
  const cache = join(WORK, p.key, 'extraction.json')
  let ex: Extraction | null
  let cost = 0
  if (existsSync(cache)) {
    ex = JSON.parse(readFileSync(cache, 'utf8')).ex ?? null
  } else {
    const res = await callClaude({
      apiKey, model: MODEL, maxTokens: 4000,
      messages: [{ role: 'user', content: `${PROMPT}\n\n<paper>\n${text.slice(0, 12000)}\n</paper>` }],
    })
    cost = res.cost
    ex = parseJsonResponse<Extraction>(res.text)
    writeFileSync(cache, JSON.stringify({ ex }, null, 1))
  }
  if (ex) {
    ex.students = (ex.students ?? []).filter((s) => s?.family)
    ex.mentors = (ex.mentors ?? []).filter(Boolean).map((m) => m.replace(/^(dr|prof)\.?\s+/i, '').trim())
    ex.keywords = (ex.keywords ?? []).filter(Boolean)
  }
  return { ex, problems: validate(ex, text), cost }
}

// ---------------------------------------------------------------------------
// 4b. Normalize authors (deterministic, re-run every time — not cached)
// ---------------------------------------------------------------------------

const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')
const personKey = (given: string, family: string) => `${norm(family)}|${norm(given).charAt(0)}`
function splitFull(name: string): { given: string; family: string } {
  const w = name.replace(/^(dr|prof)\.?\s+/i, '').trim().split(/\s+/)
  return { given: w.slice(0, -1).join(' '), family: w[w.length - 1] ?? '' }
}

interface Seniors { has(given: string, family: string): boolean }

/**
 * Students on the cover can include senior co-authors (research-plan PIs,
 * established mentors) — those become mentors. The folder's own student is
 * never moved, and is added from the folder/file name when the cover names
 * no one (some papers are anonymous). REU students with no mentor on the
 * cover take the mentors from the REU program's list.
 */
function normalizeAuthors(p: Paper, ex: Extraction, seniors: Seniors, reuMentors: Map<string, string[]>): Extraction {
  const [pFamily, pGiven] = p.key.split('_')
  const isPrimary = (s: { given: string; family: string }) =>
    norm(s.family).includes(norm(pFamily ?? '')) && norm(s.given).charAt(0) === norm(pGiven ?? '').charAt(0)
  const students: Extraction['students'] = []
  const mentors = [...ex.mentors]
  for (const raw of ex.students) {
    // "Maylee" + "D. Thompson" → "Maylee D." + "Thompson"
    const m = raw.family.match(/^((?:[A-Z]\.\s*)+)(.+)$/)
    const s = m ? { given: `${raw.given} ${m[1].trim()}`.trim(), family: m[2].trim() } : raw
    if (!isPrimary(s) && seniors.has(s.given, s.family)) mentors.push(`${s.given} ${s.family}`)
    else students.push(s)
  }
  if (!students.some(isPrimary) && pFamily && pGiven) students.unshift({ given: pGiven, family: pFamily })
  const reu = reuMentors.get(personKey(pGiven ?? '', pFamily ?? ''))
  if (!mentors.length && reu) mentors.push(...reu)
  return { ...ex, students, mentors: [...new Set(mentors)] }
}

async function loadSeniors(db: pg.Pool, extractions: Extraction[], reuMentors: Map<string, string[]>): Promise<Seniors> {
  const keys = new Set<string>()
  const add = (full: string) => { const s = splitFull(full); if (s.family) keys.add(personKey(s.given, s.family)) }
  const { rows: pis } = await db.query(`SELECT DISTINCT pi FROM projects WHERE pi IS NOT NULL AND coalesce(start_year, 0) <= $1`, [YEAR])
  pis.forEach((r) => add(r.pi))
  const { rows: ms } = await db.query(`SELECT DISTINCT name FROM publications_mentors WHERE name IS NOT NULL`)
  ms.forEach((r) => add(r.name))
  extractions.forEach((e) => e.mentors.forEach(add))
  reuMentors.forEach((list) => list.forEach(add))
  return { has: (given, family) => keys.has(personKey(given, family)) }
}

/** "REU Student: Rio Burk / Mentor: Dr. Diane Campbell and Janelle Bohey / Title: …" */
function parseReuAbstracts(docx: string): { roster: { given: string; family: string; mentors: string[]; title: string }[]; mentors: Map<string, string[]> } {
  const txt = docx.replace(/\.docx$/, '.txt')
  if (!existsSync(txt)) {
    if (!SOFFICE) throw new Error('LibreOffice not found')
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'txt:Text', '--outdir', WORK, docx], { stdio: 'ignore', timeout: 120_000 })
  }
  const lines = readFileSync(txt, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const roster: { given: string; family: string; mentors: string[]; title: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const st = lines[i].match(/^REU Student:\s*(.+)$/i)
    if (!st) continue
    const mentorLine = lines.slice(i + 1, i + 4).find((l) => /^Mentors?:/i.test(l)) ?? ''
    const titleLine = lines.slice(i + 1, i + 5).find((l) => /^Title:/i.test(l)) ?? ''
    const mentors = mentorLine.replace(/^Mentors?:\s*/i, '').split(/,|\band\b|&/).map((m) => m.replace(/^\s*(dr|prof)\.?\s+/i, '').trim()).filter(Boolean)
    roster.push({ ...splitFull(st[1]), mentors, title: titleLine.replace(/^Title:\s*/i, '').trim() })
  }
  const map = new Map<string, string[]>()
  roster.forEach((r) => map.set(personKey(r.given, r.family), r.mentors))
  return { roster, mentors: map }
}

/**
 * Official cohort roster for tag-reu-authors.ts (student PII → private dir).
 * Names and mentors come from the student's own paper where one matches: the
 * abstracts doc is typed by hand ("Paola Villanueva Astilleros" gives no
 * surname boundary; one mentor line lacks a separator).
 */
function writeReuRoster(roster: ReturnType<typeof parseReuAbstracts>['roster'], ready: { ex: Extraction }[]) {
  const full = (g: string, f: string) => norm(`${g}${f}`)
  const rows = roster.map((r) => {
    const hit = ready.find((x) => x.ex.students.some((s) => full(s.given, s.family) === full(r.given, r.family)))
    const s = hit?.ex.students.find((st) => full(st.given, st.family) === full(r.given, r.family))
    return { given: s?.given ?? r.given, family: s?.family ?? r.family, mentors: hit?.ex.mentors.length ? hit.ex.mentors : r.mentors, matched: !!hit }
  })
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  writeFileSync(join(import.meta.dirname, 'data', 'private', `reu-roster-${YEAR}.csv`),
    ['student_first,student_last,cohort_year,supplement,college,mentor,mentor_first,mentor_last',
      ...rows.map((r) => [r.given, r.family, String(YEAR), '', '', r.mentors.join(' / '), '', ''].map(cell).join(','))].join('\n') + '\n')
  const unmatched = rows.filter((r) => !r.matched)
  console.log(`  REU roster: ${rows.length} students → scripts/data/private/reu-roster-${YEAR}.csv` +
    (unmatched.length ? ` (${unmatched.length} without a matching paper: ${unmatched.map((r) => `${r.given} ${r.family}`).join(', ')})` : ''))
}

// ---------------------------------------------------------------------------
// 5. Load
// ---------------------------------------------------------------------------

/**
 * Local is the id authority: sync-databases.ts pushes local rows to Neon with
 * their local ids, and sync-bulk-to-neon.ts copies references / entity
 * mentions by raw publication id. So a Neon load reuses the local row's id
 * (hence: load local first) instead of taking one from Neon's sequence.
 */
async function load(db: pg.Pool, p: Paper, ex: Extraction, text: string, tombstones: TombstoneKeys[], localIds: Map<string, number> | null): Promise<'inserted' | 'exists' | 'tombstoned' | 'no-local'> {
  const { rows: [match] } = await db.query(
    `SELECT id FROM publications WHERE publication_type = 'student_paper' AND year = $2
       AND similarity(lower(title), lower($1)) >= 0.9 LIMIT 1`,
    [ex.title, YEAR],
  )
  if (match) return 'exists'
  if (matchesAnyTombstone(extractKeys('publications', { doi: null, title: ex.title, year: YEAR }), tombstones)) return 'tombstoned'
  const explicitId = localIds ? localIds.get(ex.title.trim().toLowerCase()) : undefined
  if (localIds && explicitId === undefined) return 'no-local'
  if (dryRun) return 'inserted'
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // With an explicit id, a clash with an unrelated Neon row fails loudly
    // (primary key) rather than being skipped.
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO publications
         (id, title, year, abstract, full_text, publication_type, data_source, discovery_method,
          rmbl_research, pdf_available, pdf_link, pdf_rights_basis, pdf_rights_checked_at,
          pdf_restricted, created_at, updated_at)
       VALUES (coalesce($6::int, nextval('publications_id_seq')::int), $1, $2, $3, $4, 'student_paper', 'manual', 'manual_entry',
               'yes', true, $5, 'rmbl_owned', NOW(), false, NOW(), NOW())
       RETURNING id`,
      [ex.title, YEAR, ex.abstract, text, `${SERVING_BASE}/${servingKey(p.key)}`, explicitId ?? null],
    )
    for (const [i, s] of ex.students.entries()) {
      await client.query(
        `INSERT INTO publications_authors (_order, _parent_id, id, given, family) VALUES ($1, $2, gen_random_uuid()::text, $3, $4)`,
        [i + 1, id, s.given ?? '', s.family],
      )
    }
    for (const [i, m] of ex.mentors.entries()) {
      await client.query(
        // publications_mentors.id is a serial (unlike authors/keywords' text ids).
        `INSERT INTO publications_mentors (_order, _parent_id, name) VALUES ($1, $2, $3)`,
        [i + 1, id, m],
      )
    }
    for (const [i, k] of ex.keywords.entries()) {
      await client.query(
        `INSERT INTO publications_keywords (_order, _parent_id, id, keyword) VALUES ($1, $2, gen_random_uuid()::text, $3)`,
        [i + 1, id, k],
      )
    }
    await client.query('COMMIT')
    return 'inserted'
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  mkdirSync(WORK, { recursive: true })
  const { papers, reuDoc, skipped } = listPapers()
  console.log(`Cohort ${YEAR}: ${papers.length} student papers${skipped.length ? `, ${skipped.length} duplicate files skipped` : ''}`)
  skipped.forEach((s) => console.log(`  - ${s}`))
  let reu: ReturnType<typeof parseReuAbstracts> = { roster: [], mentors: new Map() }
  if (reuDoc) {
    const dest = join(WORK, 'reu-abstracts.docx')
    if (!existsSync(dest)) execFileSync('aws', ['s3', 'cp', '--only-show-errors', reuDoc, dest])
    reu = parseReuAbstracts(dest)
    console.log(`  REU abstracts: ${reu.roster.length} REU students`)
  }

  // Stages 1–4
  let cost = 0
  const ready: { p: Paper; ex: Extraction; text: string; pdf: string }[] = []
  const held: string[] = []
  const { errors } = await runConcurrent(papers, 4, async (p) => {
    const { pdf, text } = prepare(p)
    if (text.trim().length < 1000) { held.push(`${p.key}: only ${text.trim().length} chars of text (scanned?)`); return }
    const r = await extract(p, text, apiKey)
    cost += r.cost
    if (!r.ex || r.problems.length) { held.push(`${p.key}: ${r.problems.join('; ') || 'unparseable extraction'}`); return }
    ready.push({ p, ex: r.ex, text, pdf })
  }, 'prepare')
  console.log(`  extraction cost $${cost.toFixed(2)}${errors ? ` · ${errors} errors` : ''}`)
  if (held.length) {
    console.log(`\nHeld for review (${held.length}) — not loaded:`)
    held.forEach((h) => console.log(`  ! ${h}`))
  }
  ready.sort((a, b) => a.p.key.localeCompare(b.p.key))

  // Stage 5
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  const tally = { inserted: 0, exists: 0, tombstoned: 0, 'no-local': 0 }
  let localIds: Map<string, number> | null = null
  if (target === 'neon') {
    const local = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    const { rows } = await local.query(`SELECT id, lower(trim(title)) AS t FROM publications WHERE publication_type = 'student_paper' AND year = $1`, [YEAR])
    await local.end()
    localIds = new Map(rows.map((r) => [r.t, r.id]))
  }
  try {
    const seniors = await loadSeniors(db, ready.map((r) => r.ex), reu.mentors)
    for (const r of ready) r.ex = normalizeAuthors(r.p, r.ex, seniors, reu.mentors)
    if (reu.roster.length && !dryRun) writeReuRoster(reu.roster, ready)
    const tombstones: TombstoneKeys[] = (await db.query(`SELECT keys FROM duplicate_tombstones WHERE collection = 'publications'`)).rows.map((r) => r.keys)
    console.log(`\nTarget: ${target}${dryRun ? ' (dry-run)' : ''}`)
    for (const r of ready) {
      const outcome = await load(db, r.p, r.ex, r.text, tombstones, localIds)
      tally[outcome]++
      console.log(
        `  ${outcome === 'inserted' ? '+' : outcome === 'exists' ? '=' : outcome === 'no-local' ? '!' : '~'} ${r.p.key.padEnd(28)} ${r.ex.title.slice(0, 60)}` +
          `  [${r.ex.students.map((s) => s.family).join(', ')}${r.ex.mentors.length ? ` | mentors: ${r.ex.mentors.join(', ')}` : ''}]`,
      )
    }
  } finally {
    await db.end()
  }

  // Stage 6 — same object for both targets; safe to repeat.
  if (!dryRun) {
    for (const r of ready) {
      execFileSync('aws', ['s3', 'cp', '--only-show-errors', '--content-type', 'application/pdf', r.pdf, `${SERVING_BUCKET}/${servingKey(r.p.key)}`])
    }
    const bad: string[] = []
    for (const r of ready) {
      let status = 0
      for (let attempt = 0; attempt < 3 && status !== 200; attempt++) {
        // Transient resets happen right after a burst of uploads.
        status = await fetch(`${SERVING_BASE}/${servingKey(r.p.key)}`, { method: 'HEAD' }).then((x) => x.status, () => 0)
        if (status !== 200) await sleep(2000)
      }
      if (status !== 200) bad.push(`${r.p.key} (${status || 'network error'})`)
    }
    console.log(`\nPublished ${ready.length - bad.length}/${ready.length} PDFs to ${SERVING_BASE}/publications/student-papers/${YEAR}/` +
      (bad.length ? ` — NOT publicly readable: ${bad.join(', ')}` : ''))
  }
  console.log(
    `\n${dryRun ? '[dry-run] ' : ''}Done: ${tally.inserted} inserted, ${tally.exists} already present, ` +
      `${tally.tombstoned} tombstoned, ${held.length} held for review.` +
      (tally['no-local'] ? ` ${tally['no-local']} not loaded on Neon: no local row yet (run locally first).` : ''),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
