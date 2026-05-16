import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

// The page itself is now tiny — the multi-MB graph JSON is fetched
// client-side from /public/graph/* (CDN-served static asset) by the
// component. ISR doesn't help much here because of the ?focus= variants;
// the win is that the static asset can be aggressively cached.
export const revalidate = 3600

// Interactive viewer with arbitrary ?focus= query params — not useful in
// search indexes and a heavy crawl surface. Detail pages cover the same
// entities individually.
export const metadata = {
  robots: { index: false, follow: true },
}

export default async function ExploreUnifiedPage({ searchParams }: { searchParams: Promise<{ mode?: string; focus?: string }> }) {
  const params = await searchParams
  const isResearch = params.mode === 'research'
  const focus = params.focus || undefined
  const fileName = isResearch ? 'unified-research.json' : 'unified.json'
  const dataUrl = `/graph/${fileName}`

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const,
    cursor: 'pointer',
  })

  const modeToggle = (
    <div key="mode-toggle" style={{ display: 'flex', gap: '6px' }}>
      <a href="/explore/unified" style={tabStyle(!isResearch)}>All content</a>
      <a href="/explore/unified?mode=research" style={tabStyle(isResearch)}>Research only</a>
    </div>
  )

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <Link href="/" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Home</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore the Knowledge Graph</h1>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        {isResearch ? (
          <>Scientific research view: publications, datasets, authors, and research entities (species, concepts, protocols, places). Community/policy documents and stakeholder organizations are excluded.</>
        ) : (
          <>A unified view of the RMBL Knowledge Fabric connecting species, concepts, protocols, places, stakeholders, authors, publications, documents, and datasets. Edges represent co-occurrence, co-authorship, citations, and entity mentions. Use the checkboxes to show/hide node types.</>
        )}
      </p>
      <ExploreEntityGraph dataUrl={dataUrl} detailSlug="" extraControls={modeToggle} focus={focus} />
    </div>
  )
}
