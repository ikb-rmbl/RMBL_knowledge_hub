import { describe, it, expect } from 'vitest'
import {
  buildPubDedupIndex,
  isPubDuplicate,
  normalizeOpenAlexWork,
  reconstructAbstract,
} from '../lib/publication-discovery.js'

describe('reconstructAbstract', () => {
  it('rebuilds text from inverted index', () => {
    const index = {
      'We': [0],
      'studied': [1],
      'plant': [2, 5],
      'communities': [3],
      'in': [4],
      'habitats': [6],
    }
    expect(reconstructAbstract(index)).toBe('We studied plant communities in plant habitats')
  })

  it('returns null for null input', () => {
    expect(reconstructAbstract(null)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(reconstructAbstract({})).toBeNull()
  })

  it('handles single word', () => {
    expect(reconstructAbstract({ 'Hello': [0] })).toBe('Hello')
  })
})

describe('normalizeOpenAlexWork', () => {
  const sampleWork = {
    id: 'https://openalex.org/W1234567890',
    title: 'Alpine plant diversity in the Gunnison Basin',
    publication_year: 2021,
    type: 'journal-article',
    doi: 'https://doi.org/10.1234/test',
    authorships: [
      {
        author: {
          display_name: 'Kenneth Williams',
          orcid: 'https://orcid.org/0000-0001-2345-6789',
        },
      },
      {
        author: {
          display_name: 'Jane Smith',
          orcid: null,
        },
      },
    ],
    primary_location: {
      source: {
        display_name: 'Journal of Ecology',
        host_organization_name: 'Wiley',
      },
    },
    biblio: {
      volume: '109',
      issue: '3',
      first_page: '1234',
      last_page: '1245',
    },
    abstract_inverted_index: {
      'Alpine': [0],
      'plants': [1],
      'are': [2],
      'diverse': [3],
    },
    concepts: [
      { display_name: 'Ecology', score: 0.9 },
      { display_name: 'Botany', score: 0.8 },
      { display_name: 'Low relevance', score: 0.1 },
    ],
    open_access: {
      oa_status: 'gold',
      oa_url: 'https://example.com/paper.pdf',
    },
  }

  it('normalizes title', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.title).toBe('Alpine plant diversity in the Gunnison Basin')
  })

  it('normalizes DOI (strips prefix)', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.doi).toBe('10.1234/test')
  })

  it('normalizes authors', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.authors).toHaveLength(2)
    expect(result.authors[0].family).toBe('Williams')
    expect(result.authors[0].given).toBe('Kenneth')
  })

  it('extracts ORCID (strips URL prefix)', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect((result.authors[0] as any).orcid).toBe('0000-0001-2345-6789')
  })

  it('maps publication type', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.publicationType).toBe('article')
  })

  it('maps dissertation to thesis', () => {
    const result = normalizeOpenAlexWork({ ...sampleWork, type: 'dissertation' })
    expect(result.publicationType).toBe('thesis')
  })

  it('extracts journal, volume, issue, pages', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.journal).toBe('Journal of Ecology')
    expect(result.volume).toBe('109')
    expect(result.issue).toBe('3')
    expect(result.pages).toBe('1234-1245')
  })

  it('reconstructs abstract from inverted index', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.abstract).toBe('Alpine plants are diverse')
  })

  it('filters low-score concepts as keywords', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result.keywords).toHaveLength(2)
    expect(result.keywords[0].keyword).toBe('Ecology')
    expect(result.keywords[1].keyword).toBe('Botany')
  })

  it('sets provenance fields', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result._source).toBe('discovered')
    expect(result._discoveryMethod).toBe('openalex_geo')
  })

  it('sets sourceId with openalex prefix', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result._sourceId).toBe('openalex:W1234567890')
  })

  it('extracts OA status and PDF link', () => {
    const result = normalizeOpenAlexWork(sampleWork)
    expect(result._oaStatus).toBe('gold')
    expect(result.pdfLink).toBe('https://example.com/paper.pdf')
  })

  it('handles missing fields gracefully', () => {
    const minimal = { id: 'W999', title: 'Minimal work', publication_year: 2020 }
    const result = normalizeOpenAlexWork(minimal)
    expect(result.title).toBe('Minimal work')
    expect(result.year).toBe(2020)
    expect(result.authors).toEqual([])
    expect(result.doi).toBeNull()
    expect(result.abstract).toBeNull()
  })
})

describe('buildPubDedupIndex', () => {
  it('builds DOI set and title list', () => {
    const pubs = [
      { doi: '10.1234/foo', title: 'First paper', year: 2020 },
      { doi: null, title: 'No DOI paper', year: 2019 },
    ] as any[]
    const index = buildPubDedupIndex(pubs)
    expect(index.doiSet.size).toBe(1)
    expect(index.titles).toHaveLength(2)
  })

  it('lowercases DOIs', () => {
    const index = buildPubDedupIndex([{ doi: '10.1234/FOO', title: 'Test', year: 2020 }] as any[])
    expect(index.doiSet.has('10.1234/foo')).toBe(true)
  })
})

describe('isPubDuplicate', () => {
  const index = buildPubDedupIndex([
    { doi: '10.1234/existing', title: 'Ecology of marmots in Gothic Colorado', year: 2020 },
  ] as any[])

  it('detects DOI duplicate', () => {
    expect(isPubDuplicate({ doi: '10.1234/existing', title: 'Different title', year: 2020 }, index)).toBe(true)
  })

  it('detects DOI duplicate case-insensitively', () => {
    expect(isPubDuplicate({ doi: '10.1234/EXISTING', title: 'Different', year: 2020 }, index)).toBe(true)
  })

  it('detects title duplicate', () => {
    expect(isPubDuplicate({ doi: null, title: 'Ecology of marmots in Gothic Colorado', year: 2020 }, index)).toBe(true)
  })

  it('returns false for new paper', () => {
    expect(isPubDuplicate({ doi: '10.9999/new', title: 'Quantum computing paper', year: 2022 }, index)).toBe(false)
  })

  it('skips title comparison for year-distant papers', () => {
    // Same title but 5 years apart — should still match (within ±2 tolerance? No, 5 > 2)
    expect(isPubDuplicate({ doi: null, title: 'Ecology of marmots in Gothic Colorado', year: 2025 }, index)).toBe(false)
  })
})
