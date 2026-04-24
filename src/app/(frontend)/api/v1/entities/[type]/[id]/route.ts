import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../../lib/db'
import { getEntityWithMentions, type EntityType } from '@/services/entities'

export const dynamic = 'force-dynamic'

const VALID_TYPES = new Set(['species', 'concept', 'protocol', 'place', 'stakeholder'])
const NAME_COL: Record<string, string> = {
  species: 'canonical_name', concept: 'name', protocol: 'name', place: 'name', stakeholder: 'name',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: `Invalid entity type: ${type}` }, { status: 400 })
  }

  const format = request.nextUrl.searchParams.get('format') || 'json'

  try {
    const result = await getEntityWithMentions(getDb(), type as EntityType, parseInt(id))
    if (!result) return NextResponse.json({ error: `${type} not found` }, { status: 404 })

    if (format === 'text') {
      const { entity, publications, documents } = result
      const nameCol = NAME_COL[type]
      const lines = [
        `${type}: ${entity[nameCol]}`,
        `ID: ${entity.id}`,
      ]
      if (entity.definition) lines.push(`Definition: ${entity.definition}`)
      if (entity.description) lines.push(`Description: ${entity.description}`)
      if (entity.common_names?.length) lines.push(`Common names: ${entity.common_names.join(', ')}`)
      if (entity.kingdom) lines.push(`Taxonomy: ${[entity.kingdom, entity.phylum, entity.class_name, entity.order_name, entity.family].filter(Boolean).join(' > ')}`)
      if (entity.concept_type) lines.push(`Type: ${entity.concept_type}`)
      if (entity.scope) lines.push(`Scope: ${entity.scope}`)
      if (entity.category) lines.push(`Category: ${entity.category}`)
      if (entity.place_type) lines.push(`Place type: ${entity.place_type}`)
      if (entity.stakeholder_type) lines.push(`Stakeholder type: ${entity.stakeholder_type}`)
      lines.push(`Publications: ${publications.length}`)
      lines.push(`Documents: ${documents.length}`)
      if (publications.length > 0) {
        lines.push('\nPublications:')
        for (const p of publications.slice(0, 20)) {
          lines.push(`  [${p.id}] ${p.title} (${p.year || '?'})${p.journal ? ' — ' + p.journal : ''}`)
        }
        if (publications.length > 20) lines.push(`  ... and ${publications.length - 20} more`)
      }
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: result })
  } catch (err: any) {
    console.error(`v1 entities/${type}/${id} error:`, err)
    return NextResponse.json({ error: 'Failed to fetch entity' }, { status: 500 })
  }
}
