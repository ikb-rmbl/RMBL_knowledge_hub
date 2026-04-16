import Link from 'next/link'
import { getDb } from '../lib/db'
import { GRAPH_COLORS, ENTITY_TYPE_LABELS } from '../lib/graph-colors'

export const dynamic = 'force-dynamic'

const SORT_OPTIONS = [
  { value: 'size', label: 'Largest First' },
  { value: 'title', label: 'Title (A-Z)' },
]

const ENTITY_TYPES = ['species', 'concept', 'protocol', 'place', 'stakeholder', 'author', 'publication', 'document', 'dataset']

export default async function NeighborhoodsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const sortParam = params.sort || 'size'
  const typeFilter = params.type || ''
  const db = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (query) {
    where.push(`(n.title ILIKE $${paramIdx} OR n.summary ILIKE $${paramIdx} OR n.label ILIKE $${paramIdx} OR $${paramIdx} ILIKE ANY(n.themes))`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (typeFilter) {
    where.push(`n.id IN (SELECT DISTINCT neighborhood_id FROM neighborhood_members WHERE entity_type = $${paramIdx})`)
    values.push(typeFilter)
    paramIdx++
  }

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const orderBy = sortParam === 'title' ? 'n.title ASC' : 'n.size DESC'

  const { rows } = await db.query(
    `SELECT n.* FROM neighborhoods n ${whereStr} ORDER BY ${orderBy}`,
    values,
  )

  const total = rows.length

  // Entity type filter counts (neighborhoods containing each type)
  const { rows: typeCounts } = await db.query(`
    SELECT entity_type, COUNT(DISTINCT neighborhood_id) as cnt
    FROM neighborhood_members
    GROUP BY entity_type ORDER BY cnt DESC
  `)

  // Size distribution for sidebar
  const { rows: sizeBuckets } = await db.query(`
    SELECT
      CASE
        WHEN size >= 200 THEN 'Large (200+)'
        WHEN size >= 50 THEN 'Medium (50-199)'
        ELSE 'Small (< 50)'
      END as bucket,
      COUNT(*) as cnt
    FROM neighborhoods
    GROUP BY 1 ORDER BY MIN(size) DESC
  `)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.sort && merged.sort !== 'size') p.set('sort', merged.sort)
    if (merged.type) p.set('type', merged.type)
    const qs = p.toString()
    return `/neighborhoods${qs ? '?' + qs : ''}`
  }

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  const chipStyle = (active: boolean) => ({
    padding: '5px 10px', borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const, fontSize: '12px',
  })

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Knowledge Neighborhoods</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          Research communities detected by analyzing connections between species, concepts, protocols, places, authors, and publications in the RMBL knowledge graph.
        </p>
        <form className="search-form" action="/neighborhoods" method="GET">
          <input className="search-input" type="text" name="q" defaultValue={query} placeholder="Search neighborhoods..." />
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href={buildUrl({ type: undefined })} style={chipStyle(!typeFilter)}>All ({total})</Link>
          {typeCounts.map((tc: any) => (
            <Link key={tc.entity_type} href={buildUrl({ type: tc.entity_type })} style={chipStyle(typeFilter === tc.entity_type)}>
              {ENTITY_TYPE_LABELS[tc.entity_type] || tc.entity_type} ({tc.cnt})
            </Link>
          ))}
          <Link href="/explore/neighborhoods" style={{ ...chipStyle(false), marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff' }}>Explore Neighborhoods Graph</Link>
        </div>

        <p className="results-count">{total} neighborhoods{query ? ` matching "${query}"` : ''}{typeFilter ? ` containing ${ENTITY_TYPE_LABELS[typeFilter] || typeFilter}` : ''}</p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}><Link href={buildUrl({ sort: opt.value })} style={sortParam === opt.value ? activeStyle : inactiveStyle}>{opt.label}</Link></label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Contains</h4>
            <label><Link href={buildUrl({ type: undefined })} style={!typeFilter ? activeStyle : inactiveStyle}>All types</Link></label>
            {typeCounts.map((tc: any) => (
              <label key={tc.entity_type}>
                <Link href={buildUrl({ type: tc.entity_type })} style={typeFilter === tc.entity_type ? activeStyle : inactiveStyle}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: GRAPH_COLORS[tc.entity_type] || '#999', marginRight: 4 }} />
                  {ENTITY_TYPE_LABELS[tc.entity_type] || tc.entity_type} ({tc.cnt})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Size</h4>
            {sizeBuckets.map((sb: any) => (
              <label key={sb.bucket} style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                {sb.bucket}: {sb.cnt}
              </label>
            ))}
          </div>
        </aside>

        <div className="result-cards">
          {rows.map((n: any) => {
            const typeCnts = n.type_counts || {}
            const topByType = n.top_by_type || {}
            const highlights: { type: string; name: string; slug: string }[] = []
            for (const type of ENTITY_TYPES) {
              const items = topByType[type] || []
              if (items.length > 0) highlights.push({ type, name: items[0].name, slug: items[0].slug })
            }

            const typeDesc = Object.entries(typeCnts)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .map(([t, cnt]) => `${cnt} ${t}${(cnt as number) > 1 ? 's' : ''}`)
              .join(', ')

            return (
              <Link key={n.id} href={`/neighborhoods/${n.id}`} className="result-card">
                <div className="result-card-header">
                  <span className="badge" style={{ background: 'var(--color-accent)', color: '#fff' }}>{n.size} items</span>
                  <h3 className="result-card-title">{n.title}</h3>
                </div>
                {n.summary && (
                  <p className="result-card-snippet">{n.summary}</p>
                )}
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: '4px 0 8px' }}>
                  {typeDesc}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {highlights.slice(0, 5).map((h, i) => (
                    <span key={i} style={{
                      padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
                      background: GRAPH_COLORS[h.type] || '#999', color: '#fff',
                      whiteSpace: 'nowrap',
                    }}>
                      {h.name.slice(0, 30)}{h.name.length > 30 ? '...' : ''}
                    </span>
                  ))}
                </div>
                {n.themes?.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {n.themes.map((t: string) => (
                      <span key={t} style={{
                        padding: '2px 8px', borderRadius: '10px', fontSize: '10px',
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
