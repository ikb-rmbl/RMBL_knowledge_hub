/**
 * Full-text search API endpoint using PostgreSQL tsvector.
 *
 * Searches across documents, publications, and datasets with weighted
 * ranking (title=A, abstract=B, fullText=C). Returns unified results
 * sorted by relevance with highlighted snippets.
 *
 * Query params:
 *   q       - search query (required)
 *   type    - filter by collection: documents|publications|datasets
 *   limit   - max results (default 20)
 *   offset  - pagination offset (default 0)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getDb } from '../../lib/db'

export const dynamic = 'force-dynamic'

export interface SearchResult {
  id: number
  type: 'document' | 'publication' | 'dataset'
  title: string
  snippet: string
  rank: number
  year: number | null
  subtype: string | null
  meta: string[]
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')?.trim()
  const typeFilter = searchParams.get('type') || ''
  const limitParam = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')

  if (!query) {
    return NextResponse.json({ results: [], total: 0 })
  }

  const db = getDb()
  const results: SearchResult[] = []

  const searchDocs = !typeFilter || typeFilter === 'documents'
  const searchPubs = !typeFilter || typeFilter === 'publications'
  const searchData = !typeFilter || typeFilter === 'datasets'

  try {
    if (searchDocs) {
      const { rows } = await db.query(
        `SELECT id, title,
                ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                  'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>') as snippet,
                ts_rank(search_vector, plainto_tsquery('english', $1)) as rank,
                date_original
         FROM documents
         WHERE search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [query, limitParam, offset],
      )
      for (const row of rows) {
        const yearStr = row.date_original ? String(row.date_original).slice(0, 4) : null
        results.push({
          id: row.id,
          type: 'document',
          title: row.title,
          snippet: row.snippet || '',
          rank: parseFloat(row.rank),
          year: yearStr ? parseInt(yearStr) : null,
          subtype: null,
          meta: [yearStr].filter(Boolean) as string[],
        })
      }
    }

    if (searchPubs) {
      const { rows } = await db.query(
        `SELECT id, title, year, journal, doi, publication_type,
                ts_headline('english', coalesce(abstract, full_text, title, ''), plainto_tsquery('english', $1),
                  'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>') as snippet,
                ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
         FROM publications
         WHERE search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [query, limitParam, offset],
      )
      for (const row of rows) {
        results.push({
          id: row.id,
          type: 'publication',
          title: row.title,
          snippet: row.snippet || '',
          rank: parseFloat(row.rank),
          year: row.year || null,
          subtype: row.publication_type || null,
          meta: [row.journal, row.year ? String(row.year) : '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean),
        })
      }
    }

    if (searchData) {
      const { rows } = await db.query(
        `SELECT id, title, publication_year, resource_type,
                ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                  'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>') as snippet,
                ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
         FROM datasets
         WHERE search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [query, limitParam, offset],
      )
      for (const row of rows) {
        results.push({
          id: row.id,
          type: 'dataset',
          title: row.title,
          snippet: row.snippet || '',
          rank: parseFloat(row.rank),
          year: row.publication_year || null,
          subtype: row.resource_type || null,
          meta: [row.publication_year ? String(row.publication_year) : ''].filter(Boolean),
        })
      }
    }

    // Sort merged results by rank
    results.sort((a, b) => b.rank - a.rank)

    // Count totals
    let total = 0
    if (searchDocs) {
      const { rows } = await db.query('SELECT count(*) FROM documents WHERE search_vector @@ plainto_tsquery(\'english\', $1)', [query])
      total += parseInt(rows[0].count)
    }
    if (searchPubs) {
      const { rows } = await db.query('SELECT count(*) FROM publications WHERE search_vector @@ plainto_tsquery(\'english\', $1)', [query])
      total += parseInt(rows[0].count)
    }
    if (searchData) {
      const { rows } = await db.query('SELECT count(*) FROM datasets WHERE search_vector @@ plainto_tsquery(\'english\', $1)', [query])
      total += parseInt(rows[0].count)
    }

    return NextResponse.json({
      results: results.slice(0, limitParam),
      total,
      query,
    })
  } catch (err: any) {
    console.error('Search error:', err)
    return NextResponse.json(
      { results: [], total: 0, error: err.message },
      { status: 500 },
    )
  }
}
