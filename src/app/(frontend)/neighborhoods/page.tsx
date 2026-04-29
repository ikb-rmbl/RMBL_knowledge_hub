import Link from 'next/link'
import { getDb } from '../lib/db'
import { GRAPH_COLORS, ENTITY_TYPE_LABELS } from '../lib/graph-colors'

export const dynamic = 'force-dynamic'

const SORT_OPTIONS = [
  { value: 'size', label: 'Largest First' },
  { value: 'title', label: 'Title (A-Z)' },
]

const ENTITY_TYPES = ['species', 'concept', 'protocol', 'place', 'stakeholder', 'author', 'publication', 'document', 'dataset', 'story']

const FOCUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'research', label: 'Research' },
  { value: 'policy', label: 'Policy & Planning' },
  { value: 'news', label: 'News & Media' },
  { value: 'mixed', label: 'Mixed' },
]

const FOCUS_COLORS: Record<string, string> = {
  research: '#3a6b7b',
  policy: '#6B7A4A',
  news: '#7a4a6b',
  mixed: '#7b5a3a',
}

function classifyNeighborhood(tc: Record<string, number>): string {
  const pubs = tc.publication || 0
  const docs = tc.document || 0
  const stories = tc.story || 0
  if (pubs > docs + stories) return 'research'
  if (docs > pubs + stories) return 'policy'
  if (stories > pubs + docs) return 'news'
  return 'mixed'
}

function focusLabel(focus: string): string {
  return focus === 'research' ? 'Research' : focus === 'policy' ? 'Policy' : focus === 'news' ? 'News' : 'Mixed'
}

export default async function NeighborhoodsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const query = params.q || ''
  const sortParam = params.sort || 'size'
  const typeFilter = params.type || ''
  const focusFilter = params.focus || ''
  const db = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (query) {
    where.push(`(n.title ILIKE $${paramIdx} OR n.summary ILIKE $${paramIdx} OR n.label ILIKE $${paramIdx} OR $${paramIdx} ILIKE ANY(n.themes))`)
    values.push(`%${query}%`)
    paramIdx++
  }
  if (typeFilter) {
    where.push(`n.id IN (SELECT DISTINCT neighborhood_id FROM neighborhood_members WHERE entity_type = $${paramIdx})`)
    values.push(typeFilter)
    paramIdx++
  }

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const orderBy = sortParam === 'title' ? 'n.title ASC' : 'n.size DESC'

  const { rows: allRows } = await db.query(
    `SELECT n.* FROM neighborhoods n ${whereStr} ORDER BY ${orderBy}`,
    values,
  )

  // Classify each neighborhood and apply focus filter
  const classified = allRows.map((n: any) => ({
    ...n,
    focus: classifyNeighborhood(n.type_counts || {}),
  }))
  const rows = focusFilter ? classified.filter((n: any) => n.focus === focusFilter) : classified
  const total = rows.length

  // Focus counts (unfiltered)
  const focusCounts: Record<string, number> = { research: 0, policy: 0, news: 0, mixed: 0 }
  for (const n of classified) focusCounts[n.focus]++

  // Entity type filter counts
  const { rows: typeCounts } = await db.query(`
    SELECT entity_type, COUNT(DISTINCT neighborhood_id) as cnt
    FROM neighborhood_members
    GROUP BY entity_type ORDER BY cnt DESC
  `)

  // Size distribution
  const { rows: sizeBuckets } = await db.query(`
    SELECT
      CASE
        WHEN size >= 200 THEN 'Large (200+)'
        WHEN size >= 50 THEN 'Medium (50-199)'
        ELSE 'Small (< 50)'
      END as bucket,
      COUNT(*) as cnt
    FROM neighborhoods
    GROUP BY 1 ORDER BY MIN(size) DESC
  `)

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...params, ...overrides }
    const p = new URLSearchParams()
    if (merged.q) p.set('q', merged.q)
    if (merged.sort && merged.sort !== 'size') p.set('sort', merged.sort)
    if (merged.type) p.set('type', merged.type)
    if (merged.focus) p.set('focus', merged.focus)
    const qs = p.toString()
    return `/neighborhoods${qs ? '?' + qs : ''}`
  }

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  const chipStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--r-pill)',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)', textDecoration: 'none' as const, fontSize: 'var(--fs-caption)',
  })

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Knowledge Neighborhoods</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          Research communities detected by analyzing connections between species, concepts, protocols, places, authors, publications, documents, and news stories in the RMBL knowledge graph.
        </p>
        <form className="search-form" action="/neighborhoods" method="GET">
          <label htmlFor="nbr-q" className="sr-only">Search neighborhoods</label>
          <input id="nbr-q" className="search-input" type="text" name="q" aria-label="Search neighborhoods" defaultValue={query} placeholder="Search neighborhoods..." />
          {focusFilter && <input type="hidden" name="focus" value={focusFilter} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        {/* Focus filter chips */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {FOCUS_OPTIONS.map((opt) => (
            <Link key={opt.value} href={buildUrl({ focus: opt.value || undefined, type: undefined })}
              style={{
                ...chipStyle(focusFilter === opt.value),
                ...(opt.value && !focusFilter ? { borderColor: FOCUS_COLORS[opt.value], color: FOCUS_COLORS[opt.value] } : {}),
                ...(focusFilter === opt.value && opt.value ? { background: FOCUS_COLORS[opt.value] } : {}),
              }}>
              {opt.label} ({opt.value ? focusCounts[opt.value] || 0 : classified.length})
            </Link>
          ))}
          <Link href="/explore/neighborhoods" style={{ ...chipStyle(false), marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff' }}>Explore Graph</Link>
        </div>

        <p className="results-count" aria-live="polite">
          {total} neighborhoods{query ? ` matching "${query}"` : ''}{focusFilter ? ` · ${focusLabel(focusFilter)}` : ''}{typeFilter ? ` · ${ENTITY_TYPE_LABELS[typeFilter] || typeFilter}` : ''}
        </p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}><Link href={buildUrl({ sort: opt.value })} style={sortParam === opt.value ? activeStyle : inactiveStyle}>{opt.label}</Link></label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Focus</h4>
            <label><Link href={buildUrl({ focus: undefined })} style={!focusFilter ? activeStyle : inactiveStyle}>All ({classified.length})</Link></label>
            {Object.entries(focusCounts).filter(([, n]) => n > 0).map(([focus, n]) => (
              <label key={focus}>
                <Link href={buildUrl({ focus })} style={focusFilter === focus ? activeStyle : inactiveStyle}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: FOCUS_COLORS[focus], marginRight: 4 }} />
                  {focusLabel(focus)} ({n})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Contains</h4>
            <label><Link href={buildUrl({ type: undefined })} style={!typeFilter ? activeStyle : inactiveStyle}>All types</Link></label>
            {typeCounts.map((tc: any) => (
              <label key={tc.entity_type}>
                <Link href={buildUrl({ type: tc.entity_type })} style={typeFilter === tc.entity_type ? activeStyle : inactiveStyle}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: GRAPH_COLORS[tc.entity_type] || '#999', marginRight: 4 }} />
                  {ENTITY_TYPE_LABELS[tc.entity_type] || tc.entity_type} ({tc.cnt})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Size</h4>
            {sizeBuckets.map((sb: any) => (
              <label key={sb.bucket} style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                {sb.bucket}: {sb.cnt}
              </label>
            ))}
          </div>
        </aside>

        <div className="result-cards">
          {rows.map((n: any) => {
            const typeCnts = n.type_counts || {}
            const topByType = n.top_by_type || {}
            const highlights: { type: string; name: string; slug: string }[] = []
            for (const type of ENTITY_TYPES) {
              const items = topByType[type] || []
              if (items.length > 0) highlights.push({ type, name: items[0].name, slug: items[0].slug })
            }

            // Source composition bar
            const pubs = typeCnts.publication || 0
            const docs = typeCnts.document || 0
            const stories = typeCnts.story || 0
            const sourceTotal = pubs + docs + stories
            const pubPct = sourceTotal > 0 ? Math.round(pubs / sourceTotal * 100) : 0
            const docPct = sourceTotal > 0 ? Math.round(docs / sourceTotal * 100) : 0
            const storyPct = sourceTotal > 0 ? 100 - pubPct - docPct : 0

            return (
              <Link key={n.id} href={`/neighborhoods/${n.id}`} className="result-card">
                <div className="result-card-header">
                  <span className="badge" style={{ background: FOCUS_COLORS[n.focus] || 'var(--color-accent)', color: '#fff' }}>
                    {focusLabel(n.focus)}
                  </span>
                  <span className="badge" style={{ background: 'var(--bg-inset)', color: 'var(--fg-2)', border: '1px solid var(--border)' }}>
                    {n.size} items
                  </span>
                  <h3 className="result-card-title">{n.title}</h3>
                </div>
                {n.summary && (
                  <p className="result-card-snippet">{n.summary}</p>
                )}

                {/* Source composition bar */}
                {sourceTotal > 0 && (
                  <div style={{ display: 'flex', height: '4px', borderRadius: '2px', overflow: 'hidden', margin: '8px 0 4px', gap: '1px' }}>
                    {pubPct > 0 && <div style={{ width: `${pubPct}%`, background: '#3a6b7b' }} title={`${pubs} publications`} />}
                    {docPct > 0 && <div style={{ width: `${docPct}%`, background: '#6B7A4A' }} title={`${docs} documents`} />}
                    {storyPct > 0 && <div style={{ width: `${storyPct}%`, background: '#7a4a6b' }} title={`${stories} stories`} />}
                  </div>
                )}
                <div style={{ fontSize: '11px', color: 'var(--fg-3)', margin: '0 0 8px' }}>
                  {[
                    pubs > 0 ? `${pubs} pub${pubs > 1 ? 's' : ''}` : null,
                    docs > 0 ? `${docs} doc${docs > 1 ? 's' : ''}` : null,
                    stories > 0 ? `${stories} stor${stories > 1 ? 'ies' : 'y'}` : null,
                  ].filter(Boolean).join(' · ')}
                </div>

                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {highlights.slice(0, 5).map((h, i) => (
                    <span key={i} style={{
                      padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
                      background: GRAPH_COLORS[h.type] || '#999', color: '#fff',
                      whiteSpace: 'nowrap',
                    }}>
                      {h.name.slice(0, 30)}{h.name.length > 30 ? '...' : ''}
                    </span>
                  ))}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
