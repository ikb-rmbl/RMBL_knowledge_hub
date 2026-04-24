import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import { checkRateLimit } from '../../lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = checkRateLimit(request)
  if (rl) return rl
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') || 'json'
  const pool = getDb()

  try {
    const { rows: [author] } = await pool.query(
      'SELECT id, display_name, family_name, given_name, orcid, affiliation, work_count FROM authors WHERE id = $1',
      [id],
    )
    if (!author) return NextResponse.json({ error: 'Author not found' }, { status: 404 })

    const { rows: pubs } = await pool.query(`
      SELECT p.id, p.title, p.year, p.journal, p.publication_type
      FROM authors_rels ar
      JOIN publications p ON p.id = ar.publications_id
      WHERE ar.parent_id = $1 AND ar.path = 'publications'
      ORDER BY p.year DESC NULLS LAST
      LIMIT 50
    `, [id])

    const { rows: datasets } = await pool.query(`
      SELECT d.id, d.title, d.publication_year, d.repository
      FROM authors_rels ar
      JOIN datasets d ON d.id = ar.datasets_id
      WHERE ar.parent_id = $1 AND ar.path = 'datasets'
      ORDER BY d.publication_year DESC NULLS LAST
      LIMIT 20
    `, [id])

    const { rows: coauthors } = await pool.query(`
      SELECT a.id, a.display_name, COUNT(DISTINCT ar2.publications_id) as shared
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id != $1 AND ar2.path = 'publications'
      JOIN authors a ON a.id = ar2.parent_id
      WHERE ar1.parent_id = $1 AND ar1.path = 'publications'
      GROUP BY a.id, a.display_name
      ORDER BY shared DESC
      LIMIT 10
    `, [id])

    const data = { ...author, publications: pubs, datasets, coauthors }

    if (format === 'text') {
      const lines = [
        `Author: ${author.display_name}`,
        `ID: ${author.id}`,
      ]
      if (author.orcid) lines.push(`ORCID: ${author.orcid}`)
      if (author.affiliation) lines.push(`Affiliation: ${author.affiliation}`)
      lines.push(`Works: ${author.work_count}`)
      if (coauthors.length > 0) {
        lines.push(`\nTop co-authors: ${coauthors.map((c: any) => `${c.display_name} (${c.shared} shared)`).join(', ')}`)
      }
      if (pubs.length > 0) {
        lines.push(`\nPublications (${pubs.length}):`)
        for (const p of pubs.slice(0, 20)) {
          lines.push(`  [${p.id}] ${p.title} (${p.year || '?'})${p.journal ? ' — ' + p.journal : ''}`)
        }
        if (pubs.length > 20) lines.push(`  ... and ${pubs.length - 20} more`)
      }
      if (datasets.length > 0) {
        lines.push(`\nDatasets (${datasets.length}):`)
        for (const d of datasets) {
          lines.push(`  [${d.id}] ${d.title} (${d.publication_year || '?'})`)
        }
      }
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('v1 author error:', err)
    return NextResponse.json({ error: 'Failed to fetch author' }, { status: 500 })
  }
}
