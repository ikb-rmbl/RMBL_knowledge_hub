/**
 * Pre-compute co-authorship and citation graphs for collection explore pages.
 *
 * Usage:
 *   npx tsx scripts/build-collection-graph.ts --type=authors [--min-works=5]
 *   npx tsx scripts/build-collection-graph.ts --type=publications [--min-cites=5]
 *   npx tsx scripts/build-collection-graph.ts --type=datasets [--min-links=2]
 *   npx tsx scripts/build-collection-graph.ts --type=all
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'

const Graph = (await import('graphology')).default
const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default

const args = process.argv.slice(2)
const typeArg = args.find((a) => a.startsWith('--type='))?.split('=')[1] || 'all'
const minWorks = parseInt(args.find((a) => a.startsWith('--min-works='))?.split('=')[1] || '3')
const minCites = parseInt(args.find((a) => a.startsWith('--min-cites='))?.split('=')[1] || '2')

// Map topics to broad groups for coloring
const TOPIC_GROUPS: Record<string, string> = {}
const TOPIC_GROUP_DEFS: [string, string[]][] = [
  ['Life Sciences', ['Flowering & Pollination', 'Wildlife Behavior', 'Alpine & Subalpine Ecology', 'Forest Ecology', 'Freshwater Ecology', 'Plant Biology', 'Insect Ecology', 'Vertebrate Biology', 'Microbial Ecology', 'Genetics & Evolution', 'Biodiversity & Conservation', 'Invasive Species & Disturbance']],
  ['Earth & Water', ['Hydrology & Watersheds', 'Snow & Ice', 'Groundwater', 'Water Quality', 'Geology & Tectonics', 'Soil Science', 'Geochemistry & Isotopes', 'Paleontology & Paleoecology']],
  ['Climate', ['Climate Change Impacts', 'Weather & Atmospheric Science', 'Biogeochemical Cycling', 'Environmental Contamination']],
  ['Human Dimensions', ['Mining & Mineral Resources', 'Land & Water Management', 'Archaeology & Cultural History', 'Community Planning', 'Energy Development', 'Recreation & Tourism']],
  ['Technology & Data', ['Remote Sensing & Imagery', 'Geospatial Analysis', 'Field Methods & Monitoring', 'Data Science & Modeling']],
  ['Places & Programs', ['RMBL & Gothic', 'Gunnison Basin', 'Western Colorado Landscapes', 'Research Programs']],
  ['Education', ['Science Education & Pedagogy', 'Mentoring & Research Training']],
]
for (const [group, topics] of TOPIC_GROUP_DEFS) {
  for (const t of topics) TOPIC_GROUPS[t] = group
}

async function getPublicationTopicGroup(db: pg.Pool, pubId: number): Promise<string> {
  // Already cached in batch below
  return 'Other'
}

async function batchPublicationGroups(db: pg.Pool, pubIds: number[]): Promise<Map<number, string>> {
  if (pubIds.length === 0) return new Map()
  const { rows } = await db.query(`
    SELECT pr.parent_id as pub_id, t.name as topic
    FROM publications_rels pr
    JOIN topics t ON t.id = pr.topics_id
    WHERE pr.path = 'researchTopics' AND pr.parent_id = ANY($1)
      AND t.name != 'Other'
  `, [pubIds])

  // For each pub, find the most common topic group (excluding RMBL & Gothic which is too generic)
  const pubTopics = new Map<number, Map<string, number>>()
  for (const r of rows) {
    const group = TOPIC_GROUPS[r.topic]
    if (!group || group === 'Places & Programs') continue
    if (!pubTopics.has(r.pub_id)) pubTopics.set(r.pub_id, new Map())
    const counts = pubTopics.get(r.pub_id)!
    counts.set(group, (counts.get(group) || 0) + 1)
  }

  const result = new Map<number, string>()
  for (const [pubId, counts] of pubTopics) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    result.set(pubId, top ? top[0] : 'Other')
  }
  return result
}

async function buildAuthorGraph(db: pg.Pool) {
  console.log(`\nBuilding author co-authorship graph (min ${minWorks} works)...`)

  const { rows: authors } = await db.query(`
    SELECT id, display_name, affiliation, work_count
    FROM authors WHERE work_count >= $1
    ORDER BY work_count DESC
  `, [minWorks])
  console.log(`  ${authors.length} authors`)

  // Derive dominant research area per author from their publications' topics
  const authorIds = authors.map((a: any) => a.id)
  const { rows: authorTopics } = await db.query(`
    SELECT ar.parent_id as author_id, t.name as topic
    FROM authors_rels ar
    JOIN publications_rels pr ON pr.parent_id = ar.publications_id AND pr.path = 'researchTopics'
    JOIN topics t ON t.id = pr.topics_id
    WHERE ar.parent_id = ANY($1) AND ar.path = 'publications' AND t.name != 'Other'
  `, [authorIds])

  const authorGroupCounts = new Map<number, Map<string, number>>()
  for (const r of authorTopics) {
    const group = TOPIC_GROUPS[r.topic]
    if (!group || group === 'Places & Programs') continue
    if (!authorGroupCounts.has(r.author_id)) authorGroupCounts.set(r.author_id, new Map())
    const counts = authorGroupCounts.get(r.author_id)!
    counts.set(group, (counts.get(group) || 0) + 1)
  }

  const authorGroup = new Map<number, string>()
  for (const [aid, counts] of authorGroupCounts) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    authorGroup.set(aid, top ? top[0] : 'Other')
  }
  console.log(`  ${authorGroup.size} authors with research area assigned`)

  const { rows: edges } = await db.query(`
    WITH pairs AS (
      SELECT ar1.parent_id AS source, ar2.parent_id AS target
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'publications'
      JOIN authors a1 ON a1.id = ar1.parent_id AND a1.work_count >= $1
      JOIN authors a2 ON a2.id = ar2.parent_id AND a2.work_count >= $1
      WHERE ar1.path = 'publications'
      UNION ALL
      SELECT ar1.parent_id, ar2.parent_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.datasets_id = ar1.datasets_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'datasets'
      JOIN authors a1 ON a1.id = ar1.parent_id AND a1.work_count >= $1
      JOIN authors a2 ON a2.id = ar2.parent_id AND a2.work_count >= $1
      WHERE ar1.path = 'datasets'
      UNION ALL
      SELECT ar1.parent_id, ar2.parent_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.documents_id = ar1.documents_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'documents'
      JOIN authors a1 ON a1.id = ar1.parent_id AND a1.work_count >= $1
      JOIN authors a2 ON a2.id = ar2.parent_id AND a2.work_count >= $1
      WHERE ar1.path = 'documents'
    )
    SELECT source, target, COUNT(*) AS shared_pubs
    FROM pairs GROUP BY source, target
    HAVING COUNT(*) >= 1
    ORDER BY shared_pubs DESC
  `, [minWorks])
  console.log(`  ${edges.length} co-authorship edges`)

  const graph = new Graph()
  const authorIdSet = new Set(authors.map((a: any) => a.id))

  for (const a of authors) {
    graph.addNode(String(a.id), {
      label: a.display_name,
      affiliation: a.affiliation || null,
      research_area: authorGroup.get(a.id) || 'Other',
      degree: a.work_count || 0,
      size: 3 + Math.log(a.work_count + 1) * 2.5,
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
    })
  }

  for (const e of edges) {
    if (authorIdSet.has(e.source) && authorIdSet.has(e.target)) {
      try { graph.addEdge(String(e.source), String(e.target), { weight: parseInt(e.shared_pubs) }) }
      catch {}
    }
  }

  // Set degree and size from actual graph edge count
  graph.forEachNode((node: string) => {
    graph.setNodeAttribute(node, 'degree', graph.degree(node))
    graph.setNodeAttribute(node, 'size', 3 + Math.log(graph.degree(node) + 1) * 2)
  })

  console.log('  Running ForceAtlas2 layout...')
  forceAtlas2.assign(graph, {
    iterations: 300,
    settings: { gravity: 0.3, scalingRatio: 20, strongGravityMode: true, barnesHutOptimize: true, edgeWeightInfluence: 1 },
  })

  return exportGraph(graph, 'author', 'research_area', 'public/graph/authors.json')
}

async function buildPublicationGraph(db: pg.Pool) {
  console.log(`\nBuilding publication citation graph (min ${minCites} citations)...`)

  const { rows: pubs } = await db.query(`
    SELECT id, title, publication_type, year, journal,
      coalesce(external_citation_count, 0) as cite_count
    FROM publications
    WHERE coalesce(external_citation_count, 0) >= $1 OR id IN (
      SELECT DISTINCT target_publication_id FROM references_cited WHERE target_publication_id IS NOT NULL
    )
    ORDER BY external_citation_count DESC NULLS LAST
  `, [minCites])
  console.log(`  ${pubs.length} publications`)

  const pubIds = new Set(pubs.map((p: any) => p.id))

  // Citation edges
  const { rows: citeEdges } = await db.query(`
    SELECT source_publication_id as source, target_publication_id as target
    FROM references_cited
    WHERE source_publication_id = ANY($1) AND target_publication_id = ANY($1)
  `, [[...pubIds]])
  console.log(`  ${citeEdges.length} citation edges`)

  // Co-authorship edges (publications sharing 2+ authors)
  const { rows: coauthorEdges } = await db.query(`
    SELECT ar1.publications_id as source, ar2.publications_id as target,
      COUNT(DISTINCT ar1.parent_id) as shared_authors
    FROM authors_rels ar1
    JOIN authors_rels ar2 ON ar2.parent_id = ar1.parent_id
      AND ar2.publications_id > ar1.publications_id AND ar2.path = 'publications'
    WHERE ar1.path = 'publications'
      AND ar1.publications_id = ANY($1) AND ar2.publications_id = ANY($1)
    GROUP BY ar1.publications_id, ar2.publications_id
    HAVING COUNT(DISTINCT ar1.parent_id) >= 2
    ORDER BY shared_authors DESC
    LIMIT 3000
  `, [[...pubIds]])
  console.log(`  ${coauthorEdges.length} shared-author edges`)

  // Derive topic group per publication
  const pubIdList = pubs.map((p: any) => p.id)
  const pubGroups = await batchPublicationGroups(db, pubIdList)
  console.log(`  ${pubGroups.size} publications with topic group assigned`)

  const graph = new Graph()
  for (const p of pubs) {
    graph.addNode(String(p.id), {
      label: p.title.slice(0, 60),
      research_area: pubGroups.get(p.id) || 'Other',
      year: p.year,
      journal: p.journal || null,
      cite_count: p.cite_count || 0,
      degree: p.cite_count || 0,
      size: 3 + Math.log((p.cite_count || 0) + 1) * 1.5,
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
    })
  }

  const edgeSet = new Set<string>()
  for (const e of citeEdges) {
    if (pubIds.has(e.source) && pubIds.has(e.target)) {
      const key = `${e.source}-${e.target}`
      if (!edgeSet.has(key)) {
        try { graph.addEdge(String(e.source), String(e.target), { weight: 2 }); edgeSet.add(key) }
        catch {}
      }
    }
  }
  for (const e of coauthorEdges) {
    const key1 = `${e.source}-${e.target}`, key2 = `${e.target}-${e.source}`
    if (!edgeSet.has(key1) && !edgeSet.has(key2)) {
      try { graph.addEdge(String(e.source), String(e.target), { weight: parseInt(e.shared_authors) }); edgeSet.add(key1) }
      catch {}
    }
  }

  // Set degree from graph edges, but keep size based on citation count
  graph.forEachNode((node: string) => {
    graph.setNodeAttribute(node, 'degree', graph.degree(node))
    const cites = graph.getNodeAttribute(node, 'cite_count') || 0
    graph.setNodeAttribute(node, 'size', 3 + Math.log(cites + 1) * 1.5)
  })

  console.log('  Running ForceAtlas2 layout...')
  forceAtlas2.assign(graph, {
    iterations: 300,
    settings: { gravity: 0.5, scalingRatio: 15, strongGravityMode: true, barnesHutOptimize: true, edgeWeightInfluence: 1 },
  })

  return exportGraph(graph, 'publication', 'research_area', 'public/graph/publications.json')
}

async function buildDatasetGraph(db: pg.Pool) {
  console.log(`\nBuilding dataset similarity graph...`)

  const { rows: datasets } = await db.query(`
    SELECT id, title, publication_year, resource_type
    FROM datasets
    WHERE id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'datasets')
    ORDER BY publication_year DESC NULLS LAST
    LIMIT 2000
  `)
  console.log(`  ${datasets.length} datasets with entity links`)

  const dsIds = datasets.map((d: any) => d.id)

  // Shared-entity edges (datasets mentioning the same species/concepts/protocols)
  const { rows: entityEdges } = await db.query(`
    SELECT em1.item_id as source, em2.item_id as target,
      COUNT(DISTINCT em1.entity_id) as shared_entities
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.entity_id = em1.entity_id AND em2.entity_type = em1.entity_type
      AND em2.collection = 'datasets' AND em2.item_id > em1.item_id
    WHERE em1.collection = 'datasets'
      AND em1.item_id = ANY($1) AND em2.item_id = ANY($1)
      AND em1.entity_type != 'place'
    GROUP BY em1.item_id, em2.item_id
    HAVING COUNT(DISTINCT em1.entity_id) >= 1
    ORDER BY shared_entities DESC
  `, [dsIds])
  console.log(`  ${entityEdges.length} shared-entity edges`)

  // Shared-author edges
  const { rows: authorEdges } = await db.query(`
    SELECT ar1.datasets_id as source, ar2.datasets_id as target,
      COUNT(DISTINCT ar1.parent_id) as shared_authors
    FROM authors_rels ar1
    JOIN authors_rels ar2 ON ar2.parent_id = ar1.parent_id
      AND ar2.datasets_id > ar1.datasets_id AND ar2.path = 'datasets'
    WHERE ar1.path = 'datasets'
      AND ar1.datasets_id = ANY($1) AND ar2.datasets_id = ANY($1)
    GROUP BY ar1.datasets_id, ar2.datasets_id
    HAVING COUNT(DISTINCT ar1.parent_id) >= 1
    ORDER BY shared_authors DESC
  `, [dsIds])
  console.log(`  ${authorEdges.length} shared-author edges`)

  // Derive research area per dataset from co-occurring concept disciplines
  const { rows: dsTopics } = await db.query(`
    SELECT em.item_id as ds_id, unnest(c.disciplines) as discipline
    FROM entity_mentions em
    JOIN concepts c ON c.id = em.entity_id
    WHERE em.collection = 'datasets' AND em.entity_type = 'concept'
      AND em.item_id = ANY($1) AND c.disciplines IS NOT NULL
  `, [dsIds])

  const DISCIPLINE_TO_GROUP: Record<string, string> = {
    ecology: 'Life Sciences', evolution: 'Life Sciences', molecular: 'Life Sciences',
    physiology: 'Life Sciences', earth_science: 'Earth & Water', methods: 'Technology & Data',
  }
  const dsGroupCounts = new Map<number, Map<string, number>>()
  for (const r of dsTopics) {
    const group = DISCIPLINE_TO_GROUP[r.discipline] || 'Other'
    if (!dsGroupCounts.has(r.ds_id)) dsGroupCounts.set(r.ds_id, new Map())
    const counts = dsGroupCounts.get(r.ds_id)!
    counts.set(group, (counts.get(group) || 0) + 1)
  }
  const dsGroup = new Map<number, string>()
  for (const [dsId, counts] of dsGroupCounts) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    dsGroup.set(dsId, top ? top[0] : 'Other')
  }
  console.log(`  ${dsGroup.size} datasets with research area assigned`)

  const graph = new Graph()
  const dsIdSet = new Set(dsIds)

  for (const d of datasets) {
    graph.addNode(String(d.id), {
      label: d.title.slice(0, 60),
      research_area: dsGroup.get(d.id) || 'Other',
      year: d.publication_year,
      degree: 0,
      size: 5,
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
    })
  }

  const edgeSet = new Set<string>()
  for (const e of [...entityEdges, ...authorEdges]) {
    const key1 = `${e.source}-${e.target}`, key2 = `${e.target}-${e.source}`
    if (!edgeSet.has(key1) && !edgeSet.has(key2) && dsIdSet.has(e.source) && dsIdSet.has(e.target)) {
      const weight = parseInt(e.shared_entities || e.shared_authors || '1')
      try { graph.addEdge(String(e.source), String(e.target), { weight }); edgeSet.add(key1) }
      catch {}
    }
  }



  // Set degree and size from actual graph edge count
  graph.forEachNode((node: string) => {
    graph.setNodeAttribute(node, 'degree', graph.degree(node))
    graph.setNodeAttribute(node, 'size', 3 + Math.log(graph.degree(node) + 1) * 2)
  })

  console.log('  Running ForceAtlas2 layout...')
  forceAtlas2.assign(graph, {
    iterations: 300,
    settings: { gravity: 0.5, scalingRatio: 15, strongGravityMode: true, barnesHutOptimize: true, edgeWeightInfluence: 1 },
  })

  return exportGraph(graph, 'dataset', 'research_area', 'public/graph/datasets.json')
}

function exportGraph(graph: any, entityType: string, colorField: string, outPath: string) {
  const output: any = {
    entityType,
    colorField,
    nodes: [] as any[],
    edges: [] as any[],
    meta: { nodeCount: graph.order, edgeCount: graph.size, generatedAt: new Date().toISOString() },
  }
  graph.forEachNode((id: string, attrs: any) => { output.nodes.push({ id, ...attrs }) })
  graph.forEachEdge((_e: string, attrs: any, source: string, target: string) => {
    output.edges.push({ source, target, weight: attrs.weight })
  })
  mkdirSync('public/graph', { recursive: true })
  writeFileSync(outPath, JSON.stringify(output))
  console.log(`  Written to ${outPath} (${(JSON.stringify(output).length / 1024).toFixed(0)}KB, ${output.meta.nodeCount} nodes, ${output.meta.edgeCount} edges)`)
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub', max: 2 })
  const types = typeArg === 'all' ? ['authors', 'publications', 'datasets'] : [typeArg]

  for (const t of types) {
    if (t === 'authors') await buildAuthorGraph(db)
    else if (t === 'publications') await buildPublicationGraph(db)
    else if (t === 'datasets') await buildDatasetGraph(db)
    else { console.error(`Unknown type: ${t}`); process.exit(1) }
  }

  await db.end()
  console.log('\nDone.')
}

main().catch((err) => { console.error(err); process.exit(1) })
