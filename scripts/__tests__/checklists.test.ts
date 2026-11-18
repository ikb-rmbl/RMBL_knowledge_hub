import { describe, expect, it } from 'vitest'
import { type RescueRow, binomialOf, decodeStatus, groupEditions } from '../lib/checklists.js'
import { redact } from '../redact-reu-students.js'

describe('binomialOf', () => {
  it('reduces to genus + epithet', () => {
    expect(binomialOf('Equisetum hyemale var. affine')).toBe('Equisetum hyemale')
    expect(binomialOf('Bombus (Pyrobombus) bifarius')).toBe('Bombus bifarius')
    expect(binomialOf('Sorex cinereus (Kerr)')).toBe('Sorex cinereus')
    expect(binomialOf('Mentha × piperita')).toBe('Mentha piperita')
  })
  it('rejects non-binomials', () => {
    expect(binomialOf('Carex sp.')).toBeNull()
    expect(binomialOf('American Robin')).toBeNull()
    expect(binomialOf(null)).toBeNull()
  })
})

describe('decodeStatus', () => {
  it('spells out bird codes, including breeding marks', () => {
    expect(decodeStatus('birds-lohr', 'U,M,B*')).toEqual([
      'uncommon (fewer than 10 a day in the right habitat)', 'regular migrant', 'summer breeding resident',
      'breeding confirmed (nest, young, territorial defense, …)',
    ])
  })
  it("uses each list's own legend", () => {
    expect(decodeStatus('plants-buck-frase', '+*')).toEqual(['added since the 1993 edition', 'non-native taxon from outside North America'])
    expect(decodeStatus('plants-taylor-ngb', '+!')).toEqual(['noxious', 'introduced'])
    expect(decodeStatus('birds-lohr', null)).toEqual([])
  })
})

describe('groupEditions', () => {
  const row = (o: Partial<RescueRow>): RescueRow => ({
    list_id: 'birds-lohr', list_key: 'k', urlkey: 'a', capture_ts: '2001', edition: 'June 1996', line_no: 1,
    scientific_name: null, authority: null, common_name: 'Mallard', ...o,
  })
  it('makes one edition of several copies, taking entries from the latest capture', () => {
    const eds = groupEditions('birds-lohr', [
      row({ urlkey: 'a', capture_ts: '20010101' }),
      row({ urlkey: 'b', capture_ts: '20040101', common_name: 'Gadwall' }),
      row({ urlkey: 'c', capture_ts: '20100101', edition: 'March 2006', common_name: 'Mallard' }),
    ])
    expect(eds.map((e) => e.spec.label)).toEqual(['June 1996', 'March 2006'])
    expect(eds[0].sourceIds).toEqual(['rmbl-wayback:a', 'rmbl-wayback:b'])
    expect(eds[0].entriesSourceId).toBe('rmbl-wayback:b')
    expect(eds[0].rows.map((r) => r.common_name)).toEqual(['Gadwall'])
  })
})

describe('redact (REU student names)', () => {
  it('replaces the forms names take on the old site', () => {
    const names = ['Jane Q Doe', 'Roe, Rick', 'Poe,R', 'Moe, J.']
    const text = 'REU Project Metadata by Jane Doe. Roe, Rick  Mentor X. Poe,R 1998 REU paper. Moe, J. reu. Rickard Roe stays.'
    const out = redact(text, names)
    expect(out.text).toBe('REU Project Metadata by [REU student]. [REU student]  Mentor X. [REU student] 1998 REU paper. [REU student] reu. Rickard Roe stays.')
    expect(out.n).toBe(4)
  })
})

describe('spellingVariants', () => {
  it('retries OCR q→g and the -i/-ii genitive', async () => {
    const { spellingVariants } = await import('../lib/checklists.js')
    expect(spellingVariants('Pseudotsuqa taxifolia')).toEqual(['Pseudotsuga taxifolia'])
    expect(spellingVariants('Picea engelmanni')).toEqual(['Picea engelmannii'])
    expect(spellingVariants('Quercus gambelii')).toEqual([])
  })
})
