import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../../lib/db'
import { getRelatedWorks } from '@/services/related'

export const dynamic = 'force-dynamic'

const VALID_COLLECTIONS = new Set(['publications', 'datasets', 'documents'])

export async function GET(request: NextRequest, { params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection, id } = await params
  if (!VALID_COLLECTIONS.has(collection)) {
    return NextResponse.json({ error: `Invalid collection: ${collection}. Valid: publications, datasets, documents` }, { status: 400 })
  }

  const format = request.nextUrl.searchParams.get('format') || 'json'
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '30') || 30, 50)

  try {
    const { initial, expanded } = await getRelatedWorks(
      getDb(),
      collection as 'publications' | 'datasets' | 'documents',
      parseInt(id),
      { limit },
    )

    if (format === 'text') {
      const lines = [`Related works for ${collection} ${id} (${expanded.length} total):\n`]
      for (const r of expanded) {
        const signals = r.signals.join(', ')
        lines.push(`[${r.type}:${r.id}] ${r.title}`)
        lines.push(`  Year: ${r.year || '?'} | Similarity: ${r.similarity.toFixed(2)} | Signals: ${signals}`)
        if (r.sharedEntities) lines.push(`  Shared entities: ${r.sharedEntities}`)
        if (r.coauthors) lines.push(`  Shared authors: ${r.coauthors}`)
        if (r.isCitation) lines.push(`  Citation link: yes`)
        lines.push('')
      }
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: { initial, expanded }, meta: { total: expanded.length } })
  } catch (err: any) {
    console.error(`v1 related/${collection}/${id} error:`, err)
    return NextResponse.json({ error: 'Failed to fetch related works' }, { status: 500 })
  }
}
