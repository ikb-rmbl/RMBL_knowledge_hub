import { describe, it, expect } from 'vitest'

// We need to test the matching and merge logic from sync-databases.ts
// Since the functions are defined inline, let's extract the core logic into testable units
// For now, we'll import titleSimilarity and test the matching patterns directly

import { titleSimilarity } from '../lib/doi-utils.js'

// ---------------------------------------------------------------------------
// Replicate matching logic for testing
// ---------------------------------------------------------------------------

function matchPublication(record: any, candidates: any[]): { match: any | null; confidence: string } {
  if (record.doi) {
    const doiMatch = candidates.find((c: any) => c.doi && c.doi.toLowerCase() === record.doi.toLowerCase())
    if (doiMatch) return { match: doiMatch, confidence: 'exact' }
  }
  if (record.title) {
    let bestMatch: any = null
    let bestScore = 0
    for (const c of candidates) {
      if (!c.title) continue
      const yearClose = !record.year || !c.year || Math.abs(record.year - c.year) <= 1
      if (!yearClose) continue
      const sim = titleSimilarity(record.title, c.title)
      if (sim > 0.9 && sim > bestScore) {
        bestMatch = c
        bestScore = sim
      }
    }
    if (bestMatch) return { match: bestMatch, confidence: bestScore > 0.95 ? 'high' : 'fuzzy' }
    for (const c of candidates) {
      if (!c.title) continue
      const sim = titleSimilarity(record.title, c.title)
      if (sim > 0.95) return { match: c, confidence: 'fuzzy' }
    }
  }
  return { match: null, confidence: 'none' }
}

function matchDocument(record: any, candidates: any[]): { match: any | null; confidence: string } {
  if (record.source_url) {
    const urlMatch = candidates.find((c: any) => c.source_url === record.source_url)
    if (urlMatch) return { match: urlMatch, confidence: 'exact' }
  }
  if (record.title) {
    for (const c of candidates) {
      if (c.title && titleSimilarity(record.title, c.title) > 0.9) {
        return { match: c, confidence: 'high' }
      }
    }
  }
  return { match: null, confidence: 'none' }
}

function matchAuthor(record: any, candidates: any[]): { match: any | null; confidence: string } {
  if (record.orcid) {
    const orcidMatch = candidates.find((c: any) => c.orcid === record.orcid)
    if (orcidMatch) return { match: orcidMatch, confidence: 'exact' }
  }
  if (record.family_name) {
    const nameMatch = candidates.find(
      (c: any) => c.family_name?.toLowerCase() === record.family_name?.toLowerCase()
        && (c.given_name || '').toLowerCase() === (record.given_name || '').toLowerCase(),
    )
    if (nameMatch) return { match: nameMatch, confidence: 'high' }
  }
  return { match: null, confidence: 'none' }
}

function mergeField(localVal: any, remoteVal: any, fieldType: 'pipeline' | 'curated', direction: 'pull' | 'push'): any {
  if (direction === 'pull') {
    if (fieldType === 'curated') return remoteVal ?? localVal
    if (fieldType === 'pipeline') return localVal ?? remoteVal
  } else {
    if (fieldType === 'curated') {
      // Push: only overwrite if remote is null and local has data
      return (remoteVal === null || remoteVal === undefined) && localVal != null ? localVal : remoteVal
    }
    if (fieldType === 'pipeline') return localVal ?? remoteVal
  }
  return localVal
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Publication matching', () => {
  const candidates = [
    { id: 1, doi: '10.1234/abc', title: 'Ecology of marmots in Gothic Colorado', year: 2020 },
    { id: 2, doi: '10.5678/def', title: 'Snowpack dynamics in the East River watershed', year: 2019 },
    { id: 3, doi: null, title: 'Pollination networks in subalpine meadows', year: 2021 },
    { id: 4, doi: null, title: 'Pollination networks in subalpine meadows', year: 2022 }, // same title, different year
  ]

  it('matches by DOI (exact)', () => {
    const result = matchPublication({ doi: '10.1234/abc', title: 'Wrong title' }, candidates)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by DOI case-insensitively', () => {
    const result = matchPublication({ doi: '10.1234/ABC', title: 'Wrong' }, candidates)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by title+year when no DOI', () => {
    const result = matchPublication({ doi: null, title: 'Ecology of marmots in Gothic Colorado', year: 2020 }, candidates)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('high')
  })

  it('matches similar title+year', () => {
    const result = matchPublication({ doi: null, title: 'Ecology of marmots in Gothic, Colorado', year: 2020 }, candidates)
    expect(result.match?.id).toBe(1)
  })

  it('falls back to title-only match when year is too far (Tier 3)', () => {
    const result = matchPublication({ doi: null, title: 'Ecology of marmots in Gothic Colorado', year: 2025 }, candidates)
    // Year 2025 vs 2020 = 5 years apart, exceeds ±1 tolerance for Tier 2
    // But identical title matches at Tier 3 (>0.95 threshold)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('fuzzy')
  })

  it('does NOT match when title is different AND year is far', () => {
    const result = matchPublication({ doi: null, title: 'Completely unrelated quantum paper', year: 2025 }, candidates)
    expect(result.match).toBeNull()
  })

  it('returns none for completely unrelated record', () => {
    const result = matchPublication({ doi: '10.9999/xyz', title: 'Quantum computing algorithms', year: 2023 }, candidates)
    expect(result.match).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('prefers DOI over title match', () => {
    // DOI points to record 1, but title is closer to record 3
    const result = matchPublication({ doi: '10.1234/abc', title: 'Pollination networks in subalpine meadows' }, candidates)
    expect(result.match?.id).toBe(1) // DOI wins
  })

  it('handles record with no DOI and no title', () => {
    const result = matchPublication({ doi: null, title: null }, candidates)
    expect(result.match).toBeNull()
  })
})

describe('Document matching', () => {
  const candidates = [
    { id: 1, source_url: 'https://example.com/doc1', title: 'Gunnison Water Plan' },
    { id: 2, source_url: 'https://example.com/doc2', title: 'Mt Emmons Mining Impact Assessment' },
  ]

  it('matches by sourceUrl (exact)', () => {
    const result = matchDocument({ source_url: 'https://example.com/doc1', title: 'Different title' }, candidates)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by title when sourceUrl missing', () => {
    const result = matchDocument({ source_url: null, title: 'Gunnison Water Plan' }, candidates)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('high')
  })

  it('returns none when nothing matches', () => {
    const result = matchDocument({ source_url: 'https://other.com', title: 'Unrelated' }, candidates)
    expect(result.match).toBeNull()
  })
})

describe('Author matching', () => {
  const candidates = [
    { id: 1, orcid: '0000-0001-2345-6789', family_name: 'Blumstein', given_name: 'Daniel' },
    { id: 2, orcid: null, family_name: 'Armitage', given_name: 'Kenneth' },
    { id: 3, orcid: null, family_name: 'Smith', given_name: 'John' },
  ]

  it('matches by ORCID', () => {
    const result = matchAuthor({ orcid: '0000-0001-2345-6789', family_name: 'Wrong' }, candidates)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by family+given name', () => {
    const result = matchAuthor({ orcid: null, family_name: 'Armitage', given_name: 'Kenneth' }, candidates)
    expect(result.match?.id).toBe(2)
    expect(result.confidence).toBe('high')
  })

  it('matches name case-insensitively', () => {
    const result = matchAuthor({ orcid: null, family_name: 'armitage', given_name: 'kenneth' }, candidates)
    expect(result.match?.id).toBe(2)
  })

  it('does NOT match different given name with same family', () => {
    const result = matchAuthor({ orcid: null, family_name: 'Smith', given_name: 'Jane' }, candidates)
    expect(result.match).toBeNull()
  })

  it('handles missing given name', () => {
    const result = matchAuthor({ orcid: null, family_name: 'Smith', given_name: '' }, candidates)
    // Won't match id:3 because given_name 'John' != ''
    expect(result.match).toBeNull()
  })
})

describe('Field merge logic', () => {
  describe('pull direction (remote wins for curated)', () => {
    it('remote curated value wins over local', () => {
      expect(mergeField('local title', 'remote title', 'curated', 'pull')).toBe('remote title')
    })

    it('falls back to local when remote curated is null', () => {
      expect(mergeField('local title', null, 'curated', 'pull')).toBe('local title')
    })

    it('keeps local pipeline value over remote', () => {
      expect(mergeField(42, 30, 'pipeline', 'pull')).toBe(42)
    })

    it('uses remote pipeline value when local is null', () => {
      expect(mergeField(null, 30, 'pipeline', 'pull')).toBe(30)
    })
  })

  describe('push direction (only fill empty remote curated fields)', () => {
    it('does NOT overwrite remote curated value', () => {
      expect(mergeField('local title', 'remote title', 'curated', 'push')).toBe('remote title')
    })

    it('fills empty remote curated field with local value', () => {
      expect(mergeField('local abstract', null, 'curated', 'push')).toBe('local abstract')
    })

    it('pushes local pipeline value', () => {
      expect(mergeField(42, null, 'pipeline', 'push')).toBe(42)
    })

    it('keeps local pipeline value over remote', () => {
      expect(mergeField(42, 30, 'pipeline', 'push')).toBe(42)
    })
  })
})

describe('Edge cases', () => {
  it('handles empty candidate list', () => {
    const result = matchPublication({ doi: '10.1234/abc', title: 'Test' }, [])
    expect(result.match).toBeNull()
  })

  it('handles candidates with null fields', () => {
    const candidates = [
      { id: 1, doi: null, title: null, year: null },
    ]
    const result = matchPublication({ doi: null, title: 'Test paper', year: 2020 }, candidates)
    expect(result.match).toBeNull()
  })

  it('merge handles undefined values', () => {
    expect(mergeField(undefined, 'remote', 'curated', 'pull')).toBe('remote')
    expect(mergeField(undefined, undefined, 'curated', 'pull')).toBeUndefined()
  })
})
