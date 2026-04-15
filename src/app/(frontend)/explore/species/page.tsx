import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExploreSpeciesPage() {
  let graphData: any = { entityType: 'species', colorField: 'kingdom', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/species.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/species" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Species</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Species Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} species, {graphData.meta.edgeCount} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Species are linked when they co-occur in the same publication or dataset. Node size reflects the number of papers studying each species. Colors indicate taxonomic kingdom.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="species" labelField="common_names" />
    </div>
  )
}
