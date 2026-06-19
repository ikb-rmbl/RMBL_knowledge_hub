/**
 * Tests for the rich-title helper — pin the parsing rules so a future
 * regex tweak doesn't silently regress the title rendering across the site.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { richTitle } from '../rich-title'

function render(input: string | null | undefined): string {
  return renderToStaticMarkup(<>{richTitle(input)}</>)
}

describe('richTitle', () => {
  it('passes through plain text', () => {
    expect(render('Pollination of subalpine flora')).toBe('Pollination of subalpine flora')
  })

  it('renders <i>...</i> wrapping a binomial', () => {
    expect(render('Reproduction in <i>Marmota flaviventer</i>')).toBe(
      'Reproduction in <i>Marmota flaviventer</i>',
    )
  })

  it('handles the CrossRef leading/trailing space inside the tag', () => {
    expect(render('Sex-specific strategies (<i> Marmota flaviventer </i>): senescence')).toBe(
      'Sex-specific strategies (<i>Marmota flaviventer</i>): senescence',
    )
  })

  it('handles multiple inline pairs', () => {
    expect(render('<i>Aneides vagrans</i> and <i>Ensatina eschscholtzii</i>')).toBe(
      '<i>Aneides vagrans</i> and <i>Ensatina eschscholtzii</i>',
    )
  })

  it('decodes common HTML entities', () => {
    // React's auto-escape re-serializes & as &amp; on the way out.
    expect(render('Frogs &amp; salamanders')).toBe('Frogs &amp; salamanders')
    expect(render('Temp 0&deg;C and CO2 flux')).toBe('Temp 0°C and CO2 flux')
  })

  it('strips unsupported / stray tags but keeps the inner text', () => {
    // Tag wrapper is dropped (React auto-escapes the surrounding text);
    // inner text is preserved as a safe string. This matches React's
    // default text-rendering safety contract.
    expect(render('Climate <script>alert(1)</script> effects')).toBe('Climate alert(1) effects')
    expect(render('Methods <a href="...">link</a> in study')).toBe('Methods link in study')
  })

  it('strips unclosed allowed tags', () => {
    expect(render('Trailing tag <i>Aquilegia')).toBe('Trailing tag Aquilegia')
  })

  it('handles sub / sup for chemical notation', () => {
    expect(render('CO<sub>2</sub> exchange')).toBe('CO<sub>2</sub> exchange')
    expect(render('M<sup>2</sup> per hectare')).toBe('M<sup>2</sup> per hectare')
  })

  it('returns null for null / undefined / empty input', () => {
    expect(richTitle(null)).toBeNull()
    expect(richTitle(undefined)).toBeNull()
    expect(richTitle('')).toBeNull()
  })

  it('escapes raw < that is not a tag', () => {
    // Bare "<" not followed by a tag character is left in place
    expect(render('p < 0.05')).toBe('p &lt; 0.05')
  })
})
