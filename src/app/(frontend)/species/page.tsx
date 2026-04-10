import Link from 'next/link'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SORT_OPTIONS = [
  { value: 'publications', label: 'Most Publications' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'family', label: 'By Family' },
]

const KINGDOM_OPTIONS = ['Animalia', 'Plantae', 'Fungi', 'Chromista', 'Bacteria']

export default async function SpeciesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const sortParam = params.sort || 'publications'
  const kingdomFilter = params.kingdom || ''
  const familyFilter = params.family || ''
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  // Build WHERE clauses
  const where: string[] = ['publication_count > 0']
  const values: any[] = []
  let paramIdx = 1

  if (query) {
    where.push(`(canonical_name ILIKE $${paramIdx} OR $${paramIdx} = ANY(common_names) OR $${paramIdx} = ANY(synonyms))`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (kingdomFilter) {
    where.push(`kingdom = $${paramIdx}`)
    values.push(kingdomFilter)
    paramIdx++
  }
  if (familyFilter) {
    where.push(`family = $${paramIdx}`)
    values.push(familyFilter)
    paramIdx++
  }

  const orderBy = sortParam === 'name' ? 'canonical_name ASC' :
    sortParam === 'family' ? 'family ASC NULLS LAST, canonical_name ASC' :
    'publication_count DESC, canonical_name ASC'

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const { rows } = await db.query(
    `SELECT id, canonical_name, rank, family, order_name, class_name, kingdom,
            common_names, ecological_roles, conservation_status, native_to_rmbl,
            publication_count, mention_count, external_ids
     FROM species ${whereStr}
     ORDER BY ${orderBy}
     LIMIT ${PAGE_SIZE} OFFSET $${paramIdx}`,
    [...values, offset],
  )

  const { rows: [{ count: totalStr }] } = await db.query(
    `SELECT COUNT(*)::int as count FROM species ${whereStr}`,
    values,
  )
  const total = parseInt(totalStr)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Get top families for sidebar filter
  const { rows: families } = await db.query(`
    SELECT family, COUNT(*) as cnt FROM species
    WHERE family IS NOT NULL AND publication_count > 0
    GROUP BY family ORDER BY cnt DESC LIMIT 15
  `)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.sort && merged.sort !== 'publications') p.set('sort', merged.sort)
    if (merged.kingdom) p.set('kingdom', merged.kingdom)
    if (merged.family) p.set('family', merged.family)
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/species${qs ? '?' + qs : ''}`
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

        <h3>Kingdom</h3>
        <Link href={buildUrl({ kingdom: undefined, page: '1' })}
          className={`sidebar-link ${!kingdomFilter ? 'active' : ''}`}>All</Link>
        {KINGDOM_OPTIONS.map((k) => (
          <Link key={k} href={buildUrl({ kingdom: k, page: '1' })}
            className={`sidebar-link ${kingdomFilter === k ? 'active' : ''}`}>{k}</Link>
        ))}

        <h3>Family</h3>
        <Link href={buildUrl({ family: undefined, page: '1' })}
          className={`sidebar-link ${!familyFilter ? 'active' : ''}`}>All</Link>
        {families.map((f: any) => (
          <Link key={f.family} href={buildUrl({ family: f.family, page: '1' })}
            className={`sidebar-link ${familyFilter === f.family ? 'active' : ''}`}>
            {f.family} ({f.cnt})
          </Link>
        ))}
      </div>

      <div className="browse-main">
        <h1>Species &amp; Taxa ({total})</h1>

        <form method="get" action="/species" className="browse-search">
          <input type="text" name="q" defaultValue={query} placeholder="Search species by name..." />
          <button type="submit">Search</button>
        </form>

        <div className="result-cards">
          {rows.map((sp: any) => (
            <Link key={sp.id} href={`/species/${sp.id}`} className="result-card">
              <div className="result-card-header">
                <span className="badge badge-species">
                  {sp.rank === 'genus' ? 'Genus' : 'Species'}
                </span>
                <h3 className="result-card-title" style={{ fontStyle: 'italic' }}>
                  {sp.canonical_name}
                </h3>
              </div>
              <p className="result-card-snippet">
                {sp.common_names?.[0] && <strong>{sp.common_names[0]}</strong>}
                {sp.common_names?.[0] && ' — '}
                {[sp.family, sp.order_name, sp.class_name].filter(Boolean).join(' > ')}
              </p>
              <div className="result-card-meta">
                {sp.kingdom && <span>{sp.kingdom}</span>}
                {sp.conservation_status && <span>IUCN: {sp.conservation_status}</span>}
                {sp.native_to_rmbl && <span>{sp.native_to_rmbl}</span>}
                <span>{sp.publication_count} paper{sp.publication_count !== 1 ? 's' : ''}</span>
                {sp.ecological_roles?.length > 0 && (
                  <span>{sp.ecological_roles.slice(0, 2).join(', ')}</span>
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
