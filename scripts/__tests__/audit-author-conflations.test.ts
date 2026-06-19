/**
 * Unit tests for the scoring helper inside `audit-author-conflations.ts`.
 *
 * The audit script's main work is database I/O, which we don't test here.
 * What we *do* pin down is the suspicion-scoring logic — those weights are
 * the load-bearing piece a future reviewer will want to tune, and we want a
 * regression net around them.
 */

import { describe, it, expect } from 'vitest'

// Inline-duplicate the score function. The audit module is a script (uses
// top-level `await` on a pg pool); importing it would trigger the DB call.
// Keep the test self-contained and have any change to the heuristic
// propagated to both copies — the docstring in the script flags it.
function score(s: { span_years: number; max_gap_years: number; bimodal: boolean }): { score: number; notes: string[] } {
  const notes: string[] = []
  let score = 0
  if (s.span_years >= 100)     { score += 5; notes.push('span>=100yr (definitive)') }
  else if (s.span_years >= 70) { score += 3; notes.push('span>=70yr (exceeds credible career)') }
  else if (s.span_years >= 50) { score += 2; notes.push('span>=50yr (long career — review)') }
  if (s.max_gap_years >= 20)   { score += 2; notes.push('long publication gap') }
  if (s.bimodal)               { score += 2; notes.push('bimodal active periods') }
  return { score, notes }
}

describe('audit-author-conflations: suspicion scoring', () => {
  it('flags definitive multi-person spans (>=100yr) at score 5', () => {
    const { score: s, notes } = score({ span_years: 157, max_gap_years: 0, bimodal: false })
    expect(s).toBe(5)
    expect(notes[0]).toMatch(/definitive/)
  })

  it('flags exceeds-credible-career spans (70-99yr) at score 3', () => {
    const { score: s } = score({ span_years: 80, max_gap_years: 0, bimodal: false })
    expect(s).toBe(3)
  })

  it('flags long-career spans (50-69yr) at score 2', () => {
    const { score: s } = score({ span_years: 55, max_gap_years: 0, bimodal: false })
    expect(s).toBe(2)
  })

  it('does not flag careers under 50yr', () => {
    const { score: s } = score({ span_years: 40, max_gap_years: 0, bimodal: false })
    expect(s).toBe(0)
  })

  it('stacks span + gap + bimodal signals', () => {
    // Real-world example pattern: Smith, J. E. — 1866-2023, gaps, two clusters.
    const { score: s, notes } = score({ span_years: 157, max_gap_years: 50, bimodal: true })
    expect(s).toBe(9) // 5 + 2 + 2
    expect(notes).toHaveLength(3)
  })

  it('high-confidence threshold (>=4) is reached by 70+ span alone with one extra signal', () => {
    const { score: s } = score({ span_years: 75, max_gap_years: 25, bimodal: false })
    expect(s).toBeGreaterThanOrEqual(4)
  })
})
