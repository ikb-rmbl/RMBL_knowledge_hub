/**
 * Structured dataset from the REU program's publication list (Word doc).
 *
 * The list marks REU authors by FORMATTING (bold), and its recent additions —
 * a running log at the top of the document — mark them with "*" or a
 * superscript "2" instead, mixed with notes ("Added to NSF-PAR", "pdf", who
 * was a supplement student). The main list ("Last updated Jan, 2022") is the
 * curated part; the log is the messy part.
 *
 * Pipeline:
 *   1. Deterministic pre-pass: split into paragraphs, tag each with its
 *      section (log | main), carry bold runs through as **name**, and attach
 *      the short note lines that follow a log entry to it.
 *   2. Claude parses each paragraph into fields (or says it is not a citation).
 *   3. Deterministic verification: the title must occur in the paragraph and
 *      every REU author must be bold, starred or superscripted in the source.
 *   4. Match to Knowledge Commons publications (DOI, then title trigram with
 *      year ±1) and report which REU authors are already tagged there.
 *
 * Output (gitignored — student names): scripts/data/private/
 *   reu-pub-list-structured.csv  one row per citation
 *   reu-pub-list-authors.csv     one row per citation × REU author
 *
 * Usage:
 *   npx tsx scripts/extract-reu-pub-list.ts --input=<list.docx|list.html> [--model=] [--dry-run]
 *   (--dry-run stops after the pre-pass and prints what would be sent)
 */

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JSDOM } from 'jsdom'
import pg from 'pg'
import './lib/config.js'
import { callClaude, parseJsonResponse } from './lib/claude-api.js'
import { runConcurrent } from './lib/concurrency.js'

const args = process.argv.slice(2)
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const PRIVATE_DIR = join(import.meta.dirname, 'data', 'private')
const INPUT = arg('input') ?? join(PRIVATE_DIR, 'reu-publications-2024.html')
const MODEL = arg('model') ?? 'claude-sonnet-5-5'
const dryRun = args.includes('--dry-run')
const BATCH = 15
/** Parses cached per paragraph text + model, so re-runs after a list edit only pay for changed entries. */
const CACHE = join(import.meta.dirname, 'output', 'reu-pub-list-parse-cache.json')

// ------------------------------------------------------------------ pre-pass

interface Para {
  idx: number
  section: 'log' | 'main'
  /** Text with bold runs as **…**; superscripts as ^…^. */
  marked: string
  plain: string
  /** Short note lines that follow a log entry ("pdf", "2020 REU on site grant"). */
  notes: string[]
}

function loadHtml(path: string): string {
  if (!path.endsWith('.docx')) return readFileSync(path, 'utf-8')
  const dir = mkdtempSync(join(tmpdir(), 'reu-list-'))
  const out = join(dir, 'list.html')
  execFileSync('textutil', ['-convert', 'html', path, '-output', out])
  return readFileSync(out, 'utf-8')
}

function markedText(node: Node): string {
  let s = ''
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) s += c.textContent ?? ''
    else if (c.nodeType === 1) {
      const el = c as Element
      const inner = markedText(el)
      const tag = el.tagName.toLowerCase()
      if ((tag === 'b' || tag === 'strong') && inner.trim()) s += `**${inner}**`
      else if (tag === 'sup' && inner.trim()) s += `^${inner}^`
      else s += inner
    }
  })
  return s
}

function prepass(html: string): Para[] {
  const doc = new JSDOM(html).window.document
  const out: Para[] = []
  let section: Para['section'] = 'log'
  let last: Para | null = null
  let idx = 0
  for (const p of doc.querySelectorAll('p, li')) {
    const plain = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!plain) continue
    if (/^PUBLICATIONS, THESES, PRESENTATIONS/i.test(plain)) { section = 'main'; last = null; continue }
    // The main list's publications end where its theses section starts.
    if (section === 'main' && /^Student Undergraduate Theses/i.test(plain)) break
    // Join adjacent bold runs, keeping the space between them ("**Doe** **J**").
    const marked = markedText(p).replace(/\*\*(\s*)\*\*/g, '$1').replace(/\s+/g, ' ').trim()
    const hasYear = /\b(19[89]\d|20[0-3]\d)\b/.test(plain)
    if (plain.length >= 60 && hasYear) {
      last = { idx: idx++, section, marked, plain, notes: [] }
      out.push(last)
    } else if (section === 'log' && last && plain.length < 160) {
      last.notes.push(plain)
    }
  }
  return out
}

// ------------------------------------------------------------------ LLM parse

interface Parsed {
  idx: number
  is_citation: boolean
  status: 'published' | 'in_press' | 'submitted' | 'other'
  year: number | null
  authors: string[]
  reu_authors: string[]
  reu_supplement: boolean
  title: string | null
  journal: string | null
  volume: string | null
  pages: string | null
  doi: string | null
  annotations: string | null
}

const PROMPT = `You are parsing an REU (Research Experiences for Undergraduates) program's list of student-coauthored publications.
Each entry below is one paragraph from the Word document. Formatting markers:
- **text** = bold in the original. Bold marks REU student authors, but bold is applied loosely and sometimes covers a note ("Added to NSF-PAR") instead of a name.
- A trailing "*" after a name, or a superscript ^2^, also marks an REU student in the recent entries.
- "(REU supplement)" means the student was funded by a supplement to a PI's grant rather than the REU site grant.

For EACH entry return one JSON object:
{"idx": <entry idx>, "is_citation": <false if the paragraph is a note, a summary, or not a single publication>,
 "status": "published" | "in_press" | "submitted" | "other",
 "year": <publication year as an integer, or null>,
 "authors": [<every author in citation order, as written, without markers>],
 "reu_authors": [<the subset of authors marked as REU students by bold, *, or ^2^ — copy the name exactly as it appears in "authors">],
 "reu_supplement": <true if marked as REU supplement>,
 "title": <the article title copied VERBATIM from the entry, or null>,
 "journal": <journal or venue>, "volume": <string or null>, "pages": <string or null>,
 "doi": <bare DOI like 10.1111/jzo.13032, or null>,
 "annotations": <any non-citation text in the entry — NSF-PAR status, who was an REU, grant notes — or null>}

Only list a name in reu_authors if the marker is on that name. Do not guess.
Return a JSON array with one object per entry, nothing else.`

async function parseBatch(apiKey: string, batch: Para[]): Promise<{ rows: Parsed[]; cost: number }> {
  const content = batch
    .map((p) => `<entry idx="${p.idx}">\n${p.marked}${p.notes.length ? `\n[following notes: ${p.notes.join(' | ')}]` : ''}\n</entry>`)
    .join('\n')
  const res = await callClaude({ apiKey, model: MODEL, maxTokens: 12000, messages: [{ role: 'user', content: `${PROMPT}\n\n${content}` }] })
  const rows = parseJsonResponse<Parsed[]>(res.text)
  if (!Array.isArray(rows)) throw new Error(`Unparseable response for entries ${batch[0].idx}–${batch[batch.length - 1].idx}`)
  return { rows, cost: res.cost ?? 0 }
}

// ------------------------------------------------------------------ verification

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Surname words of an author string in any of the list's formats: "Doe J",
 * "Doe, JQ", "Jane Doe", "Van Doe X", "Doe J P", "DoeJ" (initials glued
 * on), "J. Q. Doe". Initials — 1–3 capitals, dotted or not —
 * are dropped; what is left is the surname (or, for "Given Family", the given
 * name too, which only makes the subset tests below stricter, never looser).
 */
function surnameWords(name: string): string[] {
  let n = name.replace(/[*^0-9]/g, ' ').trim()
  if (n.includes(',')) n = n.split(',')[0]
  n = n.replace(/([a-z])([A-Z]{1,3})\b/g, '$1 $2') // "DoeJ" → "Doe J"
  const toks = n.split(/\s+/).filter((t) => t && !/^([A-Z]\.?-?){1,3}$/.test(t))
  return norm(toks.join(' ')).split(' ').filter((w) => w.length > 1)
}

/** Words the source itself marks as REU: in a bold run, starred, superscript-2, or named in an "(X was … REU …)" note. */
function markedWords(marked: string): Set<string> {
  const keys = new Set<string>()
  const add = (t: string) => { for (const w of norm(t).split(' ')) if (w.length > 1) keys.add(w) }
  for (const m of marked.matchAll(/\*\*(.+?)\*\*/g)) add(m[1])
  const unbolded = marked.replace(/\*\*/g, ' ') // a bold marker is not an REU star
  for (const m of unbolded.matchAll(/([A-Z][A-Za-z'’-]+(?:\s+[A-Z]{1,3}\.?)?)\s*\*/g)) add(m[1])
  for (const m of unbolded.matchAll(/([A-Z][A-Za-z'’-]+)\s*\^2\^/g)) add(m[1])
  for (const m of unbolded.matchAll(/\(([A-Z][A-Za-z'’ -]+?) (?:was|were) (?:an |a )?(?:local )?REU/g)) add(m[1])
  return keys
}

const isSubset = (words: string[], set: Set<string>) => words.length > 0 && words.every((w) => set.has(w))

// ------------------------------------------------------------------ main

function csv(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

async function main() {
  const paras = prepass(loadHtml(INPUT))
  console.log(`${paras.length} candidate paragraphs (${paras.filter((p) => p.section === 'log').length} in the additions log, ` +
    `${paras.filter((p) => p.section === 'main').length} in the main list)`)
  if (dryRun) {
    for (const p of paras.slice(0, 8)) console.log(`  [${p.idx} ${p.section}] ${p.marked.slice(0, 160)}${p.notes.length ? `  {notes: ${p.notes.join(' | ').slice(0, 80)}}` : ''}`)
    return
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const cache: Record<string, Omit<Parsed, 'idx'>> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf-8')) : {}
  const keyOf = (p: Para) => createHash('sha1').update(`${MODEL}\n${p.marked}\n${p.notes.join('|')}`).digest('hex')
  const parsed = new Map<number, Parsed>()
  for (const p of paras) if (cache[keyOf(p)]) parsed.set(p.idx, { ...cache[keyOf(p)], idx: p.idx })
  const todo = paras.filter((p) => !parsed.has(p.idx))
  const batches: Para[][] = []
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
  let cost = 0
  await runConcurrent(batches, 4, async (b) => {
    const { rows, cost: c } = await parseBatch(apiKey, b)
    cost += c
    for (const r of rows) {
      const para = b.find((p) => p.idx === r.idx)
      if (!para) continue
      parsed.set(r.idx, r)
      const { idx: _idx, ...rest } = r
      cache[keyOf(para)] = rest
    }
  }, 'Parse')
  writeFileSync(CACHE, JSON.stringify(cache))
  if (todo.length < paras.length) console.log(`${paras.length - todo.length} parses reused from cache`)
  const missing = paras.filter((p) => !parsed.has(p.idx))
  console.log(`Parsed ${parsed.size}/${paras.length} paragraphs ($${cost.toFixed(2)})${missing.length ? `; missing ${missing.map((p) => p.idx).join(', ')}` : ''}`)

  // ---------------- match to the Knowledge Commons
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const rows: Record<string, unknown>[] = []
  const authorRows: Record<string, unknown>[] = []
  try {
    for (const p of paras) {
      const r = parsed.get(p.idx)
      if (!r) continue
      if (!r.is_citation) {
        // Log pointers like "Add paper with **Doe**": no citation, but they
        // name REU students whose papers still have to be found.
        const names = [...p.marked.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].replace(/[*,]/g, '').trim())
          .filter((n) => /^[A-Z][A-Za-z'’ -]+$/.test(n) && !/NSF|PAR|REU/.test(n))
        if (names.length === 0) continue
        rows.push({
          entry: p.idx, section: 'additions log (2023+)', status: 'mention only (no citation)', year: r.year ?? '',
          reu_authors: names.join('; '), reu_authors_unverified: '', reu_supplement: '', authors: '', title: '', journal: '', volume: '', pages: '', doi: '',
          annotations: [r.annotations, ...p.notes].filter(Boolean).join(' | '),
          kc_publication_id: '', kc_match: '', kc_title: '', kc_reu_tags: '',
          check: 'paper not cited in the list — find it', source_text: p.plain,
        })
        continue
      }
      const problems: string[] = []
      if (r.title && !norm(p.plain).includes(norm(r.title))) problems.push('title not verbatim in source')
      const marked = markedWords(p.marked)
      const unverified = (r.reu_authors ?? []).filter((a) => !isSubset(surnameWords(a), marked))
      const reu = (r.reu_authors ?? []).filter((a) => !unverified.includes(a))
      if (unverified.length) problems.push(`dropped REU author(s) not marked in source: ${unverified.join('; ')}`)
      if (reu.length === 0) problems.push('no REU author marked')

      let kc: { id: number; title: string; doi: string | null; year: number | null; how: string } | null = null
      const doi = r.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/[.,;]+$/, '').toLowerCase() || null
      if (doi) {
        const { rows: m } = await db.query(`SELECT id, title, doi, year::int AS year FROM publications WHERE lower(doi) = $1 LIMIT 1`, [doi])
        if (m[0]) kc = { ...m[0], how: 'doi' }
      }
      if (!kc && r.title) {
        // OpenAlex discovery re-created ~100 RMBL-database papers as unreviewed
        // duplicates (2026-09). Among adequate title matches, prefer the reviewed
        // RMBL record — that is where the REU tags live.
        const { rows: m } = await db.query(
          `SELECT id, title, doi, year::int AS year, similarity(lower(title), lower($1)) AS s FROM publications
            WHERE lower(title) % lower($1) AND ($2::int IS NULL OR year IS NULL OR abs(year - $2::int) <= 1)
              AND similarity(lower(title), lower($1)) >= 0.6
            ORDER BY (rmbl_research = 'yes') DESC NULLS LAST, s DESC LIMIT 1`,
          [r.title, r.year],
        )
        if (m[0]) kc = { id: m[0].id, title: m[0].title, doi: m[0].doi, year: m[0].year, how: `title ${Number(m[0].s).toFixed(2)}` }
      }
      let tagged: string[] = []
      if (kc) {
        const { rows: t } = await db.query(
          `SELECT author_name FROM publication_student_authors WHERE publication_id = $1 AND student_program = 'reu'`, [kc.id])
        tagged = t.map((x) => x.author_name)
      }
      const taggedWords = tagged.map((n) => new Set(norm(n).split(' ')))
      const isTagged = (a: string) => taggedWords.some((t) => isSubset(surnameWords(a), t))

      rows.push({
        entry: p.idx,
        section: p.section === 'log' ? 'additions log (2023+)' : 'main list (to Jan 2022)',
        status: r.status,
        year: r.year ?? '',
        reu_authors: reu.join('; '),
        reu_authors_unverified: unverified.join('; '),
        reu_supplement: r.reu_supplement ? 'yes' : '',
        authors: (r.authors ?? []).join('; '),
        title: r.title ?? '',
        journal: r.journal ?? '',
        volume: r.volume ?? '',
        pages: r.pages ?? '',
        doi: doi ?? '',
        annotations: [r.annotations, ...p.notes].filter(Boolean).join(' | '),
        kc_publication_id: kc?.id ?? '',
        kc_match: kc?.how ?? 'not found',
        kc_title: kc?.title ?? '',
        kc_reu_tags: tagged.join('; '),
        check: problems.join('; '),
        source_text: p.plain,
      })
      for (const a of reu) {
        authorRows.push({
          entry: p.idx,
          year: r.year ?? '',
          reu_author: a,
          surname: surnameWords(a).join(' '),
          reu_supplement: r.reu_supplement ? 'yes' : '',
          title: r.title ?? '',
          kc_publication_id: kc?.id ?? '',
          tagged_in_kc: kc ? (isTagged(a) ? 'yes' : 'no') : 'paper not in KC',
        })
      }
    }
  } finally {
    await db.end()
  }

  // Same paper listed twice (log + main list, or submitted + published).
  const seen = new Map<string, number>()
  for (const r of rows) {
    const key = (r.doi as string) || norm(r.title as string)
    if (!key) continue
    if (seen.has(key)) r.check = [r.check, `duplicate of entry ${seen.get(key)}`].filter(Boolean).join('; ')
    else seen.set(key, r.entry as number)
  }

  writeFileSync(join(PRIVATE_DIR, 'reu-pub-list-structured.csv'), csv(rows))
  writeFileSync(join(PRIVATE_DIR, 'reu-pub-list-authors.csv'), csv(authorRows))
  const by = (f: (r: Record<string, unknown>) => boolean) => rows.filter(f).length
  console.log(`\n${rows.length} citations (${by((r) => String(r.section).startsWith('additions'))} from the log), ${authorRows.length} REU author rows`)
  console.log(`  matched in KC: ${by((r) => r.kc_match !== 'not found')} (doi ${by((r) => r.kc_match === 'doi')}), not found: ${by((r) => r.kc_match === 'not found')}`)
  console.log(`  REU authors already tagged: ${authorRows.filter((a) => a.tagged_in_kc === 'yes').length}, ` +
    `untagged on a matched paper: ${authorRows.filter((a) => a.tagged_in_kc === 'no').length}`)
  console.log(`  rows with a check flag: ${by((r) => Boolean(r.check))}`)
  console.log(`Wrote ${join(PRIVATE_DIR, 'reu-pub-list-structured.csv')} and reu-pub-list-authors.csv`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
