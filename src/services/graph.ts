/**
 * Graph service — entity neighborhood, item network, and author network queries.
 *
 * Pure functions taking pg.Pool — no React, no HTTP.
 */

import type pg from 'pg'

/**
 * SQL filter for entity types to include in graph visualizations.
 * Includes places only at local/site scale (excludes countries, states, generic regions).
 */
/**
 * SQL filter for entity types to include in graph visualizations.
 * Includes places only at local/site scale (excludes countries, states, generic regions).
 * Use GRAPH_ENTITY_FILTER with `em.` alias, GRAPH_ENTITY_FILTER_BARE without.
 */
const GRAPH_ENTITY_FILTER = `(
  em.entity_type IN ('species', 'concept', 'protocol', 'stakeholder')
  OR (em.entity_type = 'place' AND em.entity_id IN (
    SELECT id FROM places WHERE (scale IS NULL OR scale IN ('site', 'local'))
      AND (place_type IS NULL OR place_type NOT IN ('country', 'state', 'region'))
  ))
)`

const GRAPH_ENTITY_FILTER_BARE = `(
  entity_type IN ('species', 'concept', 'protocol', 'stakeholder')
  OR (entity_type = 'place' AND entity_id IN (
    SELECT id FROM places WHERE (scale IS NULL OR scale IN ('site', 'local'))
      AND (place_type IS NULL OR place_type NOT IN ('country', 'state', 'region'))
  ))
)`

export interface GraphNode {
  id: string
  label: string
  type: string
  degree: number
  isFocal: boolean
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
}

export interface NeighborhoodData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  focalId: string
}

/**
 * Fetch the egocentric neighborhood of an entity — all entities that
 * co-occur with it in publications or datasets, ranked by co-occurrence weight.
 */
export async function fetchNeighborhood(
  pool: pg.Pool,
  entityType: string,
  entityId: number,
  limit: number = 30,
): Promise<NeighborhoodData> {
  const db = pool
  const focalId = `${entityType}-${entityId}`

  // Get focal entity name and degree
  const nameQuery = entityType === 'species'
    ? 'SELECT canonical_name as name, publication_count as degree FROM species WHERE id = $1'
    : entityType === 'place'
    ? 'SELECT name, publication_count as degree FROM places WHERE id = $1'
    : entityType === 'protocol'
    ? 'SELECT name, publication_count as degree FROM protocols WHERE id = $1'
    : 'SELECT name, publication_count as degree FROM concepts WHERE id = $1'

  const { rows: [focal] } = await db.query(nameQuery, [entityId])
  if (!focal) return { nodes: [], edges: [], focalId }

  // Find neighbors via co-occurrence in entity_mentions
  const { rows: neighbors } = await db.query(`
    WITH focal_items AS (
      SELECT DISTINCT collection, item_id
      FROM entity_mentions
      WHERE entity_type = $1 AND entity_id = $2
    ),
    neighbors AS (
      SELECT em.entity_type, em.entity_id,
        COUNT(DISTINCT (em.collection || ':' || em.item_id)) as weight
      FROM entity_mentions em
      JOIN focal_items fi ON fi.collection = em.collection AND fi.item_id = em.item_id
      WHERE NOT (em.entity_type = $1 AND em.entity_id = $2)
        AND ${GRAPH_ENTITY_FILTER}
      GROUP BY em.entity_type, em.entity_id
      ORDER BY weight DESC
      LIMIT $3
    )
    SELECT n.entity_type, n.entity_id, n.weight,
      CASE n.entity_type
        WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = n.entity_id)
        WHEN 'place' THEN (SELECT name FROM places WHERE id = n.entity_id)
        WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = n.entity_id)
        WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = n.entity_id)
        WHEN 'stakeholder' THEN (SELECT name FROM stakeholders WHERE id = n.entity_id)
      END as name,
      CASE n.entity_type
        WHEN 'species' THEN (SELECT publication_count FROM species WHERE id = n.entity_id)
        WHEN 'place' THEN (SELECT publication_count FROM places WHERE id = n.entity_id)
        WHEN 'protocol' THEN (SELECT publication_count FROM protocols WHERE id = n.entity_id)
        WHEN 'concept' THEN (SELECT publication_count FROM concepts WHERE id = n.entity_id)
        WHEN 'stakeholder' THEN (SELECT document_count FROM stakeholders WHERE id = n.entity_id)
      END as degree
    FROM neighbors n
  `, [entityType, entityId, limit])

  // Build nodes (dedup by ID)
  const nodes: GraphNode[] = [
    { id: focalId, label: focal.name, type: entityType, degree: focal.degree || 0, isFocal: true },
  ]
  const nodeIds = new Set<string>([focalId])
  const edges: GraphEdge[] = []
  const edgeKeys = new Set<string>()

  function addEdge(source: string, target: string, weight: number) {
    const k1 = `${source}--${target}`
    const k2 = `${target}--${source}`
    if (!edgeKeys.has(k1) && !edgeKeys.has(k2)) {
      edges.push({ source, target, weight })
      edgeKeys.add(k1)
    }
  }

  for (const n of neighbors) {
    if (!n.name) continue
    const nid = `${n.entity_type}-${n.entity_id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: n.name, type: n.entity_type, degree: parseInt(n.degree) || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, parseInt(n.weight))
  }

  // Add inter-neighbor edges (co-occurrence between neighbors, capped)
  const neighborIds = neighbors.filter((n: any) => n.name).map((n: any) => `${n.entity_type}:${n.entity_id}`)
  if (neighborIds.length > 1 && neighborIds.length <= 50) {
    const { rows: interEdges } = await db.query(`
      WITH neighbor_set AS (
        SELECT unnest($1::text[]) as key
      ),
      parsed AS (
        SELECT split_part(key, ':', 1) as etype, split_part(key, ':', 2)::int as eid
        FROM neighbor_set
      ),
      neighbor_items AS (
        SELECT em.entity_type, em.entity_id, em.collection, em.item_id
        FROM entity_mentions em
        JOIN parsed p ON p.etype = em.entity_type AND p.eid = em.entity_id
      )
      SELECT a.entity_type || '-' || a.entity_id as source,
             b.entity_type || '-' || b.entity_id as target,
             COUNT(DISTINCT (a.collection || ':' || a.item_id)) as weight
      FROM neighbor_items a
      JOIN neighbor_items b ON a.collection = b.collection AND a.item_id = b.item_id
        AND (a.entity_type > b.entity_type OR (a.entity_type = b.entity_type AND a.entity_id > b.entity_id))
      GROUP BY a.entity_type, a.entity_id, b.entity_type, b.entity_id
      HAVING COUNT(DISTINCT (a.collection || ':' || a.item_id)) >= 3
      ORDER BY weight DESC
      LIMIT 50
    `, [neighborIds])

    for (const e of interEdges) {
      addEdge(e.source, e.target, parseInt(e.weight))
    }
  }

  // Top publications mentioning this entity
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, coalesce(p.external_citation_count, 0) as cite_count
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = $1 AND em.entity_id = $2 AND em.collection = 'publications'
    ORDER BY p.external_citation_count DESC NULLS LAST
    LIMIT 5
  `, [entityType, entityId])

  for (const p of pubs) {
    const nid = `publications-${p.id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: p.title.slice(0, 50), type: 'publication', degree: p.cite_count || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, 1)
  }

  // Top datasets mentioning this entity
  const { rows: dsets } = await db.query(`
    SELECT d.id, d.title, coalesce(d.external_citation_count, 0) as cite_count
    FROM entity_mentions em
    JOIN datasets d ON d.id = em.item_id
    WHERE em.entity_type = $1 AND em.entity_id = $2 AND em.collection = 'datasets'
    ORDER BY d.external_citation_count DESC NULLS LAST
    LIMIT 5
  `, [entityType, entityId])

  for (const d of dsets) {
    const nid = `datasets-${d.id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: (d.title || '').slice(0, 50), type: 'dataset', degree: d.cite_count || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, 1)
  }

  // Top documents mentioning this entity
  const { rows: docs } = await db.query(`
    SELECT d.id, d.title
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = $1 AND em.entity_id = $2 AND em.collection = 'documents'
    ORDER BY d.date_original DESC NULLS LAST
    LIMIT 5
  `, [entityType, entityId])

  for (const d of docs) {
    const nid = `documents-${d.id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: (d.title || '').slice(0, 50), type: 'document', degree: 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, 1)
  }

  // Top authors across all displayed works (publications + datasets + documents)
  const pubIds: number[] = pubs.map((p: any) => p.id)
  const dsIds: number[] = dsets.map((d: any) => d.id)
  const docIds: number[] = docs.map((d: any) => d.id)

  if (pubIds.length + dsIds.length + docIds.length > 0) {
    const { rows: authors } = await db.query(`
      WITH work_authors AS (
        SELECT parent_id AS author_id FROM authors_rels WHERE publications_id = ANY($1) AND path = 'publications'
        UNION ALL
        SELECT parent_id FROM authors_rels WHERE datasets_id = ANY($2) AND path = 'datasets'
        UNION ALL
        SELECT parent_id FROM authors_rels WHERE documents_id = ANY($3) AND path = 'documents'
      )
      SELECT a.id, a.display_name, COUNT(*) AS shared
      FROM work_authors wa JOIN authors a ON a.id = wa.author_id
      GROUP BY a.id, a.display_name
      ORDER BY shared DESC
      LIMIT 5
    `, [pubIds, dsIds, docIds])

    for (const a of authors) {
      const nid = `author-${a.id}`
      if (!nodeIds.has(nid)) {
        nodes.push({ id: nid, label: a.display_name, type: 'author', degree: parseInt(a.shared), isFocal: false })
        nodeIds.add(nid)
      }
      addEdge(focalId, nid, parseInt(a.shared))
    }

    // Author ↔ work links across all 3 collections
    const authorIds = authors.map((a: any) => a.id)
    if (authorIds.length > 0) {
      const COLL_FIELDS: Record<string, [string, number[]]> = {
        publications: ['publications_id', pubIds],
        datasets: ['datasets_id', dsIds],
        documents: ['documents_id', docIds],
      }
      for (const [coll, [field, ids]] of Object.entries(COLL_FIELDS)) {
        if (ids.length === 0) continue
        const { rows } = await db.query(`
          SELECT parent_id AS author_id, ${field} AS work_id
          FROM authors_rels
          WHERE parent_id = ANY($1) AND ${field} = ANY($2) AND path = $3
        `, [authorIds, ids, coll])
        for (const l of rows) addEdge(`author-${l.author_id}`, `${coll}-${l.work_id}`, 1)
      }
    }

    // Entity neighbor ↔ work links across all 3 collections
    const entityNodeIds = [...nodeIds].filter((nid) =>
      (nid.startsWith('species-') || nid.startsWith('protocol-') || nid.startsWith('concept-') || nid.startsWith('place-') || nid.startsWith('stakeholder-')) && nid !== focalId
    )
    if (entityNodeIds.length > 0) {
      const entitySet = new Set(entityNodeIds)
      const COLL_IDS: Record<string, number[]> = {
        publications: pubIds, datasets: dsIds, documents: docIds,
      }
      for (const [coll, ids] of Object.entries(COLL_IDS)) {
        if (ids.length === 0) continue
        const { rows: epLinks } = await db.query(`
          SELECT entity_type, entity_id, item_id
          FROM entity_mentions
          WHERE collection = $1 AND item_id = ANY($2) AND ${GRAPH_ENTITY_FILTER_BARE}
        `, [coll, ids])
        for (const e of epLinks) {
          const enid = `${e.entity_type}-${e.entity_id}`
          if (entitySet.has(enid)) addEdge(enid, `${coll}-${e.item_id}`, 1)
        }
      }
    }
  }

  return { nodes, edges, focalId }
}

/**
 * Fetch the entity network for a collection item (publication, dataset, document).
 * Returns all entities linked to that item plus co-occurrence edges between them.
 */
export async function fetchItemNetwork(
  pool: pg.Pool,
  collection: string,
  itemId: number,
  itemTitle: string,
  limit: number = 30,
): Promise<NeighborhoodData> {
  const db = pool
  const focalId = `${collection}-${itemId}`

  // Get all entities linked to this item (deduped)
  const { rows: entities } = await db.query(`
    SELECT entity_type, entity_id, name, degree FROM (
      SELECT DISTINCT ON (em.entity_type, em.entity_id) em.entity_type, em.entity_id,
        CASE em.entity_type
          WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = em.entity_id)
          WHEN 'place' THEN (SELECT name FROM places WHERE id = em.entity_id)
          WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = em.entity_id)
          WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = em.entity_id)
          WHEN 'stakeholder' THEN (SELECT name FROM stakeholders WHERE id = em.entity_id)
        END as name,
        CASE em.entity_type
          WHEN 'species' THEN (SELECT publication_count FROM species WHERE id = em.entity_id)
          WHEN 'place' THEN (SELECT publication_count FROM places WHERE id = em.entity_id)
          WHEN 'protocol' THEN (SELECT publication_count FROM protocols WHERE id = em.entity_id)
          WHEN 'concept' THEN (SELECT publication_count FROM concepts WHERE id = em.entity_id)
          WHEN 'stakeholder' THEN (SELECT document_count FROM stakeholders WHERE id = em.entity_id)
        END as degree
      FROM entity_mentions em
      WHERE em.collection = $1 AND em.item_id = $2
        AND ${GRAPH_ENTITY_FILTER}
      ORDER BY em.entity_type, em.entity_id
    ) sub
    ORDER BY degree DESC NULLS LAST
    LIMIT $3
  `, [collection, itemId, limit])

  // Build nodes and edges
  const nodes: GraphNode[] = [
    { id: focalId, label: itemTitle.slice(0, 50), type: collection === 'publications' ? 'publication' : collection === 'datasets' ? 'dataset' : collection === 'stories' ? 'story' : 'document', degree: 0, isFocal: true },
  ]
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>([focalId])
  const edgeKeys = new Set<string>()

  function addEdge(source: string, target: string, weight: number) {
    const k1 = `${source}--${target}`
    const k2 = `${target}--${source}`
    if (!edgeKeys.has(k1) && !edgeKeys.has(k2)) {
      edges.push({ source, target, weight })
      edgeKeys.add(k1)
    }
  }

  // Entity nodes
  for (const e of entities) {
    if (!e.name) continue
    const nid = `${e.entity_type}-${e.entity_id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: e.name, type: e.entity_type, degree: parseInt(e.degree) || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, 1)
  }

  // Co-authors: other authors on this publication/dataset/document (top 8 by work count)
  const COAUTHOR_FIELDS: Record<string, string> = {
    publications: 'publications_id',
    datasets: 'datasets_id',
    documents: 'documents_id',
  }
  if (collection in COAUTHOR_FIELDS) {
    const collField = COAUTHOR_FIELDS[collection]
    const { rows: coauthors } = await db.query(`
      SELECT DISTINCT a.id, a.display_name, a.work_count
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.${collField} = ar1.${collField} AND ar2.parent_id != ar1.parent_id AND ar2.path = ar1.path
      JOIN authors a ON a.id = ar2.parent_id
      WHERE ar1.${collField} = $1 AND ar1.path = $2
      ORDER BY a.work_count DESC NULLS LAST
      LIMIT 8
    `, [itemId, collection])

    for (const a of coauthors) {
      const nid = `author-${a.id}`
      if (!nodeIds.has(nid)) {
        nodes.push({ id: nid, label: a.display_name, type: 'author', degree: a.work_count || 0, isFocal: false })
        nodeIds.add(nid)
      }
      addEdge(focalId, nid, 1)
    }

    // Co-author inter-links: shared works across publications + datasets + documents (≥2)
    if (coauthors.length > 1) {
      const authorIds = coauthors.map((a: any) => a.id)
      const { rows: coauthorEdges } = await db.query(`
        WITH pairs AS (
          SELECT ar1.parent_id AS a1, ar2.parent_id AS a2
          FROM authors_rels ar1
          JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'publications'
          WHERE ar1.path = 'publications' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
          UNION ALL
          SELECT ar1.parent_id, ar2.parent_id
          FROM authors_rels ar1
          JOIN authors_rels ar2 ON ar2.datasets_id = ar1.datasets_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'datasets'
          WHERE ar1.path = 'datasets' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
          UNION ALL
          SELECT ar1.parent_id, ar2.parent_id
          FROM authors_rels ar1
          JOIN authors_rels ar2 ON ar2.documents_id = ar1.documents_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'documents'
          WHERE ar1.path = 'documents' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
        )
        SELECT a1, a2, COUNT(*) AS shared
        FROM pairs GROUP BY a1, a2
        HAVING COUNT(*) >= 2
        ORDER BY shared DESC LIMIT 20
      `, [authorIds])

      for (const e of coauthorEdges) {
        addEdge(`author-${e.a1}`, `author-${e.a2}`, parseInt(e.shared))
      }
    }
  }

  // Citation network: publications this item cites + publications that cite it (top 5 each)
  if (collection === 'publications') {
    const { rows: cites } = await db.query(`
      SELECT p.id, p.title, p.year, coalesce(p.external_citation_count, 0) as cite_count
      FROM references_cited r
      JOIN publications p ON p.id = r.target_publication_id
      WHERE r.source_publication_id = $1 AND r.target_publication_id IS NOT NULL
      ORDER BY p.external_citation_count DESC NULLS LAST
      LIMIT 5
    `, [itemId])

    for (const c of cites) {
      const nid = `publications-${c.id}`
      if (!nodeIds.has(nid)) {
        nodes.push({ id: nid, label: c.title.slice(0, 50), type: 'publication', degree: c.cite_count || 0, isFocal: false })
        nodeIds.add(nid)
      }
      addEdge(focalId, nid, 1)
    }

    const { rows: citedBy } = await db.query(`
      SELECT p.id, p.title, p.year, coalesce(p.external_citation_count, 0) as cite_count
      FROM references_cited r
      JOIN publications p ON p.id = r.source_publication_id
      WHERE r.target_publication_id = $1
      ORDER BY p.external_citation_count DESC NULLS LAST
      LIMIT 5
    `, [itemId])

    for (const c of citedBy) {
      const nid = `publications-${c.id}`
      if (!nodeIds.has(nid)) {
        nodes.push({ id: nid, label: c.title.slice(0, 50), type: 'publication', degree: c.cite_count || 0, isFocal: false })
        nodeIds.add(nid)
      }
      addEdge(nid, focalId, 1)
    }
  }

  // Cross-links between cited/citing papers (shared citations within the displayed set)
  const pubNodeIds = [...nodeIds].filter((nid) => nid.startsWith('publications-') && nid !== focalId)
  if (pubNodeIds.length > 1) {
    const pubIds = pubNodeIds.map((nid) => parseInt(nid.replace('publications-', '')))
    const { rows: citeCross } = await db.query(`
      SELECT source_publication_id as src, target_publication_id as tgt
      FROM references_cited
      WHERE source_publication_id = ANY($1) AND target_publication_id = ANY($1)
    `, [pubIds])
    for (const e of citeCross) {
      addEdge(`publications-${e.src}`, `publications-${e.tgt}`, 1)
    }
  }

  // Helper: collect displayed work nodes grouped by collection
  const workNodeIds = [...nodeIds].filter((nid) =>
    (nid.startsWith('publications-') || nid.startsWith('datasets-') || nid.startsWith('documents-')) && nid !== focalId
  )
  const worksByCollection: Record<string, number[]> = { publications: [], datasets: [], documents: [] }
  for (const nid of workNodeIds) {
    const dash = nid.indexOf('-')
    const coll = nid.slice(0, dash)
    worksByCollection[coll].push(parseInt(nid.slice(dash + 1)))
  }

  // Author ↔ work links: which co-authors wrote which displayed works (all 3 collections)
  const authorNodeIds = [...nodeIds].filter((nid) => nid.startsWith('author-'))
  if (authorNodeIds.length > 0 && workNodeIds.length > 0) {
    const authorIds = authorNodeIds.map((nid) => parseInt(nid.replace('author-', '')))
    const COLL_FIELDS: Record<string, string> = {
      publications: 'publications_id', datasets: 'datasets_id', documents: 'documents_id',
    }
    for (const [coll, ids] of Object.entries(worksByCollection)) {
      if (ids.length === 0) continue
      const field = COLL_FIELDS[coll]
      const { rows } = await db.query(`
        SELECT parent_id AS author_id, ${field} AS work_id
        FROM authors_rels
        WHERE parent_id = ANY($1) AND ${field} = ANY($2) AND path = $3
      `, [authorIds, ids, coll])
      for (const e of rows) addEdge(`author-${e.author_id}`, `${coll}-${e.work_id}`, 1)
    }
  }

  // Entity ↔ work links: which displayed works mention which displayed entities (all 3 collections)
  const entityNodeIds = [...nodeIds].filter((nid) =>
    (nid.startsWith('species-') || nid.startsWith('protocol-') || nid.startsWith('concept-') ||
     nid.startsWith('place-') || nid.startsWith('stakeholder-')) && nid !== focalId
  )
  if (entityNodeIds.length > 0 && workNodeIds.length > 0) {
    const entityNodeSet = new Set(entityNodeIds)
    for (const [coll, ids] of Object.entries(worksByCollection)) {
      if (ids.length === 0) continue
      const { rows } = await db.query(`
        SELECT entity_type, entity_id, item_id
        FROM entity_mentions
        WHERE collection = $1 AND item_id = ANY($2) AND ${GRAPH_ENTITY_FILTER_BARE}
      `, [coll, ids])
      for (const e of rows) {
        const enid = `${e.entity_type}-${e.entity_id}`
        if (entityNodeSet.has(enid)) addEdge(enid, `${coll}-${e.item_id}`, 1)
      }
    }
  }

  // Author ↔ entity links: displayed authors with works (any type) mentioning displayed entities
  if (authorNodeIds.length > 0 && entityNodeIds.length > 0) {
    const authorIds = authorNodeIds.map((nid) => parseInt(nid.replace('author-', '')))
    const { rows: authorEntityLinks } = await db.query(`
      WITH author_works AS (
        SELECT parent_id AS author_id, 'publications'::text AS collection, publications_id AS item_id FROM authors_rels WHERE parent_id = ANY($1) AND path = 'publications' AND publications_id IS NOT NULL
        UNION ALL
        SELECT parent_id, 'datasets', datasets_id FROM authors_rels WHERE parent_id = ANY($1) AND path = 'datasets' AND datasets_id IS NOT NULL
        UNION ALL
        SELECT parent_id, 'documents', documents_id FROM authors_rels WHERE parent_id = ANY($1) AND path = 'documents' AND documents_id IS NOT NULL
      )
      SELECT DISTINCT em.entity_type, em.entity_id, aw.author_id
      FROM entity_mentions em
      JOIN author_works aw ON aw.collection = em.collection AND aw.item_id = em.item_id
      WHERE ${GRAPH_ENTITY_FILTER}
      LIMIT 500
    `, [authorIds])
    const entityNodeSet = new Set(entityNodeIds)
    for (const e of authorEntityLinks) {
      const enid = `${e.entity_type}-${e.entity_id}`
      if (entityNodeSet.has(enid)) addEdge(`author-${e.author_id}`, enid, 1)
    }
  }

  // Update focal degree
  nodes[0].degree = edges.filter((e) => e.source === focalId || e.target === focalId).length

  if (nodes.length <= 1) return { nodes: [], edges: [], focalId }

  // Inter-entity edges (co-occurrence across other items)
  const entityKeys = entities.filter((e: any) => e.name).map((e: any) => `${e.entity_type}:${e.entity_id}`)
  if (entityKeys.length > 1 && entityKeys.length <= 50) {
    const { rows: interEdges } = await db.query(`
      WITH entity_set AS (
        SELECT unnest($1::text[]) as key
      ),
      parsed AS (
        SELECT split_part(key, ':', 1) as etype, split_part(key, ':', 2)::int as eid FROM entity_set
      ),
      entity_items AS (
        SELECT em.entity_type, em.entity_id, em.collection, em.item_id
        FROM entity_mentions em JOIN parsed p ON p.etype = em.entity_type AND p.eid = em.entity_id
      )
      SELECT a.entity_type || '-' || a.entity_id as source,
             b.entity_type || '-' || b.entity_id as target,
             COUNT(DISTINCT (a.collection || ':' || a.item_id)) as weight
      FROM entity_items a
      JOIN entity_items b ON a.collection = b.collection AND a.item_id = b.item_id
        AND (a.entity_type > b.entity_type OR (a.entity_type = b.entity_type AND a.entity_id > b.entity_id))
      GROUP BY a.entity_type, a.entity_id, b.entity_type, b.entity_id
      HAVING COUNT(DISTINCT (a.collection || ':' || a.item_id)) >= 2
      ORDER BY weight DESC LIMIT 40
    `, [entityKeys])

    for (const e of interEdges) {
      addEdge(e.source, e.target, parseInt(e.weight))
    }
  }

  return { nodes, edges, focalId }
}

/**
 * Fetch the network for an author: their top publications, co-authors,
 * and the entities most associated with their work.
 */
export async function fetchAuthorNetwork(
  pool: pg.Pool,
  authorId: number,
  authorName: string,
  limit: number = 30,
): Promise<NeighborhoodData> {
  const db = pool
  const focalId = `author-${authorId}`

  const nodes: GraphNode[] = [
    { id: focalId, label: authorName, type: 'author', degree: 0, isFocal: true },
  ]
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>([focalId])
  const edgeKeys = new Set<string>()

  function addEdge(source: string, target: string, weight: number) {
    const k1 = `${source}--${target}`
    const k2 = `${target}--${source}`
    if (!edgeKeys.has(k1) && !edgeKeys.has(k2)) {
      edges.push({ source, target, weight })
      edgeKeys.add(k1)
    }
  }

  // Top works by this author across publications + datasets + documents.
  // Pubs/datasets ranked by external_citation_count; documents fall to bottom (no cite count).
  const { rows: works } = await db.query(`
    SELECT 'publication' AS work_type, 'publications' AS collection, p.id, p.title,
           coalesce(p.external_citation_count, 0) AS sort_score, coalesce(p.year, 0)::int AS year
    FROM authors_rels ar JOIN publications p ON p.id = ar.publications_id
    WHERE ar.parent_id = $1 AND ar.path = 'publications'
    UNION ALL
    SELECT 'dataset', 'datasets', d.id, d.title,
           coalesce(d.external_citation_count, 0), coalesce(d.publication_year, 0)::int
    FROM authors_rels ar JOIN datasets d ON d.id = ar.datasets_id
    WHERE ar.parent_id = $1 AND ar.path = 'datasets'
    UNION ALL
    SELECT 'document', 'documents', doc.id, doc.title,
           0, coalesce(EXTRACT(YEAR FROM doc.date_original)::int, 0)
    FROM authors_rels ar JOIN documents doc ON doc.id = ar.documents_id
    WHERE ar.parent_id = $1 AND ar.path = 'documents'
    ORDER BY sort_score DESC, year DESC
    LIMIT 10
  `, [authorId])

  for (const w of works) {
    const nid = `${w.collection}-${w.id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: (w.title || '').slice(0, 50), type: w.work_type, degree: parseInt(w.sort_score) || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, 1)
  }

  // Top co-authors (by total shared works across publications + datasets + documents)
  const { rows: coauthors } = await db.query(`
    WITH shared_works AS (
      SELECT ar2.parent_id AS author_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id != $1 AND ar2.path = 'publications'
      WHERE ar1.parent_id = $1 AND ar1.path = 'publications'
      UNION ALL
      SELECT ar2.parent_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.datasets_id = ar1.datasets_id AND ar2.parent_id != $1 AND ar2.path = 'datasets'
      WHERE ar1.parent_id = $1 AND ar1.path = 'datasets'
      UNION ALL
      SELECT ar2.parent_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.documents_id = ar1.documents_id AND ar2.parent_id != $1 AND ar2.path = 'documents'
      WHERE ar1.parent_id = $1 AND ar1.path = 'documents'
    )
    SELECT a.id, a.display_name, COUNT(*) AS shared
    FROM shared_works s
    JOIN authors a ON a.id = s.author_id
    GROUP BY a.id, a.display_name
    ORDER BY shared DESC
    LIMIT 8
  `, [authorId])

  for (const c of coauthors) {
    const nid = `author-${c.id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: c.display_name, type: 'author', degree: parseInt(c.shared), isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, parseInt(c.shared))
  }

  // Co-author ↔ work links across all three paths
  if (coauthors.length > 0 && works.length > 0) {
    const coauthorIds = coauthors.map((c: any) => c.id)
    const pubIds = works.filter((w: any) => w.work_type === 'publication').map((w: any) => w.id)
    const dsIds = works.filter((w: any) => w.work_type === 'dataset').map((w: any) => w.id)
    const docIds = works.filter((w: any) => w.work_type === 'document').map((w: any) => w.id)

    if (pubIds.length > 0) {
      const { rows } = await db.query(`
        SELECT parent_id AS author_id, publications_id AS work_id
        FROM authors_rels
        WHERE parent_id = ANY($1) AND publications_id = ANY($2) AND path = 'publications'
      `, [coauthorIds, pubIds])
      for (const l of rows) addEdge(`author-${l.author_id}`, `publications-${l.work_id}`, 1)
    }
    if (dsIds.length > 0) {
      const { rows } = await db.query(`
        SELECT parent_id AS author_id, datasets_id AS work_id
        FROM authors_rels
        WHERE parent_id = ANY($1) AND datasets_id = ANY($2) AND path = 'datasets'
      `, [coauthorIds, dsIds])
      for (const l of rows) addEdge(`author-${l.author_id}`, `datasets-${l.work_id}`, 1)
    }
    if (docIds.length > 0) {
      const { rows } = await db.query(`
        SELECT parent_id AS author_id, documents_id AS work_id
        FROM authors_rels
        WHERE parent_id = ANY($1) AND documents_id = ANY($2) AND path = 'documents'
      `, [coauthorIds, docIds])
      for (const l of rows) addEdge(`author-${l.author_id}`, `documents-${l.work_id}`, 1)
    }
  }

  // Co-author ↔ co-author links (shared works of any type, ≥2)
  if (coauthors.length > 1) {
    const coauthorIds = coauthors.map((c: any) => c.id)
    const { rows: cocoEdges } = await db.query(`
      WITH pairs AS (
        SELECT ar1.parent_id AS a1, ar2.parent_id AS a2
        FROM authors_rels ar1
        JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'publications'
        WHERE ar1.path = 'publications' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
        UNION ALL
        SELECT ar1.parent_id, ar2.parent_id
        FROM authors_rels ar1
        JOIN authors_rels ar2 ON ar2.datasets_id = ar1.datasets_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'datasets'
        WHERE ar1.path = 'datasets' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
        UNION ALL
        SELECT ar1.parent_id, ar2.parent_id
        FROM authors_rels ar1
        JOIN authors_rels ar2 ON ar2.documents_id = ar1.documents_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'documents'
        WHERE ar1.path = 'documents' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
      )
      SELECT a1, a2, COUNT(*) AS shared
      FROM pairs
      GROUP BY a1, a2
      HAVING COUNT(*) >= 2
      ORDER BY shared DESC
      LIMIT 30
    `, [coauthorIds])
    for (const e of cocoEdges) addEdge(`author-${e.a1}`, `author-${e.a2}`, parseInt(e.shared))
  }

  // Top entities from this author's works (publications + datasets + documents)
  const entityLimit = Math.max(5, limit - nodes.length)
  const { rows: entities } = await db.query(`
    WITH author_works AS (
      SELECT 'publications'::text AS collection, publications_id AS item_id FROM authors_rels WHERE parent_id = $1 AND path = 'publications' AND publications_id IS NOT NULL
      UNION ALL
      SELECT 'datasets', datasets_id FROM authors_rels WHERE parent_id = $1 AND path = 'datasets' AND datasets_id IS NOT NULL
      UNION ALL
      SELECT 'documents', documents_id FROM authors_rels WHERE parent_id = $1 AND path = 'documents' AND documents_id IS NOT NULL
    )
    SELECT em.entity_type, em.entity_id,
      CASE em.entity_type
        WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = em.entity_id)
        WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = em.entity_id)
        WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = em.entity_id)
        WHEN 'place' THEN (SELECT name FROM places WHERE id = em.entity_id)
        WHEN 'stakeholder' THEN (SELECT name FROM stakeholders WHERE id = em.entity_id)
      END AS name,
      CASE em.entity_type
        WHEN 'species' THEN (SELECT publication_count FROM species WHERE id = em.entity_id)
        WHEN 'protocol' THEN (SELECT publication_count FROM protocols WHERE id = em.entity_id)
        WHEN 'concept' THEN (SELECT publication_count FROM concepts WHERE id = em.entity_id)
        WHEN 'place' THEN (SELECT publication_count FROM places WHERE id = em.entity_id)
        WHEN 'stakeholder' THEN (SELECT document_count FROM stakeholders WHERE id = em.entity_id)
      END AS degree,
      COUNT(DISTINCT (em.collection || ':' || em.item_id)) AS author_mentions
    FROM entity_mentions em
    JOIN author_works aw ON aw.collection = em.collection AND aw.item_id = em.item_id
    WHERE ${GRAPH_ENTITY_FILTER}
    GROUP BY em.entity_type, em.entity_id
    ORDER BY author_mentions DESC
    LIMIT $2
  `, [authorId, entityLimit])

  for (const e of entities) {
    if (!e.name) continue
    const nid = `${e.entity_type}-${e.entity_id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: e.name, type: e.entity_type, degree: parseInt(e.degree) || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, parseInt(e.author_mentions))
  }

  // Entity ↔ work links across all 3 collections of displayed work nodes
  const workNodeIds = [...nodeIds].filter((nid) =>
    nid.startsWith('publications-') || nid.startsWith('datasets-') || nid.startsWith('documents-')
  )
  const entityNodeIds = [...nodeIds].filter((nid) =>
    nid.startsWith('species-') || nid.startsWith('protocol-') || nid.startsWith('concept-') ||
    nid.startsWith('place-') || nid.startsWith('stakeholder-')
  )
  if (workNodeIds.length > 0 && entityNodeIds.length > 0) {
    const byCollection: Record<string, number[]> = { publications: [], datasets: [], documents: [] }
    for (const nid of workNodeIds) {
      const dash = nid.indexOf('-')
      const coll = nid.slice(0, dash)
      byCollection[coll].push(parseInt(nid.slice(dash + 1)))
    }
    const entitySet = new Set(entityNodeIds)
    for (const [coll, ids] of Object.entries(byCollection)) {
      if (ids.length === 0) continue
      const { rows: epLinks } = await db.query(`
        SELECT entity_type, entity_id, item_id
        FROM entity_mentions
        WHERE collection = $1 AND item_id = ANY($2) AND ${GRAPH_ENTITY_FILTER_BARE}
      `, [coll, ids])
      for (const e of epLinks) {
        const enid = `${e.entity_type}-${e.entity_id}`
        if (entitySet.has(enid)) addEdge(enid, `${coll}-${e.item_id}`, 1)
      }
    }
  }

  nodes[0].degree = edges.filter((e) => e.source === focalId || e.target === focalId).length
  if (nodes.length <= 1) return { nodes: [], edges: [], focalId }

  return { nodes, edges, focalId }
}
