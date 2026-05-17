import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../lib/db'
import { listFrontiers } from '@/services/frontiers'
import { frontierListToText } from '../lib/text-format'
import { checkRateLimit } from '../lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(request)
  if (rl) return rl

  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') || 'json'
  const query = searchParams.get('q') || undefined
  const sortRaw = searchParams.get('sort') || 'breadth'
  const sort = (['breadth', 'leverage', 'size', 'title'].includes(sortRaw) ? sortRaw : 'breadth') as 'breadth' | 'leverage' | 'size' | 'title'

  try {
    const { rows, total } = await listFrontiers(getDb(), { query, sort })

    if (format === 'text') {
      return new Response(frontierListToText(rows, total, query), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    return NextResponse.json({ data: rows, meta: { total } })
  } catch (err: any) {
    console.error('v1 frontiers error:', err)
    return NextResponse.json({ error: 'Failed to list frontiers' }, { status: 500 })
  }
}
