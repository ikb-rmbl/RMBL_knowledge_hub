import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Where } from 'payload'
import { getBadgeLabel, getBadgeClass } from '../lib/badges'
import type { SearchResult as FtsResult } from '../api/search/route'
import pg from 'pg'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

// PostgreSQL pool for tsvector full-text search
let dbPool: pg.Pool | null = null
function getDb(): pg.Pool {
  if (!dbPool) dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return dbPool
}

/** Full-text search using PostgreSQL tsvector with ranked results and snippets */
async function tsvectorSearch(
  query: string,
  typeFilter: string,
  limit: number,
  offset: number,
): Promise<{ results: ResultItem[]; total: number }> {
  const db = getDb()
  const results: ResultItem[] = []
  let total = 0

  const searchDocs = !typeFilter || typeFilter === 'documents'
  const searchPubs = !typeFilter || typeFilter === 'publications'
  const searchData = !typeFilter || typeFilter === 'datasets'

  if (searchDocs) {
    const { rows } = await db.query(
      `SELECT id, title,
              ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                'MaxFragments=1,MaxWords=30,MinWords=15') as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank,
              date_original
       FROM documents WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    )
    for (const row of rows) {
      const yearStr = row.date_original ? String(row.date_original).slice(0, 4) : null
      results.push({ collection: 'document', subtype: null, id: String(row.id), title: row.title, snippet: row.snippet || '', year: yearStr ? parseInt(yearStr) : null, meta: [yearStr].filter(Boolean) as string[] })
    }
    const countRes = await db.query("SELECT count(*)::int FROM documents WHERE search_vector @@ plainto_tsquery('english', $1)", [query])
    total += countRes.rows[0].count
  }

  if (searchPubs) {
    const { rows } = await db.query(
      `SELECT id, title, year, journal, doi, publication_type,
              ts_headline('english', coalesce(abstract, full_text, title, ''), plainto_tsquery('english', $1),
                'MaxFragments=1,MaxWords=30,MinWords=15') as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
       FROM publications WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    )
    for (const row of rows) {
      results.push({ collection: 'publication', subtype: row.publication_type || null, id: String(row.id), title: row.title, snippet: row.snippet || '', year: row.year || null, meta: [row.journal, row.year ? String(row.year) : '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean) })
    }
    const countRes = await db.query("SELECT count(*)::int FROM publications WHERE search_vector @@ plainto_tsquery('english', $1)", [query])
    total += countRes.rows[0].count
  }

  if (searchData) {
    const { rows } = await db.query(
      `SELECT id, title, publication_year, resource_type,
              ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                'MaxFragments=1,MaxWords=30,MinWords=15') as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
       FROM datasets WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    )
    for (const row of rows) {
      results.push({ collection: 'dataset', subtype: row.resource_type || null, id: String(row.id), title: row.title, snippet: row.snippet || '', year: row.publication_year || null, meta: [row.publication_year ? String(row.publication_year) : ''].filter(Boolean) })
    }
    const countRes = await db.query("SELECT count(*)::int FROM datasets WHERE search_vector @@ plainto_tsquery('english', $1)", [query])
    total += countRes.rows[0].count
  }

  // Sort merged by rank (already sorted per-collection, merge-sort)
  results.sort((a, b) => 0) // Already sorted within collection; for cross-collection ranking we'd need a union query
  return { results: results.slice(0, limit), total }
}

const PUB_TYPE_OPTIONS = [
  { value: 'article', label: 'Journal Article' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book Chapter' },
  { value: 'student_paper', label: 'Student Paper' },
  { value: 'other', label: 'Other' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Date (Newest)' },
  { value: 'oldest', label: 'Date (Oldest)' },
  { value: 'title', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
]

interface SearchParams {
  q?: string
  type?: string
  topic?: string
  pubType?: string
  yearFrom?: string
  yearTo?: string
  sort?: string
  page?: string
}

type ResultItem = {
  collection: 'document' | 'publication' | 'dataset'
  subtype: string | null
  id: string
  title: string
  snippet: string
  year: number | null
  meta: string[]
}

/** Build a URL preserving all current filters, overriding specific params */
function buildUrl(current: SearchParams, overrides: Record<string, string | undefined>): string {
  const merged = { ...current, ...overrides }
  const p = new URLSearchParams()
  if (merged.q) p.set('q', merged.q)
  if (merged.type) p.set('type', merged.type)
  if (merged.topic) p.set('topic', merged.topic)
  if (merged.pubType) p.set('pubType', merged.pubType)
  if (merged.yearFrom) p.set('yearFrom', merged.yearFrom)
  if (merged.yearTo) p.set('yearTo', merged.yearTo)
  if (merged.sort) p.set('sort', merged.sort)
  if (merged.page && merged.page !== '1') p.set('page', merged.page)
  return `/search?${p.toString()}`
}

/** Map our sort param to a Payload sort string per collection */
function payloadSort(sortParam: string, collection: 'documents' | 'publications' | 'datasets'): string {
  const dateField =
    collection === 'publications' ? 'year' : collection === 'datasets' ? 'publicationYear' : 'dateOriginal'
  switch (sortParam) {
    case 'oldest':
      return dateField
    case 'title':
      return 'title'
    case 'title-desc':
      return '-title'
    case 'newest':
    default:
      return `-${dateField}`
  }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const query = params.q || ''
  const typeFilter = params.type || ''
  const topicFilter = params.topic || ''
  const pubTypeFilter = params.pubType || ''
  const yearFrom = params.yearFrom ? parseInt(params.yearFrom) : null
  const yearTo = params.yearTo ? parseInt(params.yearTo) : null
  const sortParam = params.sort || 'newest'
  const page = Math.max(1, parseInt(params.page || '1'))

  const payload = await getPayload({ config })

  // Use tsvector full-text search when there's a query text
  // This provides ranked results with stemming and snippet highlighting
  const useFts = Boolean(query) && !topicFilter && !pubTypeFilter && !yearFrom && !yearTo
  let results: ResultItem[] = []
  let totalResults = 0

  if (useFts) {
    const ftsOffset = (page - 1) * PAGE_SIZE
    const fts = await tsvectorSearch(query, typeFilter, PAGE_SIZE, ftsOffset)
    results = fts.results
    totalResults = fts.total
  }

  // Resolve topic ID — if it's a parent topic, also include all children
  let topicIds: string[] = []
  if (topicFilter) {
    const topicResult = await payload.find({
      collection: 'topics',
      where: { name: { equals: topicFilter } },
      limit: 1,
    })
    if (topicResult.docs.length > 0) {
      const parentId = String(topicResult.docs[0].id)
      topicIds = [parentId]
      // Check for children
      const children = await payload.find({
        collection: 'topics',
        where: { parent: { equals: parentId } },
        limit: 500,
      })
      topicIds.push(...children.docs.map((c) => String(c.id)))
    }
  }

  if (!useFts) {
  // Payload-based search (used when browsing with filters but no text query,
  // or when combining text query with topic/date/pubType filters)

  const searchDocs = !typeFilter || typeFilter === 'documents'
  const searchPubs = !typeFilter || typeFilter === 'publications'
  const searchData = !typeFilter || typeFilter === 'datasets'

  // Topic filter: match any of the IDs (parent + children)
  const topicWhere = (field: string): Where =>
    topicIds.length === 1
      ? { [field]: { equals: topicIds[0] } }
      : topicIds.length > 1
        ? { or: topicIds.map((id) => ({ [field]: { equals: id } })) }
        : {}

  // --- Build where clauses ---
  const docWhere: Where = {}
  if (query) docWhere.title = { contains: query }
  if (topicIds.length > 0) Object.assign(docWhere, topicWhere('categories'))
  if (yearFrom) docWhere['dateOriginal'] = { ...(docWhere['dateOriginal'] as any), greater_than_equal: `${yearFrom}-01-01` }
  if (yearTo) docWhere['dateOriginal'] = { ...(docWhere['dateOriginal'] as any), less_than_equal: `${yearTo}-12-31` }

  const pubWhere: Where = {}
  if (query) pubWhere.title = { contains: query }
  if (topicIds.length > 0) Object.assign(pubWhere, topicWhere('researchTopics'))
  if (pubTypeFilter) pubWhere.publicationType = { equals: pubTypeFilter }
  if (yearFrom) pubWhere.year = { ...(pubWhere.year as any), greater_than_equal: yearFrom }
  if (yearTo) pubWhere.year = { ...(pubWhere.year as any), less_than_equal: yearTo }

  const dataWhere: Where = {}
  if (query) dataWhere.title = { contains: query }
  if (topicIds.length > 0) Object.assign(dataWhere, topicWhere('tags'))
  if (yearFrom) dataWhere.publicationYear = { ...(dataWhere.publicationYear as any), greater_than_equal: yearFrom }
  if (yearTo) dataWhere.publicationYear = { ...(dataWhere.publicationYear as any), less_than_equal: yearTo }

  // --- Fetch counts for all searched collections ---
  const [docTotal, pubTotal, dataTotal] = await Promise.all([
    searchDocs ? payload.count({ collection: 'documents', where: docWhere }) : { totalDocs: 0 },
    searchPubs ? payload.count({ collection: 'publications', where: pubWhere }) : { totalDocs: 0 },
    searchData ? payload.count({ collection: 'datasets', where: dataWhere }) : { totalDocs: 0 },
  ])
  totalResults = docTotal.totalDocs + pubTotal.totalDocs + dataTotal.totalDocs

  // --- For single-collection view, paginate directly ---
  // --- For "All" view, compute per-collection offsets to interleave results ---
  if (typeFilter) {
    // Single collection: straightforward pagination
    if (searchDocs) {
      const docs = await payload.find({ collection: 'documents', where: docWhere, limit: PAGE_SIZE, page, sort: payloadSort(sortParam, 'documents') })
      for (const doc of docs.docs) {
        const yearStr = (doc.dateOriginal as string)?.slice(0, 4)
        results.push({ collection: 'document', subtype: null, id: String(doc.id), title: doc.title, snippet: typeof doc.summary === 'string' ? doc.summary : '', year: yearStr ? parseInt(yearStr) : null, meta: [yearStr, ...(doc.geographicScope as string[] || [])].filter(Boolean) })
      }
    }
    if (searchPubs) {
      const pubs = await payload.find({ collection: 'publications', where: pubWhere, limit: PAGE_SIZE, page, sort: payloadSort(sortParam, 'publications') })
      for (const pub of pubs.docs) {
        const authors = Array.isArray(pub.authors) ? pub.authors.slice(0, 3).map((a: any) => `${a.family}${a.given ? ' ' + a.given : ''}`).join(', ') : ''
        results.push({ collection: 'publication', subtype: pub.publicationType || null, id: String(pub.id), title: pub.title, snippet: pub.abstract || '', year: pub.year || null, meta: [authors, pub.year ? String(pub.year) : '', pub.journal || '', pub.doi ? `DOI: ${pub.doi}` : ''].filter(Boolean) })
      }
    }
    if (searchData) {
      const datasets = await payload.find({ collection: 'datasets', where: dataWhere, limit: PAGE_SIZE, page, sort: payloadSort(sortParam, 'datasets') })
      for (const ds of datasets.docs) {
        const creators = Array.isArray(ds.creators) ? ds.creators.slice(0, 3).map((c: any) => c.name).join(', ') : ''
        results.push({ collection: 'dataset', subtype: ds.resourceType || null, id: String(ds.id), title: ds.title, snippet: ds.description && typeof ds.description === 'string' ? ds.description : '', year: ds.publicationYear || null, meta: [creators, ds.publicationYear ? String(ds.publicationYear) : '', ds.doi ? `DOI: ${ds.doi}` : ''].filter(Boolean) })
      }
    }
  } else {
    // "All" view: proportional pagination across collections
    // Allocate PAGE_SIZE slots proportionally to each collection's result count
    const total = totalResults || 1
    const docSlots = Math.round((docTotal.totalDocs / total) * PAGE_SIZE) || (docTotal.totalDocs > 0 ? 1 : 0)
    const dataSlots = Math.round((dataTotal.totalDocs / total) * PAGE_SIZE) || (dataTotal.totalDocs > 0 ? 1 : 0)
    const pubSlots = PAGE_SIZE - docSlots - dataSlots

    // Calculate per-collection page from the global page
    const docPage = Math.ceil((page * docSlots) / (docSlots || 1))
    const pubPage = Math.ceil((page * pubSlots) / (pubSlots || 1))
    const dataPage = Math.ceil((page * dataSlots) / (dataSlots || 1))

    const [docs, pubs, datasets] = await Promise.all([
      docSlots > 0 ? payload.find({ collection: 'documents', where: docWhere, limit: docSlots, page: docPage, sort: payloadSort(sortParam, 'documents') }) : { docs: [] },
      pubSlots > 0 ? payload.find({ collection: 'publications', where: pubWhere, limit: pubSlots, page: pubPage, sort: payloadSort(sortParam, 'publications') }) : { docs: [] },
      dataSlots > 0 ? payload.find({ collection: 'datasets', where: dataWhere, limit: dataSlots, page: dataPage, sort: payloadSort(sortParam, 'datasets') }) : { docs: [] },
    ])

    for (const doc of docs.docs) {
      const yearStr = (doc.dateOriginal as string)?.slice(0, 4)
      results.push({ collection: 'document', subtype: null, id: String(doc.id), title: doc.title, snippet: typeof doc.summary === 'string' ? doc.summary : '', year: yearStr ? parseInt(yearStr) : null, meta: [yearStr, ...(doc.geographicScope as string[] || [])].filter(Boolean) })
    }
    for (const pub of pubs.docs) {
      const authors = Array.isArray(pub.authors) ? pub.authors.slice(0, 3).map((a: any) => `${a.family}${a.given ? ' ' + a.given : ''}`).join(', ') : ''
      results.push({ collection: 'publication', subtype: pub.publicationType || null, id: String(pub.id), title: pub.title, snippet: pub.abstract || '', year: pub.year || null, meta: [authors, pub.year ? String(pub.year) : '', pub.journal || '', pub.doi ? `DOI: ${pub.doi}` : ''].filter(Boolean) })
    }
    for (const ds of datasets.docs) {
      const creators = Array.isArray(ds.creators) ? ds.creators.slice(0, 3).map((c: any) => c.name).join(', ') : ''
      results.push({ collection: 'dataset', subtype: ds.resourceType || null, id: String(ds.id), title: ds.title, snippet: ds.description && typeof ds.description === 'string' ? ds.description : '', year: ds.publicationYear || null, meta: [creators, ds.publicationYear ? String(ds.publicationYear) : '', ds.doi ? `DOI: ${ds.doi}` : ''].filter(Boolean) })
    }

    // Sort merged results
    if (sortParam === 'newest') results.sort((a, b) => (b.year || 0) - (a.year || 0))
    else if (sortParam === 'oldest') results.sort((a, b) => (a.year || 0) - (b.year || 0))
    else if (sortParam === 'title') results.sort((a, b) => a.title.localeCompare(b.title))
    else if (sortParam === 'title-desc') results.sort((a, b) => b.title.localeCompare(a.title))
  }

  } // end if (!useFts)

  const totalPages = Math.ceil(totalResults / PAGE_SIZE)

  // Topics for sidebar
  const topics = await payload.find({
    collection: 'topics',
    where: { parent: { exists: false } },
    limit: 20,
    sort: 'name',
  })

  // Active filter description
  const activeFilters: string[] = []
  if (query) activeFilters.push(`"${query}"`)
  if (topicFilter) activeFilters.push(`topic: ${topicFilter}`)
  if (pubTypeFilter) activeFilters.push(`type: ${PUB_TYPE_OPTIONS.find((o) => o.value === pubTypeFilter)?.label}`)
  if (yearFrom || yearTo) activeFilters.push(`years: ${yearFrom || '...'}-${yearTo || '...'}`)

  return (
    <>
      <div className="search-results-header">
        <form className="search-form" action="/search" method="GET">
          <input className="search-input" type="text" name="q" defaultValue={query} placeholder="Search..." />
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          {topicFilter && <input type="hidden" name="topic" value={topicFilter} />}
          {pubTypeFilter && <input type="hidden" name="pubType" value={pubTypeFilter} />}
          {yearFrom && <input type="hidden" name="yearFrom" value={String(yearFrom)} />}
          {yearTo && <input type="hidden" name="yearTo" value={String(yearTo)} />}
          {sortParam !== 'newest' && <input type="hidden" name="sort" value={sortParam} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        <div className="type-chips" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
          <Link className={`type-chip ${!typeFilter ? 'active' : ''}`} href={buildUrl(params, { type: undefined, pubType: undefined, page: undefined })}>All</Link>
          <Link className={`type-chip ${typeFilter === 'documents' ? 'active' : ''}`} href={buildUrl(params, { type: 'documents', pubType: undefined, page: undefined })}>Documents</Link>
          <Link className={`type-chip ${typeFilter === 'publications' ? 'active' : ''}`} href={buildUrl(params, { type: 'publications', page: undefined })}>Publications</Link>
          <Link className={`type-chip ${typeFilter === 'datasets' ? 'active' : ''}`} href={buildUrl(params, { type: 'datasets', pubType: undefined, page: undefined })}>Datasets</Link>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="results-count">
            {totalResults.toLocaleString()} result{totalResults !== 1 ? 's' : ''}
            {activeFilters.length > 0 ? ` — ${activeFilters.join(', ')}` : ''}
          </p>
        </div>
      </div>

      <div className="search-layout">
        <aside className="filters">
          {/* Sort */}
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl(params, { sort: opt.value === 'newest' ? undefined : opt.value, page: undefined })}
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

          {/* Publication type (only when viewing publications or all) */}
          {(!typeFilter || typeFilter === 'publications') && (
            <div className="filter-group">
              <h4>Publication Type</h4>
              {PUB_TYPE_OPTIONS.map((opt) => (
                <label key={opt.value}>
                  <Link
                    href={buildUrl(params, {
                      pubType: pubTypeFilter === opt.value ? undefined : opt.value,
                      type: typeFilter || 'publications',
                      page: undefined,
                    })}
                    style={{
                      fontWeight: pubTypeFilter === opt.value ? 700 : 400,
                      color: pubTypeFilter === opt.value ? 'var(--color-accent)' : 'inherit',
                    }}
                  >
                    {opt.label}
                  </Link>
                </label>
              ))}
              {pubTypeFilter && (
                <Link href={buildUrl(params, { pubType: undefined, page: undefined })} style={{ fontSize: '13px', marginTop: '8px', display: 'block' }}>
                  Clear type filter
                </Link>
              )}
            </div>
          )}

          {/* Date range */}
          <div className="filter-group">
            <h4>Date Range</h4>
            <form action="/search" method="GET" className="date-filter-form">
              {/* Carry forward all current params */}
              {query && <input type="hidden" name="q" value={query} />}
              {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
              {topicFilter && <input type="hidden" name="topic" value={topicFilter} />}
              {pubTypeFilter && <input type="hidden" name="pubType" value={pubTypeFilter} />}
              {sortParam !== 'newest' && <input type="hidden" name="sort" value={sortParam} />}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="number"
                  name="yearFrom"
                  placeholder="From"
                  defaultValue={yearFrom || ''}
                  min={1900}
                  max={2030}
                  style={{ width: '70px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                <input
                  type="number"
                  name="yearTo"
                  placeholder="To"
                  defaultValue={yearTo || ''}
                  min={1900}
                  max={2030}
                  style={{ width: '70px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    background: 'var(--color-accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                  }}
                >
                  Go
                </button>
              </div>
            </form>
            {(yearFrom || yearTo) && (
              <Link href={buildUrl(params, { yearFrom: undefined, yearTo: undefined, page: undefined })} style={{ fontSize: '13px', marginTop: '8px', display: 'block' }}>
                Clear date filter
              </Link>
            )}
          </div>

          {/* Topics */}
          <div className="filter-group">
            <h4>Topics</h4>
            {topics.docs.map((topic) => (
              <label key={topic.id}>
                <Link
                  href={buildUrl(params, {
                    topic: topicFilter === topic.name ? undefined : topic.name,
                    page: undefined,
                  })}
                  style={{
                    fontWeight: topicFilter === topic.name ? 700 : 400,
                    color: topicFilter === topic.name ? 'var(--color-accent)' : 'inherit',
                  }}
                >
                  {topic.name}
                </Link>
              </label>
            ))}
            {topicFilter && (
              <Link href={buildUrl(params, { topic: undefined, page: undefined })} style={{ fontSize: '13px', marginTop: '8px', display: 'block' }}>
                Clear topic filter
              </Link>
            )}
          </div>
        </aside>

        <div>
          <div className="result-list">
            {results.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>
                No results found. Try a different search term or broaden your filters.
              </p>
            )}
            {results.map((item) => {
              const slug = item.collection === 'document' ? 'documents' : item.collection === 'publication' ? 'publications' : 'datasets'
              return (
              <Link
                key={`${item.collection}-${item.id}`}
                className="result-card"
                href={`/${slug}/${item.id}`}
              >
                <div className="result-card-header">
                  <span className={getBadgeClass(item.collection)}>
                    {getBadgeLabel(item.collection, item.subtype)}
                  </span>
                  <h3 className="result-card-title">{item.title}</h3>
                </div>
                {item.snippet && <p className="result-card-snippet">{item.snippet.slice(0, 200)}</p>}
                <div className="result-card-meta">
                  {item.meta.map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </div>
              </Link>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              {page > 1 && (
                <Link href={buildUrl(params, { page: String(page - 1) })}>Prev</Link>
              )}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                // Show pages around current page
                let p: number
                if (totalPages <= 7) {
                  p = i + 1
                } else if (page <= 4) {
                  p = i + 1
                } else if (page >= totalPages - 3) {
                  p = totalPages - 6 + i
                } else {
                  p = page - 3 + i
                }
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
              {page < totalPages && (
                <Link href={buildUrl(params, { page: String(page + 1) })}>Next</Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
