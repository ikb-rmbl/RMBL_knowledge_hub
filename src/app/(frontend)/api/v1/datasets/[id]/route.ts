import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { getDataset } from '@/services/items'
import { datasetToText } from '../../lib/text-format'
import { checkRateLimit } from '../../lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = checkRateLimit(request)
  if (rl) return rl
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') || 'json'

  try {
    const ds = await getDataset(getDb(), parseInt(id))
    if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

    if (format === 'text') {
      let text = datasetToText(ds)
      if (ds.creators.length > 0) text += `\nCreators: ${ds.creators.map(c => c.display_name).join('; ')}`
      if (ds.entities.length > 0) {
        const groups = new Map<string, string[]>()
        for (const e of ds.entities) {
          if (!groups.has(e.entity_type)) groups.set(e.entity_type, [])
          groups.get(e.entity_type)!.push(e.name)
        }
        for (const [type, names] of groups) text += `\n${type}: ${names.join(', ')}`
      }
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: ds })
  } catch (err: any) {
    console.error('v1 dataset error:', err)
    return NextResponse.json({ error: 'Failed to fetch dataset' }, { status: 500 })
  }
}
