import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Stories — RMBL Knowledge Hub',
  description: 'Oral histories, interviews, press releases, memoirs, and other narratives from the RMBL community.',
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

const PAGE_SIZE = 20

export default async function StoriesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const typeFilter = params.type || ''
  const sortParam = params.sort || 'newest'
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

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const orderBy = sortParam === 'title' ? 'title ASC' : sortParam === 'oldest' ? 'date ASC NULLS LAST' : 'date DESC NULLS LAST'

  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    db.query(`SELECT id, title, story_type, author, date, summary, media_type, duration
              FROM stories ${whereStr} ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, PAGE_SIZE, offset]),
    db.query(`SELECT count(*)::int as n FROM stories ${whereStr}`, values),
  ])

  // Type counts for filter chips
  const { rows: typeCounts } = await db.query(`SELECT story_type, count(*)::int as cnt FROM stories GROUP BY story_type ORDER BY cnt DESC`)

  const totalPages = Math.ceil(total / PAGE_SIZE)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.type) p.set('type', merged.type)
    if (merged.sort && merged.sort !== 'newest') p.set('sort', merged.sort)
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

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Stories</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          Oral histories, interviews, press releases, memoirs, field notes, and other narratives from the RMBL community.
        </p>
        <form className="search-form" action="/stories" method="GET">
          <label htmlFor="stories-q" className="sr-only">Search stories</label>
          <input id="stories-q" className="search-input" type="text" name="q" aria-label="Search stories" defaultValue={query} placeholder="Search stories..." />
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <Link href={buildUrl({ type: undefined, page: undefined })} style={chipStyle(!typeFilter)}>All ({total})</Link>
          {typeCounts.map((tc: any) => (
            <Link key={tc.story_type} href={buildUrl({ type: tc.story_type, page: undefined })} style={chipStyle(typeFilter === tc.story_type)}>
              {STORY_TYPE_LABELS[tc.story_type] || tc.story_type} ({tc.cnt})
            </Link>
          ))}
        </div>

        <p className="results-count">{total} stories{query ? ` matching "${query}"` : ''}{typeFilter ? ` · ${STORY_TYPE_LABELS[typeFilter] || typeFilter}` : ''}</p>
      </div>

      <div className="result-list" style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--s-6) var(--s-6)' }}>
        {rows.map((s: any) => (
          <Link key={s.id} href={`/stories/${s.id}`} className="result-card">
            <div className="result-card-header">
              <span className="badge badge-story">{STORY_TYPE_LABELS[s.story_type] || 'Story'}</span>
              <h3 className="result-card-title">{s.title}</h3>
            </div>
            {s.summary && <p className="result-card-snippet">{String(s.summary).slice(0, 200)}</p>}
            <div className="result-card-meta">
              {s.author && <span>{s.author}</span>}
              {s.date && <span>{new Date(s.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>}
              {s.media_type && s.media_type !== 'text' && <span>{s.media_type}</span>}
              {s.duration && <span>{s.duration}</span>}
            </div>
          </Link>
        ))}
        {rows.length === 0 && <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>No stories found.</p>}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
            {page > 1 && <Link href={buildUrl({ page: String(page - 1) })} style={{ padding: '6px 12px', fontSize: '13px' }}>&larr; Previous</Link>}
            <span style={{ padding: '6px 12px', fontSize: '13px', color: 'var(--fg-3)' }}>Page {page} of {totalPages}</span>
            {page < totalPages && <Link href={buildUrl({ page: String(page + 1) })} style={{ padding: '6px 12px', fontSize: '13px' }}>Next &rarr;</Link>}
          </div>
        )}
      </div>
    </>
  )
}
