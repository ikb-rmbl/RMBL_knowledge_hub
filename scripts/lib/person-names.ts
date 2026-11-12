/**
 * Person-name keys shared by research-plan scripts: surname + first initial,
 * tolerant of the spellings 25 years of filings use ("Dan"/"Daniel Blumstein",
 * nicknames in parentheses or quotes, accents, suffixes).
 */

const SUFFIX = /^(jr|sr|ii|iii|iv|phd|dr)$/

function nameTokens(s: string): string[] {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|"[^"]*"|“[^”]*”/g, ' ')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !SUFFIX.test(t))
}

/**
 * Surname + first initial for the first person in a PI string. 25 years of
 * filings spell the same person differently ("Dan"/"Daniel Blumstein").
 */
export function piKey(s: string): string {
  return personKeys(s.split(/[,;&]| and /)[0])[0] ?? ''
}

/** Surname + first initial for every person in a PI string ("A Smith, B Jones"). */
export function personKeys(s: string): string[] {
  return s
    .split(/[,;&]| and /)
    .map(nameTokens)
    .filter((t) => t.length > 0)
    .map((t) => `${t[t.length - 1]} ${t.length > 1 ? t[0][0] : ''}`.trim())
}

/** The same key built from a structured author record (family, given). */
export function authorKey(family: string, given: string | null | undefined): string {
  const fam = nameTokens(family)
  const giv = nameTokens(given ?? '')
  if (fam.length === 0) return ''
  return `${fam[fam.length - 1]} ${giv[0]?.[0] ?? ''}`.trim()
}
