import { describe, expect, it } from 'vitest'
import { cleanLegacyHtml, decodeEntities, fixMojibake, legacyValue } from '../lib/legacy-text.js'

describe('legacy research-plan text repair', () => {
  it('decodes double-escaped paragraph markup', () => {
    expect(cleanLegacyHtml('&lt;p&gt;First.&lt;/p&gt;&lt;p&gt;Second.&lt;/p&gt;')).toBe('First.\n\nSecond.')
  })

  it('undoes entity-escaped cp1252 mojibake', () => {
    expect(cleanLegacyHtml('Earth&acirc;&euro;&trade;s climate')).toBe('Earth’s climate')
    expect(cleanLegacyHtml('&acirc;&euro;&oelig;quoted&acirc;&euro;')).toContain('“quoted')
  })

  it('turns the mojibaked replacement character into "?"', () => {
    expect(cleanLegacyHtml('plant&iuml;&iquest;&frac12;s')).toBe('plant?s')
  })

  it('leaves genuine accented text alone', () => {
    expect(fixMojibake('Sébastien café')).toBe('Sébastien café')
    expect(cleanLegacyHtml('<p>Sébastien Rivest</p>')).toBe('Sébastien Rivest')
  })

  it('keeps sub/sup text while dropping the tags', () => {
    expect(cleanLegacyHtml('<p>CO<sub>2</sub> flux</p>')).toBe('CO2 flux')
  })

  it('treats the API "None" sentinel as empty', () => {
    expect(cleanLegacyHtml('None')).toBe('')
    expect(legacyValue('None')).toBe('')
    expect(legacyValue(' Emory ')).toBe('Emory')
    expect(legacyValue(3)).toBe('3')
  })

  it('stops after the data is fully decoded', () => {
    expect(decodeEntities('A &amp;amp; B')).toBe('A & B')
    expect(decodeEntities('&bogus; stays')).toBe('&bogus; stays')
  })
})
