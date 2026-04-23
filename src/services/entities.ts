/**
 * Entity service — lookup, mentions, and co-occurrence for species, concepts,
 * protocols, places, and stakeholders.
 *
 * Centralizes the repeated entity_mentions query patterns shared across
 * species/[id], concepts/[id], protocols/[id], and places/[id] pages.
 */

import type pg from 'pg'

export type EntityType = 'species' | 'concept' | 'protocol' | 'place' | 'stakeholder'

const TABLE_MAP: Record<EntityType, string> = {
  species: 'species',
  concept: 'concepts',
  protocol: 'protocols',
  place: 'places',
  stakeholder: 'stakeholders',
}

const NAME_COL: Record<EntityType, string> = {
  species: 'canonical_name',
  concept: 'name',
  protocol: 'name',
  place: 'name',
  stakeholder: 'name',
}

/**
 * Fetch a single entity by type and ID.
 */
export async function getEntity(pool: pg.Pool, entityType: EntityType, id: number): Promise<any | null> {
  const table = TABLE_MAP[entityType]
  if (!table) return null
  const { rows: [row] } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
  return row || null
}

/**
 * Publications mentioning an entity.
 */
export async function getPublicationMentions(
  pool: pg.Pool, entityType: EntityType, entityId: number, opts: { limit?: number } = {},
): Promise<any[]> {
  const { limit = 200 } = opts
  const { rows } = await pool.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type, p.doi, em.role
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = $1 AND em.entity_id = $2 AND em.collection = 'publications'
    ORDER BY p.year DESC NULLS LAST, p.title
    LIMIT $3
  `, [entityType, entityId, limit])
  return rows
}

/**
 * Documents mentioning an entity.
 */
export async function getDocumentMentions(
  pool: pg.Pool, entityType: EntityType, entityId: number, opts: { limit?: number } = {},
): Promise<any[]> {
  const { limit = 200 } = opts
  const { rows } = await pool.query(`
    SELECT d.id, d.title, d.document_type
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = $1 AND em.entity_id = $2 AND em.collection = 'documents'
    ORDER BY d.title
    LIMIT $3
  `, [entityType, entityId, limit])
  return rows
}

/**
 * Co-occurring entities — other entities that appear in the same items.
 */
export async function getCoOccurring(
  pool: pg.Pool,
  entityType: EntityType,
  entityId: number,
  targetType: EntityType,
  opts: { limit?: number } = {},
): Promise<any[]> {
  const { limit = 10 } = opts
  const targetTable = TABLE_MAP[targetType]
  const nameCol = NAME_COL[targetType]
  if (!targetTable || !nameCol) return []

  // Build select columns based on target type
  const extraCols = targetType === 'species'
    ? ', t.family'
    : targetType === 'concept'
    ? ', t.concept_type'
    : targetType === 'protocol'
    ? ', t.category'
    : targetType === 'place'
    ? ', t.place_type'
    : targetType === 'stakeholder'
    ? ', t.stakeholder_type'
    : ''

  const { rows } = await pool.query(`
    SELECT t.id, t.${nameCol} as name, COUNT(*) as shared${extraCols}
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = $3 AND em2.entity_id != CASE WHEN $1 = $3 THEN $2 ELSE -1 END
    JOIN ${targetTable} t ON t.id = em2.entity_id
    WHERE em1.entity_type = $1 AND em1.entity_id = $2
    GROUP BY t.id, t.${nameCol}${extraCols}
    ORDER BY shared DESC
    LIMIT $4
  `, [entityType, entityId, targetType, limit])
  return rows
}

/**
 * Get all mentions (publications + documents) with counts, for API responses.
 */
export async function getEntityWithMentions(
  pool: pg.Pool, entityType: EntityType, entityId: number,
): Promise<{ entity: any; publications: any[]; documents: any[] } | null> {
  const entity = await getEntity(pool, entityType, entityId)
  if (!entity) return null

  const [publications, documents] = await Promise.all([
    getPublicationMentions(pool, entityType, entityId),
    getDocumentMentions(pool, entityType, entityId),
  ])

  return { entity, publications, documents }
}
