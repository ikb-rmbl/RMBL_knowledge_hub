/**
 * SFA / SAIL classification → publications.sfa_program, sail_program
 *
 * Two annual-reporting counts ("SFA papers", "SAIL papers") that used to be
 * tallied by hand. Tri-state like rmbl_research: 'yes' / 'no' / NULL.
 *
 *   SFA  — ON THE WATERSHED FUNCTION SFA'S OWN PUBLICATION LIST
 *          (scripts/data/sfa-publications-*.json, a snapshot of
 *          watershed.lbl.gov/research-results/publications/). Ian's call,
 *          2026-09-24: the list is authoritative. Listed RMBL articles are
 *          'yes', every other RMBL article is 'no'. The classifier's own
 *          acknowledgment verdict is kept as evidence (evidence.sfa.ack) and
 *          feeds a worklist of papers that acknowledge SFA support but are not
 *          listed — suggestions for the SFA, not counted.
 *   SAIL — uses data from, or is part of, the ARM Surface Atmosphere
 *          Integrated field Laboratory campaign (2021-2023). Classifier only.
 *
 * Classifier, per paper (RMBL-research journal articles, year >= MIN_YEAR):
 *   - full text with an acknowledgments/funding section but no SFA/SAIL cue
 *     anywhere → both 'no' (method no_cue)
 *   - cue present → Claude reads ±WINDOW chars around every cue and answers
 *     with a verbatim quote; a 'yes' whose quote is not found in the text is
 *     dropped to NULL for review (method llm_unverified)
 *   - no usable full text, or text lacking any acknowledgments/funding
 *     section (partial extraction) → falls back to publication↔project links
 *     (method project_link), counted only within each program's era (links
 *     are false-positive-heavy); 'yes' only, otherwise left NULL. Not
 *     stamped checked, so these re-run for free once text arrives.
 *
 * Curation-aware: an admin-set sfaProgram / sailProgram is never overwritten.
 * Incremental: funding_programs_checked_at IS NULL = unprocessed.
 *
 * Usage:
 *   npx tsx scripts/classify-funding-programs.ts [--dry-run] [--limit=N] [--force] [--model=...]
 *   npx tsx scripts/classify-funding-programs.ts --sfa-list-only   # re-apply the SFA list, no LLM
 *   npx tsx scripts/classify-funding-programs.ts --refresh-sfa-list  # re-fetch the list snapshot first
 *   npx tsx scripts/classify-funding-programs.ts --sync-neon   # copy local results to Neon by DOI/title (no LLM)
 *
 * Worklist → scripts/output/sfa-list-worklist.csv
 *
 * Writes directly to PostgreSQL — no dev server needed.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import { JSDOM } from 'jsdom'
import './lib/config.js' // .env auto-load
import { callClaude, parseJsonResponse } from './lib/claude-api.js'
import { runConcurrent } from './lib/concurrency.js'
import { curatedSafe } from './lib/curation.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const syncNeon = args.includes('--sync-neon')
const sfaListOnly = args.includes('--sfa-list-only')
const refreshSfaList = args.includes('--refresh-sfa-list')
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0)
const MODEL = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-sonnet-5'
const CONCURRENCY = 4

// The Genomes-to-Watershed SFA started in 2014; nothing earlier can qualify.
const MIN_YEAR = 2012
const MIN_TEXT = 2000
// Project-link fallback only inside each program's era. Publication↔project
// links (assign-projects.ts) are false-positive-heavy; outside the era they
// were wrong in every case checked (a 2014 marmot paper, a 2016 plant-
// community paper), inside it they were East River hydrology papers.
const SFA_LINK_FROM = 2017 // Watershed Function SFA (successor to Genomes-to-Watershed)
const SAIL_LINK_FROM = 2021 // SAIL campaign start
const WINDOW = 700
const MAX_CONTEXT = 12000

// A 'no' from keyword absence needs the back matter to be present.
const ACK_SECTION = /acknowledg|funding|financial support|supported by|grant/i
const CUE = /scientific focus area|science focus area|\bSFA\b|watershed function|genomes[- ]to[- ]watershed|DE-AC02-05CH11231|lawrence berkeley|\bLBNL\b|\bSAIL\b|surface atmosphere integrated|atmospheric radiation measurement|\bARM\b/gi

const SFA_LIST_URL = 'https://watershed.lbl.gov/research-results/publications/'
const DATA_DIR = join(import.meta.dirname, 'data')
const OUTPUT_DIR = join(import.meta.dirname, 'output')

type Flag = 'yes' | 'no' | null
interface Evidence {
  method: 'llm' | 'llm_unverified' | 'no_cue' | 'project_link' | 'sfa_list' | 'not_on_sfa_list'
  quote?: string
  siteId?: string
  /** SFA only: the classifier's acknowledgment verdict, kept once the list decides. */
  ack?: { flag: Flag; method: string; quote?: string }
}
interface Result { id: number; sfa: Flag; sail: Flag; evidence: { sfa: Evidence; sail: Evidence }; checked: boolean }

const PROMPT = `You classify a scientific paper for two annual-reporting counts at the Rocky Mountain Biological Laboratory. Below are excerpts from the paper's full text around funding/program keywords (acknowledgments, funding statements, methods).

1. sfa — Was this work SUPPORTED by the DOE Watershed Function Scientific Focus Area (SFA) at Lawrence Berkeley National Laboratory (or its predecessor, the Genomes-to-Watershed SFA)? Typical evidence: an acknowledgment of funding from the "Watershed Function Scientific Focus Area" / "SFA" under DOE Office of Science BER, often with contract DE-AC02-05CH11231. NOT sufficient: citing SFA papers, working in the East River watershed, or LBNL funding for a different program.
2. sail — Does this paper USE DATA FROM, or form part of, the DOE ARM "Surface Atmosphere Integrated field Laboratory" (SAIL) campaign (2021–2023, East River / Crested Butte)? NOT sufficient: other ARM campaigns or facilities, or only citing SAIL papers.

For each, answer true/false. When true, "quote" must be copied EXACTLY (verbatim, character for character) from the excerpts — the shortest span that proves it. When false, quote is null.

Return only JSON: {"sfa": {"answer": true|false, "quote": "..."|null}, "sail": {"answer": true|false, "quote": "..."|null}}`

function cueWindows(text: string): string | null {
  const spans: [number, number][] = []
  for (const m of text.matchAll(CUE)) {
    const s = Math.max(0, m.index! - WINDOW)
    const e = Math.min(text.length, m.index! + m[0].length + WINDOW)
    const last = spans[spans.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else spans.push([s, e])
  }
  if (!spans.length) return null
  let out = ''
  for (const [s, e] of spans) {
    if (out.length >= MAX_CONTEXT) break
    out += `…${text.slice(s, e)}…\n\n`
  }
  return out.slice(0, MAX_CONTEXT)
}

const words = (s: string) =>
  s
    .replace(/­/g, '')
    .replace(/(\p{L})[-‐]\s+(\p{Ll})/gu, '$1$2') // rejoin "Sci- ence" line-break hyphenation
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    // Bare numbers are dropped: preprint line numbers ("Lawrence 729
    // Berkeley") appear mid-sentence and get misquoted.
    .filter((w) => w && !/^\d+$/.test(w))

const MAX_GAP = 40 // words of the other column spliced into the sentence
const MIN_RUN_SHARE = 0.6
const MAX_MISSING_SHARE = 0.1

/**
 * Is the quote in the text? Two-column PDFs interleave the columns in the
 * extracted text ("…supported by the Watershed Function Science Focus Area
 * project at Ahmadi, N., Muniruzzman, M., … Lawrence Berkeley National
 * Laboratory…"), and can split a hyphenated word across the splice ("Sci-
 * terial as fundamentally … ence"), so a correctly reassembled sentence is
 * often not a contiguous substring. Accept the quote when its words occur in
 * order with no gap over MAX_GAP words, at most MAX_MISSING_SHARE of them
 * (min 1) unfound, AND most found words sit in unbroken runs — tolerant of
 * column layout, but a quote stitched from scattered words fails.
 */
function quoteFound(quote: string, context: string): boolean {
  const q = words(quote)
  if (q.length < 3) return false
  const c = words(context)
  const allowed = Math.max(1, Math.floor(q.length * MAX_MISSING_SHARE))
  for (let start = 0; start < c.length; start++) {
    // The quote's first words may be among the missing ones.
    const first = q.slice(0, allowed + 1).indexOf(c[start])
    if (first < 0) continue
    let missing = first
    const pos = [start]
    for (let qi = first + 1; qi < q.length && missing <= allowed; qi++) {
      const from = pos[pos.length - 1] + 1
      let hit = -1
      for (let ci = from; ci < c.length && ci - from < MAX_GAP; ci++) {
        if (c[ci] === q[qi]) { hit = ci; break }
      }
      if (hit < 0) missing++
      else pos.push(hit)
    }
    if (missing > allowed) continue
    const inRun = pos.filter((p, i) => pos[i - 1] === p - 1 || pos[i + 1] === p + 1).length
    if (inRun / q.length >= MIN_RUN_SHARE) return true
  }
  return false
}

function verdict(ans: any, context: string): { flag: Flag; ev: Evidence } {
  if (!ans?.answer) return { flag: 'no', ev: { method: 'llm' } }
  const quote = typeof ans.quote === 'string' ? ans.quote : ''
  if (quote && quoteFound(quote, context)) return { flag: 'yes', ev: { method: 'llm', quote: quote.slice(0, 400) } }
  return { flag: null, ev: { method: 'llm_unverified', quote: quote.slice(0, 400) || undefined } }
}

async function classify(db: pg.Pool) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  // Project fallback: the SFA program/plans and the SAIL campaign, by name
  // (ids differ between local and Neon).
  const { rows: projects } = await db.query<{ id: number; kind: 'sfa' | 'sail' }>(
    `SELECT id, CASE WHEN name ~* 'SAIL' THEN 'sail' ELSE 'sfa' END AS kind
       FROM projects
      WHERE name ~* '(watershed function (sfa|science focus area)|east river watershed function sfa|^SAIL \\()'`,
  )
  const sfaProjects = projects.filter((p) => p.kind === 'sfa').map((p) => p.id)
  const sailProjects = projects.filter((p) => p.kind === 'sail').map((p) => p.id)
  console.log(`Project fallback: ${sfaProjects.length} SFA project(s), ${sailProjects.length} SAIL project(s)`)

  const { rows: candidates } = await db.query<{ id: number; year: number; full_text: string | null; sfa_link: boolean; sail_link: boolean }>(
    `SELECT p.id, p.year, p.full_text,
            EXISTS (SELECT 1 FROM projects_rels r WHERE r.publications_id = p.id AND r.parent_id = ANY($1)) AS sfa_link,
            EXISTS (SELECT 1 FROM projects_rels r WHERE r.publications_id = p.id AND r.parent_id = ANY($2)) AS sail_link
       FROM publications p
      WHERE p.rmbl_research = 'yes' AND p.publication_type = 'article' AND p.year >= $3
        ${force ? '' : 'AND p.funding_programs_checked_at IS NULL'}
      ORDER BY p.year DESC, p.id
      ${limit ? `LIMIT ${limit}` : ''}`,
    [sfaProjects, sailProjects, MIN_YEAR],
  )

  const results: Result[] = []
  const llmItems: { id: number; context: string }[] = []
  for (const c of candidates) {
    const text = c.full_text ?? ''
    if (text.length < MIN_TEXT) {
      results.push({
        id: c.id,
        sfa: c.sfa_link && c.year >= SFA_LINK_FROM ? 'yes' : null,
        sail: c.sail_link && c.year >= SAIL_LINK_FROM ? 'yes' : null,
        evidence: { sfa: { method: 'project_link' }, sail: { method: 'project_link' } },
        checked: false,
      })
      continue
    }
    const context = cueWindows(text)
    if (!context && ACK_SECTION.test(text)) {
      results.push({ id: c.id, sfa: 'no', sail: 'no', evidence: { sfa: { method: 'no_cue' }, sail: { method: 'no_cue' } }, checked: true })
      continue
    }
    if (!context) {
      // Text without an acknowledgments/funding section is partial (first
      // pages, or cut off before the back matter): absence proves nothing.
      results.push({
        id: c.id,
        sfa: c.sfa_link && c.year >= SFA_LINK_FROM ? 'yes' : null,
        sail: c.sail_link && c.year >= SAIL_LINK_FROM ? 'yes' : null,
        evidence: { sfa: { method: 'project_link' }, sail: { method: 'project_link' } },
        checked: false,
      })
      continue
    }
    llmItems.push({ id: c.id, context })
  }
  console.log(
    `${candidates.length} candidates: ${llmItems.length} to Claude (${MODEL}), ` +
      `${results.filter((r) => r.checked).length} no-cue → no, ${results.filter((r) => !r.checked).length} without text → project links` +
      (dryRun ? ' (dry-run)' : ''),
  )

  let cost = 0
  if (!dryRun && llmItems.length) {
    const { errors } = await runConcurrent(llmItems, CONCURRENCY, async (item) => {
      const res = await callClaude({
        apiKey, model: MODEL, maxTokens: 1024,
        messages: [{ role: 'user', content: `${PROMPT}\n\n<excerpts>\n${item.context}\n</excerpts>` }],
      })
      cost += res.cost
      const parsed = parseJsonResponse<any>(res.text)
      if (!parsed) throw new Error(`unparseable response for #${item.id}`)
      const sfa = verdict(parsed.sfa, item.context)
      const sail = verdict(parsed.sail, item.context)
      results.push({ id: item.id, sfa: sfa.flag, sail: sail.flag, evidence: { sfa: sfa.ev, sail: sail.ev }, checked: true })
    }, 'classify')
    if (errors) console.log(`  ${errors} errors — those papers stay unchecked and retry next run`)
  }

  if (!dryRun) await writeResults(db, results)

  const count = (k: 'sfa' | 'sail', v: Flag) => results.filter((r) => r[k] === v).length
  const unverified = results.filter((r) => r.evidence.sfa.method === 'llm_unverified' || r.evidence.sail.method === 'llm_unverified')
  console.log(
    `\nSFA yes ${count('sfa', 'yes')} / no ${count('sfa', 'no')} / unknown ${count('sfa', null)} · ` +
      `SAIL yes ${count('sail', 'yes')} / no ${count('sail', 'no')} / unknown ${count('sail', null)}` +
      `${unverified.length ? ` · ${unverified.length} unverified quotes left NULL: ${unverified.map((r) => `#${r.id}`).join(' ')}` : ''}` +
      ` · cost $${cost.toFixed(2)}`,
  )
}

async function writeResults(db: pg.Pool, results: Result[]) {
  for (const r of results) {
    await db.query(
      `UPDATE publications SET
         ${curatedSafe('sfa_program', '$2')},
         ${curatedSafe('sail_program', '$3')},
         funding_program_evidence = $4,
         funding_programs_checked_at = CASE WHEN $5 THEN NOW() ELSE funding_programs_checked_at END
       WHERE id = $1`,
      [r.id, r.sfa, r.sail, JSON.stringify(r.evidence), r.checked],
    )
  }
}

/** Copy local classifications to Neon by DOI, else title + year. No LLM. */
async function copyToNeon(local: pg.Pool) {
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL })
  try {
    const { rows } = await local.query(
      `SELECT lower(doi) AS doi, lower(title) AS title, year, sfa_program, sail_program,
              funding_program_evidence, funding_programs_checked_at
         FROM publications
        WHERE funding_program_evidence IS NOT NULL`,
    )
    let updated = 0
    let missing = 0
    for (const r of rows) {
      const res = await neon.query(
        `UPDATE publications SET
           ${curatedSafe('sfa_program', '$4')},
           ${curatedSafe('sail_program', '$5')},
           funding_program_evidence = $6,
           funding_programs_checked_at = $7
         WHERE id = (
           SELECT id FROM publications
            WHERE ($1::text IS NOT NULL AND lower(doi) = $1)
               OR ($1::text IS NULL AND lower(title) = $2 AND year = $3)
            LIMIT 1)`,
        [r.doi, r.title, r.year, r.sfa_program, r.sail_program, r.funding_program_evidence, r.funding_programs_checked_at],
      )
      if (res.rowCount) updated++
      else missing++
    }
    console.log(`Neon: ${updated} publications updated, ${missing} with no Neon match`)
  } finally {
    await neon.end()
  }
}

// ---------------------------------------------------------------------------
// SFA publication list
// ---------------------------------------------------------------------------

interface SfaEntry { siteId: string; year: number | null; authors: string | null; title: string | null; journal: string | null; doi: string | null }

/** Fetch + parse the SFA's publication page into a dated snapshot. */
async function fetchSfaList(): Promise<string> {
  const res = await fetch(SFA_LIST_URL, { headers: { 'User-Agent': 'RMBL Knowledge Commons (ikb@rmbl.org)' } })
  if (!res.ok) throw new Error(`SFA list fetch failed: ${res.status}`)
  const doc = new JSDOM(await res.text()).window.document
  const entries: SfaEntry[] = []
  for (const li of doc.querySelectorAll('#citations-list > li')) {
    const text = (sel: string) => li.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || null
    const em = li.querySelector('em')
    let title = text('.title')
    if (!title && em) {
      // Some entries leave the title untagged: the text between the year and
      // the journal <em>.
      let t = ''
      for (let n = em.previousSibling; n && !(n as Element).classList?.contains('year'); n = n.previousSibling) {
        t = (n.textContent ?? '') + t
      }
      title = t.replace(/^\)\.\s*/, '').replace(/\s*\.\s*$/, '').replace(/\s+/g, ' ').trim() || null
    }
    const href = li.querySelector('a.doi')?.getAttribute('href') ?? ''
    const year = Number(li.getAttribute('data-year'))
    entries.push({
      siteId: li.getAttribute('data-id') ?? '',
      year: Number.isFinite(year) && year > 0 ? year : null,
      authors: text('.author'),
      title,
      journal: em?.textContent?.trim() || null,
      doi: href.includes('doi.org/') ? href.split('doi.org/')[1].trim().toLowerCase() : null,
    })
  }
  if (entries.length < 100) throw new Error(`SFA list parse found only ${entries.length} entries — page layout changed?`)
  const stamp = new Date().toISOString().slice(0, 7)
  const file = join(DATA_DIR, `sfa-publications-${stamp}.json`)
  writeFileSync(file, JSON.stringify({ source: SFA_LIST_URL, retrieved: new Date().toISOString().slice(0, 10), entries }, null, 1) + '\n')
  console.log(`SFA list: fetched ${entries.length} entries → ${file.split('/').slice(-3).join('/')}`)
  return file
}

function latestSfaSnapshot(): string {
  const files = readdirSync(DATA_DIR).filter((f) => /^sfa-publications-\d{4}-\d{2}\.json$/.test(f)).sort()
  if (!files.length) throw new Error('No SFA list snapshot in scripts/data — run with --refresh-sfa-list')
  return join(DATA_DIR, files[files.length - 1])
}

/**
 * SFA list is authoritative for sfa_program on RMBL articles: listed → 'yes',
 * otherwise 'no'. The classifier's verdict moves to evidence.sfa.ack.
 */
async function applySfaList(db: pg.Pool) {
  const file = refreshSfaList ? await fetchSfaList() : latestSfaSnapshot()
  const snap = JSON.parse(readFileSync(file, 'utf8'))
  const entries: SfaEntry[] = snap.entries
  console.log(`\nSFA list: ${entries.length} entries (retrieved ${snap.retrieved})`)

  // Match by DOI, else title trigram within ±1 year. Prefer the article row
  // when a DOI is shared (a student paper can carry the article's DOI).
  const { rows: matches } = await db.query<{ site_id: string; pub_id: number | null; rmbl_research: string | null; publication_type: string | null }>(
    `WITH l AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[]) AS t(site_id, doi, year, title)
     ), m AS (
       SELECT l.site_id, coalesce(
         (SELECT p.id FROM publications p WHERE l.doi IS NOT NULL AND lower(p.doi) = l.doi
           ORDER BY (p.publication_type = 'article') DESC LIMIT 1),
         (SELECT p.id FROM publications p
           WHERE l.title IS NOT NULL AND abs(coalesce(p.year, 0) - l.year) <= 1
             AND similarity(lower(p.title), lower(l.title)) > 0.8
           ORDER BY similarity(lower(p.title), lower(l.title)) DESC LIMIT 1)) AS pub_id
       FROM l)
     SELECT m.site_id, m.pub_id, p.rmbl_research, p.publication_type
       FROM m LEFT JOIN publications p ON p.id = m.pub_id`,
    [entries.map((e) => e.siteId), entries.map((e) => e.doi), entries.map((e) => e.year), entries.map((e) => e.title)],
  )
  const listed = new Map<number, string>() // pub id → site id
  for (const m of matches) if (m.pub_id != null) listed.set(m.pub_id, m.site_id)
  const notInCommons = matches.filter((m) => m.pub_id == null).length
  const unreviewed = matches.filter((m) => m.pub_id != null && m.rmbl_research == null)

  const { rows: articles } = await db.query<{ id: number; year: number; title: string; doi: string | null; sfa_program: Flag; evidence: any }>(
    `SELECT id, year, title, doi, sfa_program, funding_program_evidence AS evidence
       FROM publications
      WHERE rmbl_research = 'yes' AND publication_type = 'article' AND year >= $1`,
    [MIN_YEAR],
  )

  const worklist: string[][] = [['reason', 'publication_id', 'year', 'doi', 'title', 'evidence']]
  const writes: { id: number; flag: Flag; evidence: any }[] = []
  let yes = 0
  for (const a of articles) {
    const prev = a.evidence?.sfa as Evidence | undefined
    // The classifier verdict, whether still in place or already moved to ack.
    const ack = prev?.ack ?? (prev && prev.method !== 'sfa_list' && prev.method !== 'not_on_sfa_list'
      ? { flag: a.sfa_program, method: prev.method, quote: prev.quote } : undefined)
    const siteId = listed.get(a.id)
    const flag: Flag = siteId ? 'yes' : 'no'
    if (flag === 'yes') yes++
    const ackYes = ack?.method === 'llm' && !!ack.quote
    if (!siteId && ackYes) {
      worklist.push(['acknowledges SFA, not on SFA list', String(a.id), String(a.year), a.doi ?? '', a.title, ack!.quote!.replace(/\s+/g, ' ')])
    }
    writes.push({
      id: a.id,
      flag,
      evidence: { ...(a.evidence ?? {}), sfa: { method: siteId ? 'sfa_list' : 'not_on_sfa_list', siteId, ack } },
    })
  }
  for (const u of unreviewed) {
    worklist.push(['on SFA list, RMBL-research unreviewed', String(u.pub_id), '', '', '', `type=${u.publication_type}`])
  }

  console.log(
    `  ${listed.size} matched in the Commons (${notInCommons} not in the Commons — SFA work outside RMBL); ` +
      `${yes} RMBL articles → SFA yes, ${articles.length - yes} → no; ` +
      `${worklist.length - 1} worklist rows`,
  )
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  writeFileSync(join(OUTPUT_DIR, 'sfa-list-worklist.csv'), worklist.map((r) => r.map(csvCell).join(',')).join('\n') + '\n')
  console.log('  Worklist → scripts/output/sfa-list-worklist.csv')

  if (dryRun) return
  for (const w of writes) {
    await db.query(
      `UPDATE publications SET ${curatedSafe('sfa_program', '$2')}, funding_program_evidence = $3 WHERE id = $1`,
      [w.id, w.flag, JSON.stringify(w.evidence)],
    )
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    if (syncNeon) await copyToNeon(db)
    else {
      if (!sfaListOnly) await classify(db)
      await applySfaList(db)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
