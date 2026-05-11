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
 *   - Updates unified-research.json (if present) with the same community IDs,
 *     so the research-only neighborhoods graph stays in sync
 *
 * Usage:
 *   npx tsx scripts/detect-communities.ts [--resolution=1.0]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import './lib/config.js'

const Graph = (await import('graphology')).default
const louvain = (await import('graphology-communities-louvain')).default

const args = process.argv.slice(2)
const resolution = parseFloat(args.find((a) => a.startsWith('--resolution='))?.split('=')[1] || '6')

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
  interface TopMember {
    id: string       // node ID (e.g. "species-42")
    type: string     // entity/collection type
    name: string
    degree: number
    slug: string     // URL path (e.g. "/species/42")
  }

  interface CommunityInfo {
    id: number
    size: number
    label: string
    description: string
    topMembers: TopMember[]
    topByType: Record<string, TopMember[]>  // top 3 per type for detail display
    typeCounts: Record<string, number>
  }

  const communityInfos: CommunityInfo[] = []

  const slugMap: Record<string, string> = {
    species: 'species', place: 'places', protocol: 'protocols', concept: 'concepts',
    author: 'authors', publication: 'publications', pub: 'publications',
    dataset: 'datasets',
  }
  function toTopMember(m: { id: string; type: string; label: string; degree: number }): TopMember {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    const slug = `/${slugMap[m.type] || m.type}/${rawId}`
    return { id: m.id, type: m.type, name: m.label, degree: m.degree, slug }
  }

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

    // Top 3 per type for detail display
    const topByType: Record<string, TopMember[]> = {}
    const typeCounters = new Map<string, number>()
    for (const m of memberDetails) {
      const cnt = typeCounters.get(m.type) || 0
      if (cnt < 3) {
        if (!topByType[m.type]) topByType[m.type] = []
        topByType[m.type].push(toTopMember(m))
        typeCounters.set(m.type, cnt + 1)
      }
    }

    // Overall top members
    const topMembers = memberDetails.slice(0, 8).map(toTopMember)

    // Label: use top 2-3 entity names (no researcher names) to describe the theme
    const entityTypes = ['concept', 'species', 'protocol', 'place']
    const topEntities = memberDetails.filter((m) => entityTypes.includes(m.type))
    // Pick from different entity types if possible for a richer label
    const labelParts: string[] = []
    const usedTypes = new Set<string>()
    for (const m of topEntities) {
      if (labelParts.length >= 3) break
      if (!usedTypes.has(m.type) || labelParts.length < 2) {
        labelParts.push(m.label)
        usedTypes.add(m.type)
      }
    }
    if (labelParts.length === 0) labelParts.push(memberDetails[0]?.label || `Community ${cid}`)
    const label = labelParts.join(', ')

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
      topByType,
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

  // Propagate the same community IDs into the research-only variant if it exists.
  // Nodes excluded by --exclude-docs (documents, stakeholders) won't appear in
  // unified.json's community map — those would only show up if the research file
  // was generated separately, which currently it isn't.
  const researchPath = 'public/graph/unified-research.json'
  if (existsSync(researchPath)) {
    const research = JSON.parse(readFileSync(researchPath, 'utf-8'))
    let matched = 0
    for (const node of research.nodes) {
      const cid = communities[node.id]
      if (cid !== undefined) {
        node.community = cid
        node.communityLabel = communityLabels.get(cid) || null
        matched++
      } else {
        node.community = -1
        node.communityLabel = null
      }
    }
    writeFileSync(researchPath, JSON.stringify(research))
    console.log(`Updated ${researchPath} (${matched}/${research.nodes.length} nodes matched)`)
  }

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
