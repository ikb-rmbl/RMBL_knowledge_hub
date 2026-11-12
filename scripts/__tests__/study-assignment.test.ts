import { describe, expect, it } from 'vitest'
import {
  assignItem, buildStudies, filingFor, normalize,
  type Filing, type Item, type Params,
} from '../lib/study-assignment.js'

const P: Params = { piThreshold: 0.5, otherThreshold: 0.8, margin: 0.03, startSlack: 1, activeLag: 5 }

/** Unit vectors in 3-D are enough to control similarities exactly. */
const v = (...xs: number[]) => normalize(xs)

function filing(id: number, rootId: number, start: number, end: number, emb: Float32Array, pi = 'Dan Blumstein'): Filing {
  return { id, planId: `P-${id}`, pi, startYear: start, endYear: end, rootId, embedding: emb }
}

function item(id: number, year: number | null, emb: Float32Array, authors: string[] = []): Item {
  return { collection: 'publications', id, year, embedding: emb, authorKeys: new Set(authors) }
}

describe('filingFor', () => {
  const studies = buildStudies([
    filing(1, 1, 2002, 2006, v(1, 0, 0)),
    filing(2, 1, 2007, 2011, v(1, 0, 0)),
    filing(3, 1, 2022, 2027, v(1, 0, 0)),
  ])

  it('picks the filing in effect at the item date', () => {
    expect(filingFor(studies[0], 2009, 1).id).toBe(2)
    expect(filingFor(studies[0], 2006, 1).id).toBe(2) // in effect by year + slack
    expect(filingFor(studies[0], 2015, 1).id).toBe(2) // gap years stay with the last filing
  })

  it('keeps late papers with the last filing, however late', () => {
    expect(filingFor(studies[0], 2040, 1).id).toBe(3)
  })

  it('sends undated items to the current filing', () => {
    expect(filingFor(studies[0], null, 1).id).toBe(3)
  })
})

describe('assignItem', () => {
  const marmots = filing(1, 1, 2001, 2005, v(1, 0, 0))
  const birds = filing(2, 2, 2001, 2005, v(0, 1, 0))
  const other = filing(3, 3, 1990, 2030, v(0, 0, 1), 'Someone Else')
  const studies = buildStudies([marmots, birds, other])
  const pi = ['blumstein d']

  it('gives a PI paper to the study it best matches, not every PI study', () => {
    const got = assignItem(item(10, 2010, v(1, 0.2, 0), pi), studies, P)
    expect(got.map((a) => a.study.rootId)).toEqual([1])
  })

  it('does not attach on authorship alone', () => {
    expect(assignItem(item(11, 2010, v(0.3, 0.3, -1), pi), studies, P)).toEqual([]) // 0.28 to its PI studies
  })

  it('shares a paper between studies within the margin', () => {
    const got = assignItem(item(12, 2010, v(1, 1, 0), pi), studies, P)
    expect(got.map((a) => a.study.rootId).sort()).toEqual([1, 2])
  })

  it('rejects studies the item predates, beyond the slack', () => {
    expect(assignItem(item(13, 1999, v(1, 0, 0), pi), studies, P)).toEqual([])
    expect(assignItem(item(14, 2000, v(1, 0, 0), pi), studies, P)).toHaveLength(1)
  })

  it('holds non-PI items to the stricter bar', () => {
    expect(assignItem(item(15, 2010, v(0.6, 0, 1)), studies, P)).toHaveLength(1) // 0.86 to `other`
    expect(assignItem(item(16, 2010, v(1, 0, 1.1)), studies, P)).toEqual([]) // 0.74 to `other`
  })

  it('lets PI studies win over a closer non-PI study', () => {
    const got = assignItem(item(17, 2010, v(0.7, 0, 1), pi), studies, P)
    expect(got.map((a) => a.study.rootId)).toEqual([1])
  })

  it('prefers a study active at the item date over a stale, closer match', () => {
    const old = filing(20, 20, 2001, 2005, v(1, 0.1, 0))
    const current = filing(21, 21, 2022, 2027, v(1, 0.5, 0))
    const both = buildStudies([old, current])
    const paper = item(30, 2024, v(1, 0, 0), pi) // 0.995 to old, 0.894 to current
    expect(assignItem(paper, both, P).map((a) => a.study.rootId)).toEqual([21])
    expect(assignItem(paper, both, { ...P, activeLag: Infinity }).map((a) => a.study.rootId)).toEqual([20])
  })

  it('still places a late paper on an ended study when nothing active matches', () => {
    const ended = buildStudies([filing(22, 22, 2001, 2005, v(1, 0, 0))])
    const got = assignItem(item(31, 2030, v(1, 0, 0), pi), ended, P)
    expect(got.map((a) => a.filing.id)).toEqual([22])
  })
})
