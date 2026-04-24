/**
 * Items service — publication, dataset, and document detail with authors,
 * entities, and citations.
 */

import type pg from 'pg'

export interface PublicationDetail {
  id: number
  title: string
  year: number | null
  journal: string | null
  doi: string | null
  abstract: string | null
  publication_type: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  data_source: string | null
  external_citation_count: number | null
  pdf_link: string | null
  external_url: string | null
  authors: { id: number; display_name: string; family_name: string; given_name: string; orcid: string | null; order: number }[]
  keywords: string[]
  entities: { entity_type: string; entity_id: number; name: string; role: string | null }[]
}

export async function getPublication(pool: pg.Pool, id: number): Promise<PublicationDetail | null> {
  const { rows: [pub] } = await pool.query(
    `SELECT id, title, year, journal, doi, abstract, publication_type,
            volume, issue, pages, data_source, external_citation_count, pdf_link, external_url
     FROM publications WHERE id = $1`,
    [id],
  )
  if (!pub) return null

  const [{ rows: authors }, { rows: keywords }, { rows: entities }] = await Promise.all([
    pool.query(`
      SELECT a.id, a.display_name, a.family_name, a.given_name, a.orcid, ar."order"
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
      WHERE ar.publications_id = $1 AND ar.path = 'publications'
      ORDER BY ar."order" NULLS LAST
    `, [id]),
    pool.query(`
      SELECT keyword FROM publications_keywords WHERE _parent_id = $1 ORDER BY _order
    `, [id]),
    pool.query(`
      SELECT entity_type, entity_id, role,
        CASE entity_type
          WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = entity_id)
          WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = entity_id)
          WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = entity_id)
          WHEN 'place' THEN (SELECT name FROM places WHERE id = entity_id)
          WHEN 'stakeholder' THEN (SELECT name FROM stakeholders WHERE id = entity_id)
        END as name
      FROM entity_mentions
      WHERE collection = 'publications' AND item_id = $1
      ORDER BY entity_type
    `, [id]),
  ])

  return {
    ...pub,
    authors,
    keywords: keywords.map((k: any) => k.keyword).filter(Boolean),
    entities: entities.filter((e: any) => e.name),
  }
}

export interface DatasetDetail {
  id: number
  title: string
  doi: string | null
  description: string | null
  repository: string | null
  publication_year: number | null
  resource_type: string | null
  temporal_extent_start: string | null
  temporal_extent_end: string | null
  external_citation_count: number | null
  creators: { id: number; display_name: string }[]
  entities: { entity_type: string; entity_id: number; name: string }[]
}

export async function getDataset(pool: pg.Pool, id: number): Promise<DatasetDetail | null> {
  const { rows: [ds] } = await pool.query(
    `SELECT id, title, doi, description, repository, publication_year, resource_type,
            temporal_extent_start, temporal_extent_end, external_citation_count
     FROM datasets WHERE id = $1`,
    [id],
  )
  if (!ds) return null

  const [{ rows: creators }, { rows: entities }] = await Promise.all([
    pool.query(`
      SELECT a.id, a.display_name
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
      WHERE ar.datasets_id = $1 AND ar.path = 'datasets'
      ORDER BY ar."order" NULLS LAST
    `, [id]),
    pool.query(`
      SELECT entity_type, entity_id,
        CASE entity_type
          WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = entity_id)
          WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = entity_id)
          WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = entity_id)
          WHEN 'place' THEN (SELECT name FROM places WHERE id = entity_id)
        END as name
      FROM entity_mentions
      WHERE collection = 'datasets' AND item_id = $1
      ORDER BY entity_type
    `, [id]),
  ])

  return {
    ...ds,
    creators,
    entities: entities.filter((e: any) => e.name),
  }
}

export interface DocumentDetail {
  id: number
  title: string
  summary: string | null
  document_type: string | null
  date_original: string | null
  entities: { entity_type: string; entity_id: number; name: string }[]
  stakeholders: { id: number; name: string; stakeholder_type: string | null }[]
}

export async function getDocument(pool: pg.Pool, id: number): Promise<DocumentDetail | null> {
  const { rows: [doc] } = await pool.query(
    `SELECT id, title, summary::text as summary, document_type, date_original
     FROM documents WHERE id = $1`,
    [id],
  )
  if (!doc) return null

  const [{ rows: entities }, { rows: stakeholders }] = await Promise.all([
    pool.query(`
      SELECT entity_type, entity_id,
        CASE entity_type
          WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = entity_id)
          WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = entity_id)
          WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = entity_id)
          WHEN 'place' THEN (SELECT name FROM places WHERE id = entity_id)
        END as name
      FROM entity_mentions
      WHERE collection = 'documents' AND item_id = $1
        AND entity_type != 'stakeholder'
      ORDER BY entity_type
    `, [id]),
    pool.query(`
      SELECT s.id, s.name, s.stakeholder_type
      FROM entity_mentions em
      JOIN stakeholders s ON s.id = em.entity_id
      WHERE em.collection = 'documents' AND em.item_id = $1 AND em.entity_type = 'stakeholder'
      ORDER BY s.name
    `, [id]),
  ])

  return {
    ...doc,
    entities: entities.filter((e: any) => e.name),
    stakeholders,
  }
}

/**
 * Citations for a publication: cited-by and references.
 */
export async function getCitations(pool: pg.Pool, pubId: number): Promise<{
  citedBy: any[]
  references: any[]
  externalReferences: any[]
}> {
  const [{ rows: citedBy }, { rows: references }, { rows: externalReferences }] = await Promise.all([
    pool.query(`
      SELECT p.id, p.title, p.year, p.journal
      FROM references_cited r
      JOIN publications p ON p.id = r.source_publication_id
      WHERE r.target_publication_id = $1
      ORDER BY p.year DESC NULLS LAST
    `, [pubId]),
    pool.query(`
      SELECT p.id, p.title, p.year, p.journal
      FROM references_cited r
      JOIN publications p ON p.id = r.target_publication_id
      WHERE r.source_publication_id = $1 AND r.target_publication_id IS NOT NULL
      ORDER BY p.year DESC NULLS LAST
    `, [pubId]),
    pool.query(`
      SELECT raw_reference, doi, link_type
      FROM references_cited
      WHERE source_publication_id = $1 AND target_publication_id IS NULL
      ORDER BY raw_reference
      LIMIT 50
    `, [pubId]),
  ])

  return { citedBy, references, externalReferences }
}
