/**
 * Text repair for the legacy (1996–2020) research-plan database on old.rmbl.org.
 *
 * Its titles and abstracts went through three bad round trips before reaching
 * the API: HTML entity-escaped (sometimes twice — "&lt;p&gt;"), UTF-8 decoded as
 * cp1252 ("â€™" for "’"), and some characters already lost to U+FFFD, which was
 * then mojibaked again ("ï¿½"). Undo them in that order.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', deg: '°', micro: 'µ',
  plusmn: '±', times: '×', euro: '€', trade: '™', bull: '•',
  sbquo: '‚', bdquo: '„', dagger: '†', Dagger: '‡', permil: '‰',
  lsaquo: '‹', rsaquo: '›', OElig: 'Œ', oelig: 'œ', Scaron: 'Š',
  scaron: 'š', Yuml: 'Ÿ', Zcaron: 'Ž', zcaron: 'ž', fnof: 'ƒ',
  circ: 'ˆ', tilde: '˜',
}

/** Latin-1 entities (&acirc; &iuml; &frac12; …) by code point, 0xA0–0xFF. */
const LATIN1 = [
  'nbsp', 'iexcl', 'cent', 'pound', 'curren', 'yen', 'brvbar', 'sect', 'uml', 'copy', 'ordf',
  'laquo', 'not', 'shy', 'reg', 'macr', 'deg', 'plusmn', 'sup2', 'sup3', 'acute', 'micro',
  'para', 'middot', 'cedil', 'sup1', 'ordm', 'raquo', 'frac14', 'frac12', 'frac34', 'iquest',
  'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil', 'Egrave', 'Eacute',
  'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml', 'ETH', 'Ntilde', 'Ograve', 'Oacute',
  'Ocirc', 'Otilde', 'Ouml', 'times', 'Oslash', 'Ugrave', 'Uacute', 'Ucirc', 'Uuml', 'Yacute',
  'THORN', 'szlig', 'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring', 'aelig', 'ccedil',
  'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml', 'eth', 'ntilde',
  'ograve', 'oacute', 'ocirc', 'otilde', 'ouml', 'divide', 'oslash', 'ugrave', 'uacute', 'ucirc',
  'uuml', 'yacute', 'thorn', 'yuml',
]
LATIN1.forEach((name, i) => { NAMED[name] ??= String.fromCharCode(0xa0 + i) })

function decodeEntitiesOnce(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
    }
    return NAMED[body] ?? m
  })
}

export function decodeEntities(s: string): string {
  // Up to three passes: the data is double-escaped in places, never more.
  for (let i = 0; i < 3; i++) {
    const next = decodeEntitiesOnce(s)
    if (next === s) return s
    s = next
  }
  return s
}

/** cp1252's 0x80–0x9F block; everything else in 0x00–0xFF maps to itself. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f' +
  '\u0090‘’“”•–—˜™š›œ\u009džŸ'
const CP1252_BYTE = new Map<string, number>([...CP1252_HIGH].map((c, i) => [c, 0x80 + i]))

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** A UTF-8 lead byte (Â–ô as cp1252) followed by one or more continuation bytes. */
const MOJIBAKE = new RegExp(`[\\u00c2-\\u00f4][\\u0080-\\u00bf${CP1252_HIGH}]+`, 'g')

/**
 * Re-encode each suspicious run as cp1252 and decode it as UTF-8. Runs that do
 * not form valid UTF-8 are left alone, so genuine "é" or "Â°" text survives.
 */
export function fixMojibake(s: string): string {
  return s.replace(MOJIBAKE, (run) => {
    const bytes: number[] = []
    for (const ch of run) {
      const b = CP1252_BYTE.get(ch) ?? ch.charCodeAt(0)
      if (b > 0xff) return run
      bytes.push(b)
    }
    try {
      return utf8.decode(new Uint8Array(bytes))
    } catch {
      return run
    }
  })
}

/** Paragraph/line tags become newlines, every other tag is dropped (its text kept). */
export function stripTags(s: string): string {
  return s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
}

/** Decode, de-mojibake, de-tag. U+FFFD comes back as "?" for the caller's punctuation repair. */
export function cleanLegacyHtml(raw: string | null | undefined): string {
  if (!raw || raw === 'None') return ''
  const s = stripTags(fixMojibake(decodeEntities(raw)))
  return decodeEntities(s) // entities that were hidden inside escaped tags
    .replace(/\r\n?/g, '\n')
    .replace(/�/g, '?')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The API sends missing values as the literal string "None". */
export function legacyValue(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  return s === 'None' || s === 'null' ? '' : s
}
