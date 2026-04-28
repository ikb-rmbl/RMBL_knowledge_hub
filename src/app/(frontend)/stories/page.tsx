import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Stories — RMBL Knowledge Hub',
  description: 'News articles, interviews, press releases, and other narratives about RMBL and the Gunnison Basin.',
}

const STORY_TYPE_LABELS: Record<string, string> = {
  news_article: 'News',
  research_summary: 'Research',
  press_release: 'Press Release',
  profile: 'Profile',
  feature: 'Feature',
  opinion_editorial: 'Opinion',
  event_coverage: 'Event',
  legislative: 'Legislative',
  obituary: 'Obituary',
  interview: 'Interview',
  oral_history: 'Oral History',
  memoir: 'Memoir',
  field_notes: 'Field Notes',
  blog_post: 'Blog Post',
  scientific_paper: 'Scientific Paper',
  other: 'Other',
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'title', label: 'Title (A-Z)' },
]

const PAGE_SIZE = 20

export default async function StoriesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const typeFilter = params.type || ''
  const sortParam = params.sort || 'newest'
  const yearFrom = params.yearFrom ? parseInt(params.yearFrom) : null
  const yearTo = params.yearTo ? parseInt(params.yearTo) : null
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE
  const db = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (query) {
    where.push(`(title ILIKE $${paramIdx} OR full_text ILIKE $${paramIdx} OR summary ILIKE $${paramIdx})`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (typeFilter) {
    where.push(`story_type = $${paramIdx}`)
    values.push(typeFilter)
    paramIdx++
  }
  if (yearFrom) {
    where.push(`extract(year from date) >= $${paramIdx}`)
    values.push(yearFrom)
    paramIdx++
  }
  if (yearTo) {
    where.push(`extract(year from date) <= $${paramIdx}`)
    values.push(yearTo)
    paramIdx++
  }

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const orderBy = sortParam === 'title' ? 'title ASC' : sortParam === 'oldest' ? 'date ASC NULLS LAST' : 'date DESC NULLS LAST'

  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    db.query(`SELECT id, title, story_type, author, date, summary, media_type, duration
              FROM stories ${whereStr} ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, PAGE_SIZE, offset]),
    db.query(`SELECT count(*)::int as n FROM stories ${whereStr}`, values),
  ])

  // Type counts (unfiltered for sidebar)
  const { rows: typeCounts } = await db.query('SELECT story_type, count(*)::int as cnt FROM stories GROUP BY story_type ORDER BY cnt DESC')

  // Decade distribution for sidebar
  const { rows: decadeCounts } = await db.query(`
    SELECT (extract(year from date)::int / 10) * 10 as decade, count(*)::int as cnt
    FROM stories WHERE date IS NOT NULL
    GROUP BY 1 ORDER BY 1 DESC
  `)

  const totalPages = Math.ceil(total / PAGE_SIZE)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.type) p.set('type', merged.type)
    if (merged.sort && merged.sort !== 'newest') p.set('sort', merged.sort)
    if (merged.yearFrom) p.set('yearFrom', merged.yearFrom)
    if (merged.yearTo) p.set('yearTo', merged.yearTo)
    if (merged.page && merged.page !== '1') p.set('page', merged.page)
    const qs = p.toString()
    return `/stories${qs ? '?' + qs : ''}`
  }

  const chipStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--r-pill)',
    background: active ? 'var(--color-badge-story)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const, fontSize: 'var(--fs-caption)',
  })

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Stories</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          News articles, interviews, press releases, and other narratives about RMBL and the Gunnison Basin.
        </p>
        <form className="search-form" action="/stories" method="GET">
          <label htmlFor="stories-q" className="sr-only">Search stories</label>
          <input id="stories-q" className="search-input" type="text" name="q" aria-label="Search stories" defaultValue={query} placeholder="Search stories..." />
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          {yearFrom && <input type="hidden" name="yearFrom" value={String(yearFrom)} />}
          {yearTo && <input type="hidden" name="yearTo" value={String(yearTo)} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <Link href={buildUrl({ type: undefined, page: undefined })} style={chipStyle(!typeFilter)}>All</Link>
          {typeCounts.map((tc: any) => (
            <Link key={tc.story_type} href={buildUrl({ type: tc.story_type, page: undefined })} style={chipStyle(typeFilter === tc.story_type)}>
              {STORY_TYPE_LABELS[tc.story_type] || tc.story_type} ({tc.cnt})
            </Link>
          ))}
        </div>

        <p className="results-count" aria-live="polite">
          {total} stories{query ? ` matching "${query}"` : ''}{typeFilter ? ` · ${STORY_TYPE_LABELS[typeFilter] || typeFilter}` : ''}{yearFrom || yearTo ? ` · ${yearFrom || ''}–${yearTo || ''}` : ''}
        </p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link href={buildUrl({ sort: opt.value, page: undefined })} style={sortParam === opt.value ? activeStyle : inactiveStyle}>
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Date Range</h4>
            <form action="/stories" method="GET" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {query && <input type="hidden" name="q" value={query} />}
              {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
              {sortParam !== 'newest' && <input type="hidden" name="sort" value={sortParam} />}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <label htmlFor="yearFrom" className="sr-only">From year</label>
                <input id="yearFrom" type="number" name="yearFrom" placeholder="From" defaultValue={yearFrom || ''} min={1980} max={2030} aria-label="From year"
                  style={{ width: '70px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />
                <span aria-hidden="true" style={{ color: 'var(--fg-3)' }}>–</span>
                <label htmlFor="yearTo" className="sr-only">To year</label>
                <input id="yearTo" type="number" name="yearTo" placeholder="To" defaultValue={yearTo || ''} min={1980} max={2030} aria-label="To year"
                  style={{ width: '70px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />
                <button type="submit" style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer' }}>Go</button>
              </div>
              {(yearFrom || yearTo) && (
                <Link href={buildUrl({ yearFrom: undefined, yearTo: undefined, page: undefined })} style={{ fontSize: '12px', color: 'var(--accent)' }}>
                  Clear date filter
                </Link>
              )}
            </form>
          </div>

          <div className="filter-group">
            <h4>Story Type</h4>
            <label><Link href={buildUrl({ type: undefined, page: undefined })} style={!typeFilter ? activeStyle : inactiveStyle}>All types</Link></label>
            {typeCounts.map((tc: any) => (
              <label key={tc.story_type}>
                <Link href={buildUrl({ type: tc.story_type, page: undefined })} style={typeFilter === tc.story_type ? activeStyle : inactiveStyle}>
                  {STORY_TYPE_LABELS[tc.story_type] || tc.story_type} ({tc.cnt})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>By Decade</h4>
            {decadeCounts.map((dc: any) => (
              <label key={dc.decade}>
                <Link href={buildUrl({ yearFrom: String(dc.decade), yearTo: String(dc.decade + 9), page: undefined })} style={yearFrom === dc.decade ? activeStyle : inactiveStyle}>
                  {dc.decade}s ({dc.cnt})
                </Link>
              </label>
            ))}
          </div>
        </aside>

        <div>
          <div className="result-list">
            {rows.map((s: any) => (
              <Link key={s.id} href={`/stories/${s.id}`} className="result-card">
                <div className="result-card-header">
                  <span className="badge badge-story">{STORY_TYPE_LABELS[s.story_type] || 'Story'}</span>
                  <h3 className="result-card-title">{s.title}</h3>
                </div>
                {s.summary && s.summary.length > 20 && <p className="result-card-snippet">{String(s.summary).slice(0, 200)}</p>}
                <div className="result-card-meta">
                  {s.author && <span>{s.author}</span>}
                  {s.date && <span>{new Date(s.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>}
                  {s.media_type && s.media_type !== 'text' && <span>{s.media_type}</span>}
                </div>
              </Link>
            ))}
            {rows.length === 0 && <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>No stories found.</p>}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
              {page > 1 && <Link href={buildUrl({ page: String(page - 1) })} style={{ padding: '6px 12px', fontSize: '13px' }}>&larr; Previous</Link>}
              <span style={{ padding: '6px 12px', fontSize: '13px', color: 'var(--fg-3)' }}>Page {page} of {totalPages}</span>
              {page < totalPages && <Link href={buildUrl({ page: String(page + 1) })} style={{ padding: '6px 12px', fontSize: '13px' }}>Next &rarr;</Link>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
