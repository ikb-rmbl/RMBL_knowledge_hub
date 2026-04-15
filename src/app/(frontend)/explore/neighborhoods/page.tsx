import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import { getDb } from '../../lib/db'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default async function ExploreNeighborhoodsPage() {
  let raw: any = { nodes: [], edges: [], meta: {} }
  try { raw = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/unified.json'), 'utf-8')) } catch {}

  // Map community IDs to LLM-generated titles
  const db = getDb()
  const { rows: neighborhoods } = await db.query('SELECT community_id, title FROM neighborhoods ORDER BY community_id')
  const titleMap = new Map<number, string>()
  for (const n of neighborhoods) titleMap.set(n.community_id, n.title)

  // Build new data object with communityTitle baked into each node
  const graphData = {
    entityType: 'unified',
    colorField: 'communityTitle',
    nodes: raw.nodes.map((node: any) => ({
      ...node,
      communityTitle: titleMap.get(node.community) || 'Unassigned',
    })),
    edges: raw.edges,
    meta: raw.meta,
  }

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/neighborhoods" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Neighborhoods</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Knowledge Neighborhoods Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount?.toLocaleString()} nodes, {neighborhoods.length} neighborhoods
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        The unified knowledge graph colored by research neighborhood. Each color represents a community of densely connected species, concepts, protocols, places, authors, and publications detected by the Louvain algorithm.
        Use the checkboxes below to show/hide individual neighborhoods.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="" />
    </div>
  )
}
