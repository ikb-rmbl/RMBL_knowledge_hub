/**
 * Link research-plan PIs to the Authors registry (projects.pi_author_id),
 * only where the evidence picks out one person — see lib/pi-author-match.ts.
 *
 *   1. Candidates: registry authors with the PI's surname + first initial whose
 *      first name / middle initial don't contradict the PI's.
 *   2. Evidence per candidate: RMBL-research papers within 10 years of the
 *      filing, topic similarity of their papers to the plan text, co-authorship
 *      with the plan's listed collaborators (legacy plans), and — second pass —
 *      another filing of the same study (renewal chain) linked to them.
 *   3. Auto-link only when exactly one candidate passes; plausible-but-unproven
 *      cases go to a review CSV for an admin; the rest stay plain text.
 *
 * Re-derives every non-curated link, so an earlier link that no longer passes is
 * cleared (and listed for review). A PI author set or cleared by an admin
 * (curated_fields 'piAuthor') is never touched.
 *
 * Author ids differ between local and Neon, so pi_author_id is not synced:
 * run with --target=neon to derive production's links from its own registry.
 * Plan embeddings are cached by text hash in
 * scripts/output/study-assignment/plan-embeddings.json (shared with the
 * study-assignment prototype), so the Neon run re-embeds nothing.
 *
 * Outputs (scripts/output/plan-pi-links/): review.csv, sample.csv (stratified
 * sample of auto-links for spot-checking), decisions.json.
 *
 * Usage:
 *   npx tsx scripts/link-plan-pis.ts [--dry-run] [--target=neon] [--sample=40]
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { embedTexts } from './lib/embedding-cluster.js'
import { authorKey, piKey } from './lib/person-names.js'
import {
  type CandidateEvidence, type Decision, YEAR_WINDOW, collaboratorsOf, decide, nameCompat,
} from './lib/pi-author-match.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)
const SAMPLE = Number(args.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? 40)

const OUT = join(import.meta.dirname, 'output', 'plan-pi-links')
const EMBED_CACHE = join(import.meta.dirname, 'output', 'study-assignment', 'plan-embeddings.json')

interface Plan {
  id: number
  plan_id: string | null
  pi: string
  name: string
  description: string | null
  start_year: number | null
  end_year: number | null
  root: number
  pi_author_id: number | null
  curated: boolean
}

const firstPi = (pi: string) => pi.split(/[,;&]| and /)[0].trim()
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (rows: Record<string, unknown>[]) =>
  rows.length ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(csvCell).join(','))].join('\n') + '\n' : ''

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  mkdirSync(OUT, { recursive: true })
  try {
    const { rows: plans } = await db.query<Plan>(
      `SELECT id, plan_id, pi, name, description, start_year, end_year,
              coalesce(renews_project_id, id) AS root, pi_author_id,
              curated_fields ?| array['piAuthor', 'piAuthorId'] AS curated
         FROM projects WHERE coalesce(trim(pi), '') <> ''`)

    // ---------------------------------------------------------- candidates
    const { rows: authors } = await db.query<{ id: number; display_name: string; family_name: string; given_name: string | null }>(
      `SELECT id, display_name, family_name, given_name FROM authors`)
    const byKey = new Map<string, typeof authors>()
    const surnameCount = new Map<string, number>()
    for (const a of authors) {
      const fam = authorKey(a.family_name, null)
      surnameCount.set(fam, (surnameCount.get(fam) ?? 0) + 1)
      const k = authorKey(a.family_name, a.given_name)
      if (!k.includes(' ')) continue // no given name: initial unknown
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(a)
    }
    const candidatesOf = new Map<number, { id: number; name: string; match: 'agree' | 'initial' }[]>()
    for (const p of plans) {
      const list = (byKey.get(piKey(p.pi)) ?? [])
        .map((a) => ({ id: a.id, name: a.display_name, match: nameCompat(firstPi(p.pi), a.display_name) }))
        .filter((c): c is { id: number; name: string; match: 'agree' | 'initial' } => c.match !== 'conflict')
      candidatesOf.set(p.id, list)
    }
    const candIds = [...new Set([...candidatesOf.values()].flat().map((c) => c.id))]
    console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
    console.log(`${plans.length} projects with a PI; ${candIds.length} distinct candidate authors`)

    // ------------------------------------------------------------ evidence
    const { rows: yearRows } = await db.query<{ author: number; year: number }>(
      `SELECT ar.parent_id AS author, p.year::int AS year
         FROM authors_rels ar JOIN publications p ON p.id = ar.publications_id
        WHERE ar.parent_id = ANY($1) AND p.rmbl_research = 'yes' AND p.year IS NOT NULL`, [candIds])
    const rmblYears = new Map<number, number[]>()
    for (const r of yearRows) {
      if (!rmblYears.has(r.author)) rmblYears.set(r.author, [])
      rmblYears.get(r.author)!.push(r.year)
    }

    const { rows: coRows } = await db.query<{ author: number; family_name: string; given_name: string | null }>(
      `SELECT DISTINCT ar.parent_id AS author, co.family_name, co.given_name
         FROM authors_rels ar
         JOIN authors_rels ar2 ON ar2.publications_id = ar.publications_id AND ar2.parent_id <> ar.parent_id
         JOIN authors co ON co.id = ar2.parent_id
        WHERE ar.parent_id = ANY($1) AND ar.publications_id IS NOT NULL`, [candIds])
    const coauthors = new Map<number, Set<string>>()
    for (const r of coRows) {
      if (!coauthors.has(r.author)) coauthors.set(r.author, new Set())
      coauthors.get(r.author)!.add(authorKey(r.family_name, r.given_name))
    }

    // Plan embeddings: same text + hash as the study-assignment prototype.
    const cache: Record<string, number[]> = existsSync(EMBED_CACHE) ? JSON.parse(readFileSync(EMBED_CACHE, 'utf-8')) : {}
    const textOf = (p: Plan) => `${p.name}. ${p.description ?? ''}`.slice(0, 8000)
    const hashOf = (t: string) => createHash('sha1').update(t).digest('hex')
    const needTopic = plans.filter((p) => (candidatesOf.get(p.id) ?? []).length > 0)
    const missing = needTopic.filter((p) => !cache[hashOf(textOf(p))])
    if (missing.length > 0) {
      console.log(`Embedding ${missing.length} plan descriptions (cached for re-runs)...`)
      const vecs = await embedTexts(missing.map(textOf))
      missing.forEach((p, i) => { cache[hashOf(textOf(p))] = vecs[i] })
      mkdirSync(join(EMBED_CACHE, '..'), { recursive: true })
      writeFileSync(EMBED_CACHE, JSON.stringify(cache))
    }
    const topicOf = async (p: Plan, author: number): Promise<number | null> => {
      const { rows } = await db.query<{ sim: number }>(
        `SELECT avg(sim)::float AS sim FROM (
           SELECT 1 - (pub.embedding <=> $1::vector) AS sim
             FROM authors_rels ar JOIN publications pub ON pub.id = ar.publications_id
            WHERE ar.parent_id = $2 AND pub.embedding IS NOT NULL
            ORDER BY sim DESC LIMIT 3) t`,
        [`[${cache[hashOf(textOf(p))].join(',')}]`, author])
      return rows[0]?.sim ?? null
    }

    const evidence = new Map<number, CandidateEvidence[]>()
    for (const p of plans) {
      const lo = (p.start_year ?? p.end_year ?? 0) - YEAR_WINDOW
      const hi = (p.end_year ?? p.start_year ?? 9999) + YEAR_WINDOW
      const collabs = collaboratorsOf(p.description)
      const key = piKey(p.pi)
      const sameSurname = surnameCount.get(key.split(' ')[0]) ?? 0
      const rare = sameSurname > 0 && sameSurname === (byKey.get(key) ?? []).length
      const list: CandidateEvidence[] = []
      for (const c of candidatesOf.get(p.id) ?? []) {
        const co = coauthors.get(c.id) ?? new Set<string>()
        list.push({
          authorId: c.id,
          name: c.name,
          name_match: c.match,
          active_papers: (rmblYears.get(c.id) ?? []).filter((y) => y >= lo && y <= hi).length,
          topic: await topicOf(p, c.id),
          coauthored_collaborators: collabs.filter((n) => co.has(piKey(n))),
          chain: false,
          rare_surname: rare,
        })
      }
      evidence.set(p.id, list)
    }

    // ----------------------------------------------------------- decisions
    const decisions = new Map<number, Decision>()
    for (const p of plans) decisions.set(p.id, decide(evidence.get(p.id)!))
    // Second pass: a filing of a study whose other filing is auto-linked to a
    // candidate of this one. Repeat until stable (chains are short).
    for (let changed = true; changed;) {
      changed = false
      const linkedInChain = new Map<number, Set<number>>()
      for (const p of plans) {
        const d = decisions.get(p.id)!
        if (d.band !== 'auto') continue
        if (!linkedInChain.has(p.root)) linkedInChain.set(p.root, new Set())
        linkedInChain.get(p.root)!.add(d.authorId!)
      }
      for (const p of plans) {
        if (decisions.get(p.id)!.band === 'auto') continue
        const siblings = linkedInChain.get(p.root)
        if (!siblings || siblings.size !== 1) continue
        const ev = evidence.get(p.id)!
        let touched = false
        for (const c of ev) if (siblings.has(c.authorId) && !c.chain) { c.chain = true; touched = true }
        if (!touched) continue
        const d = decide(ev)
        if (d.band === 'auto') { decisions.set(p.id, d); changed = true }
      }
    }

    // -------------------------------------------------------------- report
    const bands = { auto: 0, review: 0, none: 0 }
    const byBasis = new Map<string, number>()
    const changes: { plan: Plan; from: number | null; to: number | null }[] = []
    const reviewRows: Record<string, unknown>[] = []
    const nameOf = new Map(authors.map((a) => [a.id, a.display_name]))
    for (const p of plans) {
      const d = decisions.get(p.id)!
      bands[d.band]++
      if (d.band === 'auto') byBasis.set(d.basis, (byBasis.get(d.basis) ?? 0) + 1)
      const to = d.band === 'auto' ? d.authorId : null
      const lostLink = p.pi_author_id != null && to !== p.pi_author_id
      if (!p.curated && to !== p.pi_author_id) changes.push({ plan: p, from: p.pi_author_id, to })
      if ((d.band === 'review' || (lostLink && !p.curated)) && !p.curated) {
        reviewRows.push({
          plan_id: p.plan_id, project_id: p.id, pi: p.pi, years: `${p.start_year ?? '?'}-${p.end_year ?? '?'}`,
          title: p.name.slice(0, 90),
          previous_link: p.pi_author_id ? `${p.pi_author_id} ${nameOf.get(p.pi_author_id) ?? ''}` : '',
          why: d.band === 'review' ? d.basis : `previous link cleared: ${d.basis}`,
          candidates: d.candidates.map((c) =>
            `${c.authorId} ${c.name} [${c.name_match}; ${c.active_papers} RMBL papers in window; topic ${c.topic?.toFixed(2) ?? '—'}` +
            `${c.coauthored_collaborators.length ? `; co-authored with ${c.coauthored_collaborators.join(', ')}` : ''}]`).join(' | '),
        })
      }
    }
    const curated = plans.filter((p) => p.curated).length
    console.log(`\nAuto-link ${bands.auto}, review ${bands.review}, no link ${bands.none}  (admin-curated, left alone: ${curated})`)
    for (const [b, n] of [...byBasis].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${b}`)
    const added = changes.filter((c) => c.from == null).length
    const cleared = changes.filter((c) => c.to == null).length
    console.log(`Changes: ${added} new links, ${changes.length - added - cleared} re-pointed, ${cleared} cleared ` +
      `(of ${plans.filter((p) => p.pi_author_id != null).length} existing links)`)

    // Stratified spot-check sample of auto-links (deterministic: hash order).
    const auto = plans.filter((p) => decisions.get(p.id)!.band === 'auto')
    const strata = [...byBasis.keys()]
    const per = Math.max(3, Math.ceil(SAMPLE / Math.max(1, strata.length)))
    const sample: Record<string, unknown>[] = []
    for (const s of strata) {
      const pool = auto.filter((p) => decisions.get(p.id)!.basis === s)
        .sort((a, b) => hashOf(String(a.id)).localeCompare(hashOf(String(b.id))))
      for (const p of pool.slice(0, per)) {
        const d = decisions.get(p.id)!
        const c = d.candidates.find((x) => x.authorId === d.authorId)!
        sample.push({
          plan_id: p.plan_id, project_id: p.id, pi: p.pi, years: `${p.start_year ?? '?'}-${p.end_year ?? '?'}`,
          title: p.name.slice(0, 90), linked_author: `${c.authorId} ${c.name}`, basis: d.basis,
          rmbl_papers_in_window: c.active_papers, topic: c.topic?.toFixed(2) ?? '',
          collaborators: c.coauthored_collaborators.join(', '), other_candidates: d.candidates.length - 1, correct: '',
        })
      }
    }
    writeFileSync(join(OUT, `review-${target}.csv`), toCsv(reviewRows))
    writeFileSync(join(OUT, `sample-${target}.csv`), toCsv(sample))
    writeFileSync(join(OUT, `decisions-${target}.json`), JSON.stringify(
      plans.map((p) => ({ project_id: p.id, plan_id: p.plan_id, pi: p.pi, curated: p.curated, ...decisions.get(p.id)! })), null, 1))
    console.log(`Wrote ${reviewRows.length} review rows, ${sample.length}-row sample → ${OUT}`)

    if (dryRun) return
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      let written = 0
      for (const c of changes) {
        const res = await client.query(
          `UPDATE projects SET pi_author_id = $1, updated_at = NOW()
            WHERE id = $2 AND NOT (curated_fields ?| array['piAuthor', 'piAuthorId'])`, [c.to, c.plan.id])
        written += res.rowCount ?? 0
      }
      await client.query('COMMIT')
      console.log(`Updated ${written} projects.`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
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
