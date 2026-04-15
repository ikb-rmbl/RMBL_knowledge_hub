/**
 * Detect knowledge neighborhoods (communities) in the unified graph.
 *
 * Uses Louvain community detection on the pre-computed unified graph to
 * identify clusters of densely connected entities, authors, publications,
 * and datasets. Each community is labeled by its most prominent members.
 *
 * Output:
 *   - public/graph/communities.json — community metadata + member lists
 *   - Updates unified.json with community assignments per node
 *
 * Usage:
 *   npx tsx scripts/detect-communities.ts [--resolution=1.0]
 */

import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'

const Graph = (await import('graphology')).default
const louvain = (await import('graphology-communities-louvain')).default

const args = process.argv.slice(2)
const resolution = parseFloat(args.find((a) => a.startsWith('--resolution='))?.split('=')[1] || '1.0')

async function main() {
  console.log('Detect Knowledge Neighborhoods')
  console.log('===============================')
  console.log(`Resolution: ${resolution}`)

  // Load the unified graph
  const raw = JSON.parse(readFileSync('public/graph/unified.json', 'utf-8'))
  console.log(`\nLoaded unified graph: ${raw.nodes.length} nodes, ${raw.edges.length} edges`)

  // Build graphology graph
  const graph = new Graph()
  for (const node of raw.nodes) {
    graph.addNode(node.id, { ...node })
  }
  const seenEdges = new Set<string>()
  for (const edge of raw.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
    const k = `${edge.source}--${edge.target}`
    const kr = `${edge.target}--${edge.source}`
    if (seenEdges.has(k) || seenEdges.has(kr)) continue
    seenEdges.add(k)
    try { graph.addEdge(edge.source, edge.target, { weight: edge.weight || 1 }) }
    catch {}
  }

  // Run Louvain community detection
  console.log('\nRunning Louvain community detection...')
  const communities = louvain(graph, {
    resolution,
    getEdgeWeight: 'weight',
  })

  // Assign community IDs to nodes
  const communityMembers = new Map<number, string[]>()
  for (const [nodeId, communityId] of Object.entries(communities)) {
    const cid = communityId as number
    if (!communityMembers.has(cid)) communityMembers.set(cid, [])
    communityMembers.get(cid)!.push(nodeId)
  }

  console.log(`  ${communityMembers.size} communities detected`)

  // Sort communities by size
  const sorted = [...communityMembers.entries()].sort((a, b) => b[1].length - a[1].length)

  // Label each community by its top members per type
  interface CommunityInfo {
    id: number
    size: number
    label: string
    description: string
    topMembers: { type: string; name: string; degree: number }[]
    typeCounts: Record<string, number>
  }

  const communityInfos: CommunityInfo[] = []

  for (const [cid, members] of sorted) {
    if (members.length < 3) continue // skip tiny communities

    // Count node types
    const typeCounts: Record<string, number> = {}
    const memberDetails: { id: string; type: string; label: string; degree: number }[] = []

    for (const nodeId of members) {
      const attrs = graph.getNodeAttributes(nodeId)
      const type = attrs.nodeType || nodeId.split('-')[0]
      typeCounts[type] = (typeCounts[type] || 0) + 1
      memberDetails.push({ id: nodeId, type, label: attrs.label, degree: attrs.degree || 0 })
    }

    // Sort by degree, pick top members per type for labeling
    memberDetails.sort((a, b) => b.degree - a.degree)

    const topByType = new Map<string, typeof memberDetails[0]>()
    for (const m of memberDetails) {
      if (!topByType.has(m.type)) topByType.set(m.type, m)
    }

    // Generate label from top 2-3 most prominent members
    const topMembers = memberDetails.slice(0, 8).map((m) => ({
      type: m.type, name: m.label, degree: m.degree,
    }))

    // Label: use the top entity (species/concept/protocol) + top author if present
    const topEntity = memberDetails.find((m) => ['species', 'concept', 'protocol', 'place'].includes(m.type))
    const topAuthor = memberDetails.find((m) => m.type === 'author')
    const labelParts = []
    if (topEntity) labelParts.push(topEntity.label)
    if (topAuthor && labelParts.length < 2) labelParts.push(topAuthor.label)
    if (labelParts.length === 0) labelParts.push(memberDetails[0]?.label || `Community ${cid}`)
    const label = labelParts.join(' + ')

    // Description: summarize the types
    const typeDesc = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`)
      .join(', ')

    communityInfos.push({
      id: cid,
      size: members.length,
      label,
      description: typeDesc,
      topMembers,
      typeCounts,
    })
  }

  console.log(`\nTop communities:`)
  for (const c of communityInfos.slice(0, 15)) {
    console.log(`  ${c.size} nodes: "${c.label}" (${c.description})`)
  }

  // Update unified graph with community assignments
  for (const node of raw.nodes) {
    node.community = communities[node.id] ?? -1
  }

  // Find the community info for each node's community
  const communityLabels = new Map<number, string>()
  for (const c of communityInfos) communityLabels.set(c.id, c.label)

  for (const node of raw.nodes) {
    node.communityLabel = communityLabels.get(node.community) || null
  }

  writeFileSync('public/graph/unified.json', JSON.stringify(raw))
  console.log(`\nUpdated public/graph/unified.json with community assignments`)

  // Write community metadata
  const output = {
    communities: communityInfos,
    meta: {
      totalCommunities: communityInfos.length,
      resolution,
      generatedAt: new Date().toISOString(),
    },
  }
  writeFileSync('public/graph/communities.json', JSON.stringify(output, null, 2))
  console.log(`Written public/graph/communities.json (${communityInfos.length} communities)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
