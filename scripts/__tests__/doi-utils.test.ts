import { describe, it, expect } from 'vitest'
import { extractDoi, titleSimilarity } from '../lib/doi-utils.js'

describe('extractDoi', () => {
  it('extracts DOI from doi.org URL', () => {
    expect(extractDoi('https://doi.org/10.1234/foo.bar')).toBe('10.1234/foo.bar')
  })

  it('extracts DOI from doi: prefix', () => {
    expect(extractDoi('doi:10.1234/foo')).toBe('10.1234/foo')
  })

  it('extracts bare DOI', () => {
    expect(extractDoi('10.1234/foo.bar')).toBe('10.1234/foo.bar')
  })

  it('strips trailing punctuation', () => {
    expect(extractDoi('https://doi.org/10.1234/foo.bar.')).toBe('10.1234/foo.bar')
  })

  it('strips trailing comma', () => {
    expect(extractDoi('https://doi.org/10.1234/foo,')).toBe('10.1234/foo')
  })

  it('returns null for no DOI', () => {
    expect(extractDoi('no doi here')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(extractDoi(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractDoi('')).toBeNull()
  })

  it('handles DOI with special characters', () => {
    expect(extractDoi('https://doi.org/10.1002/j.1537-2197.1964.tb06707.x')).toBe(
      '10.1002/j.1537-2197.1964.tb06707.x',
    )
  })
})

describe('titleSimilarity', () => {
  it('returns 1 for identical titles', () => {
    expect(titleSimilarity('Ecology of marmots', 'Ecology of marmots')).toBe(1)
  })

  it('returns 1 for case-insensitive match', () => {
    expect(titleSimilarity('Ecology of Marmots', 'ecology of marmots')).toBe(1)
  })

  it('returns high similarity for near-identical titles', () => {
    const sim = titleSimilarity(
      'Ecology of yellow-bellied marmots in Gothic Colorado',
      'Ecology of yellow-bellied marmots in Gothic, Colorado',
    )
    expect(sim).toBeGreaterThan(0.9)
  })

  it('returns low similarity for unrelated titles', () => {
    const sim = titleSimilarity(
      'Ecology of marmots',
      'Quantum computing algorithms',
    )
    expect(sim).toBeLessThan(0.2)
  })

  it('strips HTML tags before comparison', () => {
    const sim = titleSimilarity(
      'Nectar yeasts in <i>Delphinium</i>',
      'Nectar yeasts in Delphinium',
    )
    expect(sim).toBe(1)
  })

  it('handles empty strings', () => {
    expect(titleSimilarity('', '')).toBe(1)
  })
})
