import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExploreProtocolsPage() {
  let graphData: any = { entityType: 'protocol', colorField: 'category', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/protocols.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/protocols" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Protocols</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Protocol Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} protocols, {graphData.meta.edgeCount} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Protocols are linked by co-occurrence in publications, embedding similarity, and shared study species. Node size reflects the number of papers using each method. Colors indicate method category.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="protocols" detailField="description" />
    </div>
  )
}
