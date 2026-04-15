/**
 * Pre-compute co-occurrence graphs for entity explore pages.
 * Works for any entity type: concepts, species, protocols.
 *
 * Usage:
 *   npx tsx scripts/build-explore-graph.ts --type=concept [--min-pubs=5]
 *   npx tsx scripts/build-explore-graph.ts --type=species [--min-pubs=5]
 *   npx tsx scripts/build-explore-graph.ts --type=protocol [--min-pubs=5]
 *   npx tsx scripts/build-explore-graph.ts --type=all [--min-pubs=5]
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'

const Graph = (await import('graphology')).default
const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default

const args = process.argv.slice(2)
const typeArg = args.find((a) => a.startsWith('--type='))?.split('=')[1] || 'all'
const minPubs = parseInt(args.find((a) => a.startsWith('--min-pubs='))?.split('=')[1] || '5')

interface EntityConfig {
  entityType: string
  table: string
  nameCol: string
  extraCols: string       // additional columns for node attributes
  colorField: string      // which attribute to use for coloring
  outputFile: string
  extraWhere?: string     // additional WHERE clause for node selection
}

const CONFIGS: EntityConfig[] = [
  {
    entityType: 'concept',
    table: 'concepts',
    nameCol: 'name',
    extraCols: 'concept_type, scope, disciplines, definition',
    colorField: 'scope',
    outputFile: 'public/graph/concepts.json',
  },
  {
    entityType: 'species',
    table: 'species',
    nameCol: 'canonical_name',
    extraCols: 'kingdom, family, rank, common_names',
    colorField: 'kingdom',
    outputFile: 'public/graph/species.json',
  },
  {
    entityType: 'protocol',
    table: 'protocols',
    nameCol: 'name',
    extraCols: 'category, subcategory, disciplines, standardized, description',
    colorField: 'category',
    outputFile: 'public/graph/protocols.json',
  },
  {
    entityType: 'place',
    table: 'places',
    nameCol: 'name',
    extraCols: 'place_type, scale, elevation_m, habitat_types, lat, lon',
    colorField: 'place_type',
    outputFile: 'public/graph/places.json',
    extraWhere: "AND scale IN ('site', 'local') AND place_type NOT IN ('country', 'state', 'region')",
  },
]

async function buildGraph(config: EntityConfig, db: pg.Pool) {
  console.log(`\nBuilding ${config.entityType} graph (min ${minPubs} publications)...`)

  const { rows: entities } = await db.query(`
    SELECT id, ${config.nameCol} as name, publication_count, ${config.extraCols}
    FROM ${config.table}
    WHERE publication_count >= 1 ${config.extraWhere || ''}
    ORDER BY publication_count DESC
  `)
  console.log(`  ${entities.length} ${config.entityType}s`)

  const { rows: edges } = await db.query(`
    SELECT em1.entity_id as source, em2.entity_id as target,
      COUNT(DISTINCT (em1.collection || ':' || em1.item_id)) as weight
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.item_id = em1.item_id AND em2.collection = em1.collection
      AND em2.entity_type = $1 AND em2.entity_id > em1.entity_id
    JOIN ${config.table} c1 ON c1.id = em1.entity_id AND c1.publication_count >= 1
    JOIN ${config.table} c2 ON c2.id = em2.entity_id AND c2.publication_count >= 1
    WHERE em1.entity_type = $1
    GROUP BY em1.entity_id, em2.entity_id
    HAVING COUNT(*) >= 1
    ORDER BY weight DESC
  `, [config.entityType])
  console.log(`  ${edges.length} co-occurrence edges`)

  // For protocols: add embedding similarity edges and shared-species edges
  if (config.entityType === 'protocol') {
    // Embedding similarity: protocols with cosine similarity >= 0.7
    const { rows: simEdges } = await db.query(`
      SELECT p1.id as source, p2.id as target,
        (p1.embedding <=> p2.embedding) as distance
      FROM protocols p1
      JOIN protocols p2 ON p2.id > p1.id
        AND p1.publication_count >= 1 AND p2.publication_count >= 1
        AND p1.embedding IS NOT NULL AND p2.embedding IS NOT NULL
      WHERE (p1.embedding <=> p2.embedding) < 0.3
      ORDER BY distance
    `)
    // Merge with existing edges (don't duplicate)
    const edgeSet = new Set(edges.map((e: any) => `${e.source}-${e.target}`))
    let simAdded = 0
    for (const e of simEdges) {
      const key1 = `${e.source}-${e.target}`
      const key2 = `${e.target}-${e.source}`
      if (!edgeSet.has(key1) && !edgeSet.has(key2)) {
        const sim = 1 - parseFloat(e.distance)
        edges.push({ source: e.source, target: e.target, weight: Math.round(sim * 5) })
        edgeSet.add(key1)
        simAdded++
      }
    }
    console.log(`  ${simAdded} embedding similarity edges added`)

    // Shared-species edges: protocols used on the same species
    const { rows: speciesEdges } = await db.query(`
      SELECT em1.entity_id as source, em2.entity_id as target,
        COUNT(DISTINCT sp1.entity_id) as shared_species
      FROM entity_mentions em1
      JOIN entity_mentions sp1 ON sp1.item_id = em1.item_id AND sp1.collection = em1.collection AND sp1.entity_type = 'species'
      JOIN entity_mentions em2 ON em2.entity_type = 'protocol' AND em2.entity_id > em1.entity_id
      JOIN entity_mentions sp2 ON sp2.item_id = em2.item_id AND sp2.collection = em2.collection AND sp2.entity_type = 'species' AND sp2.entity_id = sp1.entity_id
      WHERE em1.entity_type = 'protocol'
        AND em1.entity_id IN (SELECT id FROM protocols WHERE publication_count >= 1)
        AND em2.entity_id IN (SELECT id FROM protocols WHERE publication_count >= 1)
      GROUP BY em1.entity_id, em2.entity_id
      HAVING COUNT(DISTINCT sp1.entity_id) >= 2
      ORDER BY shared_species DESC
    `)
    let speciesAdded = 0
    for (const e of speciesEdges) {
      const key1 = `${e.source}-${e.target}`
      const key2 = `${e.target}-${e.source}`
      if (!edgeSet.has(key1) && !edgeSet.has(key2)) {
        edges.push({ source: e.source, target: e.target, weight: parseInt(e.shared_species) })
        edgeSet.add(key1)
        speciesAdded++
      }
    }
    console.log(`  ${speciesAdded} shared-species edges added`)
    console.log(`  Total protocol edges: ${edges.length}`)
  }

  const graph = new Graph()
  const entityIds = new Set(entities.map((e: any) => e.id))

  for (const e of entities) {
    const attrs: any = {
      label: e.name,
      degree: e.publication_count || 0,
      size: 3 + Math.log(e.publication_count + 1) * 3,
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
    }
    // Copy extra columns as node attributes
    for (const col of config.extraCols.split(',').map((c) => c.trim())) {
      if (e[col] !== undefined) {
        const val = e[col]
        // Truncate long text fields
        attrs[col] = typeof val === 'string' && val.length > 150 ? val.slice(0, 150) : val
      }
    }
    graph.addNode(String(e.id), attrs)
  }

  for (const e of edges) {
    if (entityIds.has(e.source) && entityIds.has(e.target)) {
      try { graph.addEdge(String(e.source), String(e.target), { weight: parseInt(e.weight) }) }
      catch { /* skip duplicates */ }
    }
  }

  console.log('  Running ForceAtlas2 layout...')
  forceAtlas2.assign(graph, {
    iterations: 300,
    settings: { gravity: 0.5, scalingRatio: 15, strongGravityMode: true, barnesHutOptimize: true, edgeWeightInfluence: 1 },
  })

  const output: any = {
    entityType: config.entityType,
    colorField: config.colorField,
    nodes: [] as any[],
    edges: [] as any[],
    meta: { minPubs, nodeCount: graph.order, edgeCount: graph.size, generatedAt: new Date().toISOString() },
  }

  graph.forEachNode((id, attrs) => {
    output.nodes.push({ id, ...attrs })
  })

  graph.forEachEdge((_edge, attrs, source, target) => {
    output.edges.push({ source, target, weight: attrs.weight })
  })

  mkdirSync('public/graph', { recursive: true })
  writeFileSync(config.outputFile, JSON.stringify(output))
  const sizeKB = (JSON.stringify(output).length / 1024).toFixed(0)
  console.log(`  Written to ${config.outputFile} (${sizeKB}KB)`)
}

async function main() {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const configs = typeArg === 'all' ? CONFIGS : CONFIGS.filter((c) => c.entityType === typeArg)
  if (configs.length === 0) { console.error(`Unknown type: ${typeArg}`); process.exit(1) }

  for (const config of configs) {
    await buildGraph(config, db)
  }

  await db.end()
  console.log('\nDone.')
}

main().catch((err) => { console.error(err); process.exit(1) })
