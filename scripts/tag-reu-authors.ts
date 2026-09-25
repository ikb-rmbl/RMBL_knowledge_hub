/**
 * REU-author tagging → publication_student_authors (student_program='reu')
 *
 * Two sources, both kept out of git because they are student PII
 * (scripts/data/private/ is gitignored):
 *
 *   1. reu-publications-2024.html — the REU program's own list of
 *      REU-authored papers (Word doc → `textutil -convert html`). REU authors
 *      are marked in bold (loosely — bold runs often swallow punctuation or a
 *      neighbouring name) and occasionally with a trailing `*`. Each citation
 *      is matched to a publication by DOI, else by title containment within
 *      ±1 year of the cited year; authors of that publication whose surname
 *      appears in a bold/starred run are tagged. detection_method='reu_pub_list'
 *   2. reu-roster-1991-2020.csv — cohort roster (student, cohort year,
 *      mentor). A student is tagged on a peer-reviewed publication when an
 *      author matches their surname + first initial, the publication falls in
 *      [cohort, cohort + ROSTER_WINDOW], AND a mentor co-authors it. The mentor
 *      requirement is what keeps a former REU's later grad-school/PI papers
 *      from being counted. detection_method='roster'
 *
 *   3. reu-roster-derived.csv (optional) — 2021+ cohorts derived from RMBL
 *      student papers by extract-reu-cohort.ts, matched exactly like the
 *      official roster. detection_method='roster_derived'
 *
 * Only peer-reviewed types (article/chapter/book) are tagged: the metrics are
 * "REU authors on articles" and "articles with ≥1 REU author".
 *
 * Idempotent: non-curated rows from both sources are deleted and re-derived
 * each run. A matching 'inferred_window' row is upgraded in place (REU is the
 * more specific claim); curated rows are never touched.
 *
 * Usage:
 *   npx tsx scripts/tag-reu-authors.ts [--dry-run] [--target=neon]
 *
 * Writes unmatched pub-list citations to scripts/output/reu-pub-list-unmatched.txt
 * for review. Writes directly to PostgreSQL — no dev server needed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import { JSDOM } from 'jsdom'
import './lib/config.js' // .env auto-load
import { readCsvFile } from './lib/csv.js'
import { extractDoi } from './lib/doi-utils.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const PRIVATE_DIR = join(import.meta.dirname, 'data', 'private')
const ROSTER_CSV = join(PRIVATE_DIR, 'reu-roster-1991-2020.csv')
// Post-2020 cohorts derived from student-paper cover pages by
// extract-reu-cohort.ts (~70% recall, 96% precision against the official
// roster's 2015–2019 overlap). Optional.
const DERIVED_ROSTER_CSV = join(PRIVATE_DIR, 'reu-roster-derived.csv')
const PUB_LIST_HTML = join(PRIVATE_DIR, 'reu-publications-2024.html')
const OUTPUT_DIR = join(import.meta.dirname, 'output')

// Publication lag after the REU summer for roster-only tags. On the program's
// own list, 88/115 papers land 0–4 years out (peak at 3). Longer lags exist
// there but were curated by hand; for uncurated roster matches they are
// mostly grad-school papers by former REUs whose REU mentor became their PhD
// advisor (e.g. one student had 8 papers with his REU mentor 3–8 years on,
// only one of which the program counts). The pub list covers the long tail.
const ROSTER_WINDOW = 4
// Share of a title's significant words that must appear in the citation.
const TITLE_CONTAINMENT = 0.85
// Accepted only when the citation's first author is the publication's.
const LOOSE_CONTAINMENT = 0.5

const PEER_REVIEWED = ['article', 'chapter', 'book']

/** Lowercase, strip accents and everything but letters. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
}

function titleWords(s: string): string[] {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2)
}

/** Surname keys for a family name: whole name plus each hyphen/space part. */
function surnameKeys(family: string): string[] {
  const parts = family.split(/[\s-]+/).map(norm).filter((p) => p.length > 1)
  return [...new Set([norm(family), ...parts])].filter(Boolean)
}

interface PubAuthor { given: string; family: string }
interface Pub { id: number; year: number | null; title: string; doi: string | null; authors: PubAuthor[] }
interface Tag { publicationId: number; authorName: string; method: 'reu_pub_list' | 'roster' | 'roster_derived'; why: string }

function displayName(a: PubAuthor): string {
  return `${a.given ?? ''} ${a.family ?? ''}`.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Source 1: the REU program's publication list
// ---------------------------------------------------------------------------

interface Citation { text: string; boldKeys: Set<string>; years: number[]; doi: string | null }

function parsePubList(html: string): Citation[] {
  const doc = new JSDOM(html).window.document
  const out: Citation[] = []
  for (const p of doc.querySelectorAll('p, li')) {
    const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
    // Papers section ends where the theses section starts; everything after
    // (theses, presentations, awards) is not a peer-reviewed publication.
    if (/^Student Undergraduate Theses/i.test(text)) break
    if (text.length < 60) continue
    const years = [...text.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]))
    if (!years.length) continue

    const boldKeys = new Set<string>()
    for (const b of p.querySelectorAll('b, strong')) {
      for (const w of (b.textContent ?? '').split(/[\s,.;:()&*]+/)) {
        const k = norm(w)
        if (k.length > 1) boldKeys.add(k)
      }
    }
    for (const m of text.matchAll(/([A-Z][A-Za-z'’-]+)\s*[A-Z.]{0,4}\*/g)) boldKeys.add(norm(m[1]))
    // Bold runs that are only notes ("Added to NSF-PAR", "REU supplement")
    // carry no author signal; the membership test below ignores them anyway
    // because they never equal an author surname on the matched paper.
    out.push({ text, boldKeys, years, doi: extractDoi(text)?.toLowerCase() ?? null })
  }
  return out
}

function matchCitation(c: Citation, pubs: Pub[], byDoi: Map<string, Pub>): Pub | null {
  if (c.doi && byDoi.has(c.doi)) return byDoi.get(c.doi)!
  const citeWords = new Set(titleWords(c.text))
  // The list paraphrases some titles ("hemoparasites" for "hemosporidian
  // infections", "predispersal" for "pre-dispersal"), so a looser title match
  // is accepted when the first author agrees too.
  const firstAuthor = norm(c.text.replace(/^\(.*?\)\s*/, '').split(/[\s,]+/)[0] ?? '')
  let best: Pub | null = null
  let bestScore = 0
  for (const p of pubs) {
    if (p.year == null || !c.years.some((y) => Math.abs(y - p.year!) <= 1)) continue
    const tw = titleWords(p.title)
    if (tw.length < 3) continue
    let score = tw.filter((w) => citeWords.has(w)).length / tw.length
    const lead = p.authors[0]?.family
    if (score < TITLE_CONTAINMENT && score >= LOOSE_CONTAINMENT && lead && surnameKeys(lead).includes(firstAuthor)) {
      score = TITLE_CONTAINMENT
    }
    if (score > bestScore) { bestScore = score; best = p }
  }
  return bestScore >= TITLE_CONTAINMENT ? best : null
}

// ---------------------------------------------------------------------------
// Source 2: cohort roster + mentor co-authorship
// ---------------------------------------------------------------------------

interface RosterStudent { first: string; last: string; cohort: number; mentorKeys: Set<string>; derived: boolean }

function loadRoster(): RosterStudent[] {
  const read = (file: string, derived: boolean) => readCsvFile(file).map((row) => ({ row, derived }))
  const rows = [...read(ROSTER_CSV, false), ...(existsSync(DERIVED_ROSTER_CSV) ? read(DERIVED_ROSTER_CSV, true) : [])]
  return rows.map(({ row: r, derived }) => {
    const mentorKeys = new Set<string>()
    if (r.mentor_last) surnameKeys(r.mentor_last).forEach((k) => mentorKeys.add(k))
    // Free-text mentor column: "Brad Taylor/ Andrew Barnes", "A and B", ...
    for (const part of (r.mentor ?? '').split(/\/|&|,|\band\b/)) {
      const words = part.trim().split(/\s+/).filter(Boolean)
      if (words.length >= 2) surnameKeys(words[words.length - 1]).forEach((k) => mentorKeys.add(k))
    }
    return { first: r.student_first.trim(), last: r.student_last.trim(), cohort: Number(r.cohort_year), mentorKeys, derived }
  }).filter((s) => s.last && s.cohort)
}

function authorMatchesStudent(a: PubAuthor, s: RosterStudent): boolean {
  if (!a.family || !a.given) return false
  const fam = surnameKeys(a.family)
  if (!surnameKeys(s.last).some((k) => fam.includes(k))) return false
  return norm(a.given).charAt(0) === norm(s.first).charAt(0)
}

// ---------------------------------------------------------------------------

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })

  try {
    const { rows } = await db.query<{ id: number; year: number | null; title: string; doi: string | null; given: string; family: string }>(
      `SELECT p.id, p.year, p.title, lower(p.doi) AS doi, pa.given, pa.family
         FROM publications p
         JOIN publications_authors pa ON pa._parent_id = p.id
        WHERE p.publication_type = ANY($1)
        ORDER BY p.id, pa._order`,
      [PEER_REVIEWED],
    )
    const pubMap = new Map<number, Pub>()
    for (const r of rows) {
      if (!pubMap.has(r.id)) pubMap.set(r.id, { id: r.id, year: r.year, title: r.title ?? '', doi: r.doi, authors: [] })
      pubMap.get(r.id)!.authors.push({ given: r.given, family: r.family })
    }
    const pubs = [...pubMap.values()]
    const byDoi = new Map(pubs.filter((p) => p.doi).map((p) => [p.doi!, p]))
    console.log(`  ${pubs.length} peer-reviewed publications with authors`)

    const tags = new Map<string, Tag>() // key: pubId|authorName
    const addTag = (t: Tag) => {
      const k = `${t.publicationId}|${t.authorName}`
      // Pub-list evidence is the program's own assertion — keep it over roster.
      if (!tags.has(k) || t.method === 'reu_pub_list') tags.set(k, t)
    }

    // --- source 1 ---
    const citations = parsePubList(readFileSync(PUB_LIST_HTML, 'utf8'))
    const unmatched: string[] = []
    const noAuthor: string[] = []
    let matched = 0
    const seenPubs = new Set<number>()
    for (const c of citations) {
      const pub = matchCitation(c, pubs, byDoi)
      if (!pub) { unmatched.push(c.text); continue }
      matched++
      seenPubs.add(pub.id)
      const reu = pub.authors.filter((a) => a.family && surnameKeys(a.family).some((k) => c.boldKeys.has(k)))
      if (!reu.length) { noAuthor.push(`#${pub.id} ${c.text.slice(0, 160)}`); continue }
      for (const a of reu) addTag({ publicationId: pub.id, authorName: displayName(a), method: 'reu_pub_list', why: c.text.slice(0, 80) })
    }
    console.log(
      `  Pub list: ${citations.length} citations → ${matched} matched (${seenPubs.size} distinct pubs), ` +
        `${unmatched.length} unmatched, ${noAuthor.length} matched but no bold author found`,
    )

    // --- source 2 ---
    const roster = loadRoster()
    let rosterTags = 0
    const studentsWithPubs = new Set<string>()
    for (const s of roster) {
      for (const p of pubs) {
        if (p.year == null || p.year < s.cohort || p.year > s.cohort + ROSTER_WINDOW) continue
        const student = p.authors.find((a) => authorMatchesStudent(a, s))
        if (!student) continue
        const mentorOnPaper = p.authors.some(
          (a) => a !== student && a.family && surnameKeys(a.family).some((k) => s.mentorKeys.has(k)),
        )
        if (!mentorOnPaper) continue
        addTag({ publicationId: p.id, authorName: displayName(student), method: s.derived ? 'roster_derived' : 'roster', why: `${s.first} ${s.last} (${s.cohort}${s.derived ? ', derived' : ''})` })
        studentsWithPubs.add(`${s.first} ${s.last}`)
        rosterTags++
      }
    }
    console.log(
      `  Roster: ${roster.filter((s) => !s.derived).length} official + ${roster.filter((s) => s.derived).length} derived students → ` +
        `${rosterTags} tags for ${studentsWithPubs.size} students (mentor co-authored)`,
    )

    // Lag (pub year − cohort year) on the program's own list, for roster
    // students it names — the evidence behind ROSTER_WINDOW.
    const lags: number[] = []
    for (const t of tags.values()) {
      if (t.method !== 'reu_pub_list') continue
      const p = pubMap.get(t.publicationId)!
      const a = p.authors.find((x) => displayName(x) === t.authorName)
      const s = a && roster.find((r) => !r.derived && authorMatchesStudent(a, r) && p.year != null && r.cohort <= p.year)
      if (s && p.year != null) lags.push(p.year - s.cohort)
    }
    const hist = new Map<number, number>()
    lags.forEach((l) => hist.set(l, (hist.get(l) ?? 0) + 1))
    console.log(
      `  Pub-list lag (pub year − cohort), n=${lags.length}: ` +
        [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}y:${n}`).join(' '),
    )

    const all = [...tags.values()]
    const bySource = (m: string) => all.filter((t) => t.method === m).length
    console.log(
      `  Combined: ${all.length} REU author tags on ${new Set(all.map((t) => t.publicationId)).size} publications ` +
        `(${bySource('reu_pub_list')} pub list, ${bySource('roster')} roster-only, ${bySource('roster_derived')} derived-roster-only)`,
    )

    mkdirSync(OUTPUT_DIR, { recursive: true })
    writeFileSync(
      join(OUTPUT_DIR, 'reu-pub-list-unmatched.txt'),
      `# Citations from the REU pub list with no matching publication (${unmatched.length})\n` +
        unmatched.join('\n') +
        `\n\n# Matched, but no bold/starred name equals an author surname (${noAuthor.length})\n` +
        noAuthor.join('\n') +
        `\n\n# Roster-only tags — not on the program's list; mentor co-authored (${bySource('roster') + bySource('roster_derived')})\n` +
        all
          .filter((t) => t.method === 'roster' || t.method === 'roster_derived')
          .map((t) => {
            const p = pubMap.get(t.publicationId)!
            return `#${p.id} ${p.year} ${t.authorName} ← ${t.why} | ${p.authors.map(displayName).join(', ').slice(0, 90)} | ${p.title.slice(0, 70)}`
          })
          .join('\n') + '\n',
    )
    console.log(`  Review list → scripts/output/reu-pub-list-unmatched.txt`)

    if (dryRun) {
      console.log('\n[dry-run] nothing written.')
      return
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `DELETE FROM publication_student_authors
          WHERE detection_method IN ('reu_pub_list', 'roster', 'roster_derived') AND NOT curated`,
      )
      let written = 0
      for (const t of all) {
        const res = await client.query(
          `INSERT INTO publication_student_authors
             (publication_id, author_id, author_name, student_program, detection_method)
           VALUES ($1, (SELECT id FROM authors WHERE display_name = $2 ORDER BY work_count DESC NULLS LAST LIMIT 1),
                   $2, 'reu', $3)
           ON CONFLICT (publication_id, author_name) DO UPDATE
             SET student_program = 'reu', detection_method = EXCLUDED.detection_method
             WHERE NOT publication_student_authors.curated
               AND publication_student_authors.detection_method = 'inferred_window'`,
          [t.publicationId, t.authorName, t.method],
        )
        written += res.rowCount ?? 0
      }
      await client.query('COMMIT')
      console.log(`\nWrote ${written} REU tags (the rest already held by curated or structural rows).`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
