import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../lib/db'
import { listNeighborhoods } from '@/services/neighborhoods'
import { neighborhoodListToText } from '../lib/text-format'
import { checkRateLimit } from '../lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(request)
  if (rl) return rl

  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') || 'json'

  try {
    const { rows, total } = await listNeighborhoods(getDb(), {
      query: searchParams.get('q') || undefined,
      type: searchParams.get('type') || undefined,
      sort: (searchParams.get('sort') as 'size' | 'title') || 'size',
    })

    if (format === 'text') {
      return new Response(neighborhoodListToText(rows), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    return NextResponse.json({ data: rows, meta: { total } })
  } catch (err: any) {
    console.error('v1 neighborhoods error:', err)
    return NextResponse.json({ error: 'Failed to list neighborhoods' }, { status: 500 })
  }
}
