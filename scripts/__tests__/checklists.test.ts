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

describe('keyTaxon', () => {
  it('reads the taxon and qualifier from a stonefly key page title', async () => {
    const { keyTaxon } = await import('../lib/checklists.js')
    expect(keyTaxon('Alloperla females: Draft Key to the Plecoptera of Gunnison County')).toEqual({ taxon: 'Alloperla', qualifier: 'females' })
    expect(keyTaxon('Capnia_coloradensis: Draft Key to the Plecoptera of Gunnison County')).toEqual({ taxon: 'Capnia coloradensis', qualifier: null })
    expect(keyTaxon('Draft Key to the Plecoptera: Chloroperlidae males of Gunnison County')).toEqual({ taxon: 'Chloroperlidae', qualifier: 'males' })
    expect(keyTaxon('Chloroperlidae Introduction')).toEqual({ taxon: 'Chloroperlidae', qualifier: 'introduction' })
    expect(keyTaxon('Annotated References for the Draft Key to the Plecoptera of Gunnison County')).toBeNull()
    expect(keyTaxon('Plecoptera Species List: Draft Key to the Plecoptera of Gunnison County')).toBeNull()
  })
})

describe('keyTaxon — run-on species titles', () => {
  it('reads species and family pages titled "Plecoptera: <Family> of Gunnison County, Colorado…"', async () => {
    const { keyTaxon } = await import('../lib/checklists.js')
    expect(keyTaxon('Plecoptera: Capniidae of Gunnison County, ColoradoCapnia vernalis Newport 1848')).toEqual({ taxon: 'Capnia vernalis', qualifier: null })
    expect(keyTaxon('Plecoptera: Perlidae of Gunnison County, Colorado')).toEqual({ taxon: 'Perlidae', qualifier: null })
    expect(keyTaxon('Plecoptera of Gunnison County, ColoradoNymph key to Genera')).toBeNull()
  })
})

describe('publicationFromCrossRef', () => {
  it('maps a CrossRef work to a publications row', async () => {
    const { publicationFromCrossRef } = await import('../extract-rescued-bibliographies.js')
    const row = publicationFromCrossRef({
      DOI: '10.1006/QRES.1997.1960', type: 'journal-article', title: ['Palynological evidence for <i>late</i> change'],
      'container-title': ['Quaternary Research'], issued: { 'date-parts': [[1998]] }, volume: '49', page: '222-232',
      author: [{ given: 'L. A.', family: 'Vierling' }], abstract: '<jats:p>A core</jats:p>',
    })
    expect(row).toMatchObject({ title: 'Palynological evidence for late change', year: 1998, journal: 'Quaternary Research',
      doi: '10.1006/qres.1997.1960', type: 'article', pages: '222-232', abstract: 'A core', authors: [{ given: 'L. A.', family: 'Vierling' }] })
    expect(publicationFromCrossRef({ DOI: 'x', type: 'proceedings-article', title: ['T'] }).type).toBe('other')
  })
})
