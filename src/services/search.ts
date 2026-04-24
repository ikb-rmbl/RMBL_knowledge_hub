/**
 * Search service — full-text search across publications, datasets, and documents.
 *
 * Uses PostgreSQL tsvector with weighted ranking (title=A, abstract=B, fullText=C).
 * Returns unified results sorted by relevance with highlighted snippets.
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
}

export interface SearchOptions {
  query: string
  type?: '' | 'documents' | 'publications' | 'datasets' | 'stories'
  limit?: number
  offset?: number
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

const HEADLINE_OPTS = "'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>'"

export async function search(pool: pg.Pool, opts: SearchOptions): Promise<SearchResponse> {
  const { query, type = '', limit = 20, offset = 0 } = opts
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
       ORDER BY rank DESC
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
      `SELECT id, title, year, journal, doi, publication_type,
              ts_headline('english', coalesce(abstract, full_text, title, ''), plainto_tsquery('english', $1),
                ${HEADLINE_OPTS}) as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
       FROM publications
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2 OFFSET $3`,
      [query, safeLimit, safeOffset],
    )
    for (const row of rows) {
      results.push({
        id: row.id, type: 'publication', title: row.title,
        snippet: row.snippet || '', rank: parseFloat(row.rank),
        year: row.year || null, subtype: row.publication_type || null,
        meta: [row.journal, row.year ? String(row.year) : '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean),
      })
    }
  }

  if (searchData) {
    const { rows } = await pool.query(
      `SELECT id, title, publication_year, resource_type,
              ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                ${HEADLINE_OPTS}) as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
       FROM datasets
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2 OFFSET $3`,
      [query, safeLimit, safeOffset],
    )
    for (const row of rows) {
      results.push({
        id: row.id, type: 'dataset', title: row.title,
        snippet: row.snippet || '', rank: parseFloat(row.rank),
        year: row.publication_year || null, subtype: row.resource_type || null,
        meta: [row.publication_year ? String(row.publication_year) : ''].filter(Boolean),
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
       ORDER BY rank DESC
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

  results.sort((a, b) => b.rank - a.rank)

  // Count totals
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
