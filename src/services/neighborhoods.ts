/**
 * Neighborhoods service — community listing, detail, and primer access.
 */

import type pg from 'pg'

export interface NeighborhoodSummary {
  id: number
  title: string
  summary: string | null
  size: number
  type_counts: Record<string, number>
  top_by_type: Record<string, any[]>
  themes: string[]
  primer_type: string | null
}

export interface NeighborhoodDetail extends NeighborhoodSummary {
  community_id: number
  primer: string | null
  primer_generated_at: string | null
  primer_citations: any[]
  members: Record<string, any[]>
}

export interface ListOptions {
  query?: string
  type?: string
  sort?: 'size' | 'title'
  limit?: number
  offset?: number
}

export async function listNeighborhoods(pool: pg.Pool, opts: ListOptions = {}): Promise<{ rows: any[]; total: number }> {
  const { query, type, sort = 'size' } = opts

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (query) {
    where.push(`(n.title ILIKE $${paramIdx} OR n.summary ILIKE $${paramIdx} OR n.label ILIKE $${paramIdx} OR $${paramIdx} ILIKE ANY(n.themes))`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (type) {
    where.push(`n.id IN (SELECT DISTINCT neighborhood_id FROM neighborhood_members WHERE entity_type = $${paramIdx})`)
    values.push(type)
    paramIdx++
  }

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const orderBy = sort === 'title' ? 'n.title ASC' : 'n.size DESC'

  const { rows } = await pool.query(
    `SELECT n.* FROM neighborhoods n ${whereStr} ORDER BY ${orderBy}`,
    values,
  )

  return { rows, total: rows.length }
}

export async function getNeighborhood(pool: pg.Pool, id: number): Promise<NeighborhoodDetail | null> {
  const { rows: [neighborhood] } = await pool.query('SELECT * FROM neighborhoods WHERE id = $1', [id])
  if (!neighborhood) return null

  // Fetch members grouped by type
  const { rows: members } = await pool.query(`
    SELECT nm.entity_id, nm.entity_type, nm.label, nm.degree
    FROM neighborhood_members nm
    WHERE nm.neighborhood_id = $1
    ORDER BY nm.degree DESC
  `, [id])

  const membersByType: Record<string, any[]> = {}
  for (const m of members) {
    if (!membersByType[m.entity_type]) membersByType[m.entity_type] = []
    membersByType[m.entity_type].push(m)
  }

  return {
    ...neighborhood,
    members: membersByType,
  }
}

export async function getNeighborhoodPrimer(pool: pg.Pool, id: number): Promise<{ primer: string | null; primer_type: string | null; title: string } | null> {
  const { rows: [row] } = await pool.query(
    'SELECT title, primer, primer_type FROM neighborhoods WHERE id = $1',
    [id],
  )
  return row || null
}
