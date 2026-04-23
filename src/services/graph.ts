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

  // Top documents mentioning this entity
  const { rows: docs } = await db.query(`
    SELECT d.id, d.title
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = $1 AND em.entity_id = $2 AND em.collection = 'documents'
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

  // Top authors of those publications
  const pubIds = pubs.map((p: any) => p.id)
  if (pubIds.length > 0) {
    const { rows: authors } = await db.query(`
      SELECT a.id, a.display_name, COUNT(DISTINCT ar.publications_id) as shared
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
      WHERE ar.publications_id = ANY($1) AND ar.path = 'publications'
      GROUP BY a.id, a.display_name
      ORDER BY shared DESC
      LIMIT 5
    `, [pubIds])

    for (const a of authors) {
      const nid = `author-${a.id}`
      if (!nodeIds.has(nid)) {
        nodes.push({ id: nid, label: a.display_name, type: 'author', degree: parseInt(a.shared), isFocal: false })
        nodeIds.add(nid)
      }
      addEdge(focalId, nid, parseInt(a.shared))
    }

    // Author ↔ publication links
    const authorIds = authors.map((a: any) => a.id)
    if (authorIds.length > 0) {
      const { rows: apLinks } = await db.query(`
        SELECT parent_id as author_id, publications_id as pub_id
        FROM authors_rels
        WHERE parent_id = ANY($1) AND publications_id = ANY($2) AND path = 'publications'
      `, [authorIds, pubIds])
      for (const l of apLinks) addEdge(`author-${l.author_id}`, `publications-${l.pub_id}`, 1)
    }

    // Entity neighbor ↔ publication links
    const entityNodeIds = [...nodeIds].filter((nid) =>
      (nid.startsWith('species-') || nid.startsWith('protocol-') || nid.startsWith('concept-') || nid.startsWith('place-') || nid.startsWith('stakeholder-')) && nid !== focalId
    )
    if (entityNodeIds.length > 0) {
      const { rows: epLinks } = await db.query(`
        SELECT entity_type, entity_id, item_id
        FROM entity_mentions
        WHERE collection = 'publications' AND item_id = ANY($1) AND ${GRAPH_ENTITY_FILTER_BARE}
      `, [pubIds])
      const entitySet = new Set(entityNodeIds)
      for (const e of epLinks) {
        const enid = `${e.entity_type}-${e.entity_id}`
        if (entitySet.has(enid)) addEdge(enid, `publications-${e.item_id}`, 1)
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
    { id: focalId, label: itemTitle.slice(0, 50), type: collection === 'publications' ? 'publication' : collection === 'datasets' ? 'dataset' : 'document', degree: 0, isFocal: true },
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

  // Co-authors: other authors on this publication/dataset (top 8 by work count)
  if (collection === 'publications' || collection === 'datasets') {
    const collField = collection === 'publications' ? 'publications_id' : 'datasets_id'
    const { rows: coauthors } = await db.query(`
      SELECT DISTINCT a.id, a.display_name, a.work_count
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.${collField} = ar1.${collField} AND ar2.parent_id != ar1.parent_id AND ar2.path = ar1.path
      JOIN authors a ON a.id = ar2.parent_id
      WHERE ar1.${collField} = $1 AND ar1.path = $2
      ORDER BY a.work_count DESC NULLS LAST
      LIMIT 8
    `, [itemId, collection === 'publications' ? 'publications' : 'datasets'])

    for (const a of coauthors) {
      const nid = `author-${a.id}`
      if (!nodeIds.has(nid)) {
        nodes.push({ id: nid, label: a.display_name, type: 'author', degree: a.work_count || 0, isFocal: false })
        nodeIds.add(nid)
      }
      addEdge(focalId, nid, 1)
    }

    // Co-author inter-links (shared other publications)
    if (coauthors.length > 1) {
      const authorIds = coauthors.map((a: any) => a.id)
      const { rows: coauthorEdges } = await db.query(`
        SELECT ar1.parent_id as a1, ar2.parent_id as a2, COUNT(DISTINCT ar1.publications_id) as shared
        FROM authors_rels ar1
        JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id > ar1.parent_id
          AND ar2.path = 'publications'
        WHERE ar1.path = 'publications' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
          AND ar1.publications_id != $2
        GROUP BY ar1.parent_id, ar2.parent_id
        HAVING COUNT(DISTINCT ar1.publications_id) >= 2
        LIMIT 20
      `, [authorIds, itemId])

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

  // Author-publication links: which co-authors wrote which displayed papers
  const authorNodeIds = [...nodeIds].filter((nid) => nid.startsWith('author-'))
  if (authorNodeIds.length > 0 && pubNodeIds.length > 0) {
    const authorIds = authorNodeIds.map((nid) => parseInt(nid.replace('author-', '')))
    const pubIds = pubNodeIds.map((nid) => parseInt(nid.replace('publications-', '')))
    const { rows: authorPubLinks } = await db.query(`
      SELECT parent_id as author_id, publications_id as pub_id
      FROM authors_rels
      WHERE parent_id = ANY($1) AND publications_id = ANY($2) AND path = 'publications'
    `, [authorIds, pubIds])
    for (const e of authorPubLinks) {
      addEdge(`author-${e.author_id}`, `publications-${e.pub_id}`, 1)
    }
  }

  // Entity-publication links: which displayed papers mention which displayed entities
  const entityNodeIds = [...nodeIds].filter((nid) =>
    (nid.startsWith('species-') || nid.startsWith('protocol-') || nid.startsWith('concept-')) && nid !== focalId
  )
  if (entityNodeIds.length > 0 && pubNodeIds.length > 0) {
    const parsedEntities = entityNodeIds.map((nid) => {
      const dash = nid.indexOf('-')
      return { type: nid.slice(0, dash), id: parseInt(nid.slice(dash + 1)) }
    })
    const pubIds = pubNodeIds.map((nid) => parseInt(nid.replace('publications-', '')))
    const { rows: entityPubLinks } = await db.query(`
      SELECT entity_type, entity_id, item_id
      FROM entity_mentions
      WHERE collection = 'publications' AND item_id = ANY($1)
        AND ${GRAPH_ENTITY_FILTER_BARE}
    `, [pubIds])
    const entityNodeSet = new Set(entityNodeIds)
    for (const e of entityPubLinks) {
      const enid = `${e.entity_type}-${e.entity_id}`
      if (entityNodeSet.has(enid)) {
        addEdge(enid, `publications-${e.item_id}`, 1)
      }
    }
  }

  // Author-entity links: which displayed authors have papers mentioning displayed entities
  if (authorNodeIds.length > 0 && entityNodeIds.length > 0) {
    const authorIds = authorNodeIds.map((nid) => parseInt(nid.replace('author-', '')))
    const { rows: authorPubs } = await db.query(`
      SELECT DISTINCT parent_id as author_id, publications_id as pub_id
      FROM authors_rels
      WHERE parent_id = ANY($1) AND path = 'publications' AND publications_id IS NOT NULL
    `, [authorIds])
    // For each author's publications, check if any displayed entities are mentioned
    const authorPubIds = [...new Set(authorPubs.map((r: any) => r.pub_id))]
    if (authorPubIds.length > 0) {
      const { rows: authorEntityLinks } = await db.query(`
        SELECT DISTINCT em.entity_type, em.entity_id, ar.parent_id as author_id
        FROM entity_mentions em
        JOIN authors_rels ar ON ar.publications_id = em.item_id AND ar.path = 'publications'
        WHERE ar.parent_id = ANY($1) AND em.collection = 'publications'
          AND ${GRAPH_ENTITY_FILTER}
        LIMIT 500
      `, [authorIds])
      const entityNodeSet = new Set(entityNodeIds)
      for (const e of authorEntityLinks) {
        const enid = `${e.entity_type}-${e.entity_id}`
        if (entityNodeSet.has(enid)) {
          addEdge(`author-${e.author_id}`, enid, 1)
        }
      }
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

  // Top publications by this author (by citation count)
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, coalesce(p.external_citation_count, 0) as cite_count
    FROM authors_rels ar
    JOIN publications p ON p.id = ar.publications_id
    WHERE ar.parent_id = $1 AND ar.path = 'publications'
    ORDER BY p.external_citation_count DESC NULLS LAST
    LIMIT 8
  `, [authorId])

  for (const p of pubs) {
    const nid = `publications-${p.id}`
    if (!nodeIds.has(nid)) {
      nodes.push({ id: nid, label: p.title.slice(0, 50), type: 'publication', degree: p.cite_count || 0, isFocal: false })
      nodeIds.add(nid)
    }
    addEdge(focalId, nid, 1)
  }

  // Top co-authors (by shared publications)
  const { rows: coauthors } = await db.query(`
    SELECT a.id, a.display_name, COUNT(DISTINCT ar2.publications_id) as shared
    FROM authors_rels ar1
    JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id != $1 AND ar2.path = 'publications'
    JOIN authors a ON a.id = ar2.parent_id
    WHERE ar1.parent_id = $1 AND ar1.path = 'publications'
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

  // Co-author ↔ publication links
  if (coauthors.length > 0 && pubs.length > 0) {
    const coauthorIds = coauthors.map((c: any) => c.id)
    const pubIds = pubs.map((p: any) => p.id)
    const { rows: links } = await db.query(`
      SELECT parent_id as author_id, publications_id as pub_id
      FROM authors_rels
      WHERE parent_id = ANY($1) AND publications_id = ANY($2) AND path = 'publications'
    `, [coauthorIds, pubIds])
    for (const l of links) addEdge(`author-${l.author_id}`, `publications-${l.pub_id}`, 1)
  }

  // Co-author ↔ co-author links
  if (coauthors.length > 1) {
    const coauthorIds = coauthors.map((c: any) => c.id)
    const { rows: cocoEdges } = await db.query(`
      SELECT ar1.parent_id as a1, ar2.parent_id as a2, COUNT(DISTINCT ar1.publications_id) as shared
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'publications'
      WHERE ar1.path = 'publications' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
      GROUP BY ar1.parent_id, ar2.parent_id
      HAVING COUNT(DISTINCT ar1.publications_id) >= 2
      LIMIT 20
    `, [coauthorIds])
    for (const e of cocoEdges) addEdge(`author-${e.a1}`, `author-${e.a2}`, parseInt(e.shared))
  }

  // Top entities from this author's publications
  const entityLimit = Math.max(5, limit - nodes.length)
  const { rows: entities } = await db.query(`
    SELECT em.entity_type, em.entity_id,
      CASE em.entity_type
        WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = em.entity_id)
        WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = em.entity_id)
        WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = em.entity_id)
      END as name,
      CASE em.entity_type
        WHEN 'species' THEN (SELECT publication_count FROM species WHERE id = em.entity_id)
        WHEN 'protocol' THEN (SELECT publication_count FROM protocols WHERE id = em.entity_id)
        WHEN 'concept' THEN (SELECT publication_count FROM concepts WHERE id = em.entity_id)
      END as degree,
      COUNT(DISTINCT em.item_id) as author_mentions
    FROM entity_mentions em
    JOIN authors_rels ar ON ar.publications_id = em.item_id AND ar.path = 'publications'
    WHERE ar.parent_id = $1 AND em.collection = 'publications' AND ${GRAPH_ENTITY_FILTER}
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

  // Entity ↔ publication links
  const pubNodeIds = [...nodeIds].filter((nid) => nid.startsWith('publications-'))
  const entityNodeIds = [...nodeIds].filter((nid) =>
    nid.startsWith('species-') || nid.startsWith('protocol-') || nid.startsWith('concept-')
  )
  if (pubNodeIds.length > 0 && entityNodeIds.length > 0) {
    const pubIds = pubNodeIds.map((nid) => parseInt(nid.replace('publications-', '')))
    const { rows: epLinks } = await db.query(`
      SELECT entity_type, entity_id, item_id
      FROM entity_mentions
      WHERE collection = 'publications' AND item_id = ANY($1) AND ${GRAPH_ENTITY_FILTER_BARE}
    `, [pubIds])
    const entitySet = new Set(entityNodeIds)
    for (const e of epLinks) {
      const enid = `${e.entity_type}-${e.entity_id}`
      if (entitySet.has(enid)) addEdge(enid, `publications-${e.item_id}`, 1)
    }
  }

  nodes[0].degree = edges.filter((e) => e.source === focalId || e.target === focalId).length
  if (nodes.length <= 1) return { nodes: [], edges: [], focalId }

  return { nodes, edges, focalId }
}
