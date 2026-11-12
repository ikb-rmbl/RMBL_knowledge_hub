/**
 * Study-based assignment of items (publications, datasets, documents) to research plans.
 *
 * The unit is the STUDY — a renewal chain of plan filings (or a lone filing),
 * not the filing. An item is matched to studies on content (embedding similarity
 * to any of the study's filings); authorship only lowers the bar, it is not
 * evidence on its own. A PI's studies compete for their papers, so each paper
 * goes to the study it best matches rather than to every plan the PI ever filed.
 * Time enters twice, and never as a cut-off after a study ends:
 *   - a study cannot claim an item from before it began (startSlack);
 *   - among the studies competing for an item, those still active at its date
 *     (last filing ended no more than activeLag years earlier) are preferred.
 *     A study that ended long ago only wins when nothing active matches, so
 *     late papers are kept but a stale filing — usually a renewal the chain
 *     detection missed — cannot absorb a PI's current work.
 * Within the study the item attaches to the filing in effect at its date, so
 * late papers stay with the last filing however long after it they appear.
 */

// ------------------------------------------------------------------ names

import { personKeys } from './person-names.js'
export { authorKey, personKeys, piKey } from './person-names.js'

// ------------------------------------------------------------------ model

export interface Filing {
  id: number
  planId: string
  pi: string
  startYear: number
  endYear: number
  /** The chain root's id — renews_project_id, or the filing's own id. */
  rootId: number
  embedding: Float32Array // unit-normalised
}

export interface Study {
  rootId: number
  filings: Filing[] // ascending start year
  startYear: number
  /** End year of the study's last filing. */
  endYear: number
  piKeys: Set<string>
}

export interface Item {
  collection: 'publications' | 'datasets' | 'documents'
  id: number
  year: number | null
  embedding: Float32Array // unit-normalised
  /** Author keys; empty for collections without structured authors. */
  authorKeys: Set<string>
}

export interface Params {
  /** Minimum similarity when a study PI is an author of the item. */
  piThreshold: number
  /** Minimum similarity otherwise. */
  otherThreshold: number
  /** Studies within this much of the best match also receive the item. */
  margin: number
  /** Years an item may precede its study's first filing (pilot work, in-press). */
  startSlack: number
  /** Years after a study's last filing ends that it still counts as active. Infinity disables. */
  activeLag: number
}

export interface Assignment {
  item: Item
  study: Study
  filing: Filing
  similarity: number
  viaPi: boolean
}

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v)
  let n = 0
  for (let i = 0; i < out.length; i++) n += out[i] * out[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < out.length; i++) out[i] /= n
  return out
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function buildStudies(filings: Filing[]): Study[] {
  const byRoot = new Map<number, Filing[]>()
  for (const f of filings) {
    if (!byRoot.has(f.rootId)) byRoot.set(f.rootId, [])
    byRoot.get(f.rootId)!.push(f)
  }
  return [...byRoot.entries()].map(([rootId, fs]) => {
    fs.sort((a, b) => a.startYear - b.startYear || a.id - b.id)
    return {
      rootId,
      filings: fs,
      startYear: fs[0].startYear,
      endYear: Math.max(...fs.map((f) => f.endYear)),
      piKeys: new Set(fs.flatMap((f) => personKeys(f.pi))),
    }
  })
}

/**
 * The filing in effect when the item appeared: the latest one that had started
 * by `year + slack`. Undated items go to the current (latest) filing.
 */
export function filingFor(study: Study, year: number | null, slack: number): Filing {
  if (year == null) return study.filings[study.filings.length - 1]
  let pick = study.filings[0]
  for (const f of study.filings) if (f.startYear <= year + slack) pick = f
  return pick
}

/** Best similarity of an item to any filing of a study. */
export function studySimilarity(item: Item, study: Study): number {
  let best = -1
  for (const f of study.filings) best = Math.max(best, dot(item.embedding, f.embedding))
  return best
}

/**
 * Assign one item. Studies the item predates are out. If any study's PI is an
 * author, only those studies compete (authorship is the strongest evidence of
 * provenance there is); otherwise every study competes at the stricter bar.
 * Studies active at the item's date are preferred over long-ended ones.
 */
export function assignItem(item: Item, studies: Study[], p: Params): Assignment[] {
  const scored: { study: Study; sim: number; viaPi: boolean }[] = []
  for (const study of studies) {
    if (item.year != null && item.year < study.startYear - p.startSlack) continue
    const viaPi = [...study.piKeys].some((k) => item.authorKeys.has(k))
    const sim = studySimilarity(item, study)
    if (sim >= (viaPi ? p.piThreshold : p.otherThreshold)) scored.push({ study, sim, viaPi })
  }
  let pool = scored.some((s) => s.viaPi) ? scored.filter((s) => s.viaPi) : scored
  if (item.year != null) {
    const active = pool.filter((s) => item.year! <= s.study.endYear + p.activeLag)
    if (active.length > 0) pool = active
  }
  if (pool.length === 0) return []
  const best = Math.max(...pool.map((s) => s.sim))
  return pool
    .filter((s) => s.sim >= best - p.margin)
    .map((s) => ({
      item,
      study: s.study,
      filing: filingFor(s.study, item.year, p.startSlack),
      similarity: s.sim,
      viaPi: s.viaPi,
    }))
}
