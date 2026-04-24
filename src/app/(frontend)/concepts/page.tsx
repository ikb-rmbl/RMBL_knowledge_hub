import Link from 'next/link'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SORT_OPTIONS = [
  { value: 'publications', label: 'Most Referenced' },
  { value: 'name', label: 'Name (A-Z)' },
]

const TYPE_OPTIONS = [
  '', 'theory', 'hypothesis', 'process', 'phenomenon', 'measurement', 'metric', 'framework', 'model_type',
]

const SCOPE_OPTIONS = [
  '', 'general_ecology', 'climate', 'hydrology', 'population_ecology', 'community_ecology',
  'evolution', 'biogeochemistry', 'landscape', 'molecular', 'methodological',
]

export default async function ConceptsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const sortParam = params.sort || 'publications'
  const typeFilter = params.type || ''
  const scopeFilter = params.scope || ''
  const neighborhoodParam = params.neighborhood || ''
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const where: string[] = ['publication_count > 0']
  const values: any[] = []
  let paramIdx = 1

  if (neighborhoodParam) {
    where.push(`id IN (SELECT entity_id FROM neighborhood_members WHERE neighborhood_id = $${paramIdx} AND entity_type = 'concept')`)
    values.push(neighborhoodParam)
    paramIdx++
  }
  if (query) {
    where.push(`(name ILIKE $${paramIdx} OR definition ILIKE $${paramIdx} OR $${paramIdx} = ANY(aliases))`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (typeFilter) {
    where.push(`concept_type = $${paramIdx}`)
    values.push(typeFilter)
    paramIdx++
  }
  if (scopeFilter) {
    where.push(`scope = $${paramIdx}`)
    values.push(scopeFilter)
    paramIdx++
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
    `SELECT id, name, concept_type, definition, scope, aliases, publication_count
     FROM concepts ${whereStr}
     ORDER BY ${orderBy}
     LIMIT ${PAGE_SIZE} OFFSET $${paramIdx}`,
    [...values, offset],
  )

  const { rows: [{ count: totalStr }] } = await db.query(
    `SELECT COUNT(*)::int as count FROM concepts ${whereStr}`, values,
  )
  const total = parseInt(totalStr)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Type/scope counts for sidebar
  const { rows: typeCounts } = await db.query(`
    SELECT concept_type, COUNT(*) as cnt FROM concepts
    WHERE concept_type IS NOT NULL AND publication_count > 0
    GROUP BY concept_type ORDER BY cnt DESC
  `)
  const { rows: scopeCounts } = await db.query(`
    SELECT scope, COUNT(*) as cnt FROM concepts
    WHERE scope IS NOT NULL AND publication_count > 0
    GROUP BY scope ORDER BY cnt DESC
  `)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.sort && merged.sort !== 'publications') p.set('sort', merged.sort)
    if (merged.type) p.set('type', merged.type)
    if (merged.scope) p.set('scope', merged.scope)
    if (merged.discipline) p.set('discipline', merged.discipline)
    if (merged.neighborhood) p.set('neighborhood', merged.neighborhood)
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/concepts${qs ? '?' + qs : ''}`
  }

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  // Discipline counts for chips
  const { rows: discCounts } = await db.query(`
    SELECT d as discipline, COUNT(*) as cnt
    FROM concepts, unnest(disciplines) as d
    WHERE publication_count > 0
    GROUP BY d ORDER BY cnt DESC
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

  let neighborhoodTitle = ''
  if (neighborhoodParam) {
    const { rows: [nbr] } = await db.query('SELECT title FROM neighborhoods WHERE id = $1', [neighborhoodParam])
    neighborhoodTitle = nbr?.title || ''
  }

  return (
    <>
      <div className="search-results-header">
        {neighborhoodTitle && (
          <div style={{ fontSize: '13px', marginBottom: '12px', padding: '8px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Filtered by neighborhood:</span>
            <Link href={`/neighborhoods/${neighborhoodParam}`} style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{neighborhoodTitle}</Link>
            <Link href="/concepts" style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-muted)' }}>Clear filter</Link>
          </div>
        )}
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Concepts</h1>
        <form className="search-form" action="/concepts" method="GET">
          <input className="search-input" type="text" name="q" aria-label="Search concepts" defaultValue={query} placeholder="Search concepts..." />
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href={buildUrl({ discipline: undefined, type: undefined, page: '1' })} style={chipStyle(!disciplineFilter && !typeFilter)}>All ({total.toLocaleString()})</Link>
          {discCounts.map((dc: any) => (
            <Link key={dc.discipline} href={buildUrl({ discipline: dc.discipline, type: undefined, page: '1' })} style={chipStyle(disciplineFilter === dc.discipline)}>{DISCIPLINE_LABELS[dc.discipline] || dc.discipline} ({dc.cnt})</Link>
          ))}
          <Link href="/explore/concepts" style={{ ...chipStyle(false), marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff' }}>Explore Concept Graph</Link>
        </div>

        <p className="results-count">{total.toLocaleString()} concepts{query ? ` matching "${query}"` : ''}{disciplineFilter ? ` in ${DISCIPLINE_LABELS[disciplineFilter] || disciplineFilter}` : ''}</p>
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
            <h4>Type</h4>
            <label><Link href={buildUrl({ type: undefined, page: '1' })} style={!typeFilter ? activeStyle : inactiveStyle}>All</Link></label>
            {typeCounts.map((tc: any) => (
              <label key={tc.concept_type}><Link href={buildUrl({ type: tc.concept_type, page: '1' })} style={typeFilter === tc.concept_type ? activeStyle : inactiveStyle}>{tc.concept_type.replace(/_/g, ' ')} ({tc.cnt})</Link></label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Scope</h4>
            <label><Link href={buildUrl({ scope: undefined, page: '1' })} style={!scopeFilter ? activeStyle : inactiveStyle}>All</Link></label>
            {scopeCounts.map((sc: any) => (
              <label key={sc.scope}><Link href={buildUrl({ scope: sc.scope, page: '1' })} style={scopeFilter === sc.scope ? activeStyle : inactiveStyle}>{sc.scope.replace(/_/g, ' ')} ({sc.cnt})</Link></label>
            ))}
          </div>
        </aside>

        <div className="result-cards">
          {rows.map((c: any) => (
            <Link key={c.id} href={`/concepts/${c.id}`} className="result-card">
              <div className="result-card-header">
                <span className="badge badge-concept">{(c.concept_type || 'concept').replace(/_/g, ' ')}</span>
                <h3 className="result-card-title">{c.name}</h3>
              </div>
              {c.definition && (
                <p className="result-card-snippet">{c.definition.slice(0, 200)}{c.definition.length > 200 ? '...' : ''}</p>
              )}
              <div className="result-card-meta">
                {c.scope && <span>{c.scope.replace(/_/g, ' ')}</span>}
                <span>{c.publication_count} paper{c.publication_count !== 1 ? 's' : ''}</span>
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
