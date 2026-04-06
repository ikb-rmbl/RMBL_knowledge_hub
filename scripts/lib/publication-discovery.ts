/**
 * Shared utilities for publication discovery.
 *
 * Provides deduplication against existing publications, OpenAlex normalization,
 * and abstract reconstruction from inverted index format.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { OUTPUT_DIR } from './config.js'
import { titleSimilarity } from './doi-utils.js'
import type { NormalizedPublication } from './types.js'

const TITLE_SIMILARITY_THRESHOLD = 0.85

// ---------------------------------------------------------------------------
// Load existing publications for deduplication
// ---------------------------------------------------------------------------

export function loadExistingPublications(): NormalizedPublication[] {
  const mainPath = `${OUTPUT_DIR}/publications-normalized.json`
  const existing: NormalizedPublication[] = existsSync(mainPath)
    ? JSON.parse(readFileSync(mainPath, 'utf-8'))
    : []

  // Also load previously discovered publications
  const discoveredFiles = [
    'publications-discovered-openalex.json',
    'publications-discovered-citations.json',
  ]

  for (const file of discoveredFiles) {
    const path = `${OUTPUT_DIR}/${file}`
    if (existsSync(path)) {
      const discovered: NormalizedPublication[] = JSON.parse(readFileSync(path, 'utf-8'))
      existing.push(...discovered)
    }
  }

  return existing
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export function buildPubDedupIndex(pubs: NormalizedPublication[]): {
  doiSet: Set<string>
  titles: { title: string; year: number }[]
} {
  const doiSet = new Set<string>()
  const titles: { title: string; year: number }[] = []

  for (const pub of pubs) {
    if (pub.doi) doiSet.add(pub.doi.toLowerCase())
    if (pub.title) titles.push({ title: pub.title, year: pub.year })
  }

  return { doiSet, titles }
}

export function isPubDuplicate(
  candidate: { doi?: string | null; title: string; year?: number },
  index: { doiSet: Set<string>; titles: { title: string; year: number }[] },
): boolean {
  if (candidate.doi && index.doiSet.has(candidate.doi.toLowerCase())) {
    return true
  }

  // Title similarity with year filter for performance
  for (const existing of index.titles) {
    // Skip year-distant titles (±2 years tolerance for publication date discrepancies)
    if (candidate.year && existing.year && Math.abs(candidate.year - existing.year) > 2) continue

    if (titleSimilarity(candidate.title, existing.title) > TITLE_SIMILARITY_THRESHOLD) {
      return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export function saveDiscoveredPublications(source: string, pubs: NormalizedPublication[]): void {
  const path = `${OUTPUT_DIR}/publications-discovered-${source}.json`
  writeFileSync(path, JSON.stringify(pubs, null, 2))
  console.log(`Saved ${pubs.length} publications to ${path}`)
}

// ---------------------------------------------------------------------------
// OpenAlex normalization
// ---------------------------------------------------------------------------

const OPENALEX_TYPE_MAP: Record<string, string> = {
  'journal-article': 'article',
  'book-chapter': 'chapter',
  'book': 'book',
  'dissertation': 'thesis',
  'proceedings-article': 'article',
  'posted-content': 'other',
  'monograph': 'book',
  'report': 'other',
  'review': 'article',
  'article': 'article',
}

/**
 * Reconstruct abstract text from OpenAlex inverted index format.
 * Format: { "word1": [0, 5], "word2": [1, 3], ... } where values are position arrays.
 */
export function reconstructAbstract(invertedIndex: Record<string, number[]> | null): string | null {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null

  const words: [number, string][] = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue
    for (const pos of positions) {
      words.push([pos, word])
    }
  }

  if (words.length === 0) return null

  words.sort((a, b) => a[0] - b[0])
  return words.map(([, word]) => word).join(' ')
}

/**
 * Convert an OpenAlex work object to NormalizedPublication.
 */
export function normalizeOpenAlexWork(work: any): NormalizedPublication {
  // Authors
  const authors = (work.authorships || []).map((a: any) => {
    const displayName = a.author?.display_name || ''
    const parts = displayName.split(/\s+/)
    const family = parts.length > 1 ? parts[parts.length - 1] : displayName
    const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : ''
    return {
      given,
      family,
      orcid: a.author?.orcid?.replace('https://orcid.org/', '') || undefined,
    }
  })

  // DOI
  const doi = work.doi?.replace('https://doi.org/', '') || null

  // Abstract
  const abstract = reconstructAbstract(work.abstract_inverted_index) || null

  // Keywords from concepts
  const keywords: { keyword: string }[] = (work.concepts || [])
    .filter((c: any) => c.score > 0.3)
    .slice(0, 10)
    .map((c: any) => ({ keyword: c.display_name }))

  // PDF link from open access
  const pdfLink = work.open_access?.oa_url || work.primary_location?.pdf_url || null

  // Publication year
  const year = work.publication_year || 0

  // Type mapping
  const publicationType = OPENALEX_TYPE_MAP[work.type || ''] || 'other'

  // Journal
  const journal = work.primary_location?.source?.display_name || null

  // Pages
  const firstPage = work.biblio?.first_page
  const lastPage = work.biblio?.last_page
  const pages = firstPage && lastPage ? `${firstPage}-${lastPage}` : firstPage || null

  return {
    _sourceId: `openalex:${work.id?.replace('https://openalex.org/', '') || ''}`,
    title: work.title || work.display_name || '',
    authors,
    year,
    publicationType,
    journal,
    volume: work.biblio?.volume || null,
    issue: work.biblio?.issue || null,
    pages,
    doi,
    publisher: work.primary_location?.source?.host_organization_name || null,
    abstract,
    keywords,
    pdfLink,
    externalUrl: doi ? `https://doi.org/${doi}` : null,
    editors: [],
    _chaptertitle: null,
    _degree: null,
    _institution: null,
    _crossrefEnriched: false,
    _unpaywallEnriched: false,
    _oaStatus: work.open_access?.oa_status || null,
    _source: 'discovered',
    _discoveryMethod: 'openalex_geo',
  }
}

// ---------------------------------------------------------------------------
// CrossRef normalization
// ---------------------------------------------------------------------------

const CROSSREF_TYPE_MAP: Record<string, string> = {
  'journal-article': 'article',
  'book-chapter': 'chapter',
  'book': 'book',
  'dissertation': 'thesis',
  'proceedings-article': 'article',
  'monograph': 'book',
  'report': 'other',
  'posted-content': 'other',
}

/**
 * Convert a CrossRef work item to NormalizedPublication.
 */
export function normalizeCrossRefWork(item: any): NormalizedPublication {
  const title = Array.isArray(item.title) ? item.title[0] : (item.title || '')
  const doi = item.DOI || null

  // Authors — CrossRef provides {given, family} directly
  const authors = (item.author || []).map((a: any) => ({
    given: a.given || '',
    family: a.family || '',
    orcid: a.ORCID?.replace('http://orcid.org/', '').replace('https://orcid.org/', '') || undefined,
  }))

  // Year
  const dateParts = item['published-print']?.['date-parts']?.[0]
    || item['published-online']?.['date-parts']?.[0]
    || item.issued?.['date-parts']?.[0]
  const year = dateParts?.[0] || 0

  // Abstract — strip JATS XML tags
  let abstract = item.abstract || null
  if (abstract) abstract = abstract.replace(/<[^>]+>/g, '').trim()

  // Journal
  const journal = Array.isArray(item['container-title']) ? item['container-title'][0] : (item['container-title'] || null)

  // Keywords
  const keywords: { keyword: string }[] = (item.subject || []).map((s: string) => ({ keyword: s }))

  return {
    _sourceId: `crossref:${doi || ''}`,
    title,
    authors,
    year,
    publicationType: CROSSREF_TYPE_MAP[item.type || ''] || 'other',
    journal,
    volume: item.volume || null,
    issue: item.issue || null,
    pages: item.page || null,
    doi,
    publisher: item.publisher || null,
    abstract,
    keywords,
    pdfLink: null,
    externalUrl: doi ? `https://doi.org/${doi}` : null,
    editors: [],
    _chaptertitle: null,
    _degree: null,
    _institution: null,
    _crossrefEnriched: true,
    _unpaywallEnriched: false,
    _oaStatus: null,
    _source: 'discovered',
    _discoveryMethod: 'crossref_affiliation',
  }
}
