/**
 * Research-plan PI → Authors registry matching (scripts/link-plan-pis.ts).
 *
 * A name only proposes candidates (surname + first initial). A link needs
 * independent evidence that the candidate is the person who filed the plan,
 * because the registry holds only people who published: a student PI who never
 * did shares a surname and initial with someone who has often enough to make
 * name-only links wrong. Unlinked PIs stay plain text.
 */

import { middleInitialsConflict } from './participant-tags.js'

/** RMBL-research papers this many years either side of a filing count as "active then". */
export const YEAR_WINDOW = 10
/** Mean of the candidate's three most similar papers vs. the plan text (voyage-4 cosine). */
export const TOPIC_SIMILARITY = 0.6

const NICKNAMES: string[][] = [
  ['william', 'bill', 'will', 'billy'], ['robert', 'bob', 'rob', 'bobby'], ['richard', 'rick', 'dick', 'rich'],
  ['james', 'jim', 'jimmy', 'jamie'], ['michael', 'mike', 'mick'], ['thomas', 'tom', 'tommy'],
  ['david', 'dave'], ['daniel', 'dan', 'danny'], ['kenneth', 'ken', 'kenny'], ['christopher', 'chris'],
  ['katherine', 'kate', 'kathy', 'katie', 'kat'], ['catherine', 'cathy', 'cat', 'kate'], ['elizabeth', 'liz', 'beth', 'betsy', 'lisa', 'eliza'],
  ['rebecca', 'becky', 'becca'], ['jennifer', 'jen', 'jenny', 'jennie'], ['margaret', 'maggie', 'meg', 'peggy'],
  ['joseph', 'joe'], ['charles', 'chuck', 'charlie'], ['edward', 'ed', 'ted', 'eddie'], ['theodore', 'ted', 'theo'],
  ['anthony', 'tony'], ['nicholas', 'nick', 'nic'], ['alexander', 'alex'], ['alexandra', 'alex', 'sandra'],
  ['benjamin', 'ben'], ['samuel', 'sam'], ['samantha', 'sam'], ['matthew', 'matt'], ['andrew', 'andy', 'drew'],
  ['jonathan', 'jon'], ['john', 'jack'], ['patricia', 'pat', 'trish'], ['patrick', 'pat'], ['susan', 'sue', 'susie'],
  ['gregory', 'greg'], ['stephen', 'steve'], ['steven', 'steve'], ['timothy', 'tim'], ['peter', 'pete'],
  ['douglas', 'doug'], ['ronald', 'ron'], ['donald', 'don'], ['gerald', 'jerry'], ['lawrence', 'larry'],
  ['frederick', 'fred'], ['william', 'liam'], ['victoria', 'vicky', 'tori'], ['deborah', 'deb', 'debbie'],
  ['judith', 'judy'], ['barbara', 'barb'], ['carolyn', 'carol'], ['cynthia', 'cindy'], ['kimberly', 'kim'],
  ['zachary', 'zach'], ['joshua', 'josh'], ['nathaniel', 'nate', 'nathan'], ['jacob', 'jake'],
]
const NICK = new Map<string, Set<string>>()
for (const group of NICKNAMES) for (const n of group) {
  if (!NICK.has(n)) NICK.set(n, new Set())
  for (const m of group) NICK.get(n)!.add(m)
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')

/** Spelled-out first names a person goes by: "Mary (Cassie) Stoddard" → [mary, cassie]; "D. W. Inouye" → []. */
export function firstNames(name: string): string[] {
  const out: string[] = []
  for (const m of name.matchAll(/\(([^)]*)\)|"([^"]*)"|“([^”]*)”/g)) {
    const n = norm((m[1] ?? m[2] ?? m[3] ?? '').split(/\s+/)[0] ?? '')
    if (n.length >= 2) out.push(n)
  }
  const first = name.replace(/\([^)]*\)|"[^"]*"|“[^”]*”/g, ' ').replace(/\b(dr|prof)\.?\s+/gi, '').trim().split(/\s+/)[0] ?? ''
  if (!/\./.test(first) && norm(first).length >= 2) out.unshift(norm(first))
  return out
}

function sameFirst(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true
  return NICK.get(a)?.has(b) ?? false
}

/**
 * 'agree' — both spell out a first name and some pair matches (exact, prefix
 * of ≥3 letters, or a common nickname); 'initial' — one side gives only an
 * initial; 'conflict' — spelled-out names disagree, or middle initials differ.
 * Callers have already matched surname + first initial.
 */
export function nameCompat(pi: string, author: string): 'agree' | 'initial' | 'conflict' {
  const strip = (s: string) => s.replace(/\([^)]*\)|"[^"]*"|“[^”]*”/g, ' ').replace(/\s+/g, ' ').trim()
  if (middleInitialsConflict(strip(pi), strip(author))) return 'conflict'
  const a = firstNames(pi)
  const b = firstNames(author)
  if (a.length === 0 || b.length === 0) return 'initial'
  return a.some((x) => b.some((y) => sameFirst(x, y))) ? 'agree' : 'conflict'
}

/** Collaborator names from a legacy plan's description trailer ("Collaborators: A, B"). */
export function collaboratorsOf(description: string | null | undefined): string[] {
  const m = /^Collaborators?:\s*(.+)$/im.exec(description ?? '')
  if (!m) return []
  return m[1].split(/[,;]| and |&/).map((s) => s.trim()).filter((s) => /[A-Za-z]{2}/.test(s))
}

export interface CandidateEvidence {
  authorId: number
  name: string
  name_match: 'agree' | 'initial'
  /** RMBL-research papers within YEAR_WINDOW of the filing years. */
  active_papers: number
  /** Mean similarity of the candidate's three closest papers to the plan text (null: no embedded papers). */
  topic: number | null
  /** Plan collaborators the candidate has co-authored with. */
  coauthored_collaborators: string[]
  /** Another filing of the same study is linked to this author. */
  chain: boolean
  /** Every registry author with this surname is a candidate (no other initials share it). */
  rare_surname: boolean
}

export interface Decision {
  band: 'auto' | 'review' | 'none'
  authorId: number | null
  basis: string
  /** The evidence for every candidate considered (for the review list). */
  candidates: CandidateEvidence[]
}

/** Why one candidate would be linked on its own evidence, or null. */
export function autoBasis(c: CandidateEvidence, competing: boolean): string | null {
  const topic = c.topic != null && c.topic >= TOPIC_SIMILARITY
  const collab = c.coauthored_collaborators.length > 0
  const active = c.active_papers > 0
  if (c.chain && (active || topic || collab)) return 'another filing of this study'
  // With a namesake in the registry, the name and dates alone can't choose.
  if (competing) {
    if (active && collab) return 'co-authored with a plan collaborator'
    if (active && topic && c.name_match === 'agree') return 'first name, active at RMBL then, same topic'
    return null
  }
  if (c.name_match === 'agree' && active) return 'first name + RMBL papers in the plan years'
  if (active && collab) return 'initials + co-authored with a plan collaborator'
  if (active && topic) return 'initials + RMBL papers in the plan years + same topic'
  if (active && c.rare_surname) return 'initials + RMBL papers in the plan years + rare surname'
  return null
}

/** Any evidence beyond the name. */
const hasEvidence = (c: CandidateEvidence) =>
  c.active_papers > 0 || (c.topic != null && c.topic >= TOPIC_SIMILARITY) || c.coauthored_collaborators.length > 0 || c.chain

/**
 * Link only when exactly one candidate stands on its own evidence. Anything
 * with a plausible candidate but no unique winner goes to review.
 */
export function decide(candidates: CandidateEvidence[]): Decision {
  if (candidates.length === 0) return { band: 'none', authorId: null, basis: 'no author with this surname and initial', candidates }
  // A namesake with no evidence at all — typically a duplicate registry entry
  // ("J. D. Thomson" / "James D. Thomson") — does not compete.
  const competing = candidates.filter(hasEvidence).length > 1
  const passing = candidates.map((c) => ({ c, basis: autoBasis(c, competing) })).filter((x) => x.basis)
  if (passing.length === 1) return { band: 'auto', authorId: passing[0].c.authorId, basis: passing[0].basis!, candidates }
  if (passing.length > 1) return { band: 'review', authorId: null, basis: `${passing.length} candidates pass — namesakes`, candidates }
  const plausible = candidates.some(hasEvidence)
  return plausible
    ? { band: 'review', authorId: null, basis: competing ? 'namesakes — evidence does not single one out' : 'some evidence, not enough to link', candidates }
    : { band: 'none', authorId: null, basis: 'name only — no papers, topic or collaborators in common', candidates }
}
