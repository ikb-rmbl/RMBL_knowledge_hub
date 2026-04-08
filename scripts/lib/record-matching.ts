/**
 * Record Matching & Merge Logic
 *
 * Shared functions used by sync-databases.ts and tested directly.
 * Provides O(1) index-based matching for publications, datasets, documents,
 * authors, topics, and projects.
 */

import { titleSimilarity } from './doi-utils.js'

// ---------------------------------------------------------------------------
// Match Index — pre-built maps for O(1) lookups
// ---------------------------------------------------------------------------

export interface MatchIndex {
  byDoi: Map<string, any>
  bySourceUrl: Map<string, any>
  byOrcid: Map<string, any>
  byName: Map<string, any>
  byFamilyGiven: Map<string, any>
  all: any[]
}

export interface MatchResult {
  match: any | null
  confidence: 'exact' | 'high' | 'fuzzy' | 'none'
}

export function buildMatchIndex(candidates: any[]): MatchIndex {
  const byDoi = new Map<string, any>()
  const bySourceUrl = new Map<string, any>()
  const byOrcid = new Map<string, any>()
  const byName = new Map<string, any>()
  const byFamilyGiven = new Map<string, any>()

  for (const c of candidates) {
    if (c.doi) byDoi.set(c.doi.toLowerCase(), c)
    if (c.source_url) bySourceUrl.set(c.source_url, c)
    if (c.orcid) byOrcid.set(c.orcid, c)
    if (c.name) byName.set(c.name.toLowerCase(), c)
    if (c.family_name) {
      const key = `${c.family_name.toLowerCase()}|${(c.given_name || '').toLowerCase()}`
      byFamilyGiven.set(key, c)
    }
  }

  return { byDoi, bySourceUrl, byOrcid, byName, byFamilyGiven, all: candidates }
}

// ---------------------------------------------------------------------------
// Collection-specific matchers
// ---------------------------------------------------------------------------

export function matchPublication(record: any, _candidates: any[], index?: MatchIndex): MatchResult {
  const idx = index!
  // Tier 1: DOI exact match (O(1))
  if (record.doi) {
    const doiMatch = idx.byDoi.get(record.doi.toLowerCase())
    if (doiMatch) return { match: doiMatch, confidence: 'exact' }
  }

  // Tier 2: Title + year (must scan, but only for non-DOI matches)
  if (record.title) {
    let bestMatch: any = null
    let bestScore = 0
    for (const c of idx.all) {
      if (!c.title) continue
      const yearClose = !record.year || !c.year || Math.abs(record.year - c.year) <= 1
      if (!yearClose) continue
      const sim = titleSimilarity(record.title, c.title)
      if (sim > 0.9 && sim > bestScore) {
        bestMatch = c
        bestScore = sim
      }
    }
    if (bestMatch) return { match: bestMatch, confidence: bestScore > 0.95 ? 'high' : 'fuzzy' }

    // Tier 3: Title only, very high threshold
    for (const c of idx.all) {
      if (!c.title) continue
      const sim = titleSimilarity(record.title, c.title)
      if (sim > 0.95) return { match: c, confidence: 'fuzzy' }
    }
  }

  return { match: null, confidence: 'none' }
}

export function matchDataset(record: any, _candidates: any[], index?: MatchIndex): MatchResult {
  const idx = index!
  if (record.doi) {
    const doiMatch = idx.byDoi.get(record.doi.toLowerCase())
    if (doiMatch) return { match: doiMatch, confidence: 'exact' }
  }
  if (record.title) {
    for (const c of idx.all) {
      if (c.title && titleSimilarity(record.title, c.title) > 0.9) {
        return { match: c, confidence: 'high' }
      }
    }
  }
  return { match: null, confidence: 'none' }
}

export function matchDocument(record: any, _candidates: any[], index?: MatchIndex): MatchResult {
  const idx = index!
  if (record.source_url) {
    const urlMatch = idx.bySourceUrl.get(record.source_url)
    if (urlMatch) return { match: urlMatch, confidence: 'exact' }
  }
  if (record.title) {
    for (const c of idx.all) {
      if (c.title && titleSimilarity(record.title, c.title) > 0.9) {
        return { match: c, confidence: 'high' }
      }
    }
  }
  return { match: null, confidence: 'none' }
}

export function matchAuthor(record: any, _candidates: any[], index?: MatchIndex): MatchResult {
  const idx = index!
  if (record.orcid) {
    const orcidMatch = idx.byOrcid.get(record.orcid)
    if (orcidMatch) return { match: orcidMatch, confidence: 'exact' }
  }
  if (record.family_name) {
    const key = `${record.family_name.toLowerCase()}|${(record.given_name || '').toLowerCase()}`
    const nameMatch = idx.byFamilyGiven.get(key)
    if (nameMatch) return { match: nameMatch, confidence: 'high' }
  }
  return { match: null, confidence: 'none' }
}

export function matchTopic(record: any, _candidates: any[], index?: MatchIndex): MatchResult {
  const nameMatch = index!.byName.get(record.name?.toLowerCase())
  return nameMatch ? { match: nameMatch, confidence: 'exact' } : { match: null, confidence: 'none' }
}

export function matchProject(record: any, _candidates: any[], index?: MatchIndex): MatchResult {
  const nameMatch = index!.byName.get(record.name?.toLowerCase())
  return nameMatch ? { match: nameMatch, confidence: 'exact' } : { match: null, confidence: 'none' }
}

// ---------------------------------------------------------------------------
// Field merge logic
// ---------------------------------------------------------------------------

export function mergeField(
  localVal: any,
  remoteVal: any,
  fieldType: 'pipeline' | 'curated',
  direction: 'pull' | 'push',
): any {
  if (direction === 'pull') {
    if (fieldType === 'curated') return remoteVal ?? localVal
    if (fieldType === 'pipeline') return localVal ?? remoteVal
  } else {
    if (fieldType === 'curated') {
      return (remoteVal === null || remoteVal === undefined) && localVal != null ? localVal : remoteVal
    }
    if (fieldType === 'pipeline') return localVal ?? remoteVal
  }
  return localVal
}
