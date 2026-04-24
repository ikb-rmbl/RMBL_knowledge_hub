import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../../../lib/db'
import { getPublicationMentions, getDocumentMentions, getCoOccurring, type EntityType } from '@/services/entities'

export const dynamic = 'force-dynamic'

const VALID_TYPES = new Set(['species', 'concept', 'protocol', 'place', 'stakeholder'])

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: `Invalid entity type: ${type}` }, { status: 400 })
  }

  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') || 'json'
  const coType = searchParams.get('co_type') as EntityType | null
  const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 200)
  const pool = getDb()
  const entityType = type as EntityType
  const entityId = parseInt(id)

  try {
    if (coType && VALID_TYPES.has(coType)) {
      // Co-occurring entities
      const rows = await getCoOccurring(pool, entityType, entityId, coType as EntityType, { limit })

      if (format === 'text') {
        const lines = [`${coType} entities co-occurring with ${type} ${id} (${rows.length}):\n`]
        for (const r of rows) lines.push(`  [${r.id}] ${r.name} (${r.shared} shared items)`)
        return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }

      return NextResponse.json({ data: rows, meta: { total: rows.length } })
    }

    // Default: publication + document mentions
    const [publications, documents] = await Promise.all([
      getPublicationMentions(pool, entityType, entityId, { limit }),
      getDocumentMentions(pool, entityType, entityId, { limit }),
    ])

    if (format === 'text') {
      const lines = [`Items mentioning ${type} ${id}:\n`]
      if (publications.length > 0) {
        lines.push(`Publications (${publications.length}):`)
        for (const p of publications.slice(0, 30)) {
          lines.push(`  [${p.id}] ${p.title} (${p.year || '?'})${p.journal ? ' — ' + p.journal : ''}`)
        }
        if (publications.length > 30) lines.push(`  ... and ${publications.length - 30} more`)
      }
      if (documents.length > 0) {
        lines.push(`\nDocuments (${documents.length}):`)
        for (const d of documents.slice(0, 20)) {
          lines.push(`  [${d.id}] ${d.title}`)
        }
        if (documents.length > 20) lines.push(`  ... and ${documents.length - 20} more`)
      }
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: { publications, documents }, meta: { publications: publications.length, documents: documents.length } })
  } catch (err: any) {
    console.error(`v1 entities/${type}/${id}/mentions error:`, err)
    return NextResponse.json({ error: 'Failed to fetch mentions' }, { status: 500 })
  }
}
