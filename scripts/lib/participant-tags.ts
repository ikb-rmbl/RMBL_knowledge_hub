/**
 * Undergraduate-program participant tags — see the header of
 * tag-student-authors.ts for the rule. Shared with evaluation scripts.
 */

import type pg from 'pg'
import { normName, NOT_REU_NAMES, personKey } from './student-paper-cover.js'

/** Years after the student paper a participant's publications still count — Ian 2026-11-11: 6 (REU lag is mostly 1–6 years). */
export const PARTICIPANT_LAG = 6
/**
 * Initial-only matches ("J. Doe") need corroboration: the student paper's
 * mentor co-authors the pub, or — when the student paper names exactly one
 * student — the pub is on the same topic (embedding similarity ≥ this). In
 * Ian's 2026-11-11 review, 0.6 kept all 4 correct initial-only tags
 * (0.62–0.93) and rejected the mismatched people (0.17–0.42); the one wrong
 * tag above it was a mentor on a two-person paper, which the single-student
 * condition excludes. (The earlier "≤4 pubs in the window" rule was right in
 * only 3 of 10.)
 */
export const TOPIC_SIMILARITY = 0.6
/** RMBL peer-reviewed pubs by the student-paper year that mark someone as already established. */
export const SENIOR_PRIOR_PUBS = 3
export const PARTICIPANT_PROGRAMS = ['reu', 'urp', 'independent_research', 'course', 'rmbl_undergraduate']

export interface ParticipantTag {
  publicationId: number
  authorId: number
  authorName: string
  program: 'reu' | 'student_paper'
  year: number
  /** Evidence (not stored): the student paper and how the name was matched. */
  studentPaperId: number
  studentPaperYear: number
  studentName: string
  basis: 'first name agrees' | 'mentor co-author' | 'same topic'
}

const firstName = (n: string) => {
  const tok = n.replace(/\b(dr|prof)\.?\s+/gi, '').trim().split(/\s+/)[0] ?? ''
  return /\./.test(tok) ? '' : normName(tok)
}

/** Given-name initials, hyphenated parts included: "Jane-Rae Doe" → [j, r]; "J. Q. Doe" → [j, q]. */
function initials(name: string): string[] {
  const toks = name.replace(/\b(dr|prof)\.?\s+/gi, '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/)
  toks.pop() // surname
  return toks.flatMap((t) => t.split(/[-.]/)).filter((t) => /[A-Za-z]/.test(t)).map((t) => normName(t).charAt(0)).filter(Boolean)
}

/** Two names whose second initials are both given and differ are different people (J. Q. Doe ≠ Jane-Rae Doe). */
export function middleInitialsConflict(a: string, b: string): boolean {
  const ia = initials(a)
  const ib = initials(b)
  return ia.length >= 2 && ib.length >= 2 && ia[1] !== ib[1]
}

/**
 * 'agree' / 'differ' when both records spell out a first name ("Ben" and
 * "Benjamin" agree); 'unknown' when either gives only an initial.
 */
export function firstNameMatch(a: string, b: string): 'agree' | 'differ' | 'unknown' {
  const fa = firstName(a)
  const fb = firstName(b)
  if (fa.length < 2 || fb.length < 2) return 'unknown'
  return fa.startsWith(fb) || fb.startsWith(fa) ? 'agree' : 'differ'
}

/** Undergraduate-program participants → tags on RMBL peer-reviewed pubs (see header). */
export async function deriveParticipantTags(db: pg.Pool): Promise<ParticipantTag[]> {
  const { rows: papers } = await db.query<{ id: number; year: number; program: string; info: any }>(
    `SELECT id, year::int AS year, student_paper_program AS program, student_paper_info AS info FROM publications
      WHERE publication_type = 'student_paper' AND student_paper_level = 'undergraduate'
        AND student_paper_program = ANY($1) AND year IS NOT NULL`,
    [PARTICIPANT_PROGRAMS],
  )
  const { rows: pubAuthors } = await db.query<{ pub: number; year: number; author_id: number; name: string }>(
    `SELECT p.id AS pub, p.year::int AS year, a.id AS author_id, a.display_name AS name
       FROM publications p
       JOIN authors_rels ar ON ar.publications_id = p.id
       JOIN authors a ON a.id = ar.parent_id
      WHERE p.rmbl_research = 'yes' AND p.publication_type IN ('article', 'chapter', 'book') AND p.year IS NOT NULL`,
  )
  // Career stage of each registry person: an author already publishing RMBL
  // papers before the student-paper year was not a student then — this is what
  // stops a student "J. Doe" from matching a PI with the same initials.
  const pubYears = new Map<number, number[]>()
  for (const r of pubAuthors) {
    if (!pubYears.has(r.author_id)) pubYears.set(r.author_id, [])
    pubYears.get(r.author_id)!.push(r.year)
  }
  const establishedBy = (authorId: number, year: number) =>
    (pubYears.get(authorId) ?? []).filter((y) => y <= year).length >= SENIOR_PRIOR_PUBS

  const keysByPub = new Map<number, Set<string>>()
  for (const r of pubAuthors) {
    if (!keysByPub.has(r.pub)) keysByPub.set(r.pub, new Set())
    keysByPub.get(r.pub)!.add(personKey(r.name))
  }

  const byKey = new Map<string, typeof pubAuthors>()
  for (const r of pubAuthors) {
    const k = personKey(r.name)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(r)
  }
  // Student papers often give only initials ("D. Hughes"), so match the coordinator's exclusions on surname + initial.
  const notReuKeys = new Set(NOT_REU_NAMES.map(personKey))
  const simCache = new Map<string, number>()
  const topicSimilarity = async (a: number, b: number): Promise<number> => {
    const k = `${a}|${b}`
    if (!simCache.has(k)) {
      const { rows } = await db.query<{ s: number | null }>(
        `SELECT 1 - (x.embedding <=> y.embedding) AS s FROM publications x, publications y
          WHERE x.id = $1 AND y.id = $2 AND x.embedding IS NOT NULL AND y.embedding IS NOT NULL`, [a, b])
      simCache.set(k, rows[0]?.s == null ? 0 : Number(rows[0].s))
    }
    return simCache.get(k)!
  }
  const tags = new Map<string, ParticipantTag>()
  for (const p of papers) {
    for (const s of (p.info?.students ?? []) as { name: string; reu: boolean | null }[]) {
      const reu = (s.reu === true || p.program === 'reu' || p.program === 'urp') && !notReuKeys.has(personKey(s.name))
      const mentorKeys = ((p.info?.mentors ?? []) as string[]).map(personKey)
      const inWindow = (byKey.get(personKey(s.name)) ?? []).filter((r) => r.year >= p.year - 1 && r.year <= p.year + PARTICIPANT_LAG)
      for (const r of inWindow) {
        const names = firstNameMatch(s.name, r.name)
        if (names === 'differ' || middleInitialsConflict(s.name, r.name)) continue
        if (establishedBy(r.author_id, p.year)) continue
        let basis: ParticipantTag['basis'] = 'first name agrees'
        if (names === 'unknown') {
          if (mentorKeys.some((k) => keysByPub.get(r.pub)?.has(k))) {
            basis = 'mentor co-author'
          } else if ((p.info?.students ?? []).length === 1 && (await topicSimilarity(p.id, r.pub)) >= TOPIC_SIMILARITY) {
            basis = 'same topic'
          } else {
            continue
          }
        }
        const key = `${r.pub}|${r.name}`
        const prev = tags.get(key)
        // A participant on several student papers: REU from any of them wins.
        if (!prev || (reu && prev.program !== 'reu')) {
          tags.set(key, {
            publicationId: r.pub, authorId: r.author_id, authorName: r.name, program: reu ? 'reu' : 'student_paper', year: r.year,
            studentPaperId: p.id, studentPaperYear: p.year, studentName: s.name, basis,
          })
        }
      }
    }
  }
  return [...tags.values()]
}
