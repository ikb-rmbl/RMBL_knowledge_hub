/**
 * Pre-compute a unified knowledge graph combining all entity and collection types.
 * Nodes: species, concepts, protocols, places, stakeholders, authors, publications, datasets, documents
 * Edges: entity co-occurrence, entity↔item mentions, author↔item, co-authorship,
 *        citations (pub↔pub, pub↔dataset, doc↔pub, doc↔doc)
 *
 * Usage:
 *   npx tsx scripts/build-unified-graph.ts [--min-degree=5]
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'

const Graph = (await import('graphology')).default
const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default

const args = process.argv.slice(2)
const minDegree = parseInt(args.find((a) => a.startsWith('--min-degree='))?.split('=')[1] || '5')

async function main() {
  console.log(`Building unified knowledge graph (min degree ${minDegree})...`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const graph = new Graph()
  const edgeKeys = new Set<string>()

  function addEdge(source: string, target: string, weight: number) {
    if (!graph.hasNode(source) || !graph.hasNode(target)) return
    const k1 = `${source}--${target}`, k2 = `${target}--${source}`
    if (edgeKeys.has(k1) || edgeKeys.has(k2)) return
    try { graph.addEdge(source, target, { weight, size: Math.max(0.3, Math.log(weight + 1) * 0.3), color: '#e0ddd8' }); edgeKeys.add(k1) }
    catch {}
  }

  // --- Add nodes ---

  // Species (filter by total mentions across all collections — includes documents)
  const { rows: species } = await db.query(`
    SELECT s.id, s.canonical_name as name, s.kingdom, s.family,
      (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
       WHERE em.entity_type = 'species' AND em.entity_id = s.id) as total_count
    FROM species s
    WHERE (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
           WHERE em.entity_type = 'species' AND em.entity_id = s.id) >= $1
    ORDER BY total_count DESC
  `, [minDegree])
  for (const s of species) {
    graph.addNode(`species-${s.id}`, {
      label: s.name, nodeType: 'species', kingdom: s.kingdom, family: s.family,
      degree: parseInt(s.total_count), size: 1.5 + Math.log(parseInt(s.total_count) + 1) * 0.8,
      x: -100 + Math.random() * 50, y: -100 + Math.random() * 50,
    })
  }
  console.log(`  ${species.length} species`)

  // Concepts
  const { rows: concepts } = await db.query(`
    SELECT c.id, c.name, c.scope, c.concept_type,
      (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
       WHERE em.entity_type = 'concept' AND em.entity_id = c.id) as total_count
    FROM concepts c
    WHERE (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
           WHERE em.entity_type = 'concept' AND em.entity_id = c.id) >= $1
    ORDER BY total_count DESC
  `, [minDegree])
  for (const c of concepts) {
    graph.addNode(`concept-${c.id}`, {
      label: c.name, nodeType: 'concept', scope: c.scope, conceptType: c.concept_type,
      degree: parseInt(c.total_count), size: 1.5 + Math.log(parseInt(c.total_count) + 1) * 0.8,
      x: 100 + Math.random() * 50, y: -100 + Math.random() * 50,
    })
  }
  console.log(`  ${concepts.length} concepts`)

  // Protocols
  const { rows: protocols } = await db.query(`
    SELECT p.id, p.name, p.category,
      (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
       WHERE em.entity_type = 'protocol' AND em.entity_id = p.id) as total_count
    FROM protocols p
    WHERE (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
           WHERE em.entity_type = 'protocol' AND em.entity_id = p.id) >= $1
    ORDER BY total_count DESC
  `, [minDegree])
  for (const p of protocols) {
    graph.addNode(`protocol-${p.id}`, {
      label: p.name, nodeType: 'protocol', category: p.category,
      degree: parseInt(p.total_count), size: 1.5 + Math.log(parseInt(p.total_count) + 1) * 0.8,
      x: 0 + Math.random() * 50, y: 100 + Math.random() * 50,
    })
  }
  console.log(`  ${protocols.length} protocols`)

  // Places (exclude broad scales — countries, states, generic regions)
  const { rows: places } = await db.query(`
    SELECT pl.id, pl.name, pl.place_type, pl.scale,
      (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
       WHERE em.entity_type = 'place' AND em.entity_id = pl.id) as total_count
    FROM places pl
    WHERE (pl.scale IS NULL OR pl.scale IN ('site', 'local'))
      AND (pl.place_type IS NULL OR pl.place_type NOT IN ('country', 'state', 'region'))
      AND (SELECT count(DISTINCT collection || ':' || item_id) FROM entity_mentions em
           WHERE em.entity_type = 'place' AND em.entity_id = pl.id) >= $1
    ORDER BY total_count DESC
  `, [minDegree])
  for (const p of places) {
    graph.addNode(`place-${p.id}`, {
      label: p.name, nodeType: 'place', placeType: p.place_type, scale: p.scale,
      degree: parseInt(p.total_count), size: 1.5 + Math.log(parseInt(p.total_count) + 1) * 0.8,
      x: 50 + Math.random() * 50, y: -50 + Math.random() * 50,
    })
  }
  console.log(`  ${places.length} places`)

  // Stakeholders (agencies, NGOs, orgs with significant mention count)
  const { rows: stakeholders } = await db.query(`
    SELECT id, name, stakeholder_type, document_count, publication_count
    FROM stakeholders
    WHERE (document_count + publication_count) >= $1
    ORDER BY (document_count + publication_count) DESC
  `, [minDegree])
  for (const s of stakeholders) {
    const deg = s.document_count + s.publication_count
    graph.addNode(`stakeholder-${s.id}`, {
      label: s.name, nodeType: 'stakeholder', stakeholderType: s.stakeholder_type,
      degree: deg, size: 1.5 + Math.log(deg + 1) * 0.8,
      x: -150 + Math.random() * 50, y: 0 + Math.random() * 50,
    })
  }
  console.log(`  ${stakeholders.length} stakeholders`)

  // Authors (top by work count)
  const { rows: authors } = await db.query(`
    SELECT id, display_name, work_count
    FROM authors WHERE work_count >= $1 ORDER BY work_count DESC LIMIT 500
  `, [minDegree])
  for (const a of authors) {
    graph.addNode(`author-${a.id}`, {
      label: a.display_name, nodeType: 'author',
      degree: a.work_count, size: 1.5 + Math.log(a.work_count + 1) * 0.8,
      x: -100 + Math.random() * 50, y: 100 + Math.random() * 50,
    })
  }
  console.log(`  ${authors.length} authors`)

  // Publications: top by citation count + those linked to datasets + those cited by documents
  const { rows: pubs } = await db.query(`
    SELECT id, title, coalesce(external_citation_count, 0) as cite_count
    FROM publications
    WHERE id IN (
      SELECT id FROM publications WHERE coalesce(external_citation_count, 0) >= $1
      UNION SELECT source_publication_id FROM references_cited WHERE target_dataset_id IS NOT NULL
      UNION SELECT publication_id FROM data_repositories WHERE linked_dataset_id IS NOT NULL
      UNION SELECT publications_id FROM datasets_rels WHERE publications_id IS NOT NULL
      UNION SELECT target_publication_id FROM references_cited WHERE source_document_id IS NOT NULL AND target_publication_id IS NOT NULL
    )
    ORDER BY cite_count DESC
    LIMIT 800
  `, [minDegree])
  for (const p of pubs) {
    graph.addNode(`pub-${p.id}`, {
      label: p.title.slice(0, 50), nodeType: 'publication',
      degree: p.cite_count, size: 1.5 + Math.log(p.cite_count + 1) * 0.6,
      x: 100 + Math.random() * 50, y: 100 + Math.random() * 50,
    })
  }
  console.log(`  ${pubs.length} publications`)

  // Documents (those with entity mentions — most policy/community documents)
  const { rows: documents } = await db.query(`
    SELECT d.id, d.title, d.document_type, d.date_original,
      (SELECT count(*) FROM entity_mentions em WHERE em.collection = 'documents' AND em.item_id = d.id) as mention_count
    FROM documents d
    WHERE d.id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'documents')
    ORDER BY mention_count DESC
    LIMIT 800
  `)
  for (const d of documents) {
    graph.addNode(`document-${d.id}`, {
      label: (d.title || '').slice(0, 50), nodeType: 'document',
      documentType: d.document_type,
      degree: parseInt(d.mention_count), size: 1.5 + Math.log(parseInt(d.mention_count) + 1) * 0.6,
      x: -50 + Math.random() * 50, y: 50 + Math.random() * 50,
    })
  }
  console.log(`  ${documents.length} documents`)

  // Datasets (those with entity links)
  const { rows: datasets } = await db.query(`
    SELECT d.id, d.title, d.publication_year
    FROM datasets d
    WHERE d.id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'datasets')
    ORDER BY d.publication_year DESC NULLS LAST
    LIMIT 500
  `)
  for (const d of datasets) {
    graph.addNode(`dataset-${d.id}`, {
      label: d.title.slice(0, 50), nodeType: 'dataset',
      year: d.publication_year,
      degree: 0, size: 2,
      x: 0 + Math.random() * 50, y: -50 + Math.random() * 50,
    })
  }
  console.log(`  ${datasets.length} datasets`)

  console.log(`  Total nodes: ${graph.order}`)

  // --- Add edges ---

  // Entity co-occurrence (species↔concept, species↔protocol, concept↔protocol)
  const entityIds = [
    ...species.map((s: any) => ({ type: 'species', id: s.id })),
    ...places.map((p: any) => ({ type: 'place', id: p.id })),
    ...concepts.map((c: any) => ({ type: 'concept', id: c.id })),
    ...protocols.map((p: any) => ({ type: 'protocol', id: p.id })),
  ]
  const entityTypeIds = new Map<string, Set<number>>()
  for (const e of entityIds) {
    if (!entityTypeIds.has(e.type)) entityTypeIds.set(e.type, new Set())
    entityTypeIds.get(e.type)!.add(e.id)
  }

  const { rows: cooccurrences } = await db.query(`
    SELECT em1.entity_type as t1, em1.entity_id as id1, em2.entity_type as t2, em2.entity_id as id2,
      COUNT(DISTINCT (em1.collection || ':' || em1.item_id)) as weight
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.item_id = em1.item_id AND em2.collection = em1.collection
      AND (em2.entity_type > em1.entity_type OR (em2.entity_type = em1.entity_type AND em2.entity_id > em1.entity_id))
    WHERE em1.entity_type IN ('species', 'concept', 'protocol', 'place')
      AND em2.entity_type IN ('species', 'concept', 'protocol', 'place')
      AND em1.entity_type != 'place' AND em2.entity_type != 'place'
    GROUP BY em1.entity_type, em1.entity_id, em2.entity_type, em2.entity_id
    HAVING COUNT(DISTINCT (em1.collection || ':' || em1.item_id)) >= 3
    ORDER BY weight DESC
    LIMIT 5000
  `)
  let entityEdges = 0
  for (const e of cooccurrences) {
    if (entityTypeIds.get(e.t1)?.has(e.id1) && entityTypeIds.get(e.t2)?.has(e.id2)) {
      addEdge(`${e.t1}-${e.id1}`, `${e.t2}-${e.id2}`, parseInt(e.weight))
      entityEdges++
    }
  }
  console.log(`  ${entityEdges} entity co-occurrence edges`)

  // Entity ↔ Publication (top entities mentioned in top publications)
  const pubIdSet = new Set(pubs.map((p: any) => p.id))
  const { rows: entityPubLinks } = await db.query(`
    SELECT em.entity_type, em.entity_id, em.item_id
    FROM entity_mentions em
    WHERE em.collection = 'publications' AND em.item_id = ANY($1)
      AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
    LIMIT 10000
  `, [[...pubIdSet]])
  let epEdges = 0
  for (const e of entityPubLinks) {
    if (entityTypeIds.get(e.entity_type)?.has(e.entity_id) && pubIdSet.has(e.item_id)) {
      addEdge(`${e.entity_type}-${e.entity_id}`, `pub-${e.item_id}`, 1)
      epEdges++
    }
  }
  console.log(`  ${epEdges} entity↔publication edges`)

  // Author ↔ Publication
  const authorIdSet = new Set(authors.map((a: any) => a.id))
  const { rows: authorPubLinks } = await db.query(`
    SELECT parent_id as author_id, publications_id as pub_id
    FROM authors_rels
    WHERE parent_id = ANY($1) AND publications_id = ANY($2) AND path = 'publications'
  `, [[...authorIdSet], [...pubIdSet]])
  let apEdges = 0
  for (const e of authorPubLinks) {
    addEdge(`author-${e.author_id}`, `pub-${e.pub_id}`, 1)
    apEdges++
  }
  console.log(`  ${apEdges} author↔publication edges`)

  // Author co-authorship
  const { rows: coauthorEdges } = await db.query(`
    SELECT ar1.parent_id as a1, ar2.parent_id as a2,
      COUNT(DISTINCT ar1.publications_id) as shared
    FROM authors_rels ar1
    JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id
      AND ar2.parent_id > ar1.parent_id AND ar2.path = 'publications'
    WHERE ar1.path = 'publications' AND ar1.parent_id = ANY($1) AND ar2.parent_id = ANY($1)
    GROUP BY ar1.parent_id, ar2.parent_id
    HAVING COUNT(DISTINCT ar1.publications_id) >= 3
    LIMIT 3000
  `, [[...authorIdSet]])
  let caEdges = 0
  for (const e of coauthorEdges) {
    addEdge(`author-${e.a1}`, `author-${e.a2}`, parseInt(e.shared))
    caEdges++
  }
  console.log(`  ${caEdges} co-authorship edges`)

  // Author ↔ Entity (authors linked to the entities they study most)
  const { rows: authorEntityLinks } = await db.query(`
    SELECT ar.parent_id as author_id, em.entity_type, em.entity_id,
      COUNT(DISTINCT em.item_id) as shared
    FROM authors_rels ar
    JOIN entity_mentions em ON em.item_id = ar.publications_id AND em.collection = 'publications'
    WHERE ar.parent_id = ANY($1) AND ar.path = 'publications'
      AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
    GROUP BY ar.parent_id, em.entity_type, em.entity_id
    HAVING COUNT(DISTINCT em.item_id) >= 3
    ORDER BY shared DESC
    LIMIT 5000
  `, [[...authorIdSet]])
  let aeEdges = 0
  for (const e of authorEntityLinks) {
    if (entityTypeIds.get(e.entity_type)?.has(e.entity_id)) {
      addEdge(`author-${e.author_id}`, `${e.entity_type}-${e.entity_id}`, parseInt(e.shared))
      aeEdges++
    }
  }
  console.log(`  ${aeEdges} author↔entity edges`)

  // Pub↔Pub citation edges
  const { rows: citations } = await db.query(`
    SELECT source_publication_id as src, target_publication_id as tgt
    FROM references_cited
    WHERE source_publication_id = ANY($1) AND target_publication_id = ANY($1)
  `, [[...pubIdSet]])
  let citEdges = 0
  for (const e of citations) {
    addEdge(`pub-${e.src}`, `pub-${e.tgt}`, 2)
    citEdges++
  }
  console.log(`  ${citEdges} pub↔pub citation edges`)

  // Document ↔ Entity
  const docIdSet = new Set(documents.map((d: any) => d.id))
  const { rows: docEntityLinks } = await db.query(`
    SELECT em.entity_type, em.entity_id, em.item_id
    FROM entity_mentions em
    WHERE em.collection = 'documents' AND em.item_id = ANY($1)
      AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
    LIMIT 15000
  `, [[...docIdSet]])
  let docEntEdges = 0
  for (const e of docEntityLinks) {
    if (entityTypeIds.get(e.entity_type)?.has(e.entity_id) && docIdSet.has(e.item_id)) {
      addEdge(`document-${e.item_id}`, `${e.entity_type}-${e.entity_id}`, 1)
      docEntEdges++
    }
  }
  console.log(`  ${docEntEdges} document↔entity edges`)

  // Stakeholder ↔ Document & Publication
  const stakeholderIdSet = new Set(stakeholders.map((s: any) => s.id))
  const { rows: stakeholderLinks } = await db.query(`
    SELECT em.entity_id, em.collection, em.item_id
    FROM entity_mentions em
    WHERE em.entity_type = 'stakeholder'
      AND em.entity_id = ANY($1)
      AND ((em.collection = 'documents' AND em.item_id = ANY($2))
        OR (em.collection = 'publications' AND em.item_id = ANY($3)))
    LIMIT 20000
  `, [[...stakeholderIdSet], [...docIdSet], [...pubIdSet]])
  let shEdges = 0
  for (const e of stakeholderLinks) {
    const itemNode = e.collection === 'documents' ? `document-${e.item_id}` : `pub-${e.item_id}`
    addEdge(`stakeholder-${e.entity_id}`, itemNode, 1)
    shEdges++
  }
  console.log(`  ${shEdges} stakeholder↔item edges`)

  // Document ↔ Publication citations
  const { rows: docPubCitations } = await db.query(`
    SELECT source_document_id as doc_id, target_publication_id as pub_id
    FROM references_cited
    WHERE source_document_id = ANY($1) AND target_publication_id = ANY($2)
  `, [[...docIdSet], [...pubIdSet]])
  let dpcEdges = 0
  for (const e of docPubCitations) {
    addEdge(`document-${e.doc_id}`, `pub-${e.pub_id}`, 2)
    dpcEdges++
  }
  console.log(`  ${dpcEdges} document→publication citation edges`)

  // Document ↔ Document citations
  const { rows: docDocCitations } = await db.query(`
    SELECT source_document_id as src, target_document_id as tgt
    FROM references_cited
    WHERE source_document_id = ANY($1) AND target_document_id = ANY($1)
  `, [[...docIdSet]])
  let ddcEdges = 0
  for (const e of docDocCitations) {
    addEdge(`document-${e.src}`, `document-${e.tgt}`, 2)
    ddcEdges++
  }
  console.log(`  ${ddcEdges} document↔document citation edges`)

  // Author ↔ Document (authors who wrote documents)
  const { rows: authorDocLinks } = await db.query(`
    SELECT parent_id as author_id, documents_id as doc_id
    FROM authors_rels
    WHERE parent_id = ANY($1) AND documents_id = ANY($2) AND path = 'documents'
  `, [[...authorIdSet], [...docIdSet]])
  let adEdges = 0
  for (const e of authorDocLinks) {
    addEdge(`author-${e.author_id}`, `document-${e.doc_id}`, 1)
    adEdges++
  }
  console.log(`  ${adEdges} author↔document edges`)

  // Dataset ↔ Entity (entities mentioned in datasets)
  const dsIdSet = new Set(datasets.map((d: any) => d.id))
  const { rows: datasetEntityLinks } = await db.query(`
    SELECT em.entity_type, em.entity_id, em.item_id
    FROM entity_mentions em
    WHERE em.collection = 'datasets' AND em.item_id = ANY($1)
      AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
    LIMIT 10000
  `, [[...dsIdSet]])
  let deEdges = 0
  for (const e of datasetEntityLinks) {
    if (entityTypeIds.get(e.entity_type)?.has(e.entity_id)) {
      addEdge(`dataset-${e.item_id}`, `${e.entity_type}-${e.entity_id}`, 1)
      deEdges++
    }
  }
  console.log(`  ${deEdges} dataset↔entity edges`)

  // Dataset ↔ Publication (three sources: data_repositories, references_cited, datasets_rels)
  let dpEdges = 0

  // Via data_repositories (VLM-extracted links)
  const { rows: dpViaRepos } = await db.query(`
    SELECT publication_id, linked_dataset_id
    FROM data_repositories
    WHERE linked_dataset_id = ANY($1) AND publication_id = ANY($2)
  `, [[...dsIdSet], [...pubIdSet]])
  for (const e of dpViaRepos) {
    addEdge(`dataset-${e.linked_dataset_id}`, `pub-${e.publication_id}`, 2)
    dpEdges++
  }

  // Via references_cited (publications citing datasets)
  const { rows: dpViaCitations } = await db.query(`
    SELECT source_publication_id as pub_id, target_dataset_id as ds_id
    FROM references_cited
    WHERE target_dataset_id = ANY($1) AND source_publication_id = ANY($2)
  `, [[...dsIdSet], [...pubIdSet]])
  for (const e of dpViaCitations) {
    addEdge(`pub-${e.pub_id}`, `dataset-${e.ds_id}`, 2)
    dpEdges++
  }

  // Via datasets_rels (Payload relationship field)
  const { rows: dpViaRels } = await db.query(`
    SELECT parent_id as ds_id, publications_id as pub_id
    FROM datasets_rels
    WHERE publications_id IS NOT NULL AND parent_id = ANY($1) AND publications_id = ANY($2)
  `, [[...dsIdSet], [...pubIdSet]])
  for (const e of dpViaRels) {
    addEdge(`dataset-${e.ds_id}`, `pub-${e.pub_id}`, 2)
    dpEdges++
  }

  console.log(`  ${dpEdges} dataset↔publication edges`)

  // Dataset ↔ Author (shared authorship)
  const { rows: datasetAuthorLinks } = await db.query(`
    SELECT parent_id as author_id, datasets_id as ds_id
    FROM authors_rels
    WHERE parent_id = ANY($1) AND datasets_id = ANY($2) AND path = 'datasets'
  `, [[...authorIdSet], [...dsIdSet]])
  let daEdges = 0
  for (const e of datasetAuthorLinks) {
    addEdge(`author-${e.author_id}`, `dataset-${e.ds_id}`, 1)
    daEdges++
  }
  console.log(`  ${daEdges} dataset↔author edges`)

  console.log(`  Total edges: ${graph.size}`)

  // Remove isolated nodes (no edges)
  const isolated: string[] = []
  graph.forEachNode((node: string) => { if (graph.degree(node) === 0) isolated.push(node) })
  for (const n of isolated) graph.dropNode(n)
  console.log(`  Removed ${isolated.length} isolated nodes → ${graph.order} nodes remaining`)

  // Update degree from actual graph edges
  graph.forEachNode((node: string) => {
    graph.setNodeAttribute(node, 'degree', graph.degree(node))
  })

  // Run ForceAtlas2
  console.log('  Running ForceAtlas2 layout...')
  forceAtlas2.assign(graph, {
    iterations: 800,
    settings: {
      gravity: 0.5,
      scalingRatio: 50,
      strongGravityMode: true,
      barnesHutOptimize: true,
      edgeWeightInfluence: 0.3,
    },
  })

  // Normalize coordinates to [-500, 500] range so Sigma's auto-fit works well
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  graph.forEachNode((_n: string, attrs: any) => {
    if (attrs.x < minX) minX = attrs.x
    if (attrs.x > maxX) maxX = attrs.x
    if (attrs.y < minY) minY = attrs.y
    if (attrs.y > maxY) maxY = attrs.y
  })
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  graph.forEachNode((n: string) => {
    const x = graph.getNodeAttribute(n, 'x')
    const y = graph.getNodeAttribute(n, 'y')
    graph.setNodeAttribute(n, 'x', ((x - minX) / rangeX - 0.5) * 1000)
    graph.setNodeAttribute(n, 'y', ((y - minY) / rangeY - 0.5) * 1000)
  })

  // Export
  const output: any = {
    entityType: 'unified',
    colorField: 'nodeType',
    nodes: [] as any[],
    edges: [] as any[],
    meta: { minDegree, nodeCount: graph.order, edgeCount: graph.size, generatedAt: new Date().toISOString() },
  }
  graph.forEachNode((id: string, attrs: any) => { output.nodes.push({ id, ...attrs }) })
  graph.forEachEdge((_e: string, attrs: any, source: string, target: string) => {
    output.edges.push({ source, target, weight: attrs.weight })
  })

  mkdirSync('public/graph', { recursive: true })
  const outPath = 'public/graph/unified.json'
  writeFileSync(outPath, JSON.stringify(output))
  console.log(`  Written to ${outPath} (${(JSON.stringify(output).length / 1024).toFixed(0)}KB)`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
