import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { getNeighborhood } from '@/services/neighborhoods'
import { neighborhoodToText } from '../../lib/text-format'
import { checkRateLimit } from '../../lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = checkRateLimit(request)
  if (rl) return rl
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') || 'json'

  try {
    const neighborhood = await getNeighborhood(getDb(), parseInt(id))
    if (!neighborhood) {
      return NextResponse.json({ error: 'Neighborhood not found' }, { status: 404 })
    }

    if (format === 'text') {
      return new Response(neighborhoodToText(neighborhood), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    return NextResponse.json({ data: neighborhood })
  } catch (err: any) {
    console.error('v1 neighborhood detail error:', err)
    return NextResponse.json({ error: 'Failed to fetch neighborhood' }, { status: 500 })
  }
}
