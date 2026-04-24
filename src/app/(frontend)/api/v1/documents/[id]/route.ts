import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { getDocument } from '@/services/items'
import { documentToText } from '../../lib/text-format'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') || 'json'

  try {
    const doc = await getDocument(getDb(), parseInt(id))
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    if (format === 'text') {
      let text = documentToText(doc)
      if (doc.entities.length > 0) {
        const groups = new Map<string, string[]>()
        for (const e of doc.entities) {
          if (!groups.has(e.entity_type)) groups.set(e.entity_type, [])
          groups.get(e.entity_type)!.push(e.name)
        }
        for (const [type, names] of groups) text += `\n${type}: ${names.join(', ')}`
      }
      if (doc.stakeholders.length > 0) {
        text += `\nStakeholders: ${doc.stakeholders.map(s => s.name).join(', ')}`
      }
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: doc })
  } catch (err: any) {
    console.error('v1 document error:', err)
    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
  }
}
