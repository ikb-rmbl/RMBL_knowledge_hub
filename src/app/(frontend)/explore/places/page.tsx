import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExplorePlacesPage() {
  let graphData: any = { entityType: 'place', colorField: 'place_type', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/places.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/places" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Places</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Places Graph</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} places, {graphData.meta.edgeCount} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Places are linked when they co-occur in the same publication or dataset. Node size reflects the number of papers referencing each place. Colors indicate place type.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="places" />
    </div>
  )
}
