/**
 * Pre-compute neighborhood subgraph layouts.
 *
 * For each neighborhood, extracts the subgraph from unified.json,
 * includes cross-community authors with 2+ edges, runs ForceAtlas2,
 * and writes the result to public/graph/neighborhoods/<id>.json.
 *
 * This avoids running FA2 on every page load.
 *
 * Usage:
 *   npx tsx scripts/layout-neighborhoods.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import pg from 'pg'
import './lib/config.js'

async function main() {
  console.log('Layout Neighborhood Subgraphs')
  console.log('=============================')

  const unifiedPath = 'public/graph/unified.json'
  if (!existsSync(unifiedPath)) {
    console.error('Missing unified.json — run build-unified-graph.ts first')
    process.exit(1)
  }
  const unified = JSON.parse(readFileSync(unifiedPath, 'utf-8'))
  console.log(`Loaded unified graph: ${unified.nodes.length} nodes, ${unified.edges.length} edges`)

  // Build edge index for fast lookups
  const edgesByNode = new Map<string, { source: string; target: string; weight: number }[]>()
  for (const e of unified.edges) {
    if (!edgesByNode.has(e.source)) edgesByNode.set(e.source, [])
    if (!edgesByNode.has(e.target)) edgesByNode.set(e.target, [])
    edgesByNode.get(e.source)!.push(e)
    edgesByNode.get(e.target)!.push(e)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const { rows: neighborhoods } = await db.query('SELECT id, community_id FROM neighborhoods ORDER BY size DESC')
  console.log(`${neighborhoods.length} neighborhoods`)

  const outDir = 'public/graph/neighborhoods'
  mkdirSync(outDir, { recursive: true })

  const Graph = (await import('graphology')).default
  const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default

  // Index nodes by id
  const nodeById = new Map<string, any>()
  for (const n of unified.nodes) nodeById.set(n.id, n)

  let laid = 0
  for (const nbr of neighborhoods) {
    const communityNodes = unified.nodes.filter((n: any) => n.community === nbr.community_id)
    if (communityNodes.length < 3) continue

    const nodeIds = new Set(communityNodes.map((n: any) => n.id))

    // Include cross-community authors/pubs with 2+ edges into this community
    for (const n of communityNodes) {
      const edges = edgesByNode.get(n.id) || []
      for (const e of edges) {
        const other = e.source === n.id ? e.target : e.source
        if (nodeIds.has(other)) continue
        const otherNode = nodeById.get(other)
        if (!otherNode || (otherNode.nodeType !== 'author' && otherNode.nodeType !== 'publication')) continue
        // Count edges to community members
        const otherEdges = edgesByNode.get(other) || []
        let edgesToCommunity = 0
        for (const e2 of otherEdges) {
          const neighbor = e2.source === other ? e2.target : e2.source
          if (nodeIds.has(neighbor)) edgesToCommunity++
          if (edgesToCommunity >= 2) break
        }
        if (edgesToCommunity >= 2) nodeIds.add(other)
      }
    }

    const subNodes = unified.nodes.filter((n: any) => nodeIds.has(n.id))
    const subEdges = unified.edges.filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target))

    // Run ForceAtlas2
    const g = new Graph()
    for (const n of subNodes) {
      g.addNode(n.id, { ...n, x: Math.random() * 100 - 50, y: Math.random() * 100 - 50 })
    }
    const seen = new Set<string>()
    for (const e of subEdges) {
      const k = `${e.source}--${e.target}`
      if (seen.has(k) || seen.has(`${e.target}--${e.source}`)) continue
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
      seen.add(k)
      try { g.addEdge(e.source, e.target, { weight: e.weight || 1 }) } catch {}
    }
    forceAtlas2.assign(g, {
      iterations: 300,
      settings: { gravity: 1, scalingRatio: 10, strongGravityMode: true, barnesHutOptimize: true },
    })

    const laidOutNodes = subNodes.map((n: any) => {
      const attrs = g.getNodeAttributes(n.id)
      return { ...n, x: attrs.x, y: attrs.y }
    })

    const graphData = {
      entityType: 'unified',
      colorField: 'nodeType',
      nodes: laidOutNodes,
      edges: subEdges,
      meta: { nodeCount: subNodes.length, edgeCount: subEdges.length },
    }

    writeFileSync(`${outDir}/${nbr.id}.json`, JSON.stringify(graphData))
    laid++
  }

  console.log(`Laid out ${laid} neighborhood subgraphs → ${outDir}/`)
  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
