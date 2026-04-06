/**
 * CrossRef & Unpaywall API client.
 *
 * Shared by scrape-publications.ts (strict mode) and enrich.ts (relaxed mode).
 */

import { titleSimilarity } from './doi-utils.js'
import { CROSSREF_API, CROSSREF_MAILTO, UNPAYWALL_API, UNPAYWALL_EMAIL } from './config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossRefResult {
  doi: string | null
  abstract: string | null
}

export interface UnpaywallResult {
  pdfUrl: string | null
  oaStatus: string | null
}

export interface CrossRefOptions {
  /** Use relaxed matching: lower similarity threshold (0.75), +/-1 year tolerance, more rows */
  relaxed?: boolean
}

// ---------------------------------------------------------------------------
// CrossRef
// ---------------------------------------------------------------------------

export async function queryCrossRef(
  title: string,
  firstAuthorFamily: string,
  year: number | string,
  opts?: CrossRefOptions,
): Promise<CrossRefResult> {
  const relaxed = opts?.relaxed ?? false
  const numYear = typeof year === 'string' ? parseInt(year) : year
  const threshold = relaxed ? 0.75 : 0.85
  const yearFrom = relaxed ? numYear - 1 : numYear
  const yearTo = relaxed ? numYear + 1 : numYear
  const rows = relaxed ? 5 : 3

  try {
    const query = encodeURIComponent(title)
    const url = `${CROSSREF_API}?query.title=${query}&query.author=${encodeURIComponent(firstAuthorFamily)}&filter=from-pub-date:${yearFrom},until-pub-date:${yearTo}&rows=${rows}&select=DOI,title,abstract,author&mailto=${CROSSREF_MAILTO}`

    const res = await fetch(url)
    if (!res.ok) return { doi: null, abstract: null }

    const data = await res.json()
    const items = data?.message?.items
    if (!items || items.length === 0) return { doi: null, abstract: null }

    for (const item of items) {
      const crTitle = Array.isArray(item.title) ? item.title[0] : item.title
      if (!crTitle) continue

      const similarity = titleSimilarity(title, crTitle)
      if (similarity > threshold) {
        let abstract = item.abstract || null
        if (abstract) abstract = abstract.replace(/<[^>]+>/g, '').trim()
        return { doi: item.DOI, abstract }
      }
    }

    return { doi: null, abstract: null }
  } catch {
    return { doi: null, abstract: null }
  }
}

// ---------------------------------------------------------------------------
// Unpaywall
// ---------------------------------------------------------------------------

export async function queryUnpaywall(doi: string): Promise<UnpaywallResult> {
  try {
    const url = `${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`
    const res = await fetch(url)
    if (!res.ok) return { pdfUrl: null, oaStatus: null }

    const data = await res.json()
    const oaStatus = data.oa_status || null

    const bestPdf = data.best_oa_location?.url_for_pdf || null
    if (bestPdf) return { pdfUrl: bestPdf, oaStatus }

    if (Array.isArray(data.oa_locations)) {
      for (const loc of data.oa_locations) {
        if (loc.url_for_pdf) return { pdfUrl: loc.url_for_pdf, oaStatus }
      }
    }

    return { pdfUrl: null, oaStatus }
  } catch {
    return { pdfUrl: null, oaStatus: null }
  }
}
