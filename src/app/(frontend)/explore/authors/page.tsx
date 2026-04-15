import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'

export const dynamic = 'force-dynamic'

export default function ExploreAuthorsPage() {
  let graphData: any = { entityType: 'author', colorField: 'research_area', nodes: [], edges: [], meta: {} }
  try { graphData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/authors.json'), 'utf-8')) } catch {}

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <Link href="/authors" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Authors</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Co-Authorship Network</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {graphData.meta.nodeCount} authors, {graphData.meta.edgeCount} collaborations
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Authors are linked when they co-author two or more publications together. Node size reflects the number of connections in the network. Colors indicate the author's primary research area, derived from their publication topics.
      </p>
      <ExploreEntityGraph data={graphData} detailSlug="authors" detailField="affiliation" />
    </div>
  )
}
