import { describe, it, expect } from 'vitest'
import { getBadgeLabel, getBadgeClass } from '../app/(frontend)/lib/badges'

describe('getBadgeLabel', () => {
  it('returns specific type for publications', () => {
    expect(getBadgeLabel('publication', 'article')).toBe('Article')
    expect(getBadgeLabel('publication', 'thesis')).toBe('Thesis')
    expect(getBadgeLabel('publication', 'book')).toBe('Book')
    expect(getBadgeLabel('publication', 'chapter')).toBe('Chapter')
    expect(getBadgeLabel('publication', 'student_paper')).toBe('Student Paper')
  })

  it('returns "Publication" for unknown subtype', () => {
    expect(getBadgeLabel('publication', 'unknown')).toBe('Publication')
    expect(getBadgeLabel('publication', null)).toBe('Publication')
  })

  it('returns "Document" for documents', () => {
    expect(getBadgeLabel('document', null)).toBe('Document')
    expect(getBadgeLabel('document', 'anything')).toBe('Document')
  })

  it('returns specific type for datasets', () => {
    expect(getBadgeLabel('dataset', 'dataset')).toBe('Dataset')
    expect(getBadgeLabel('dataset', 'software')).toBe('Software')
    expect(getBadgeLabel('dataset', 'collection')).toBe('Collection')
  })

  it('returns "Dataset" for unknown dataset subtype', () => {
    expect(getBadgeLabel('dataset', null)).toBe('Dataset')
  })
})

describe('getBadgeClass', () => {
  it('returns correct CSS class per collection', () => {
    expect(getBadgeClass('document')).toBe('badge badge-document')
    expect(getBadgeClass('publication')).toBe('badge badge-publication')
    expect(getBadgeClass('dataset')).toBe('badge badge-dataset')
  })
})
