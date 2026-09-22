import { describe, it, expect } from 'vitest'
import {
  parsePublicationFilters,
  hasAdvancedFilters,
  buildPublicationWhere,
  publicationOrderBy,
  normalizeDoiQuery,
} from '../services/publication-query'

describe('parsePublicationFilters', () => {
  it('trims and drops empty fields', () => {
    const f = parsePublicationFilters({ title: '  pollination  ', author: '   ', keyword: '' })
    expect(f.title).toBe('pollination')
    expect(f.author).toBeUndefined()
    expect(f.keyword).toBeUndefined()
  })

  it('caps field length so a pasted blob cannot drive the query', () => {
    const f = parsePublicationFilters({ title: 'x'.repeat(500) })
    expect(f.title).toHaveLength(200)
  })

  it('rejects out-of-range and non-numeric years', () => {
    expect(parsePublicationFilters({ yearFrom: '1' }).yearFrom).toBeNull()
    expect(parsePublicationFilters({ yearTo: 'abcd' }).yearTo).toBeNull()
    expect(parsePublicationFilters({ yearFrom: '1975' }).yearFrom).toBe(1975)
  })

  it('treats rmbl only as the literal yes flag', () => {
    expect(parsePublicationFilters({ rmbl: 'yes' }).rmblOnly).toBe(true)
    expect(parsePublicationFilters({ rmbl: 'true' }).rmblOnly).toBe(false)
    expect(parsePublicationFilters({}).rmblOnly).toBe(false)
  })
})

describe('hasAdvancedFilters', () => {
  it('is false for a bare text query or sidebar-only filters', () => {
    expect(hasAdvancedFilters(parsePublicationFilters({ q: 'snowmelt' }))).toBe(false)
    expect(hasAdvancedFilters(parsePublicationFilters({ pubType: 'thesis', yearFrom: '2000' }))).toBe(false)
  })

  it('is true once a panel field is filled', () => {
    expect(hasAdvancedFilters(parsePublicationFilters({ author: 'Inouye' }))).toBe(true)
    expect(hasAdvancedFilters(parsePublicationFilters({ doi: '10.1002/ecy' }))).toBe(true)
  })
})

describe('normalizeDoiQuery', () => {
  it('reduces resolver URLs and doi: prefixes to the bare DOI', () => {
    expect(normalizeDoiQuery('https://doi.org/10.1002/ECY.1234')).toBe('10.1002/ecy.1234')
    expect(normalizeDoiQuery('http://dx.doi.org/10.1002/ecy.1234')).toBe('10.1002/ecy.1234')
    expect(normalizeDoiQuery('doi: 10.1002/ecy.1234')).toBe('10.1002/ecy.1234')
    expect(normalizeDoiQuery('  10.1002/ecy.1234 ')).toBe('10.1002/ecy.1234')
  })
})

describe('buildPublicationWhere', () => {
  it('returns TRUE with no filters so an unfiltered browse still works', () => {
    const w = buildPublicationWhere({})
    expect(w.sql).toBe('TRUE')
    expect(w.params).toEqual([])
  })

  it('ANDs every supplied field', () => {
    const w = buildPublicationWhere(parsePublicationFilters({
      title: 'phenology', author: 'Inouye', yearFrom: '2000', pubType: 'article',
    }))
    expect(w.sql).toContain('p.title ILIKE')
    expect(w.sql).toContain('publications_authors')
    expect(w.sql).toContain('p.year >=')
    expect(w.sql).toContain('p.publication_type =')
    expect(w.params).toEqual(['%phenology%', '%Inouye%', 2000, 'article'])
  })

  it('parameterizes all user input — no interpolated values', () => {
    const w = buildPublicationWhere(parsePublicationFilters({
      title: "'; DROP TABLE publications; --",
      author: 'Inouye',
      keyword: 'bumble',
      journal: 'Ecology',
      doi: '10.1002/x',
    }))
    expect(w.sql).not.toContain('DROP TABLE')
    expect(w.params).toContain("%'; DROP TABLE publications; --%")
    // Placeholders are numbered contiguously from the start index.
    const placeholders = [...w.sql.matchAll(/\$(\d+)/g)].map((m) => parseInt(m[1], 10))
    expect(Math.max(...placeholders)).toBe(w.params.length)
  })

  it('honors a non-default start index so callers can splice it in', () => {
    const w = buildPublicationWhere(parsePublicationFilters({ title: 'x' }), 5)
    expect(w.sql).toContain('$5')
  })

  it('wraps text fields in substring wildcards', () => {
    const w = buildPublicationWhere(parsePublicationFilters({ title: 'pollinat' }))
    expect(w.params).toEqual(['%pollinat%'])
    expect(w.sql).toContain('ILIKE')
  })

  it('matches authors across family, given, and both assembled orderings', () => {
    const w = buildPublicationWhere(parsePublicationFilters({ author: 'Inouye' }))
    expect(w.sql).toContain('a.family ILIKE')
    expect(w.sql).toContain('a.given ILIKE')
    expect(w.sql).toContain("a.given || ' ' || a.family")
    // One parameter reused across all four comparisons.
    expect(w.params).toEqual(['%Inouye%'])
  })

  it('matches an empty project assignment against nothing, not everything', () => {
    const w = buildPublicationWhere({ projectPubIds: [] })
    expect(w.params).toEqual([[-1]])
  })

  it('omits the rmbl clause unless the flag is set', () => {
    expect(buildPublicationWhere({ rmblOnly: false }).sql).toBe('TRUE')
    expect(buildPublicationWhere({ rmblOnly: true }).sql).toContain("rmbl_research = 'yes'")
  })

  it('ignores an empty topic list', () => {
    expect(buildPublicationWhere({ topicIds: [] }).sql).toBe('TRUE')
    expect(buildPublicationWhere({ topicIds: ['3', '9'] }).params).toEqual([[3, 9]])
  })
})

describe('publicationOrderBy', () => {
  it('orders the legacy composite by year, then type, then first author', () => {
    const sql = publicationOrderBy('year-type-author')
    expect(sql.indexOf('p.year')).toBeLessThan(sql.indexOf('p.publication_type'))
    expect(sql.indexOf('p.publication_type')).toBeLessThan(sql.indexOf('a.family'))
  })

  it('sorts by author on the first author by _order', () => {
    expect(publicationOrderBy('author')).toContain('ORDER BY a._order LIMIT 1')
  })

  it('falls back to a date ordering for relevance, which needs a rank the caller supplies', () => {
    expect(publicationOrderBy('relevance')).toContain('p.year DESC')
  })
})
