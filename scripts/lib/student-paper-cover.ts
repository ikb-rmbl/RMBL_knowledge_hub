/**
 * Cover-page extraction for RMBL student papers, shared by
 * extract-reu-cohort.ts and classify-student-papers.ts (one cache, one prompt).
 *
 * RMBL student papers usually open with a cover block: title, student
 * author(s), mentor(s), and a program line ("Full-Time Independent
 * Research/REU", "Independent Research and Course"). Claude reads the opening
 * plus acknowledgment windows and returns students (with an REU verdict and a
 * verbatim quote), the program line, and mentors.
 */

import { callClaude, parseJsonResponse } from './claude-api.js'

export const PROGRAM_REU = /\bREU\b|research experiences? for undergrad/i

/**
 * Students the REU coordinator's own notes say were NOT REUs despite an REU
 * program line ("Donovan Hughes was not an REU", REU pub list, June 2024).
 * Keyed by normName(full name).
 */
export const NOT_REU_NAMES = ['Donovan Hughes']
export const NOT_REU = new Set(NOT_REU_NAMES.map((n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')))

const OPENING = 2500
const WINDOW = 500
const CUE = /\bREU\b|research experiences? for undergrad|acknowledg|national science foundation|\bNSF\b/gi

export interface CoverExtraction {
  students: { name: string; reu: 'yes' | 'no' | 'unclear'; quote: string | null }[]
  program_line: string | null
  mentors: string[]
}

/** Cache row in scripts/output/reu-cohort-cache.json, keyed by publication id. */
export interface CoverCacheEntry {
  id: number
  year: number
  extraction: CoverExtraction | null
  /** Per student: an REU 'yes' whose quote was found in the excerpt. */
  verified: boolean[]
}

export const COVER_PROMPT = `This is the opening and acknowledgment excerpts of a student research paper written at the Rocky Mountain Biological Laboratory (RMBL). RMBL student papers usually open with a cover block: title, student author(s), mentor(s), and a program line such as "Program: REU, Independent Research and Course" or "Full Time Independent Research/REU Program 2018".

Extract:
- students: each STUDENT author (not mentors). For each, reu = "yes" only if the text states THIS student was in the NSF Research Experiences for Undergraduates (REU) program or was supported by an REU award/supplement; "no" if the text states a different program and no REU; "unclear" otherwise. A citation of someone else's REU proposal, or REU mentioned only in passing, is NOT evidence. When reu is "yes", quote the shortest span that proves it, copied EXACTLY from the text; otherwise quote is null.
- program_line: the program line exactly as written, or null.
- mentors: mentor / advisor names as written (people named as mentor, advisor, or supervisor of this project), [] if none.

Return only JSON: {"students": [{"name": "...", "reu": "yes"|"no"|"unclear", "quote": "..."|null}], "program_line": "..."|null, "mentors": ["..."]}`

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** Quote words in order, mostly contiguous (cover blocks wrap mid-line). */
export function quoteFound(quote: string, text: string): boolean {
  const q = words(quote)
  if (!q.length) return false
  const t = words(text)
  for (let s = 0; s < t.length; s++) {
    if (t[s] !== q[0]) continue
    let qi = 1
    for (let ci = s + 1; qi < q.length && ci < t.length && ci - s < q.length * 3; ci++) if (t[ci] === q[qi]) qi++
    if (qi === q.length) return true
  }
  return false
}

/** The opening plus windows around REU / acknowledgment / NSF cues. */
export function coverExcerpt(text: string): string {
  const flat = text.replace(/[ \t]+/g, ' ')
  const parts = [flat.slice(0, OPENING)]
  let last = OPENING
  for (const m of flat.matchAll(CUE)) {
    if (m.index! < last) continue
    parts.push(flat.slice(Math.max(last, m.index! - WINDOW), m.index! + WINDOW))
    last = m.index! + WINDOW
    if (parts.length > 6) break
  }
  return parts.join('\n…\n')
}

/** Run the extraction on one paper's full text. */
export async function extractCover(
  apiKey: string,
  model: string,
  fullText: string,
): Promise<{ extraction: CoverExtraction; verified: boolean[]; cost: number }> {
  const ex = coverExcerpt(fullText)
  const res = await callClaude({ apiKey, model, maxTokens: 2000, messages: [{ role: 'user', content: `${COVER_PROMPT}\n\n<paper>\n${ex}\n</paper>` }] })
  const parsed = parseJsonResponse<CoverExtraction>(res.text)
  if (!parsed) throw new Error('unparseable response')
  parsed.students = (parsed.students ?? []).filter((s) => s?.name)
  parsed.mentors = (parsed.mentors ?? []).filter(Boolean)
  const verified = parsed.students.map((s) => s.reu === 'yes' && !!s.quote && quoteFound(s.quote, ex))
  return { extraction: parsed, verified, cost: res.cost }
}

export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')

export function splitName(full: string): { first: string; last: string } {
  const w = full.replace(/\(.*?\)/g, '').replace(/[,.]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return { first: w[0] ?? '', last: w.length > 1 ? w[w.length - 1] : '' }
}

/** "Dr. Juliana Jiranek" / "J. Jiranek" → "jiranek|j" */
export function personKey(name: string): string {
  const { first, last } = splitName(name.replace(/\b(dr|prof|professor)\.?\s+/gi, ''))
  return `${normName(last)}|${normName(first).charAt(0)}`
}
