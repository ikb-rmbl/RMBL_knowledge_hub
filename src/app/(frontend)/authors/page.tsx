import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

interface AuthorSearchParams {
  q?: string
  page?: string
  letter?: string
  sort?: string
  filter?: string
}

const PAGE_SIZE = 50

const SORT_OPTIONS = [
  { value: 'works', label: 'Most Works' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
]

const FILTER_OPTIONS = [
  { value: '', label: 'All Authors' },
  { value: 'orcid', label: 'With ORCID' },
  { value: 'pubs', label: 'With Publications' },
  { value: 'datasets', label: 'With Datasets' },
  { value: 'cross', label: 'Cross-Collection' },
]

function buildUrl(params: AuthorSearchParams, overrides: Record<string, string | undefined>): string {
  const merged = { ...params, ...overrides }
  const p = new URLSearchParams()
  if (merged.q) p.set('q', merged.q)
  if (merged.letter) p.set('letter', merged.letter)
  if (merged.sort && merged.sort !== 'works') p.set('sort', merged.sort)
  if (merged.filter) p.set('filter', merged.filter)
  if (merged.page && merged.page !== '1') p.set('page', merged.page)
  return `/authors?${p.toString()}`
}

export default async function AuthorsPage({ searchParams }: { searchParams: Promise<AuthorSearchParams> }) {
  const params = await searchParams
  const query = params.q || ''
  const letter = params.letter || ''
  const sortParam = params.sort || 'works'
  const filterParam = params.filter || ''
  const page = Math.max(1, parseInt(params.page || '1'))

  const payload = await getPayload({ config })

  // Use raw SQL for "most works" sort (workCount column not in Payload schema)
  // Use Payload API for name-based sorts (simpler)
  let authors: { docs: any[]; totalDocs: number; totalPages: number }

  if (sortParam === 'works' && !query && !letter && !filterParam) {
    // Fast path: raw SQL sort by work_count
    const db = getDb()
    const offset = (page - 1) * PAGE_SIZE
    const { rows } = await db.query(
      'SELECT id, display_name as "displayName", family_name as "familyName", given_name as "givenName", orcid, affiliation, work_count as "workCount" FROM authors ORDER BY work_count DESC, family_name ASC LIMIT $1 OFFSET $2',
      [PAGE_SIZE, offset],
    )
    const countRes = await db.query('SELECT count(*)::int FROM authors')
    const totalDocs = countRes.rows[0].count
    authors = { docs: rows, totalDocs, totalPages: Math.ceil(totalDocs / PAGE_SIZE) }
  } else {
    // Payload path: name sorts, search, letter filter
    const where: any = {}
    if (query) {
      where.or = [
        { displayName: { contains: query } },
        { familyName: { contains: query } },
        { orcid: { contains: query } },
        { affiliation: { contains: query } },
      ]
    } else if (letter) {
      where.familyName = { like: `${letter}%` }
    }
    if (filterParam === 'orcid') {
      where.orcid = { exists: true }
    }

    let sort: string
    switch (sortParam) {
      case 'name': sort = 'familyName'; break
      case 'name-desc': sort = '-familyName'; break
      default: sort = 'familyName'; break
    }

    const result = await payload.find({ collection: 'authors', where, limit: PAGE_SIZE, page, sort, depth: 0 })
    authors = result
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Browse Authors</h1>

        <form className="search-form" action="/authors" method="GET">
          <input
            className="search-input"
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by name, affiliation, or ORCID..."
          />
          {sortParam !== 'works' && <input type="hidden" name="sort" value={sortParam} />}
          {filterParam && <input type="hidden" name="filter" value={filterParam} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        <div className="type-chips" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
          <Link className={`type-chip ${!letter && !query ? 'active' : ''}`} href={buildUrl(params, { letter: undefined, q: undefined, page: undefined })}>All</Link>
          {alphabet.map((l) => (
            <Link
              key={l}
              className={`type-chip ${letter === l ? 'active' : ''}`}
              href={buildUrl(params, { letter: l, q: undefined, page: undefined })}
              style={{ minWidth: '32px', textAlign: 'center', padding: '4px 6px' }}
            >
              {l}
            </Link>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <p className="results-count">
            {authors.totalDocs.toLocaleString()} author{authors.totalDocs !== 1 ? 's' : ''}
            {query ? ` matching "${query}"` : ''}
            {letter ? ` starting with ${letter}` : ''}
          </p>
        </div>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl(params, { sort: opt.value === 'works' ? undefined : opt.value, page: undefined })}
                  style={{
                    fontWeight: sortParam === opt.value ? 700 : 400,
                    color: sortParam === opt.value ? 'var(--color-accent)' : 'inherit',
                  }}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Filter</h4>
            {FILTER_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl(params, { filter: opt.value || undefined, page: undefined })}
                  style={{
                    fontWeight: filterParam === opt.value ? 700 : 400,
                    color: filterParam === opt.value ? 'var(--color-accent)' : 'inherit',
                  }}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>
        </aside>

        <div>
          <div className="result-list">
            {authors.docs.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>
                No authors found.
              </p>
            )}
            {authors.docs.map((author) => {
              const workCount = (author.workCount as number) || 0

              return (
                <Link
                  key={author.id}
                  className="result-card"
                  href={`/authors/${author.id}`}
                >
                  <div className="result-card-header">
                    <h3 className="result-card-title">{author.displayName}</h3>
                  </div>
                  <div className="result-card-meta">
                    {author.affiliation && <span>{author.affiliation}</span>}
                    {author.orcid && <span>ORCID: {author.orcid}</span>}
                    <span>{workCount} work{workCount !== 1 ? 's' : ''}</span>
                  </div>
                </Link>
              )
            })}
          </div>

          {authors.totalPages > 1 && (
            <div className="pagination">
              {page > 1 && (
                <Link href={buildUrl(params, { page: String(page - 1) })}>Prev</Link>
              )}
              {Array.from({ length: Math.min(authors.totalPages, 7) }, (_, i) => {
                let p: number
                if (authors.totalPages <= 7) p = i + 1
                else if (page <= 4) p = i + 1
                else if (page >= authors.totalPages - 3) p = authors.totalPages - 6 + i
                else p = page - 3 + i
                return (
                  <Link
                    key={p}
                    className={p === page ? 'active' : ''}
                    href={buildUrl(params, { page: String(p) })}
                  >
                    {p}
                  </Link>
                )
              })}
              {page < authors.totalPages && (
                <Link href={buildUrl(params, { page: String(page + 1) })}>Next</Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
