/**
 * Identifying-key extraction for the duplicate-tombstones flow.
 *
 * The same function powers two paths that must agree:
 *  - The Payload `beforeDelete` hook (src/collections/shared/tombstoneHook.ts)
 *    snapshots a deleted row's keys into `duplicate_tombstones`.
 *  - The pipeline loaders (`load-to-payload.ts`, `load-stories.ts`) extract
 *    keys from incoming records and check them against the tombstones.
 *
 * Keys are intentionally a small JSON object; nulls are fine. The pipeline
 * check considers an incoming record tombstoned when ANY non-null key on the
 * incoming side matches the same non-null key on a tombstone row.
 *
 * Field-name handling: this helper accepts both Payload camelCase shape
 * (sourceUrl) and DB snake_case shape (source_url) for the same logical
 * field, so it works whether the caller is a Payload hook (camelCase docs)
 * or a pg row (snake_case).
 */

import { titleSimilarity } from './doi-utils.js'

export type TombstoneKeys = {
  doi?: string | null
  source_url?: string | null
  title?: string | null
  year?: number | null
}

function pick<T = any>(doc: any, camel: string, snake: string): T | null {
  return doc?.[camel] ?? doc?.[snake] ?? null
}

function norm(s: string | null | undefined): string | null {
  if (!s) return null
  return s.trim().toLowerCase()
}

export function extractKeys(collection: string, doc: any): TombstoneKeys {
  switch (collection) {
    case 'publications':
      return {
        doi: norm(doc?.doi),
        title: doc?.title || null,
        year: doc?.year ?? null,
      }
    case 'datasets':
      return {
        doi: norm(doc?.doi),
        title: doc?.title || null,
      }
    case 'documents':
      return {
        source_url: pick(doc, 'sourceUrl', 'source_url'),
        title: doc?.title || null,
      }
    case 'stories':
      return {
        source_url: pick(doc, 'sourceUrl', 'source_url'),
        title: doc?.title || null,
      }
    default:
      return {}
  }
}

/**
 * Does this incoming record match an existing tombstone?
 *
 * Match rules (in priority order):
 *   1. Exact DOI match (lowercased).
 *   2. Exact source_url match.
 *   3. Title similarity ≥ 0.9 (and year within ±1 for publications, when both
 *      sides have a year).
 *
 * If a tombstone's keys are empty (no DOI/url/title), it can never match —
 * we don't want to accidentally tombstone every future row with a missing
 * identifier.
 */
export function matchesAnyTombstone(
  incoming: TombstoneKeys,
  tombstones: TombstoneKeys[],
): boolean {
  const incDoi = incoming.doi
  const incUrl = incoming.source_url
  const incTitle = incoming.title
  const incYear = incoming.year

  for (const t of tombstones) {
    if (incDoi && t.doi && incDoi === t.doi) return true
    if (incUrl && t.source_url && incUrl === t.source_url) return true
    if (incTitle && t.title) {
      const yearMatches = !incYear || !t.year || Math.abs((incYear as number) - (t.year as number)) <= 1
      if (yearMatches && titleSimilarity(incTitle, t.title) > 0.9) return true
    }
  }
  return false
}
