import { describe, it, expect } from 'vitest'
import { deduplicateAuthors, type AuthorRecord } from '../lib/author-dedup.js'

function makeAuthor(overrides: Partial<AuthorRecord>): AuthorRecord {
  return {
    id: overrides.id || `${overrides.familyName || 'unknown'}|${(overrides.givenName || '').charAt(0).toLowerCase()}`,
    displayName: `${overrides.givenName || ''} ${overrides.familyName || ''}`.trim(),
    familyName: overrides.familyName || 'Unknown',
    givenName: overrides.givenName || '',
    orcid: overrides.orcid || null,
    affiliation: overrides.affiliation || null,
    publicationIds: overrides.publicationIds || [],
    datasetIds: overrides.datasetIds || [],
    documentIds: overrides.documentIds || [],
  }
}

describe('deduplicateAuthors', () => {
  it('merges authors with same ORCID', () => {
    const authors = [
      makeAuthor({ familyName: 'Williams', givenName: 'K.', orcid: '0000-0001-2345-6789', publicationIds: ['1'] }),
      makeAuthor({ familyName: 'Williams', givenName: 'Kenneth', orcid: '0000-0001-2345-6789', datasetIds: ['d1'] }),
    ]
    const { result, orcidMerges } = deduplicateAuthors(authors)
    expect(result).toHaveLength(1)
    expect(orcidMerges).toBe(1)
    expect(result[0].givenName).toBe('Kenneth') // prefers longer name
    expect(result[0].publicationIds).toContain('1')
    expect(result[0].datasetIds).toContain('d1')
  })

  it('merges authors with same family name and matching initials', () => {
    const authors = [
      makeAuthor({ id: 'smith-pub1', familyName: 'Smith', givenName: 'J. A.', publicationIds: ['1'] }),
      makeAuthor({ id: 'smith-pub2', familyName: 'Smith', givenName: 'JA', publicationIds: ['2'] }),
    ]
    const { result, nameMerges } = deduplicateAuthors(authors)
    expect(result).toHaveLength(1)
    expect(nameMerges).toBe(1)
    expect(result[0].publicationIds).toEqual(expect.arrayContaining(['1', '2']))
  })

  it('merges initials with full name ("K." + "Kenneth")', () => {
    const authors = [
      makeAuthor({ id: 'williams-init', familyName: 'Williams', givenName: 'K.', publicationIds: ['1'] }),
      makeAuthor({ id: 'williams-full', familyName: 'Williams', givenName: 'Kenneth', publicationIds: ['2'] }),
    ]
    const { result, nameMerges } = deduplicateAuthors(authors)
    expect(result).toHaveLength(1)
    expect(nameMerges).toBe(1)
    expect(result[0].givenName).toBe('Kenneth')
  })

  it('does NOT merge different family names', () => {
    const authors = [
      makeAuthor({ familyName: 'Smith', givenName: 'John', publicationIds: ['1'] }),
      makeAuthor({ familyName: 'Jones', givenName: 'John', publicationIds: ['2'] }),
    ]
    const { result } = deduplicateAuthors(authors)
    expect(result).toHaveLength(2)
  })

  it('does NOT merge different initials with same family', () => {
    const authors = [
      makeAuthor({ familyName: 'Smith', givenName: 'J.', publicationIds: ['1'] }),
      makeAuthor({ familyName: 'Smith', givenName: 'R.', publicationIds: ['2'] }),
    ]
    const { result } = deduplicateAuthors(authors)
    expect(result).toHaveLength(2)
  })

  it('merges "Kenneth" and "Kenneth Hurst" (startsWith match)', () => {
    const authors = [
      makeAuthor({ id: 'williams-ken', familyName: 'Williams', givenName: 'Kenneth', publicationIds: ['1'] }),
      makeAuthor({ id: 'williams-kh', familyName: 'Williams', givenName: 'Kenneth Hurst', datasetIds: ['d1'] }),
    ]
    const { result, nameMerges } = deduplicateAuthors(authors)
    expect(result).toHaveLength(1)
    expect(nameMerges).toBe(1)
    expect(result[0].givenName).toBe('Kenneth Hurst')
  })

  it('preserves affiliation during merge', () => {
    const authors = [
      makeAuthor({ id: 'smith-init', familyName: 'Smith', givenName: 'J.', affiliation: 'RMBL' }),
      makeAuthor({ id: 'smith-full', familyName: 'Smith', givenName: 'John', affiliation: null }),
    ]
    const { result } = deduplicateAuthors(authors)
    expect(result).toHaveLength(1)
    expect(result[0].affiliation).toBe('RMBL')
  })

  it('handles empty input', () => {
    const { result, orcidMerges, nameMerges } = deduplicateAuthors([])
    expect(result).toHaveLength(0)
    expect(orcidMerges).toBe(0)
    expect(nameMerges).toBe(0)
  })

  it('handles single author', () => {
    const authors = [makeAuthor({ familyName: 'Solo', givenName: 'A.' })]
    const { result } = deduplicateAuthors(authors)
    expect(result).toHaveLength(1)
  })

  it('deduplicates publication IDs during merge', () => {
    const authors = [
      makeAuthor({ familyName: 'Smith', givenName: 'J.', orcid: '0000-0001', publicationIds: ['1', '2'] }),
      makeAuthor({ familyName: 'Smith', givenName: 'John', orcid: '0000-0001', publicationIds: ['2', '3'] }),
    ]
    const { result } = deduplicateAuthors(authors)
    expect(result[0].publicationIds).toEqual(expect.arrayContaining(['1', '2', '3']))
    expect(result[0].publicationIds).toHaveLength(3)
  })
})
