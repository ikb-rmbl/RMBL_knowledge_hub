import { describe, expect, it } from 'vitest'
import { specificTerms } from '../lib/species-terms'

const sp = (id: number, canonical_name: string, common_names: string[] = [], synonyms: string[] = []) => ({ id, canonical_name, common_names, synonyms })

describe('specificTerms', () => {
  const terms = specificTerms([
    sp(1, 'Bombus terrestris', ['buff-tailed bumblebee', 'bumble bee'], ['Bombus', 'B. terrestris']),
    sp(2, 'Bombus balteatus', ['bumble bee'], ['Bombus', 'Bombus sp.']),
    sp(3, 'Bombus'),
    sp(4, 'Marmota flaviventris', ['yellow-bellied marmot', 'marmot']),
    sp(5, 'Fisher', ['fisher']),
  ])
  it('keeps the binomial and species-specific common names', () => {
    expect(terms.get(1)).toEqual(expect.arrayContaining(['Bombus terrestris', 'buff-tailed bumblebee']))
    expect(terms.get(4)).toEqual(expect.arrayContaining(['Marmota flaviventris', 'yellow-bellied marmot']))
  })
  it('does not give a species its genus as a term', () => {
    expect(terms.get(1)).not.toContain('Bombus')
    expect(terms.get(2)).not.toContain('Bombus')
  })
  it('drops common names shared by several species', () => {
    expect(terms.get(1)).not.toContain('bumble bee')
    expect(terms.get(2)).not.toContain('bumble bee')
  })
  it('gives cross-listed names to the right row (genus row carrying the species binomial)', () => {
    const t = specificTerms([
      { id: 10, canonical_name: 'Marmota flaviventris', common_names: ['yellow-bellied marmot'], synonyms: [], mention_count: 599 },
      { id: 11, canonical_name: 'Marmota', common_names: ['yellow-bellied marmot'], synonyms: ['Marmota flaviventris', 'Marmota flaviventer'], mention_count: 597 },
      { id: 12, canonical_name: 'Bombus', common_names: [], synonyms: [], mention_count: 487 },
      { id: 13, canonical_name: 'Bombus', common_names: [], synonyms: [], mention_count: 303 },
    ])
    expect(t.get(10)).toEqual(expect.arrayContaining(['Marmota flaviventris', 'yellow-bellied marmot']))
    expect(t.get(11)).toEqual(expect.arrayContaining(['Marmota', 'Marmota flaviventer']))
    expect(t.get(11)).not.toContain('Marmota flaviventris')
    expect(t.get(12)).toEqual(['Bombus'])
    expect(t.get(13)).toEqual([])
  })
  it('drops generic adjective + group-noun common names, but not a group entity’s own name', () => {
    const t = specificTerms([
      { id: 20, canonical_name: 'Halictus virgatellus', common_names: ['solitary bee'], synonyms: ['H. virgatellus'] },
      { id: 21, canonical_name: 'small mammals', common_names: [], synonyms: [] },
      { id: 22, canonical_name: 'Bombus occidentalis', common_names: ['western bumble bee'], synonyms: [] },
    ])
    expect(t.get(20)).not.toContain('solitary bee')
    expect(t.get(21)).toEqual(['small mammals'])
    expect(t.get(22)).toContain('western bumble bee')
  })
  it('keeps a genus-level entity’s own name, drops single lowercase common names and stoplisted words', () => {
    expect(terms.get(3)).toEqual(['Bombus'])
    expect(terms.get(4)).not.toContain('marmot')
    expect(terms.get(5)).toEqual([])
  })
})
