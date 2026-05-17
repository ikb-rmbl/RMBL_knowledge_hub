import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { getFrontier } from '@/services/frontiers'
import { frontierToText } from '../../lib/text-format'
import { checkRateLimit } from '../../lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = checkRateLimit(request)
  if (rl) return rl
  const { id } = await params
  const numId = parseInt(id)
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid frontier ID' }, { status: 400 })
  }
  const format = request.nextUrl.searchParams.get('format') || 'json'

  try {
    const frontier = await getFrontier(getDb(), numId)
    if (!frontier) {
      return NextResponse.json({ error: 'Frontier not found' }, { status: 404 })
    }

    if (format === 'text') {
      return new Response(frontierToText(frontier), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    return NextResponse.json({ data: frontier })
  } catch (err: any) {
    console.error('v1 frontier detail error:', err)
    return NextResponse.json({ error: 'Failed to fetch frontier' }, { status: 500 })
  }
}
