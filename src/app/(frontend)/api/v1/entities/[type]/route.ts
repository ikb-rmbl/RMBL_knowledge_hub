import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../../lib/db'
import type { EntityType } from '@/services/entities'

export const dynamic = 'force-dynamic'

const VALID_TYPES = new Set(['species', 'concept', 'protocol', 'place', 'stakeholder'])

const TABLE_MAP: Record<string, { table: string; nameCol: string; orderCol: string }> = {
  species: { table: 'species', nameCol: 'canonical_name', orderCol: 'publication_count' },
  concept: { table: 'concepts', nameCol: 'name', orderCol: 'publication_count' },
  protocol: { table: 'protocols', nameCol: 'name', orderCol: 'publication_count' },
  place: { table: 'places', nameCol: 'name', orderCol: 'publication_count' },
  stakeholder: { table: 'stakeholders', nameCol: 'name', orderCol: 'document_count' },
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: `Invalid entity type: ${type}. Valid: ${[...VALID_TYPES].join(', ')}` }, { status: 400 })
  }

  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') || 'json'
  const query = searchParams.get('q') || ''
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '50') || 50), 200)
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0') || 0)
  const pool = getDb()

  const { table, nameCol, orderCol } = TABLE_MAP[type]

  try {
    const where: string[] = []
    const values: any[] = []
    let paramIdx = 1

    if (query) {
      where.push(`${nameCol} ILIKE $${paramIdx}`)
      values.push(`%${query}%`)
      paramIdx++
    }

    const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
      pool.query(
        `SELECT * FROM ${table} ${whereStr} ORDER BY ${orderCol} DESC NULLS LAST LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT count(*)::int as n FROM ${table} ${whereStr}`,
        values,
      ),
    ])

    if (format === 'text') {
      const lines = [`${type} entities (${total} total, showing ${rows.length}):\n`]
      for (const r of rows) {
        lines.push(`[${r.id}] ${r[nameCol]} (${r[orderCol] || 0} works)`)
      }
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return NextResponse.json({ data: rows, meta: { total, limit, offset } })
  } catch (err: any) {
    console.error(`v1 entities/${type} error:`, err)
    return NextResponse.json({ error: 'Failed to list entities' }, { status: 500 })
  }
}
