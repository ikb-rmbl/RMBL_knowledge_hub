import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExploreUnifiedPage() {
  let graphData: any = { entityType: 'unified', colorField: 'nodeType', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/unified.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Home</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore the Knowledge Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount?.toLocaleString()} nodes, {graphData.meta.edgeCount?.toLocaleString()} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        A unified view of the RMBL Knowledge Hub connecting species, concepts, protocols, authors, and publications.
        Edges represent co-occurrence, co-authorship, citations, and entity mentions. Node size reflects connectivity. Use the checkboxes to show/hide node types.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="" />
    </div>
  )
}
