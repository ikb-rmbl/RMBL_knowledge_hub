import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { publicationToText } from '../../lib/text-format'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') || 'json'
  const db = getDb()

  try {
    const { rows: [pub] } = await db.query(
      `SELECT id, title, year, journal, doi, abstract, publication_type,
              data_source, external_citation_count
       FROM publications WHERE id = $1`,
      [id],
    )
    if (!pub) return NextResponse.json({ error: 'Publication not found' }, { status: 404 })

    const { rows: authors } = await db.query(`
      SELECT a.id, a.display_name, a.family_name, a.given_name, a.orcid, ar."order"
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
      WHERE ar.publications_id = $1 AND ar.path = 'publications'
      ORDER BY ar."order" NULLS LAST
    `, [id])

    const { rows: entities } = await db.query(`
      SELECT entity_type, entity_id,
        CASE entity_type
          WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = entity_id)
          WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = entity_id)
          WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = entity_id)
          WHEN 'place' THEN (SELECT name FROM places WHERE id = entity_id)
        END as name
      FROM entity_mentions
      WHERE collection = 'publications' AND item_id = $1
      ORDER BY entity_type, entity_id
    `, [id])

    const data = {
      ...pub,
      authors,
      entities: entities.filter((e: any) => e.name),
    }

    if (format === 'text') {
      let text = publicationToText(pub, authors)
      const entityGroups = new Map<string, string[]>()
      for (const e of entities) {
        if (!e.name) continue
        if (!entityGroups.has(e.entity_type)) entityGroups.set(e.entity_type, [])
        entityGroups.get(e.entity_type)!.push(e.name)
      }
      for (const [type, names] of entityGroups) {
        text += `\n${type}: ${names.join(', ')}`
      }
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('v1 publication error:', err)
    return NextResponse.json({ error: 'Failed to fetch publication' }, { status: 500 })
  }
}
