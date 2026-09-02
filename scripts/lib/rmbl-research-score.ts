/**
 * RMBL-Research scoring core — shared by score-rmbl-research.ts (CLI /
 * pipeline --apply) and any future ingest-time use.
 *
 * Signals (all computable from DB state at load time):
 *   1. author overlap — paper authors (family + first initial) appearing on
 *      OTHER rmbl_research='yes' publications (leave-self-out)
 *   2. text markers — strong ("Rocky Mountain Biological", "RMBL") and weak
 *      (Gothic / East River / Crested Butte / Gunnison) in title+abstract+
 *      fullText
 *   3. PI match — an author matches a project PI (projects.pi)
 *
 * score = 2·min(authorMatches,3)/3 + 2·strong + 0.5·weak + 1.5·pi   (max 6)
 *
 * Calibration vs the 2025–26 curated ground truth (2026-09-02): recall 92%
 * at score ≥ 0.5, 84% at ≥ 1.5. Misses are metadata-poor in-press papers.
 */

import type pg from 'pg'

const STRONG_RE = /rocky mountain biological|\brmbl\b/i
const WEAK_RE = /gothic,? colorado|east river|crested butte|gunnison/i

export interface ScoringContext {
  /** name key → set of rmbl_research='yes' publication ids the name appears on */
  knownAuthors: Map<string, Set<number>>
  piKeys: Set<string>
}

export function nameKey(family: string, given: string | null | undefined): string {
  return `${family.trim().toLowerCase()}|${(given ?? '').trim().slice(0, 1).toLowerCase()}`
}

export async function buildScoringContext(db: pg.Pool): Promise<ScoringContext> {
  const { rows: yesAuthors } = await db.query(`
    SELECT pa.family, pa.given, pa._parent_id AS pub_id
    FROM publications_authors pa
    JOIN publications p ON p.id = pa._parent_id
    WHERE p.rmbl_research = 'yes'
  `)
  const knownAuthors = new Map<string, Set<number>>()
  for (const a of yesAuthors) {
    const k = nameKey(a.family, a.given)
    if (!knownAuthors.has(k)) knownAuthors.set(k, new Set())
    knownAuthors.get(k)!.add(a.pub_id)
  }
  const { rows: pis } = await db.query(`SELECT pi FROM projects WHERE pi IS NOT NULL AND pi <> ''`)
  const piKeys = new Set<string>()
  for (const { pi } of pis) {
    for (const name of String(pi).split(/[,;&]| and /)) {
      const parts = name.trim().split(/\s+/)
      if (parts.length >= 2) piKeys.add(nameKey(parts[parts.length - 1], parts[0]))
    }
  }
  return { knownAuthors, piKeys }
}

export interface ScoreParts {
  authorMatches: number
  strong: 0 | 1
  weak: 0 | 1
  piMatch: 0 | 1
  score: number
}

export function scorePublication(
  pubId: number,
  text: string,
  authors: { family: string; given: string | null }[],
  ctx: ScoringContext,
): ScoreParts {
  let authorMatches = 0
  let piMatch: 0 | 1 = 0
  for (const a of authors) {
    const k = nameKey(a.family, a.given)
    const pubs = ctx.knownAuthors.get(k)
    if (pubs && (pubs.size > 1 || !pubs.has(pubId))) authorMatches++
    if (ctx.piKeys.has(k)) piMatch = 1
  }
  const strong = STRONG_RE.test(text) ? 1 : (0 as const)
  const weak = WEAK_RE.test(text) ? 1 : (0 as const)
  const score = (2 * Math.min(authorMatches, 3)) / 3 + 2 * strong + 0.5 * weak + 1.5 * piMatch
  return { authorMatches, strong: strong as 0 | 1, weak: weak as 0 | 1, piMatch, score }
}
