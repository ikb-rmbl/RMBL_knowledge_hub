import { describe, it, expect } from 'vitest'
import { parseAuthors, parseOneAuthor, parseEditors } from '../lib/author-parsing.js'

describe('parseOneAuthor', () => {
  it('parses standard "LastName Initials" format', () => {
    expect(parseOneAuthor('Smith JA')).toEqual({ given: 'J. A.', family: 'Smith' })
  })

  it('parses single initial', () => {
    expect(parseOneAuthor('Baker C')).toEqual({ given: 'C.', family: 'Baker' })
  })

  it('parses three initials', () => {
    expect(parseOneAuthor('Carroll RWH')).toEqual({ given: 'R. W. H.', family: 'Carroll' })
  })

  it('handles multi-word surnames', () => {
    expect(parseOneAuthor('de Boer G')).toEqual({ given: 'G.', family: 'de Boer' })
  })

  it('handles Van prefix', () => {
    expect(parseOneAuthor('Van Vuren D')).toEqual({ given: 'D.', family: 'Van Vuren' })
  })

  it('strips student marker asterisks', () => {
    expect(parseOneAuthor('Smith J*')).toEqual({ given: 'J.', family: 'Smith' })
  })

  it('handles single-name author', () => {
    expect(parseOneAuthor('Anonymous')).toEqual({ given: '', family: 'Anonymous' })
  })

  it('handles first-name last-name format', () => {
    const result = parseOneAuthor('Haruko Wainwright')
    expect(result.family).toBe('Wainwright')
  })
})

describe('parseAuthors', () => {
  it('parses comma-separated author list', () => {
    const result = parseAuthors('Adler B, Caicedo V, Butterworth B')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ given: 'B.', family: 'Adler' })
    expect(result[1]).toEqual({ given: 'V.', family: 'Caicedo' })
  })

  it('removes "et al" suffix', () => {
    const result = parseAuthors('Dunn PO, Ahmed I, et al')
    expect(result).toHaveLength(2)
    expect(result[0].family).toBe('Dunn')
  })

  it('strips asterisks from student authors', () => {
    const result = parseAuthors('Duggal K*, Jiranek J, Machado M*')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ given: 'K.', family: 'Duggal' })
    expect(result[2]).toEqual({ given: 'M.', family: 'Machado' })
  })

  it('returns empty array for empty input', () => {
    expect(parseAuthors('')).toEqual([])
  })

  it('returns empty array for null-like input', () => {
    expect(parseAuthors(null as any)).toEqual([])
  })

  it('handles single author', () => {
    const result = parseAuthors('Blumstein DT')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ given: 'D. T.', family: 'Blumstein' })
  })
})

describe('parseEditors', () => {
  it('parses "J. E. Moran" format', () => {
    const result = parseEditors('J. E. Moran')
    expect(result).toHaveLength(1)
    expect(result[0].family).toBe('Moran')
  })

  it('returns empty array for null', () => {
    expect(parseEditors(null)).toEqual([])
  })

  it('handles "and" separator', () => {
    const result = parseEditors('Smith J and Doe A')
    expect(result).toHaveLength(2)
  })
})
