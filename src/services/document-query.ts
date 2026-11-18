/**
 * Documents browse for /search?type=documents (and the documents share of the
 * "All" view), in SQL rather than Payload because:
 *   - Payload's sort is `ORDER BY date_original DESC`, and Postgres puts NULLs
 *     first in a descending sort: the ~700 undated documents (Sustainable
 *     Living Library pages, legacy website pages) filled the first pages in
 *     insertion order, so "Date (Newest)" looked like "date added". Here
 *     undated documents sort last in both directions.
 *   - the source filter needs provenance, document_type and the source_url
 *     host, which Payload doesn't expose (provenance is SQL-only).
 */

import type { Pool } from 'pg'

/**
 * Where a document came from. Mirrors documentSource() in
 * app/(frontend)/lib/document-source.ts (the display label) — keep in step.
 */
export const DOCUMENT_SOURCES = {
  'sustainable-library': {
    label: 'Sustainable Living Library',
    sql: `d.source_url ~* '^https?://(www\\.)?sustainablelibrary\\.org'`,
  },
  'federal-register': {
    label: 'Federal Register',
    sql: `(d.document_type LIKE 'federal\\_%' OR d.source_url ~* '^https?://(www\\.)?(federalregister|govinfo)\\.gov')`,
  },
  'rmbl-website': {
    label: 'RMBL legacy website (2000–2014)',
    sql: `d.provenance->>'discoveryMethod' = 'wayback_rescue'`,
  },
} as const

export type DocumentSourceKey = keyof typeof DOCUMENT_SOURCES

export function parseDocumentSource(v: string | undefined | null): DocumentSourceKey | undefined {
  return v && v in DOCUMENT_SOURCES ? (v as DocumentSourceKey) : undefined
}

export interface DocumentFilters {
  /** Title substring (the browse path's text match, as Payload's `contains`). */
  title?: string
  topicIds?: number[]
  yearFrom?: number | null
  yearTo?: number | null
  source?: DocumentSourceKey
}

export type DocumentSort = 'newest' | 'oldest' | 'title' | 'title-desc'

export interface DocumentRow {
  id: number
  title: string
  summary: string | null
  date_original: string | null
  geographic_scope: string[]
}

function whereOf(f: DocumentFilters, skipSource = false): { sql: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []
  if (f.title) {
    params.push(`%${f.title}%`)
    parts.push(`d.title ILIKE $${params.length}`)
  }
  if (f.topicIds?.length) {
    params.push(f.topicIds)
    parts.push(`EXISTS (SELECT 1 FROM documents_rels r WHERE r.parent_id = d.id AND r.path = 'categories' AND r.topics_id = ANY($${params.length}))`)
  }
  if (f.yearFrom) {
    params.push(`${f.yearFrom}-01-01`)
    parts.push(`d.date_original >= $${params.length}`)
  }
  if (f.yearTo) {
    params.push(`${f.yearTo}-12-31`)
    parts.push(`d.date_original <= $${params.length}`)
  }
  if (f.source && !skipSource) parts.push(DOCUMENT_SOURCES[f.source].sql)
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
}

const ORDER: Record<DocumentSort, string> = {
  newest: 'd.date_original DESC NULLS LAST, d.id DESC',
  oldest: 'd.date_original ASC NULLS LAST, d.id',
  title: 'd.title ASC, d.id',
  'title-desc': 'd.title DESC, d.id',
}

export function documentSort(sortParam: string): DocumentSort {
  return sortParam in ORDER ? (sortParam as DocumentSort) : 'newest'
}

export async function browseDocuments(
  db: Pool, f: DocumentFilters, opts: { sort: DocumentSort; limit: number; offset: number },
): Promise<DocumentRow[]> {
  const { sql, params } = whereOf(f)
  const { rows } = await db.query<DocumentRow>(
    `SELECT d.id, d.title, d.summary, d.date_original::date::text AS date_original,
            coalesce((SELECT array_agg(g.value ORDER BY g."order") FROM documents_geographic_scope g WHERE g.parent_id = d.id), '{}') AS geographic_scope
       FROM documents d ${sql}
      ORDER BY ${ORDER[opts.sort]}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset])
  return rows
}

export async function countDocuments(db: Pool, f: DocumentFilters): Promise<number> {
  const { sql, params } = whereOf(f)
  const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM documents d ${sql}`, params)
  return r.n
}

/** Counts per source under the other filters, for the source chips. */
export async function countDocumentsBySource(db: Pool, f: DocumentFilters): Promise<Record<DocumentSourceKey, number>> {
  const { sql, params } = whereOf(f, true)
  const cols = Object.entries(DOCUMENT_SOURCES).map(([k, s]) => `count(*) FILTER (WHERE ${s.sql})::int AS "${k}"`).join(', ')
  const { rows: [r] } = await db.query(`SELECT ${cols} FROM documents d ${sql}`, params)
  return r
}
