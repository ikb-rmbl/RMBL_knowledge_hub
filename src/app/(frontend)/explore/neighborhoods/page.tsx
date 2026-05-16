import Link from 'next/link'
import { getDb } from '../../lib/db'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

// The multi-MB graph JSON is fetched client-side from /public/graph/* now;
// only the small (community_id → title) map is loaded server-side and
// passed through, so the SSR payload is tiny.
export const revalidate = 3600

// Interactive viewer over the unified graph — not useful in search indexes.
// Detail pages cover individual entities.
export const metadata = {
  robots: { index: false, follow: true },
}

export default async function ExploreNeighborhoodsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const params = await searchParams
  const isResearch = params.mode === 'research'
  const fileName = isResearch ? 'unified-research.json' : 'unified.json'
  const dataUrl = `/graph/${fileName}`

  // Tiny query — just titles, keyed by community_id.
  const db = getDb()
  const { rows: neighborhoods } = await db.query('SELECT community_id, title FROM neighborhoods ORDER BY community_id')
  const communityTitleMap: Record<number, string> = {}
  for (const n of neighborhoods) communityTitleMap[n.community_id] = n.title

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const,
    cursor: 'pointer',
  })

  const modeToggle = (
    <div key="mode-toggle" style={{ display: 'flex', gap: '6px' }}>
      <a href="/explore/neighborhoods" style={tabStyle(!isResearch)}>All content</a>
      <a href="/explore/neighborhoods?mode=research" style={tabStyle(isResearch)}>Research only</a>
    </div>
  )

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <Link href="/neighborhoods" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Neighborhoods</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Knowledge Neighborhoods Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{neighborhoods.length} neighborhoods</span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        {isResearch ? (
          <>The research-focused knowledge graph colored by neighborhood. Documents and stakeholders are excluded.</>
        ) : (
          <>The unified knowledge graph colored by research neighborhood. Each color represents a community of densely connected species, concepts, protocols, places, authors, and publications detected by the Louvain algorithm.</>
        )}
        {' '}Use the checkboxes below to show/hide individual neighborhoods.
      </p>
      <ExploreEntityGraph
        dataUrl={dataUrl}
        detailSlug=""
        extraControls={modeToggle}
        communityTitleMap={communityTitleMap}
      />
    </div>
  )
}
