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
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

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
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/places${qs ? '?' + qs : ''}`
  }

  return (
    <div className="browse-page">
      <div className="browse-sidebar">
        <h3>Sort</h3>
        {SORT_OPTIONS.map((opt) => (
          <Link key={opt.value} href={buildUrl({ sort: opt.value, page: '1' })}
            className={`sidebar-link ${sortParam === opt.value ? 'active' : ''}`}>
            {opt.label}
          </Link>
        ))}

        <h3>Place Type</h3>
        <Link href={buildUrl({ type: undefined, page: '1' })}
          className={`sidebar-link ${!typeFilter ? 'active' : ''}`}>All Types</Link>
        {typeCounts.map((tc: any) => (
          <Link key={tc.place_type} href={buildUrl({ type: tc.place_type, page: '1' })}
            className={`sidebar-link ${typeFilter === tc.place_type ? 'active' : ''}`}>
            {tc.place_type.replace(/_/g, ' ')} ({tc.cnt})
          </Link>
        ))}

        <h3>Show</h3>
        <Link href={buildUrl({ show: undefined, page: '1' })}
          className={`sidebar-link ${!showAll ? 'active' : ''}`}>Referenced only</Link>
        <Link href={buildUrl({ show: 'all', page: '1' })}
          className={`sidebar-link ${showAll ? 'active' : ''}`}>All places (inc. GNIS seeds)</Link>
      </div>

      <div className="browse-main">
        <h1>Places ({total})</h1>

        <form method="get" action="/places" className="browse-search">
          <input type="text" name="q" defaultValue={query} placeholder="Search places..." />
          <button type="submit">Search</button>
        </form>

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
    </div>
  )
}
