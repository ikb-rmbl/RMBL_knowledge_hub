import React from 'react'

/**
 * Render a publication / dataset / document title that may contain HTML
 * inline-formatting tags (`<i>`, `<em>`, `<sub>`, `<sup>`, `<b>`, `<strong>`)
 * as a sequence of safe React elements. CrossRef and a few other sources
 * deliver scientific names italicized this way:
 *
 *     "Sex-specific reproductive strategies in <i>Marmota flaviventer</i>"
 *
 * Rendered as text, the tags show literally, which was the bug surfaced in
 * user feedback. This helper restores the intended typography without
 * resorting to dangerouslySetInnerHTML (per project XSS policy).
 *
 * Approach:
 *   1. Decode the small set of HTML entities we see in the corpus.
 *   2. Find each balanced inline-tag pair on the allow-list and render its
 *      inner text as the matching React element.
 *   3. Strip any stray / unsupported tags that don't form a valid pair.
 *
 * The allow-list is intentionally short: only inline typographic tags
 * relevant to scientific titles. No links, no images, no block-level tags.
 * Anything outside the list is stripped — never escaped to a literal "<".
 *
 * Nested same-tag pairs are not supported (regex is non-greedy on `.*?`);
 * we haven't seen any in the corpus and the common case is one level deep.
 *
 * Surveyed 4,852 publication titles; 865 (~18%) contain at least one tag,
 * almost all of them `<i>...</i>` around a binomial.
 */

const ALLOWED_TAGS = ['i', 'em', 'sub', 'sup', 'b', 'strong'] as const

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&apos;': "'", '&#39;': "'",
  '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—',
  '&times;': '×', '&deg;': '°',
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp|ndash|mdash|times|deg);/g, m => ENTITIES[m] ?? m)
}

function stripStrayTags(s: string): string {
  // Drop any leftover open/close tags (allowed or otherwise). The matched
  // pairs are already pulled out before this runs; what remains is either
  // malformed or unsupported and shouldn't render as text.
  return s.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g, '')
}

export function richTitle(title: string | null | undefined): React.ReactNode {
  if (!title) return null

  const decoded = decodeEntities(title)
  const tagAlternation = ALLOWED_TAGS.join('|')
  // Non-greedy match of any allowed tag pair. Whitespace tolerance after
  // the inner content (many CrossRef titles have `<i> Genus species </i>`
  // with a leading and trailing space).
  const re = new RegExp(`<(${tagAlternation})\\b[^>]*>([^<]*?)<\\/\\1>`, 'gi')

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = re.exec(decoded))) {
    if (match.index > lastIndex) {
      parts.push(stripStrayTags(decoded.slice(lastIndex, match.index)))
    }
    const tag = match[1].toLowerCase()
    // Trim only leading/trailing spaces from the inner text — preserve
    // intra-word spacing like "<i>X</i> &amp; <i>Y</i>" rendering correctly.
    parts.push(React.createElement(tag, { key: key++ }, match[2].trim()))
    lastIndex = re.lastIndex
  }
  if (lastIndex < decoded.length) {
    parts.push(stripStrayTags(decoded.slice(lastIndex)))
  }

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return <>{parts.map((p, i) => <React.Fragment key={i}>{p}</React.Fragment>)}</>
}
