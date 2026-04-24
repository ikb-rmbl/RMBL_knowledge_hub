/**
 * Full-text search API endpoint.
 *
 * Delegates to the search service for tsvector-based search across
 * documents, publications, and datasets.
 *
 * Query params:
 *   q       - search query (required)
 *   type    - filter by collection: documents|publications|datasets
 *   limit   - max results (default 20)
 *   offset  - pagination offset (default 0)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../lib/db'
import { search } from '@/services/search'

export const dynamic = 'force-dynamic'

// Re-export the type for consumers
export type { SearchResult } from '@/services/search'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')?.trim()
  const typeFilter = searchParams.get('type') || ''

  if (!query || query.length > 1000) {
    return NextResponse.json({ results: [], total: 0 })
  }

  const validTypes = ['', 'documents', 'publications', 'datasets', 'stories']
  if (!validTypes.includes(typeFilter)) {
    return NextResponse.json({ results: [], total: 0, error: 'Invalid type filter' }, { status: 400 })
  }

  try {
    const result = await search(getDb(), {
      query,
      type: typeFilter as '' | 'documents' | 'publications' | 'datasets',
      limit: parseInt(searchParams.get('limit') || '20', 10) || 20,
      offset: parseInt(searchParams.get('offset') || '0', 10) || 0,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Search error:', err)
    return NextResponse.json(
      { results: [], total: 0, error: 'Search failed' },
      { status: 500 },
    )
  }
}
