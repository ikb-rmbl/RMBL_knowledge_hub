/**
 * Shared utilities for dataset discovery scripts.
 *
 * Provides deduplication against existing datasets, loading helpers,
 * and normalization utilities shared across all discovery sources.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { OUTPUT_DIR } from './config.js'
import { titleSimilarity } from './doi-utils.js'
import type { NormalizedDataset } from './types.js'

const TITLE_SIMILARITY_THRESHOLD = 0.8

// ---------------------------------------------------------------------------
// Load existing datasets for deduplication
// ---------------------------------------------------------------------------

export function loadExistingDatasets(): NormalizedDataset[] {
  const catalogPath = `${OUTPUT_DIR}/data-catalog-normalized.json`
  const existing: NormalizedDataset[] = existsSync(catalogPath)
    ? JSON.parse(readFileSync(catalogPath, 'utf-8'))
    : []

  // Also load previously discovered datasets from all sources
  const discoveredFiles = [
    'datasets-discovered.json',
    'datasets-discovered-zenodo.json',
    'datasets-discovered-datacite.json',
    'datasets-discovered-dois.json',
    'datasets-discovered-ncei.json',
    'datasets-discovered-sciencebase.json',
    'datasets-discovered-paleo.json',
  ]

  for (const file of discoveredFiles) {
    const path = `${OUTPUT_DIR}/${file}`
    if (existsSync(path)) {
      const discovered: NormalizedDataset[] = JSON.parse(readFileSync(path, 'utf-8'))
      existing.push(...discovered)
    }
  }

  return existing
}

/**
 * Build a deduplication index from existing datasets.
 */
export function buildDedupIndex(existing: NormalizedDataset[]): {
  doiSet: Set<string>
  titles: string[]
} {
  const doiSet = new Set<string>()
  const titles: string[] = []

  for (const ds of existing) {
    if (ds.doi) doiSet.add(ds.doi.toLowerCase())
    if (ds.title) titles.push(ds.title)
  }

  return { doiSet, titles }
}

/**
 * Check if a candidate dataset is a duplicate of an existing one.
 */
export function isDuplicate(
  candidate: { doi?: string | null; title: string },
  index: { doiSet: Set<string>; titles: string[] },
): boolean {
  // DOI exact match
  if (candidate.doi && index.doiSet.has(candidate.doi.toLowerCase())) {
    return true
  }

  // Title similarity match
  for (const existingTitle of index.titles) {
    if (titleSimilarity(candidate.title, existingTitle) > TITLE_SIMILARITY_THRESHOLD) {
      return true
    }
  }

  return false
}

/**
 * Save discovered datasets to their source-specific output file.
 */
export function saveDiscoveredDatasets(source: string, datasets: NormalizedDataset[]): void {
  const filename = source === 'dataone' ? 'datasets-discovered.json' : `datasets-discovered-${source}.json`
  const path = `${OUTPUT_DIR}/${filename}`
  writeFileSync(path, JSON.stringify(datasets, null, 2))
  console.log(`Saved ${datasets.length} datasets to ${path}`)
}

/**
 * Common license normalization.
 */
export function normalizeLicense(raw: string | null | undefined): string | null {
  if (!raw) return null
  const r = raw.toLowerCase()
  if (r.includes('cc0') || r.includes('cc 0') || r.includes('public domain')) return 'cc0'
  if (r.includes('cc-by-sa') || r.includes('cc by-sa') || r.includes('cc by sa')) return 'cc_by_sa_4'
  if (r.includes('cc-by-nc') || r.includes('cc by-nc') || r.includes('cc by nc')) return 'cc_by_nc_4'
  if (r.includes('cc-by') || r.includes('cc by') || r.includes('attribution')) return 'cc_by_4'
  return null
}

/**
 * Strip HTML tags from a string.
 */
export function stripHtml(text: string | null): string | null {
  if (!text) return null
  return text.replace(/<[^>]+>/g, '').trim() || null
}
