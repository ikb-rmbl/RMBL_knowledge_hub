import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default async function ExploreUnifiedPage({ searchParams }: { searchParams: Promise<{ mode?: string; focus?: string }> }) {
  const params = await searchParams
  const isResearch = params.mode === 'research'
  const focus = params.focus || undefined
  const fileName = isResearch ? 'unified-research.json' : 'unified.json'

  let graphData: any = { entityType: 'unified', colorField: 'nodeType', nodes: [], edges: [], meta: {} }
  const filePath = join(process.cwd(), 'public/graph', fileName)
  if (existsSync(filePath)) {
    try { graphData = JSON.parse(readFileSync(filePath, 'utf-8')) } catch {}
  }

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
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount?.toLocaleString()} nodes, {graphData.meta.edgeCount?.toLocaleString()} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        {isResearch ? (
          <>Scientific research view: publications, datasets, authors, and research entities (species, concepts, protocols, places). Community/policy documents and stakeholder organizations are excluded.</>
        ) : (
          <>A unified view of the RMBL Knowledge Fabric connecting species, concepts, protocols, places, stakeholders, authors, publications, documents, and datasets. Edges represent co-occurrence, co-authorship, citations, and entity mentions. Use the checkboxes to show/hide node types.</>
        )}
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="" extraControls={modeToggle} focus={focus} />
    </div>
  )
}
