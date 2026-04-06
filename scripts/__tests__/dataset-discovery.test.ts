import { describe, it, expect } from 'vitest'
import { buildDedupIndex, isDuplicate, normalizeLicense, stripHtml } from '../lib/dataset-discovery.js'

describe('buildDedupIndex', () => {
  it('builds DOI set from existing datasets', () => {
    const existing = [
      { doi: '10.1234/foo', title: 'First dataset' },
      { doi: '10.5678/bar', title: 'Second dataset' },
      { doi: null, title: 'No DOI dataset' },
    ] as any[]

    const index = buildDedupIndex(existing)
    expect(index.doiSet.size).toBe(2)
    expect(index.doiSet.has('10.1234/foo')).toBe(true)
    expect(index.titles).toHaveLength(3)
  })

  it('lowercases DOIs', () => {
    const index = buildDedupIndex([{ doi: '10.1234/FOO', title: 'Test' }] as any[])
    expect(index.doiSet.has('10.1234/foo')).toBe(true)
  })

  it('handles empty array', () => {
    const index = buildDedupIndex([])
    expect(index.doiSet.size).toBe(0)
    expect(index.titles).toHaveLength(0)
  })
})

describe('isDuplicate', () => {
  const index = buildDedupIndex([
    { doi: '10.1234/foo', title: 'Streamflow measurements in East River' },
    { doi: '10.5678/bar', title: 'Alpine plant diversity' },
  ] as any[])

  it('detects DOI duplicate', () => {
    expect(isDuplicate({ doi: '10.1234/foo', title: 'Different title' }, index)).toBe(true)
  })

  it('detects DOI duplicate case-insensitively', () => {
    expect(isDuplicate({ doi: '10.1234/FOO', title: 'Different title' }, index)).toBe(true)
  })

  it('detects title duplicate', () => {
    expect(isDuplicate({ doi: null, title: 'Streamflow measurements in East River' }, index)).toBe(true)
  })

  it('detects similar title duplicate', () => {
    expect(isDuplicate({ doi: null, title: 'Streamflow measurements in the East River' }, index)).toBe(true)
  })

  it('returns false for new dataset', () => {
    expect(isDuplicate({ doi: '10.9999/new', title: 'Completely new dataset about quantum physics' }, index)).toBe(false)
  })

  it('returns false for null DOI and different title', () => {
    expect(isDuplicate({ doi: null, title: 'Quantum computing dataset' }, index)).toBe(false)
  })
})

describe('normalizeLicense', () => {
  it('normalizes CC0', () => {
    expect(normalizeLicense('CC0 1.0 Universal')).toBe('cc0')
  })

  it('normalizes CC 0 with space', () => {
    expect(normalizeLicense('CC 0')).toBe('cc0')
  })

  it('normalizes public domain', () => {
    expect(normalizeLicense('Public Domain')).toBe('cc0')
  })

  it('normalizes CC-BY', () => {
    expect(normalizeLicense('CC-BY 4.0')).toBe('cc_by_4')
  })

  it('normalizes CC BY (with space)', () => {
    expect(normalizeLicense('CC BY 4.0 International')).toBe('cc_by_4')
  })

  it('normalizes Attribution license', () => {
    expect(normalizeLicense('Attribution License')).toBe('cc_by_4')
  })

  it('normalizes CC-BY-SA', () => {
    expect(normalizeLicense('CC-BY-SA 4.0')).toBe('cc_by_sa_4')
  })

  it('normalizes CC-BY-NC', () => {
    expect(normalizeLicense('CC BY-NC 4.0')).toBe('cc_by_nc_4')
  })

  it('returns null for null input', () => {
    expect(normalizeLicense(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizeLicense(undefined)).toBeNull()
  })

  it('returns null for unrecognized license', () => {
    expect(normalizeLicense('Custom License 2024')).toBeNull()
  })
})

describe('stripHtml', () => {
  it('strips simple HTML tags', () => {
    expect(stripHtml('<p>Hello world</p>')).toBe('Hello world')
  })

  it('strips nested tags', () => {
    expect(stripHtml('<div><p><b>Bold</b> text</p></div>')).toBe('Bold text')
  })

  it('returns null for null input', () => {
    expect(stripHtml(null)).toBeNull()
  })

  it('returns null for empty result after stripping', () => {
    expect(stripHtml('<br/>')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(stripHtml('  Hello world  ')).toBe('Hello world')
  })

  it('leaves plain text unchanged', () => {
    expect(stripHtml('No HTML here')).toBe('No HTML here')
  })
})
