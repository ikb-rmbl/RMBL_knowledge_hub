import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { getPublication, getCitations } from '@/services/items'
import { publicationToText } from '../../lib/text-format'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') || 'json'
  const pool = getDb()

  try {
    const pub = await getPublication(pool, parseInt(id))
    if (!pub) return NextResponse.json({ error: 'Publication not found' }, { status: 404 })

    const citations = await getCitations(pool, pub.id)

    if (format === 'text') {
      let text = publicationToText(pub, pub.authors, citations)
      if (pub.entities.length > 0) {
        const groups = new Map<string, string[]>()
        for (const e of pub.entities) {
          if (!groups.has(e.entity_type)) groups.set(e.entity_type, [])
          groups.get(e.entity_type)!.push(e.name)
        }
        for (const [type, names] of groups) text += `\n${type}: ${names.join(', ')}`
      }
      if (citations.citedBy.length > 0) text += `\nCited by: ${citations.citedBy.length} publications`
      if (citations.references.length > 0) text += `\nReferences: ${citations.references.length} internal`
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: { ...pub, citations } })
  } catch (err: any) {
    console.error('v1 publication error:', err)
    return NextResponse.json({ error: 'Failed to fetch publication' }, { status: 500 })
  }
}
