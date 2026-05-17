/**
 * Frontiers service — synthesized research-gap listings, detail, and link resolution.
 *
 * Frontiers are synthesized from clusters of atomic gap-statements pulled
 * out of the neighborhood primers (see scripts/load-frontiers.ts). They have
 * narrative fields (context, frontier_description, barriers, etc.), structured
 * fields (key_questions, pushing_the_frontier, data_gaps), and links to
 * neighborhoods, entities, and source statements.
 */

import type pg from 'pg'

export interface FrontierSummary {
  id: number
  slug: string
  title: string
  cross_cutting_summary: string | null
  source_cluster_size: number
  source_neighborhoods: number
  avg_management_relevance: number | null
  question_count: number
  action_count: number
}

export interface FrontierDetail {
  id: number
  cluster_id: number
  slug: string
  title: string
  context: string | null
  frontier_description: string | null
  barriers: string | null
  research_opportunities: string | null
  impacts: string | null
  cross_cutting_summary: string | null
  tractability: string | null
  framing_notes: string | null
  key_questions: string[]
  pushing_the_frontier: { category: string; effort: string; action: string }[]
  data_gaps: string[]
  avg_management_relevance: number | null
  source_cluster_size: number
  source_neighborhoods: number
  generated_at: string
  updated_at: string
  // Resolved relationships
  contributing_neighborhoods: { id: number; title: string; statement_count: number }[]
  linked_entities: Record<string, { id: number; name: string; weight: number }[]>
  source_statements: { id: number; neighborhood_id: number; neighborhood_title: string; statement_text: string; management_relevance: number | null }[]
}

export interface ListOptions {
  query?: string
  sort?: 'breadth' | 'leverage' | 'size' | 'title'
  limit?: number
  offset?: number
}

function orderByClause(sort: string): string {
  switch (sort) {
    case 'leverage': return 'avg_management_relevance DESC NULLS LAST, source_neighborhoods DESC NULLS LAST'
    case 'size': return 'source_cluster_size DESC NULLS LAST'
    case 'title': return 'title ASC'
    default: return 'source_neighborhoods DESC NULLS LAST, avg_management_relevance DESC NULLS LAST'
  }
}

export async function listFrontiers(pool: pg.Pool, opts: ListOptions = {}): Promise<{ rows: FrontierSummary[]; total: number }> {
  const { query, sort = 'breadth' } = opts
  const safeLimit = Math.min(opts.limit ?? 200, 500)
  const safeOffset = Math.max(opts.offset ?? 0, 0)

  const where: string[] = []
  const values: any[] = []
  let p = 1
  if (query) {
    where.push(`(title ILIKE $${p} OR cross_cutting_summary ILIKE $${p} OR frontier_description ILIKE $${p} OR context ILIKE $${p})`)
    values.push(`%${query}%`)
    p++
  }
  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    pool.query(
      `SELECT id, slug, title, cross_cutting_summary,
              source_cluster_size, source_neighborhoods, avg_management_relevance,
              jsonb_array_length(coalesce(key_questions, '[]'::jsonb)) AS question_count,
              jsonb_array_length(coalesce(pushing_the_frontier, '[]'::jsonb)) AS action_count
       FROM frontiers ${whereStr}
       ORDER BY ${orderByClause(sort)}
       LIMIT $${p} OFFSET $${p + 1}`,
      [...values, safeLimit, safeOffset],
    ),
    pool.query(`SELECT count(*)::int AS n FROM frontiers ${whereStr}`, values),
  ])
  return { rows, total }
}

export async function getFrontier(pool: pg.Pool, id: number): Promise<FrontierDetail | null> {
  const { rows: [frontier] } = await pool.query('SELECT * FROM frontiers WHERE id = $1', [id])
  if (!frontier) return null

  const [{ rows: nbrRows }, { rows: entityRows }, { rows: stmtRows }] = await Promise.all([
    pool.query(
      `SELECT fn.neighborhood_id AS id, n.title, fn.statement_count
       FROM frontier_neighborhoods fn JOIN neighborhoods n ON n.id = fn.neighborhood_id
       WHERE fn.frontier_id = $1 ORDER BY fn.statement_count DESC, n.title ASC`,
      [id],
    ),
    pool.query(
      `SELECT entity_type, entity_id, weight FROM frontier_entities
       WHERE frontier_id = $1 ORDER BY weight DESC`,
      [id],
    ),
    pool.query(
      `SELECT fss.id, fss.neighborhood_id, n.title AS neighborhood_title,
              fss.statement_text, fss.management_relevance
       FROM frontier_source_statements fss JOIN neighborhoods n ON n.id = fss.neighborhood_id
       WHERE fss.frontier_id = $1 ORDER BY fss.neighborhood_id, fss.id`,
      [id],
    ),
  ])

  // Resolve entity names per type
  const ENTITY_TABLE: Record<string, [string, string]> = {
    concept: ['concepts', 'name'],
    protocol: ['protocols', 'name'],
    species: ['species', 'canonical_name'],
    place: ['places', 'name'],
    stakeholder: ['stakeholders', 'name'],
    author: ['authors', 'display_name'],
    publication: ['publications', 'title'],
    dataset: ['datasets', 'title'],
    document: ['documents', 'title'],
    project: ['projects', 'name'],
  }
  const idsByType: Record<string, number[]> = {}
  const weightById: Record<string, Map<number, number>> = {}
  for (const e of entityRows) {
    (idsByType[e.entity_type] ||= []).push(e.entity_id)
    weightById[e.entity_type] ||= new Map<number, number>()
    weightById[e.entity_type].set(e.entity_id, Number(e.weight))
  }
  const linked_entities: Record<string, { id: number; name: string; weight: number }[]> = {}
  await Promise.all(
    Object.entries(idsByType).map(async ([etype, ids]) => {
      const [table, col] = ENTITY_TABLE[etype] || []
      if (!table) return
      const { rows } = await pool.query(`SELECT id, ${col} AS name FROM ${table} WHERE id = ANY($1)`, [ids])
      linked_entities[etype] = rows
        .map((r: any) => ({ id: r.id, name: r.name, weight: weightById[etype].get(r.id) || 0 }))
        .sort((a, b) => b.weight - a.weight)
    }),
  )

  return {
    ...frontier,
    contributing_neighborhoods: nbrRows,
    linked_entities,
    source_statements: stmtRows,
  }
}
