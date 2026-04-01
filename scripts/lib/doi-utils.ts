/**
 * DOI extraction and title similarity utilities.
 *
 * Used by CrossRef enrichment to extract DOIs from reference strings
 * and match titles for disambiguation.
 */

/**
 * Extract a DOI from a reference string that may contain a doi.org URL,
 * a "doi:" prefix, or a bare DOI.
 */
export function extractDoi(restofreference: string | null): string | null {
  if (!restofreference) return null
  const doiUrlMatch = restofreference.match(/doi\.org\/(10\.\S+)/i)
  if (doiUrlMatch) return doiUrlMatch[1].replace(/[.,;)\s]+$/, '')
  const bareDoiMatch = restofreference.match(/(10\.\d{4,}\/\S+)/i)
  if (bareDoiMatch) return bareDoiMatch[1].replace(/[.,;)\s]+$/, '')
  return null
}

/**
 * Compute Jaccard similarity between two titles (word overlap).
 * Returns a value between 0 and 1.
 */
export function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1

  const wordsA = new Set(na.split(' '))
  const wordsB = new Set(nb.split(' '))
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
  const union = new Set([...wordsA, ...wordsB])
  return intersection.size / union.size
}
