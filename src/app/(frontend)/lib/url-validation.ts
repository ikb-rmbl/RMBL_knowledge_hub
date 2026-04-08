/** Validate that a URL uses http(s) protocol — prevents javascript: and data: injection */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Validate ORCID format (XXXX-XXXX-XXXX-XXXX where X is digit, last may be X) */
export function isValidOrcid(orcid: string | null | undefined): orcid is string {
  return !!orcid && /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid)
}

/** Validate DOI format (starts with 10.NNNN/) */
export function isValidDoi(doi: string | null | undefined): doi is string {
  return !!doi && /^10\.\d{4,}\/\S+$/.test(doi)
}
