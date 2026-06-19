/**
 * Audit candidate author conflations: single `authors` rows that look like
 * they aggregate two or more distinct researchers. Targets the class of bug
 * where authors lacking ORCID and sharing a family name + first/middle
 * initials get over-merged by the name-based dedup heuristic
 * (`scripts/lib/author-dedup.ts`).
 *
 * The script is read-only — it queries the database, scores each
 * suspect author by a small set of evidence-weighted signals, and writes a
 * sorted CSV of candidates to `scripts/output/author-conflation-audit.csv`
 * for human review. It does NOT mutate any data.
 *
 * Signals (each contributes to the suspicion score):
 *
 *   span:50–69 yr  +2   plausible-but-long career; review
 *   span:70+ yr    +3   exceeds a credible single career
 *   span:100+ yr   +5   definitively multiple people
 *   max_gap:>=20yr +2   long publication gap; could be different people
 *   bimodal_cluster +2  two distinct active periods >15yr apart
 *
 * Score >= 4 is treated as "high confidence — review first".
 *
 * Usage:
 *   npx tsx scripts/audit-author-conflations.ts
 *   npx tsx scripts/audit-author-conflations.ts --min-pubs=3 --min-span=30
 *
 * Output schema (CSV columns):
 *   author_id, display_name, family_name, given_name, orcid,
 *   n_pubs, first_year, last_year, span_years, max_gap_years,
 *   n_coauthors, top_venues, top_coauthors,
 *   suspicion_score, notes
 *
 * Tracks: https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues/46
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const argInt = (name: string, fallback: number): number => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  if (!a) return fallback
  const v = parseInt(a.split('=')[1], 10)
  return Number.isFinite(v) ? v : fallback
}
const MIN_PUBS = argInt('min-pubs', 3)
const MIN_SPAN = argInt('min-span', 30)
const OUT_PATH = 'scripts/output/author-conflation-audit.csv'

interface Suspect {
  author_id: number
  display_name: string
  family_name: string
  given_name: string
  orcid: string | null
  n_pubs: number
  first_year: number
  last_year: number
  span_years: number
  max_gap_years: number
  bimodal: boolean
  n_coauthors: number
  top_venues: string[]
  top_coauthors: string[]
  suspicion_score: number
  notes: string[]
}

function score(s: Pick<Suspect, 'span_years' | 'max_gap_years' | 'bimodal'>): { score: number; notes: string[] } {
  const notes: string[] = []
  let score = 0
  if (s.span_years >= 100)     { score += 5; notes.push('span>=100yr (definitive)') }
  else if (s.span_years >= 70) { score += 3; notes.push('span>=70yr (exceeds credible career)') }
  else if (s.span_years >= 50) { score += 2; notes.push('span>=50yr (long career — review)') }
  if (s.max_gap_years >= 20)   { score += 2; notes.push('long publication gap') }
  if (s.bimodal)               { score += 2; notes.push('bimodal active periods') }
  return { score, notes }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL not set. Did you load .env? (config.ts auto-loads on import.)')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: url })

  // Pool of candidates: authors with no ORCID + short given name + enough pubs to
  // be worth checking. Short given name (≤6 chars) captures initials-only
  // and short-form variants where the dedup heuristic is liberal.
  const { rows: pool_rows } = await pool.query<{
    author_id: number
    display_name: string
    family_name: string
    given_name: string
    orcid: string | null
    n_pubs: number
    first_year: number
    last_year: number
  }>(
    `
    WITH author_years AS (
      SELECT a.id            AS author_id,
             a.display_name,
             a.family_name,
             coalesce(a.given_name, '') AS given_name,
             a.orcid,
             count(DISTINCT p.id)::int  AS n_pubs,
             min(p.year)::int           AS first_year,
             max(p.year)::int           AS last_year
        FROM authors a
        JOIN authors_rels ar ON ar.parent_id = a.id
        JOIN publications p  ON p.id        = ar.publications_id
       WHERE (a.orcid IS NULL OR a.orcid = '')
         AND length(coalesce(a.given_name, '')) <= 6
         AND p.year > 0
       GROUP BY a.id, a.display_name, a.family_name, a.given_name, a.orcid
    )
    SELECT * FROM author_years
     WHERE n_pubs >= $1 AND (last_year - first_year) >= $2
     ORDER BY (last_year - first_year) DESC, n_pubs DESC
    `,
    [MIN_PUBS, MIN_SPAN],
  )

  console.log(`Inspecting ${pool_rows.length} candidate authors (n_pubs >= ${MIN_PUBS}, span >= ${MIN_SPAN}yr)…`)

  const suspects: Suspect[] = []
  for (const row of pool_rows) {
    // Pull this author's per-publication years + their coauthors + venues
    // for finer-grained gap analysis.
    const { rows: pub_rows } = await pool.query<{ year: number; journal: string | null }>(
      `
      SELECT p.year, p.journal
        FROM authors_rels ar
        JOIN publications p ON p.id = ar.publications_id
       WHERE ar.parent_id = $1 AND p.year > 0
       ORDER BY p.year ASC
      `,
      [row.author_id],
    )
    const years = pub_rows.map((r) => r.year).filter((y) => y > 0)
    if (years.length === 0) continue

    // Largest gap between consecutive distinct years
    const distinct_years = Array.from(new Set(years)).sort((a, b) => a - b)
    let max_gap = 0
    for (let i = 1; i < distinct_years.length; i++) {
      max_gap = Math.max(max_gap, distinct_years[i] - distinct_years[i - 1])
    }

    // Bimodal: two distinct clusters of years separated by >15yr gap with
    // multiple pubs on each side.
    let bimodal = false
    for (let i = 1; i < distinct_years.length; i++) {
      if (distinct_years[i] - distinct_years[i - 1] > 15) {
        const before = years.filter((y) => y <= distinct_years[i - 1]).length
        const after  = years.filter((y) => y >= distinct_years[i]).length
        if (before >= 2 && after >= 2) { bimodal = true; break }
      }
    }

    const top_venues = Object.entries(
      pub_rows.reduce<Record<string, number>>((acc, r) => {
        const v = (r.journal || '').trim()
        if (v) acc[v] = (acc[v] || 0) + 1
        return acc
      }, {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v} (${n})`)

    // Top coauthors: most-frequent other author IDs appearing on this
    // author's publications.
    const { rows: coauthor_rows } = await pool.query<{ name: string; n: number }>(
      `
      SELECT a2.display_name AS name, count(*)::int AS n
        FROM authors_rels ar1
        JOIN authors_rels ar2
          ON ar1.publications_id = ar2.publications_id
         AND ar1.parent_id <> ar2.parent_id
        JOIN authors a2 ON a2.id = ar2.parent_id
       WHERE ar1.parent_id = $1
       GROUP BY a2.display_name
       ORDER BY n DESC
       LIMIT 4
      `,
      [row.author_id],
    )

    const span_years   = row.last_year - row.first_year
    const { score: s, notes } = score({ span_years, max_gap_years: max_gap, bimodal })

    suspects.push({
      author_id:       row.author_id,
      display_name:    row.display_name,
      family_name:     row.family_name,
      given_name:      row.given_name,
      orcid:           row.orcid,
      n_pubs:          row.n_pubs,
      first_year:      row.first_year,
      last_year:       row.last_year,
      span_years,
      max_gap_years:   max_gap,
      bimodal,
      n_coauthors:     coauthor_rows.length, // distinct, capped at limit
      top_venues,
      top_coauthors:   coauthor_rows.map((r) => `${r.name} (${r.n})`),
      suspicion_score: s,
      notes,
    })
  }

  await pool.end()

  suspects.sort((a, b) => b.suspicion_score - a.suspicion_score || b.span_years - a.span_years)

  // Write CSV
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  const headers = [
    'author_id', 'display_name', 'family_name', 'given_name', 'orcid',
    'n_pubs', 'first_year', 'last_year', 'span_years', 'max_gap_years',
    'bimodal', 'n_coauthors', 'top_venues', 'top_coauthors',
    'suspicion_score', 'notes',
  ]
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [headers.join(',')]
  for (const s of suspects) {
    lines.push([
      s.author_id, s.display_name, s.family_name, s.given_name, s.orcid || '',
      s.n_pubs, s.first_year, s.last_year, s.span_years, s.max_gap_years,
      s.bimodal, s.n_coauthors,
      s.top_venues.join(' | '),
      s.top_coauthors.join(' | '),
      s.suspicion_score,
      s.notes.join(' | '),
    ].map(esc).join(','))
  }
  writeFileSync(OUT_PATH, lines.join('\n'))

  const high     = suspects.filter((s) => s.suspicion_score >= 4).length
  const medium   = suspects.filter((s) => s.suspicion_score === 2 || s.suspicion_score === 3).length
  const low      = suspects.filter((s) => s.suspicion_score <= 1).length
  console.log()
  console.log(`Wrote ${suspects.length} candidate authors to ${OUT_PATH}`)
  console.log(`  high confidence (score >= 4):    ${high}`)
  console.log(`  medium confidence (score 2-3):   ${medium}`)
  console.log(`  low confidence (score 0-1):      ${low}`)
  console.log()
  console.log('Next step: manually review the high-confidence rows. Use the Payload')
  console.log('admin UI to split conflated authors into separate records.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
