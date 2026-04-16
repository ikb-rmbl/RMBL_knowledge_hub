import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import { getDb } from '../../lib/db'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default async function ExploreNeighborhoodsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const params = await searchParams
  const isResearch = params.mode === 'research'
  const fileName = isResearch ? 'unified-research.json' : 'unified.json'

  let raw: any = { nodes: [], edges: [], meta: {} }
  const filePath = join(process.cwd(), 'public/graph', fileName)
  if (existsSync(filePath)) {
    try { raw = JSON.parse(readFileSync(filePath, 'utf-8')) } catch {}
  }

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

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const,
    cursor: 'pointer',
  })

  // Count distinct communities actually represented in the filtered node set
  const visibleCommunities = new Set<number>()
  for (const n of raw.nodes) if (n.community !== undefined && n.community >= 0) visibleCommunities.add(n.community)

  const modeToggle = (
    <div style={{ display: 'flex', gap: '6px' }}>
      <Link href="/explore/neighborhoods" style={tabStyle(!isResearch)}>All content</Link>
      <Link href="/explore/neighborhoods?mode=research" style={tabStyle(isResearch)}>Research only</Link>
    </div>
  )

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <Link href="/neighborhoods" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Neighborhoods</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Knowledge Neighborhoods Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount?.toLocaleString()} nodes, {visibleCommunities.size} neighborhoods
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        {isResearch ? (
          <>The research-focused knowledge graph colored by neighborhood. Documents and stakeholders are excluded.</>
        ) : (
          <>The unified knowledge graph colored by research neighborhood. Each color represents a community of densely connected species, concepts, protocols, places, authors, and publications detected by the Louvain algorithm.</>
        )}
        {' '}Use the checkboxes below to show/hide individual neighborhoods.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="" extraControls={modeToggle} />
    </div>
  )
}
