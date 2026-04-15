import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExploreConceptsPage() {
  let graphData: any = { entityType: 'concept', colorField: 'scope', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/concepts.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/concepts" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Concepts</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Concept Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} concepts, {graphData.meta.edgeCount} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Concepts are linked when they appear in the same publication or dataset. Node size reflects the number of papers referencing each concept. Colors indicate research scope.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="concepts" detailField="definition" />
    </div>
  )
}
