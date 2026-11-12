/**
 * PROTOTYPE (dry-run only) — study-based project assignment. See lib/study-assignment.ts
 * for the model. Compares against the item lists currently in projects_rels
 * and writes review files; it never writes to the database.
 *
 * Plan embeddings ("<name>. <description>", the text assign-projects embeds) are
 * cached in scripts/output/study-assignment/plan-embeddings.json, keyed by a
 * hash of that text, so re-runs and threshold sweeps cost nothing.
 *
 * Outputs (scripts/output/study-assignment/):
 *   projects.csv  per filing: proposed vs current counts, top items
 *   sample.csv    stratified paper–plan pairs to hand-label (label column blank)
 *
 * Usage:
 *   npx tsx scripts/prototype-study-assignment.ts [--pi-threshold=0.5] [--other-threshold=0.7]
 *     [--margin=0.03] [--start-slack=1] [--active-lag=5] [--sample=40] [--seed=1]
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { embedTexts } from './lib/embedding-cluster.js'
import {
  assignItem, authorKey, buildStudies, normalize, studySimilarity,
  type Assignment, type Filing, type Item, type Params, type Study,
} from './lib/study-assignment.js'

const args = process.argv.slice(2)
const num = (name: string, dflt: number) => {
  const v = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  return v == null ? dflt : Number(v)
}
const params: Params = {
  piThreshold: num('pi-threshold', 0.5),
  otherThreshold: num('other-threshold', 0.7),
  margin: num('margin', 0.03),
  startSlack: num('start-slack', 1),
  activeLag: num('active-lag', 5),
}
const SAMPLE = num('sample', 40)
let seed = num('seed', 1)

const OUT = join(import.meta.dirname, 'output', 'study-assignment')
const CACHE = join(OUT, 'plan-embeddings.json')

/** Deterministic PRNG so the labeling sample is reproducible. */
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 31
}
function sample<T>(xs: T[], n: number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

const parseVec = (s: string) => normalize(s.slice(1, -1).split(',').map(Number))

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // ---------------------------------------------------------------- plans
    const { rows: plans } = await db.query<{
      id: number; plan_id: string | null; pi: string | null; name: string; description: string | null
      start_year: number | null; end_year: number | null; renews_project_id: number | null
    }>(`SELECT id, plan_id, pi, name, description, start_year, end_year, renews_project_id
          FROM projects WHERE project_type = 'research_plan'`)
    const undated = plans.filter((p) => p.start_year == null)
    const dated = plans.filter((p) => p.start_year != null)

    const cache: Record<string, number[]> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf-8')) : {}
    const textOf = (p: (typeof plans)[number]) => `${p.name}. ${p.description ?? ''}`.slice(0, 8000)
    const hashOf = (t: string) => createHash('sha1').update(t).digest('hex')
    const missing = dated.filter((p) => !cache[hashOf(textOf(p))])
    if (missing.length > 0) {
      console.log(`Embedding ${missing.length} plan descriptions (cached for re-runs)...`)
      const vecs = await embedTexts(missing.map(textOf))
      missing.forEach((p, i) => { cache[hashOf(textOf(p))] = vecs[i] })
      writeFileSync(CACHE, JSON.stringify(cache))
    }

    const filings: Filing[] = dated.map((p) => ({
      id: p.id,
      planId: p.plan_id ?? `#${p.id}`,
      pi: p.pi ?? '',
      startYear: p.start_year!,
      endYear: p.end_year ?? p.start_year!,
      rootId: p.renews_project_id ?? p.id,
      embedding: normalize(cache[hashOf(textOf(p))]),
    }))
    const studies = buildStudies(filings)
    const planById = new Map(dated.map((p) => [p.id, p]))
    const filingById = new Map(filings.map((f) => [f.id, f]))
    const studyByRoot = new Map(studies.map((s) => [s.rootId, s]))
    console.log(`${filings.length} dated filings in ${studies.length} studies` +
      (undated.length ? ` (${undated.length} undated plans skipped: ${undated.map((p) => `#${p.id}`).join(', ')})` : ''))

    // ---------------------------------------------------------------- items
    const items: Item[] = []
    const titles = new Map<string, string>()
    const key = (c: string, id: number) => `${c}:${id}`

    const { rows: pubs } = await db.query<{ id: number; year: number | null; title: string; embedding: string }>(
      `SELECT id, year::int AS year, title, embedding::text FROM publications WHERE rmbl_research = 'yes' AND embedding IS NOT NULL`)
    const { rows: pubAuthors } = await db.query<{ pid: number; family: string; given: string | null }>(
      `SELECT pa._parent_id AS pid, pa.family, pa.given FROM publications_authors pa
         JOIN publications p ON p.id = pa._parent_id WHERE p.rmbl_research = 'yes' AND pa.family IS NOT NULL`)
    const pubKeys = new Map<number, Set<string>>()
    for (const a of pubAuthors) {
      if (!pubKeys.has(a.pid)) pubKeys.set(a.pid, new Set())
      pubKeys.get(a.pid)!.add(authorKey(a.family, a.given))
    }
    for (const r of pubs) {
      items.push({ collection: 'publications', id: r.id, year: r.year, embedding: parseVec(r.embedding),
        authorKeys: pubKeys.get(r.id) ?? new Set() })
      titles.set(key('publications', r.id), r.title)
    }

    // Data-collection start is the date that ties a dataset to a filing; 1900 is a placeholder.
    const { rows: dss } = await db.query<{ id: number; year: number | null; title: string; embedding: string }>(
      `SELECT id, title, embedding::text,
              COALESCE(NULLIF(GREATEST(extract(year FROM temporal_extent_start), 1950), 1950),
                       publication_year)::int AS year
         FROM datasets WHERE embedding IS NOT NULL`)
    const { rows: creators } = await db.query<{ pid: number; name: string }>(
      `SELECT _parent_id AS pid, name FROM datasets_creators WHERE name IS NOT NULL`)
    const dsKeys = new Map<number, Set<string>>()
    for (const c of creators) {
      const [family, given] = c.name.includes(',') ? c.name.split(',', 2) : [c.name.split(' ').pop()!, c.name]
      if (!dsKeys.has(c.pid)) dsKeys.set(c.pid, new Set())
      dsKeys.get(c.pid)!.add(authorKey(family, given))
    }
    for (const r of dss) {
      items.push({ collection: 'datasets', id: r.id, year: r.year, embedding: parseVec(r.embedding),
        authorKeys: dsKeys.get(r.id) ?? new Set() })
      titles.set(key('datasets', r.id), r.title)
    }

    const { rows: docs } = await db.query<{ id: number; year: number | null; title: string; embedding: string }>(
      `SELECT id, title, embedding::text, extract(year FROM date_original)::int AS year
         FROM documents WHERE embedding IS NOT NULL`)
    for (const r of docs) {
      items.push({ collection: 'documents', id: r.id, year: r.year, embedding: parseVec(r.embedding),
        authorKeys: new Set() })
      titles.set(key('documents', r.id), r.title)
    }
    console.log(`${pubs.length} RMBL publications, ${dss.length} datasets, ${docs.length} documents with embeddings`)

    // ---------------------------------------------------------------- assign
    const t0 = Date.now()
    const assignments: Assignment[] = []
    for (const it of items) assignments.push(...assignItem(it, studies, params))
    console.log(`Assigned in ${((Date.now() - t0) / 1000).toFixed(1)}s with ${JSON.stringify(params)}`)

    const proposed = new Map<number, Assignment[]>() // filing id -> assignments
    for (const a of assignments) {
      if (!proposed.has(a.filing.id)) proposed.set(a.filing.id, [])
      proposed.get(a.filing.id)!.push(a)
    }

    // ---------------------------------------------------------------- current
    const { rows: rels } = await db.query<{ parent_id: number; path: string; item_id: number }>(
      `SELECT parent_id, path, COALESCE(publications_id, datasets_id, documents_id) AS item_id
         FROM projects_rels WHERE path IN ('publications', 'datasets', 'documents')`)
    const current = new Map<number, Set<string>>()
    for (const r of rels) {
      if (!filingById.has(r.parent_id)) continue
      if (!current.has(r.parent_id)) current.set(r.parent_id, new Set())
      current.get(r.parent_id)!.add(key(r.path, r.item_id))
    }

    // ---------------------------------------------------------------- report
    const count = (as: Assignment[], c: string) => as.filter((a) => a.item.collection === c).length
    const projectRows = filings
      .map((f) => {
        const as = (proposed.get(f.id) ?? []).sort((a, b) => b.similarity - a.similarity)
        const cur = current.get(f.id) ?? new Set()
        const study = studyByRoot.get(f.rootId)!
        const curPubs = [...cur].filter((k) => k.startsWith('publications:')).length
        const kept = as.filter((a) => cur.has(key(a.item.collection, a.item.id))).length
        return {
          id: f.id,
          plan_id: f.planId,
          study_root: filingById.get(f.rootId)?.planId ?? '',
          study_filings: study.filings.length,
          years: `${f.startYear}-${f.endYear}`,
          pi: f.pi,
          name: planById.get(f.id)!.name,
          pubs: count(as, 'publications'),
          pubs_via_pi: as.filter((a) => a.item.collection === 'publications' && a.viaPi).length,
          datasets: count(as, 'datasets'),
          documents: count(as, 'documents'),
          current_pubs: curPubs,
          current_items: cur.size,
          overlap_with_current: kept,
          pub_years: (() => {
            const ys = as.filter((a) => a.item.collection === 'publications' && a.item.year != null).map((a) => a.item.year!)
            return ys.length ? `${Math.min(...ys)}-${Math.max(...ys)}` : ''
          })(),
          top_pubs: as.filter((a) => a.item.collection === 'publications').slice(0, 3)
            .map((a) => `${a.item.year ?? '?'} ${titles.get(key('publications', a.item.id))?.slice(0, 60)} [${a.similarity.toFixed(2)}${a.viaPi ? ' pi' : ''}]`)
            .join(' | '),
        }
      })
      .sort((a, b) => a.plan_id.localeCompare(b.plan_id))
    writeFileSync(join(OUT, 'projects.csv'), csv(projectRows))

    // ---------------------------------------------------------------- summary
    const pubAs = assignments.filter((a) => a.item.collection === 'publications')
    const assignedPubs = new Set(pubAs.map((a) => a.item.id))
    const perPaper = new Map<number, number>()
    for (const a of pubAs) perPaper.set(a.item.id, (perPaper.get(a.item.id) ?? 0) + 1)
    const pc = projectRows.map((r) => r.pubs).sort((a, b) => a - b)
    const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]
    const afterEnd = pubAs.filter((a) => a.item.year != null && a.item.year > a.filing.endYear + 5).length
    const curPubLinks = [...current.values()].reduce((n, s) => n + [...s].filter((k) => k.startsWith('publications:')).length, 0)

    const split = (pref: string) => projectRows.filter((r) => r.plan_id.startsWith(pref))
    const line = (label: string, rows: typeof projectRows) => {
      const c = rows.map((r) => r.pubs).sort((a, b) => a - b)
      return `  ${label.padEnd(9)} ${String(rows.length).padStart(5)} filings  ` +
        `${String(rows.reduce((n, r) => n + r.pubs, 0)).padStart(6)} pub links ` +
        `(was ${rows.reduce((n, r) => n + r.current_pubs, 0)})  ` +
        `median ${q(c, 0.5)}, p90 ${q(c, 0.9)}, max ${c[c.length - 1]}, zero ${c.filter((x) => x === 0).length}`
    }

    console.log(`\n== Proposed (study-based) ==`)
    console.log(line('legacy', split('LEGACY-')))
    console.log(line('2022+', split('RS')))
    console.log(line('all', projectRows))
    console.log(`  publications assigned: ${assignedPubs.size}/${pubs.length} RMBL papers; ` +
      `${[...perPaper.values()].filter((n) => n > 1).length} go to more than one study`)
    console.log(`  ${pubAs.filter((a) => a.viaPi).length}/${pubAs.length} pub links via a PI-authored paper; ` +
      `${afterEnd} published more than 5 years after their filing ended (kept — the date window would have cut them)`)
    console.log(`  datasets ${count(assignments, 'datasets')}, documents ${count(assignments, 'documents')}`)
    console.log(`  current pub links across all plans: ${curPubLinks}; ` +
      `${projectRows.reduce((n, r) => n + r.overlap_with_current, 0)} proposed links already exist`)

    // Similarity profile of each PI-authored paper's best study, for threshold tuning.
    const best: number[] = []
    for (const it of items) {
      if (it.collection !== 'publications' || it.authorKeys.size === 0) continue
      let b = -1
      for (const s of studies) {
        if ([...s.piKeys].some((k) => it.authorKeys.has(k))) b = Math.max(b, studySimilarity(it, s))
      }
      if (b >= 0) best.push(b)
    }
    best.sort((a, b) => a - b)
    console.log(`\n  ${best.length} papers have a study PI among their authors; best-study similarity:`)
    for (const t of [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7]) {
      console.log(`    >= ${t.toFixed(2)}: ${best.filter((s) => s >= t).length}`)
    }

    // ---------------------------------------------------------------- sample
    // Strata where the proposal is least certain or disagrees with what is live now.
    type Pair = { stratum: string; filing: Filing; itemId: number; year: number | null; sim: number; viaPi: boolean }
    const strata: Pair[][] = []
    const pubAssigned = (lo: number, hi: number, viaPi: boolean) =>
      pubAs.filter((a) => a.viaPi === viaPi && a.similarity >= lo && a.similarity < hi)
        .map((a): Pair => ({ stratum: '', filing: a.filing, itemId: a.item.id, year: a.item.year, sim: a.similarity, viaPi: a.viaPi }))

    strata.push(pubAssigned(params.piThreshold, params.piThreshold + 0.05, true).map((p) => ({ ...p, stratum: 'A: PI paper, just above bar' })))
    strata.push(pubAssigned(params.otherThreshold, 2, false).map((p) => ({ ...p, stratum: 'B: non-PI paper, content only' })))
    strata.push(pubAs.filter((a) => a.item.year != null && a.item.year > a.filing.endYear + 5)
      .map((a): Pair => ({ stratum: 'C: >5y after filing ended', filing: a.filing, itemId: a.item.id, year: a.item.year, sim: a.similarity, viaPi: a.viaPi })))

    const itemById = new Map(items.filter((i) => i.collection === 'publications').map((i) => [i.id, i]))
    const proposedKeys = new Set(pubAs.map((a) => `${a.filing.rootId}:${a.item.id}`))
    const dropped: Pair[] = []
    for (const [fid, set] of current) {
      const f = filingById.get(fid)!
      for (const k of set) {
        if (!k.startsWith('publications:')) continue
        const id = Number(k.split(':')[1])
        const it = itemById.get(id)
        if (!it || proposedKeys.has(`${f.rootId}:${id}`)) continue
        const study = studyByRoot.get(f.rootId)!
        dropped.push({ stratum: 'D: live now, proposal drops', filing: f, itemId: id, year: it.year,
          sim: studySimilarity(it, study), viaPi: [...study.piKeys].some((pk) => it.authorKeys.has(pk)) })
      }
    }
    strata.push(dropped)
    // E: PI papers that miss every one of their PI's studies by a small margin.
    const nearMiss: Pair[] = []
    for (const it of items) {
      if (it.collection !== 'publications' || assignedPubs.has(it.id)) continue
      for (const s of studies) {
        if (![...s.piKeys].some((k) => it.authorKeys.has(k))) continue
        if (it.year != null && it.year < s.startYear - params.startSlack) continue
        const sim = studySimilarity(it, s)
        if (sim >= params.piThreshold - 0.07) {
          nearMiss.push({ stratum: 'E: PI paper, just below bar', filing: s.filings[s.filings.length - 1],
            itemId: it.id, year: it.year, sim, viaPi: true })
        }
      }
    }
    strata.push(nearMiss)

    const nonEmpty = strata.filter((s) => s.length > 0)
    const per = Math.ceil(SAMPLE / nonEmpty.length)
    const picked = nonEmpty.flatMap((s) => sample(s, per))
    writeFileSync(join(OUT, 'sample.csv'), csv(picked.map((p) => {
      const plan = planById.get(p.filing.id)!
      const study = studyByRoot.get(p.filing.rootId)!
      return {
        label: '',
        stratum: p.stratum,
        plan_id: p.filing.planId,
        filing_years: `${p.filing.startYear}-${p.filing.endYear}`,
        study_years: `${study.startYear}-${Math.max(...study.filings.map((f) => f.endYear))}`,
        pi: p.filing.pi,
        plan: plan.name,
        pub_id: p.itemId,
        pub_year: p.year ?? '',
        pub_title: titles.get(key('publications', p.itemId)) ?? '',
        similarity: p.sim.toFixed(3),
        pi_author: p.viaPi ? 'yes' : 'no',
        pub_url: `http://localhost:3000/publications/${p.itemId}`,
        plan_url: `http://localhost:3000/projects/${p.filing.id}`,
      }
    })))
    console.log(`\nStrata sizes: ${strata.map((s) => s[0]?.stratum.slice(0, 1) + '=' + s.length).filter((s) => !s.startsWith('undefined')).join(', ')}`)
    console.log(`Wrote ${join(OUT, 'projects.csv')} and ${join(OUT, 'sample.csv')} (${picked.length} pairs to label)`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
