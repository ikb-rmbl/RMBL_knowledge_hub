import { describe, it, expect } from 'vitest'
import { parseCreatorName, expandInitials, buildDisplayName } from '../lib/author-parsing.js'

describe('parseCreatorName', () => {
  it('parses "LastName, FirstName" format', () => {
    expect(parseCreatorName('Williams, Kenneth')).toEqual({ given: 'Kenneth', family: 'Williams' })
  })

  it('parses "LastName, I.N." format', () => {
    expect(parseCreatorName('Carroll, R.W.H.')).toEqual({ given: 'R.W.H.', family: 'Carroll' })
  })

  it('parses "FirstName LastName" format', () => {
    expect(parseCreatorName('Kenneth Williams')).toEqual({ given: 'Kenneth', family: 'Williams' })
  })

  it('parses "FirstName MiddleName LastName" format', () => {
    expect(parseCreatorName('Kenneth Hurst Williams')).toEqual({ given: 'Kenneth Hurst', family: 'Williams' })
  })

  it('parses "F. LastName" format', () => {
    expect(parseCreatorName('K. Williams')).toEqual({ given: 'K.', family: 'Williams' })
  })

  it('handles single name', () => {
    expect(parseCreatorName('RMBL')).toEqual({ given: '', family: 'RMBL' })
  })

  it('handles empty input', () => {
    expect(parseCreatorName('')).toEqual({ given: '', family: '' })
  })

  it('handles whitespace-only input', () => {
    expect(parseCreatorName('   ')).toEqual({ given: '', family: '' })
  })
})

describe('expandInitials', () => {
  it('expands compact initials "JA" to "J. A."', () => {
    expect(expandInitials('JA')).toBe('J. A.')
  })

  it('expands single initial "J" to "J."', () => {
    expect(expandInitials('J')).toBe('J.')
  })

  it('expands three initials "RWH" to "R. W. H."', () => {
    expect(expandInitials('RWH')).toBe('R. W. H.')
  })

  it('leaves already-dotted initials unchanged', () => {
    expect(expandInitials('J. A.')).toBe('J. A.')
  })

  it('leaves full name unchanged', () => {
    expect(expandInitials('Kenneth')).toBe('Kenneth')
  })

  it('returns empty string for empty input', () => {
    expect(expandInitials('')).toBe('')
  })
})

describe('buildDisplayName', () => {
  it('builds name with full given name', () => {
    expect(buildDisplayName('Kenneth', 'Williams')).toBe('Kenneth Williams')
  })

  it('builds name with expanded initials', () => {
    expect(buildDisplayName('JA', 'Smith')).toBe('J. A. Smith')
  })

  it('returns just family name when given is empty', () => {
    expect(buildDisplayName('', 'Williams')).toBe('Williams')
  })

  it('handles dotted initials', () => {
    expect(buildDisplayName('R. W. H.', 'Carroll')).toBe('R. W. H. Carroll')
  })
})
