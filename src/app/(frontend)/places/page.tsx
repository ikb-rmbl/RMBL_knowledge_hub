import Link from 'next/link'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SORT_OPTIONS = [
  { value: 'publications', label: 'Most Publications' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'elevation', label: 'By Elevation' },
]

const TYPE_OPTIONS = [
  '', 'study_site', 'peak', 'valley', 'watershed', 'stream', 'lake',
  'meadow', 'town', 'county', 'trail', 'named_point', 'region',
]

export default async function PlacesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const sortParam = params.sort || 'publications'
  const typeFilter = params.type || ''
  const showAll = params.show === 'all'
  const neighborhoodParam = params.neighborhood || ''
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (neighborhoodParam) {
    where.push(`id IN (SELECT entity_id FROM neighborhood_members WHERE neighborhood_id = $${paramIdx} AND entity_type = 'place')`)
    values.push(neighborhoodParam)
    paramIdx++
  }

  // Default: only show places with publications (hide GNIS-only seeds)
  if (!showAll) {
    where.push('publication_count > 0')
  }

  if (query) {
    where.push(`(name ILIKE $${paramIdx} OR $${paramIdx} = ANY(aliases))`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (typeFilter) {
    where.push(`place_type = $${paramIdx}`)
    values.push(typeFilter)
    paramIdx++
  }

  const orderBy = sortParam === 'name' ? 'name ASC' :
    sortParam === 'elevation' ? 'elevation_m DESC NULLS LAST, name ASC' :
    'publication_count DESC, name ASC'

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const { rows } = await db.query(
    `SELECT id, name, place_type, scale, lat, lon, elevation_m,
            habitat_types, publication_count, mention_count,
            parent_place_id, external_ids
     FROM places ${whereStr}
     ORDER BY ${orderBy}
     LIMIT ${PAGE_SIZE} OFFSET $${paramIdx}`,
    [...values, offset],
  )

  const { rows: [{ count: totalStr }] } = await db.query(
    `SELECT COUNT(*)::int as count FROM places ${whereStr}`, values,
  )
  const total = parseInt(totalStr)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Get type counts for sidebar
  const { rows: typeCounts } = await db.query(`
    SELECT place_type, COUNT(*) as cnt FROM places
    WHERE publication_count > 0 AND place_type IS NOT NULL
    GROUP BY place_type ORDER BY cnt DESC
  `)

  // Look up parent names for display
  const parentIds = rows.filter((r: any) => r.parent_place_id).map((r: any) => r.parent_place_id)
  const parentMap = new Map<number, string>()
  if (parentIds.length > 0) {
    const { rows: parents } = await db.query(
      `SELECT id, name FROM places WHERE id = ANY($1)`, [parentIds],
    )
    for (const p of parents) parentMap.set(p.id, p.name)
  }

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.sort && merged.sort !== 'publications') p.set('sort', merged.sort)
    if (merged.type) p.set('type', merged.type)
    if (merged.show === 'all') p.set('show', 'all')
    if (merged.neighborhood) p.set('neighborhood', merged.neighborhood)
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/places${qs ? '?' + qs : ''}`
  }

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  // Counts for chips
  const { rows: [{ ref_count, all_count }] } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM places WHERE publication_count > 0) as ref_count,
      (SELECT COUNT(*)::int FROM places) as all_count
  `)

  const chipStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const, fontSize: '13px',
  })

  return (
    <>
      <div className="search-results-header">
        {neighborhoodParam && await (async () => {
          const { rows: [nbr] } = await db.query('SELECT title FROM neighborhoods WHERE id = $1', [neighborhoodParam])
          if (!nbr) return null
          return (
            <div style={{ fontSize: '13px', marginBottom: '12px', padding: '8px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Filtered by neighborhood:</span>
              <Link href={`/neighborhoods/${neighborhoodParam}`} style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{nbr.title}</Link>
              <Link href="/places" style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-muted)' }}>Clear filter</Link>
            </div>
          )
        })()}
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Places</h1>
        <form className="search-form" action="/places" method="GET">
          <input className="search-input" type="text" name="q" defaultValue={query} placeholder="Search places..." />
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href={buildUrl({ show: undefined, page: '1' })} style={chipStyle(!showAll)}>Referenced ({ref_count})</Link>
          <Link href={buildUrl({ show: 'all', page: '1' })} style={chipStyle(showAll)}>All ({all_count})</Link>
          <Link href="/explore/map" style={{ ...chipStyle(false), marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff' }}>Research Sites Map</Link>
          <Link href="/explore/places" style={{ ...chipStyle(false), background: 'var(--color-accent)', color: '#fff' }}>Explore Places Graph</Link>
        </div>

        <p className="results-count">{total.toLocaleString()} places{query ? ` matching "${query}"` : ''}</p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}><Link href={buildUrl({ sort: opt.value, page: '1' })} style={sortParam === opt.value ? activeStyle : inactiveStyle}>{opt.label}</Link></label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Place Type</h4>
            <label><Link href={buildUrl({ type: undefined, page: '1' })} style={!typeFilter ? activeStyle : inactiveStyle}>All Types</Link></label>
            {typeCounts.map((tc: any) => (
              <label key={tc.place_type}><Link href={buildUrl({ type: tc.place_type, page: '1' })} style={typeFilter === tc.place_type ? activeStyle : inactiveStyle}>{tc.place_type.replace(/_/g, ' ')} ({tc.cnt})</Link></label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Show</h4>
            <label><Link href={buildUrl({ show: undefined, page: '1' })} style={!showAll ? activeStyle : inactiveStyle}>Referenced only</Link></label>
            <label><Link href={buildUrl({ show: 'all', page: '1' })} style={showAll ? activeStyle : inactiveStyle}>All (inc. GNIS seeds)</Link></label>
          </div>
        </aside>

        <div className="result-cards">
          {rows.map((pl: any) => (
            <Link key={pl.id} href={`/places/${pl.id}`} className="result-card">
              <div className="result-card-header">
                <span className="badge badge-place">
                  {(pl.place_type || 'place').replace(/_/g, ' ')}
                </span>
                <h3 className="result-card-title">{pl.name}</h3>
              </div>
              <p className="result-card-snippet">
                {parentMap.get(pl.parent_place_id) && `${parentMap.get(pl.parent_place_id)} · `}
                {pl.elevation_m && `${pl.elevation_m}m · `}
                {pl.habitat_types?.slice(0, 2).join(', ')}
              </p>
              <div className="result-card-meta">
                {pl.scale && <span>{pl.scale}</span>}
                {pl.lat && pl.lon && <span>{pl.lat.toFixed(3)}, {pl.lon.toFixed(3)}</span>}
                {pl.publication_count > 0 && <span>{pl.publication_count} paper{pl.publication_count !== 1 ? 's' : ''}</span>}
                {pl.external_ids?.gnis && <span>GNIS</span>}
              </div>
            </Link>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            {page > 1 && <Link href={buildUrl({ page: String(page - 1) })}>Previous</Link>}
            <span>Page {page} of {totalPages}</span>
            {page < totalPages && <Link href={buildUrl({ page: String(page + 1) })}>Next</Link>}
          </div>
        )}
      </div>
    </>
  )
}
