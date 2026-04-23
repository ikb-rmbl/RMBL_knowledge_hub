import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../lib/db'
import { search } from '@/services/search'
import { searchResultsToText } from '../lib/text-format'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')?.trim()
  const format = searchParams.get('format') || 'json'

  if (!query || query.length > 1000) {
    return format === 'text'
      ? new Response('No query provided.', { headers: { 'Content-Type': 'text/plain' } })
      : NextResponse.json({ data: { results: [], total: 0 }, meta: {} })
  }

  const validTypes = ['', 'documents', 'publications', 'datasets']
  const typeFilter = searchParams.get('type') || ''
  if (!validTypes.includes(typeFilter)) {
    return NextResponse.json({ error: 'Invalid type filter' }, { status: 400 })
  }

  try {
    const result = await search(getDb(), {
      query,
      type: typeFilter as '' | 'documents' | 'publications' | 'datasets',
      limit: parseInt(searchParams.get('limit') || '20', 10) || 20,
      offset: parseInt(searchParams.get('offset') || '0', 10) || 0,
    })

    if (format === 'text') {
      return new Response(searchResultsToText(result.results, result.total, result.query), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    return NextResponse.json({ data: result, meta: { total: result.total } })
  } catch (err: any) {
    console.error('v1 search error:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
