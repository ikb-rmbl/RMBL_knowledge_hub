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
    if (merged.show === 'all') p.set('show', 'all')
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/protocols${qs ? '?' + qs : ''}`
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

        <h3>Category</h3>
        <Link href={buildUrl({ category: undefined, page: '1' })}
          className={`sidebar-link ${!categoryFilter ? 'active' : ''}`}>All</Link>
        {catCounts.map((cc: any) => (
          <Link key={cc.category} href={buildUrl({ category: cc.category, page: '1' })}
            className={`sidebar-link ${categoryFilter === cc.category ? 'active' : ''}`}>
            {cc.category} ({cc.cnt})
          </Link>
        ))}
      </div>

      <div className="browse-main">
        <h1>Protocols ({total})</h1>

        <form method="get" action="/protocols" className="browse-search">
          <input type="text" name="q" defaultValue={query} placeholder="Search protocols..." />
          <button type="submit">Search</button>
        </form>

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
    </div>
  )
}
