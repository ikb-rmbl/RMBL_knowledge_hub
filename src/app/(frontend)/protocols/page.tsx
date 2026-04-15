import Link from 'next/link'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SORT_OPTIONS = [
  { value: 'publications', label: 'Most Used' },
  { value: 'name', label: 'Name (A-Z)' },
]

const CATEGORY_OPTIONS = [
  '', 'sampling', 'measurement', 'analytical', 'experimental', 'observational', 'computational', 'laboratory',
]

export default async function ProtocolsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const sortParam = params.sort || 'publications'
  const categoryFilter = params.category || ''
  const showUnapproved = params.show === 'all'
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  // Default: show all protocols (since none are approved yet in dev)
  // In production, uncomment: if (!showUnapproved) where.push('approved = true')

  if (query) {
    where.push(`(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (categoryFilter) {
    where.push(`category = $${paramIdx}`)
    values.push(categoryFilter)
    paramIdx++
  }
  if (params.std === 'true') {
    where.push('standardized = true')
  }
  const disciplineFilter = params.discipline || ''
  if (disciplineFilter) {
    where.push(`$${paramIdx} = ANY(disciplines)`)
    values.push(disciplineFilter)
    paramIdx++
  }

  const orderBy = sortParam === 'name' ? 'name ASC' : 'publication_count DESC, name ASC'
  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const { rows } = await db.query(
    `SELECT id, name, slug, category, subcategory, description, typical_equipment,
            output_measurements, standardized, publication_count, mention_count, approved
     FROM protocols ${whereStr}
     ORDER BY ${orderBy}
     LIMIT ${PAGE_SIZE} OFFSET $${paramIdx}`,
    [...values, offset],
  )

  const { rows: [{ count: totalStr }] } = await db.query(
    `SELECT COUNT(*)::int as count FROM protocols ${whereStr}`, values,
  )
  const total = parseInt(totalStr)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Category counts for sidebar
  const { rows: catCounts } = await db.query(`
    SELECT category, COUNT(*) as cnt FROM protocols
    WHERE category IS NOT NULL
    GROUP BY category ORDER BY cnt DESC
  `)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.sort && merged.sort !== 'publications') p.set('sort', merged.sort)
    if (merged.category) p.set('category', merged.category)
    if (merged.std === 'true') p.set('std', 'true')
    if (merged.discipline) p.set('discipline', merged.discipline)
    if (merged.show === 'all') p.set('show', 'all')
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/protocols${qs ? '?' + qs : ''}`
  }

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  // Discipline counts for chips
  const { rows: discCounts } = await db.query(`
    SELECT d as discipline, COUNT(*) as cnt
    FROM protocols, unnest(disciplines) as d
    GROUP BY d ORDER BY cnt DESC
  `)
  const { rows: [{ std_count, all_count }] } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM protocols WHERE standardized = true) as std_count,
      (SELECT COUNT(*)::int FROM protocols) as all_count
  `)

  const DISCIPLINE_LABELS: Record<string, string> = {
    ecology: 'Ecology', earth_science: 'Earth Science', methods: 'Methods',
    evolution: 'Evolution', molecular: 'Molecular', physiology: 'Physiology',
  }

  const chipStyle = (active: boolean) => ({
    padding: '5px 10px', borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const, fontSize: '12px',
  })

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Protocols</h1>
        <form className="search-form" action="/protocols" method="GET">
          <input className="search-input" type="text" name="q" defaultValue={query} placeholder="Search protocols..." />
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <Link href={buildUrl({ discipline: undefined, std: undefined, page: '1' })} style={chipStyle(!disciplineFilter && !params.std)}>All ({all_count})</Link>
          {discCounts.map((dc: any) => (
            <Link key={dc.discipline} href={buildUrl({ discipline: dc.discipline, std: undefined, page: '1' })} style={chipStyle(disciplineFilter === dc.discipline)}>{DISCIPLINE_LABELS[dc.discipline] || dc.discipline} ({dc.cnt})</Link>
          ))}
          <Link href="/explore/protocols" style={{ ...chipStyle(false), marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff' }}>Explore Protocol Graph</Link>
        </div>

        <p className="results-count">{total.toLocaleString()} protocols{query ? ` matching "${query}"` : ''}{disciplineFilter ? ` in ${DISCIPLINE_LABELS[disciplineFilter] || disciplineFilter}` : ''}</p>
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
            <h4>Category</h4>
            <label><Link href={buildUrl({ category: undefined, page: '1' })} style={!categoryFilter ? activeStyle : inactiveStyle}>All</Link></label>
            {catCounts.map((cc: any) => (
              <label key={cc.category}><Link href={buildUrl({ category: cc.category, page: '1' })} style={categoryFilter === cc.category ? activeStyle : inactiveStyle}>{cc.category} ({cc.cnt})</Link></label>
            ))}
          </div>
        </aside>

        <div className="result-cards">
          {rows.map((pr: any) => (
            <Link key={pr.id} href={`/protocols/${pr.id}`} className="result-card">
              <div className="result-card-header">
                <span className="badge badge-protocol">{pr.category || 'protocol'}</span>
                {pr.standardized && <span className="badge" style={{ background: '#2e7d32', color: 'white' }}>standardized</span>}
                <h3 className="result-card-title">{pr.name}</h3>
              </div>
              {pr.description && (
                <p className="result-card-snippet">{pr.description.slice(0, 200)}{pr.description.length > 200 ? '...' : ''}</p>
              )}
              <div className="result-card-meta">
                {pr.subcategory && <span>{pr.subcategory}</span>}
                <span>{pr.publication_count} paper{pr.publication_count !== 1 ? 's' : ''}</span>
                {pr.typical_equipment?.length > 0 && (
                  <span>{pr.typical_equipment.slice(0, 2).join(', ')}{pr.typical_equipment.length > 2 ? '...' : ''}</span>
                )}
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
