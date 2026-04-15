import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExplorePublicationsPage() {
  let graphData: any = { entityType: 'publication', colorField: 'research_area', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/publications.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/search?type=publications" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Publications</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Citation Network</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} publications, {graphData.meta.edgeCount} connections
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Publications are linked by internal citations and shared authorship (2+ co-authors). Node size reflects external citation count. Colors indicate the publication's primary research area, derived from topic assignments.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="publications" detailField="journal" labelField="year" />
    </div>
  )
}
