import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExploreDatasetsPage() {
  let graphData: any = { entityType: 'dataset', colorField: 'research_area', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/datasets.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/search?type=datasets" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Datasets</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Dataset Network</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} datasets, {graphData.meta.edgeCount} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Datasets are linked by shared entities (species, concepts, protocols) and shared authors. Node size reflects the number of connections in the network. Colors indicate research area, derived from associated concept disciplines.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="datasets" labelField="year" />
    </div>
  )
}
