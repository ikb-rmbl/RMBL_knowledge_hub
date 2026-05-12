/**
 * Search service — full-text search across publications, datasets, documents,
 * and stories. Single source of truth for unified search; both the REST API
 * (`/api/search`) and the `/search` page call this.
 *
 * Uses PostgreSQL tsvector with weighted ranking (title=A, abstract/summary=B,
 * fullText=C). Returns unified results with highlighted snippets, citation
 * counts where available, and a per-collection sort applied before the final
 * cross-collection merge.
 */

import type pg from 'pg'

export interface SearchResult {
  id: number
  type: 'document' | 'publication' | 'dataset' | 'story'
  title: string
  snippet: string
  rank: number
  year: number | null
  subtype: string | null
  meta: string[]
  externalCitationCount?: number
  internalCitationCount?: number
}

export type SearchSort =
  | 'relevance'
  | 'newest'
  | 'oldest'
  | 'title'
  | 'title-desc'
  | 'most-cited'
  | 'most-cited-internal'

export interface SearchOptions {
  query: string
  type?: '' | 'documents' | 'publications' | 'datasets' | 'stories'
  sortBy?: SearchSort
  limit?: number
  offset?: number
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

const HEADLINE_OPTS = "'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>'"

// Per-collection ORDER BY fragments. Citation-based sorts only make sense for
// publications/datasets; everything else falls back to rank or date.
function orderBySql(sortBy: SearchSort, collection: 'documents' | 'publications' | 'datasets' | 'stories'): string {
  const dateCol =
    collection === 'publications' ? 'year' :
    collection === 'datasets' ? 'publication_year' :
    collection === 'stories' ? 'date' :
    'date_original'
  switch (sortBy) {
    case 'newest': return `${dateCol} DESC NULLS LAST`
    case 'oldest': return `${dateCol} ASC NULLS LAST`
    case 'title': return 'title ASC'
    case 'title-desc': return 'title DESC'
    case 'most-cited':
      return (collection === 'publications' || collection === 'datasets') ? 'external_citation_count DESC NULLS LAST' : 'rank DESC'
    case 'most-cited-internal':
      return (collection === 'publications' || collection === 'datasets') ? 'internal_citation_count DESC NULLS LAST' : 'rank DESC'
    case 'relevance':
    default:
      return 'rank DESC'
  }
}

export async function search(pool: pg.Pool, opts: SearchOptions): Promise<SearchResponse> {
  const { query, type = '', sortBy = 'relevance', limit = 20, offset = 0 } = opts
  const safeLimit = Math.min(Math.max(1, limit), 100)
  const safeOffset = Math.max(0, offset)

  const searchDocs = !type || type === 'documents'
  const searchPubs = !type || type === 'publications'
  const searchData = !type || type === 'datasets'
  const searchStories = !type || type === 'stories'

  const results: SearchResult[] = []

  if (searchDocs) {
    const { rows } = await pool.query(
      `SELECT id, title,
              ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                ${HEADLINE_OPTS}) as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank,
              date_original
       FROM documents
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBySql(sortBy, 'documents')}
       LIMIT $2 OFFSET $3`,
      [query, safeLimit, safeOffset],
    )
    for (const row of rows) {
      const yearStr = row.date_original ? String(row.date_original).slice(0, 4) : null
      results.push({
        id: row.id, type: 'document', title: row.title,
        snippet: row.snippet || '', rank: parseFloat(row.rank),
        year: yearStr ? parseInt(yearStr) : null, subtype: null,
        meta: [yearStr].filter(Boolean) as string[],
      })
    }
  }

  if (searchPubs) {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.year, p.journal, p.doi, p.publication_type,
              ts_headline('english', coalesce(p.abstract, p.full_text, p.title, ''), plainto_tsquery('english', $1),
                ${HEADLINE_OPTS}) as snippet,
              ts_rank(p.search_vector, plainto_tsquery('english', $1)) as rank,
              coalesce(p.external_citation_count, 0) as external_citation_count,
              (SELECT count(*)::int FROM references_cited r WHERE r.target_publication_id = p.id) as internal_citation_count
       FROM publications p
       WHERE p.search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBySql(sortBy, 'publications')}
       LIMIT $2 OFFSET $3`,
      [query, safeLimit, safeOffset],
    )
    for (const row of rows) {
      results.push({
        id: row.id, type: 'publication', title: row.title,
        snippet: row.snippet || '', rank: parseFloat(row.rank),
        year: row.year || null, subtype: row.publication_type || null,
        meta: [row.journal, row.year ? String(row.year) : '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean),
        externalCitationCount: row.external_citation_count,
        internalCitationCount: row.internal_citation_count,
      })
    }
  }

  if (searchData) {
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.publication_year, d.resource_type,
              ts_headline('english', coalesce(d.full_text, d.title, ''), plainto_tsquery('english', $1),
                ${HEADLINE_OPTS}) as snippet,
              ts_rank(d.search_vector, plainto_tsquery('english', $1)) as rank,
              coalesce(d.external_citation_count, 0) as external_citation_count,
              (SELECT count(*)::int FROM references_cited r WHERE r.target_dataset_id = d.id) as internal_citation_count
       FROM datasets d
       WHERE d.search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBySql(sortBy, 'datasets')}
       LIMIT $2 OFFSET $3`,
      [query, safeLimit, safeOffset],
    )
    for (const row of rows) {
      results.push({
        id: row.id, type: 'dataset', title: row.title,
        snippet: row.snippet || '', rank: parseFloat(row.rank),
        year: row.publication_year || null, subtype: row.resource_type || null,
        meta: [row.publication_year ? String(row.publication_year) : ''].filter(Boolean),
        externalCitationCount: row.external_citation_count,
        internalCitationCount: row.internal_citation_count,
      })
    }
  }

  if (searchStories) {
    const { rows } = await pool.query(
      `SELECT id, title, story_type, author, date,
              ts_headline('english', coalesce(full_text, summary, title, ''), plainto_tsquery('english', $1),
                ${HEADLINE_OPTS}) as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
       FROM stories
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBySql(sortBy, 'stories')}
       LIMIT $2 OFFSET $3`,
      [query, safeLimit, safeOffset],
    )
    for (const row of rows) {
      const yearStr = row.date ? new Date(row.date).getFullYear() : null
      results.push({
        id: row.id, type: 'story', title: row.title,
        snippet: row.snippet || '', rank: parseFloat(row.rank),
        year: yearStr, subtype: row.story_type || null,
        meta: [row.author, yearStr ? String(yearStr) : ''].filter(Boolean) as string[],
      })
    }
  }

  // Cross-collection re-sort: without this, all of one type appears before
  // the next regardless of relevance.
  if (sortBy === 'relevance') results.sort((a, b) => b.rank - a.rank)
  else if (sortBy === 'newest') results.sort((a, b) => (b.year || 0) - (a.year || 0))
  else if (sortBy === 'oldest') results.sort((a, b) => (a.year || 0) - (b.year || 0))
  else if (sortBy === 'title') results.sort((a, b) => a.title.localeCompare(b.title))
  else if (sortBy === 'title-desc') results.sort((a, b) => b.title.localeCompare(a.title))
  else if (sortBy === 'most-cited') results.sort((a, b) => (b.externalCitationCount || 0) - (a.externalCitationCount || 0))
  else if (sortBy === 'most-cited-internal') results.sort((a, b) => (b.internalCitationCount || 0) - (a.internalCitationCount || 0))

  // Count totals (per-collection in parallel)
  let total = 0
  const countQueries: Promise<any>[] = []
  if (searchDocs) countQueries.push(pool.query("SELECT count(*)::int as n FROM documents WHERE search_vector @@ plainto_tsquery('english', $1)", [query]))
  if (searchPubs) countQueries.push(pool.query("SELECT count(*)::int as n FROM publications WHERE search_vector @@ plainto_tsquery('english', $1)", [query]))
  if (searchData) countQueries.push(pool.query("SELECT count(*)::int as n FROM datasets WHERE search_vector @@ plainto_tsquery('english', $1)", [query]))
  if (searchStories) countQueries.push(pool.query("SELECT count(*)::int as n FROM stories WHERE search_vector @@ plainto_tsquery('english', $1)", [query]))
  const counts = await Promise.all(countQueries)
  for (const c of counts) total += c.rows[0].n

  return {
    results: results.slice(0, safeLimit),
    total,
    query,
  }
}
