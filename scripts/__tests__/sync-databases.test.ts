import { describe, it, expect } from 'vitest'
import {
  buildMatchIndex,
  matchPublication,
  matchDataset,
  matchDocument,
  matchAuthor,
  matchTopic,
  matchProject,
  mergeField,
} from '../lib/record-matching.js'

// ---------------------------------------------------------------------------
// Tests — now verifying the real exported functions
// ---------------------------------------------------------------------------

describe('Publication matching', () => {
  const candidates = [
    { id: 1, doi: '10.1234/abc', title: 'Ecology of marmots in Gothic Colorado', year: 2020 },
    { id: 2, doi: '10.5678/def', title: 'Snowpack dynamics in the East River watershed', year: 2019 },
    { id: 3, doi: null, title: 'Pollination networks in subalpine meadows', year: 2021 },
    { id: 4, doi: null, title: 'Pollination networks in subalpine meadows', year: 2022 },
  ]
  const index = buildMatchIndex(candidates)

  it('matches by DOI (exact)', () => {
    const result = matchPublication({ doi: '10.1234/abc', title: 'Wrong title' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by DOI case-insensitively', () => {
    const result = matchPublication({ doi: '10.1234/ABC', title: 'Wrong' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by title+year when no DOI', () => {
    const result = matchPublication({ doi: null, title: 'Ecology of marmots in Gothic Colorado', year: 2020 }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('high')
  })

  it('matches similar title+year', () => {
    const result = matchPublication({ doi: null, title: 'Ecology of marmots in Gothic, Colorado', year: 2020 }, candidates, index)
    expect(result.match?.id).toBe(1)
  })

  it('falls back to title-only match when year is too far (Tier 3)', () => {
    const result = matchPublication({ doi: null, title: 'Ecology of marmots in Gothic Colorado', year: 2025 }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('fuzzy')
  })

  it('does NOT match when title is different AND year is far', () => {
    const result = matchPublication({ doi: null, title: 'Completely unrelated quantum paper', year: 2025 }, candidates, index)
    expect(result.match).toBeNull()
  })

  it('returns none for completely unrelated record', () => {
    const result = matchPublication({ doi: '10.9999/xyz', title: 'Quantum computing algorithms', year: 2023 }, candidates, index)
    expect(result.match).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('prefers DOI over title match', () => {
    const result = matchPublication({ doi: '10.1234/abc', title: 'Pollination networks in subalpine meadows' }, candidates, index)
    expect(result.match?.id).toBe(1)
  })

  it('handles record with no DOI and no title', () => {
    const result = matchPublication({ doi: null, title: null }, candidates, index)
    expect(result.match).toBeNull()
  })
})

describe('Dataset matching', () => {
  const candidates = [
    { id: 1, doi: '10.5065/data1', title: 'East River soil moisture 2020-2023' },
    { id: 2, doi: null, title: 'RMBL weather station data' },
  ]
  const index = buildMatchIndex(candidates)

  it('matches by DOI', () => {
    const result = matchDataset({ doi: '10.5065/data1', title: 'Wrong' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by title similarity', () => {
    const result = matchDataset({ doi: null, title: 'RMBL weather station data' }, candidates, index)
    expect(result.match?.id).toBe(2)
    expect(result.confidence).toBe('high')
  })

  it('returns none for no match', () => {
    const result = matchDataset({ doi: '10.9999/xyz', title: 'Unrelated' }, candidates, index)
    expect(result.match).toBeNull()
  })
})

describe('Document matching', () => {
  const candidates = [
    { id: 1, source_url: 'https://example.com/doc1', title: 'Gunnison Water Plan' },
    { id: 2, source_url: 'https://example.com/doc2', title: 'Mt Emmons Mining Impact Assessment' },
  ]
  const index = buildMatchIndex(candidates)

  it('matches by sourceUrl (exact)', () => {
    const result = matchDocument({ source_url: 'https://example.com/doc1', title: 'Different title' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by title when sourceUrl missing', () => {
    const result = matchDocument({ source_url: null, title: 'Gunnison Water Plan' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('high')
  })

  it('returns none when nothing matches', () => {
    const result = matchDocument({ source_url: 'https://other.com', title: 'Unrelated' }, candidates, index)
    expect(result.match).toBeNull()
  })
})

describe('Author matching', () => {
  const candidates = [
    { id: 1, orcid: '0000-0001-2345-6789', family_name: 'Blumstein', given_name: 'Daniel' },
    { id: 2, orcid: null, family_name: 'Armitage', given_name: 'Kenneth' },
    { id: 3, orcid: null, family_name: 'Smith', given_name: 'John' },
  ]
  const index = buildMatchIndex(candidates)

  it('matches by ORCID', () => {
    const result = matchAuthor({ orcid: '0000-0001-2345-6789', family_name: 'Wrong' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('matches by family+given name', () => {
    const result = matchAuthor({ orcid: null, family_name: 'Armitage', given_name: 'Kenneth' }, candidates, index)
    expect(result.match?.id).toBe(2)
    expect(result.confidence).toBe('high')
  })

  it('matches name case-insensitively', () => {
    const result = matchAuthor({ orcid: null, family_name: 'armitage', given_name: 'kenneth' }, candidates, index)
    expect(result.match?.id).toBe(2)
  })

  it('does NOT match different given name with same family', () => {
    const result = matchAuthor({ orcid: null, family_name: 'Smith', given_name: 'Jane' }, candidates, index)
    expect(result.match).toBeNull()
  })

  it('handles missing given name', () => {
    const result = matchAuthor({ orcid: null, family_name: 'Smith', given_name: '' }, candidates, index)
    expect(result.match).toBeNull()
  })
})

describe('Topic matching', () => {
  const candidates = [
    { id: 1, name: 'Alpine Ecology' },
    { id: 2, name: 'Climate Change' },
  ]
  const index = buildMatchIndex(candidates)

  it('matches by name case-insensitively', () => {
    const result = matchTopic({ name: 'alpine ecology' }, candidates, index)
    expect(result.match?.id).toBe(1)
    expect(result.confidence).toBe('exact')
  })

  it('returns none for unknown topic', () => {
    const result = matchTopic({ name: 'Quantum Physics' }, candidates, index)
    expect(result.match).toBeNull()
  })
})

describe('Project matching', () => {
  const candidates = [
    { id: 1, name: 'East River SFA' },
    { id: 2, name: 'SPLASH Campaign' },
  ]
  const index = buildMatchIndex(candidates)

  it('matches by name', () => {
    const result = matchProject({ name: 'east river sfa' }, candidates, index)
    expect(result.match?.id).toBe(1)
  })

  it('returns none for unknown project', () => {
    const result = matchProject({ name: 'Mars Rover' }, candidates, index)
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

describe('buildMatchIndex', () => {
  it('indexes DOI in lowercase', () => {
    const index = buildMatchIndex([{ doi: '10.1234/ABC', title: 'Test' }])
    expect(index.byDoi.get('10.1234/abc')).toBeTruthy()
    expect(index.byDoi.has('10.1234/ABC')).toBe(false)
  })

  it('indexes family+given as compound key', () => {
    const index = buildMatchIndex([{ family_name: 'Smith', given_name: 'John' }])
    expect(index.byFamilyGiven.get('smith|john')).toBeTruthy()
  })

  it('handles empty candidates', () => {
    const index = buildMatchIndex([])
    expect(index.all).toHaveLength(0)
    expect(index.byDoi.size).toBe(0)
  })
})

describe('Edge cases', () => {
  it('handles empty candidate list', () => {
    const index = buildMatchIndex([])
    const result = matchPublication({ doi: '10.1234/abc', title: 'Test' }, [], index)
    expect(result.match).toBeNull()
  })

  it('handles candidates with null fields', () => {
    const candidates = [{ id: 1, doi: null, title: null, year: null }]
    const index = buildMatchIndex(candidates)
    const result = matchPublication({ doi: null, title: 'Test paper', year: 2020 }, candidates, index)
    expect(result.match).toBeNull()
  })

  it('merge handles undefined values', () => {
    expect(mergeField(undefined, 'remote', 'curated', 'pull')).toBe('remote')
    expect(mergeField(undefined, undefined, 'curated', 'pull')).toBeUndefined()
  })
})
