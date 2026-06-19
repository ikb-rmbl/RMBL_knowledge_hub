import Link from 'next/link'
import { getDb } from '../lib/db'
import { listErasWithCounts, isCenturyEra, type EraWithCounts } from '@/services/eras'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Eras — RMBL Knowledge Commons',
  description:
    'Time periods covering research, community documents, datasets, and stories from the Gunnison Basin. Open an era to see what was happening then; compare eras to see how patterns of research and policy have changed.',
}

type SortKey = 'recent' | 'oldest' | 'items' | 'publications'
type ShowKey = 'all' | 'decades' | 'centuries'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'items', label: 'Total items' },
  { value: 'publications', label: 'Publications' },
]

const SHOW_OPTIONS: { value: ShowKey; label: string }[] = [
  { value: 'all', label: 'All eras' },
  { value: 'decades', label: 'Decades only' },
  { value: 'centuries', label: 'Centuries only' },
]

const countTextStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-text-muted)',
}

function CountBadge({ label, n }: { label: string; n: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        fontSize: '12px',
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
      }}
    >
      <strong style={{ fontWeight: 600 }}>{n.toLocaleString()}</strong>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </span>
  )
}

function EraCard({ era }: { era: EraWithCounts }) {
  const century = isCenturyEra(era)
  const headerSize = century ? '20px' : '17px'
  return (
    <Link
      href={`/eras/${era.slug}`}
      className="result-card"
      style={{
        display: 'block',
        padding: '16px 18px',
        background: century ? 'var(--color-surface-elevated, var(--color-surface))' : 'var(--color-bg)',
        borderLeft: century ? '3px solid var(--color-accent)' : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: headerSize, fontWeight: 600 }}>{era.name}</span>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {era.start_year}–{era.end_year}
        </span>
        {era.parent_name && !century && (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            {era.parent_name}
          </span>
        )}
        <span style={{ marginLeft: 'auto', ...countTextStyle }}>
          {era.counts.total.toLocaleString()} items
        </span>
      </div>

      {era.description && (
        <p style={{ margin: '8px 0 12px', fontSize: '14px', lineHeight: 1.45, color: 'var(--color-text)' }}>
          {era.description}
        </p>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <CountBadge label="publications" n={era.counts.publications} />
        <CountBadge label="documents" n={era.counts.documents} />
        <CountBadge label="datasets" n={era.counts.datasets} />
        <CountBadge label="stories" n={era.counts.stories} />
      </div>
    </Link>
  )
}

function buildUrl(current: { sort: SortKey; show: ShowKey }, overrides: Partial<{ sort: SortKey; show: ShowKey }>) {
  const params = new URLSearchParams()
  const sort = overrides.sort ?? current.sort
  const show = overrides.show ?? current.show
  if (sort !== 'recent') params.set('sort', sort)
  if (show !== 'all') params.set('show', show)
  const qs = params.toString()
  return qs ? `/eras?${qs}` : '/eras'
}

export default async function ErasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const sort: SortKey =
    params.sort === 'items' ||
    params.sort === 'publications' ||
    params.sort === 'oldest'
      ? params.sort
      : 'recent'
  const show: ShowKey =
    params.show === 'decades' || params.show === 'centuries' ? params.show : 'all'

  const db = getDb()
  const allEras = await listErasWithCounts(db)

  // Apply show filter
  const filtered = allEras.filter((e) => {
    const century = isCenturyEra(e)
    if (show === 'decades') return !century
    if (show === 'centuries') return century
    return true
  })

  // Apply sort. For "recent" (default), reverse the chronological direction
  // AND flip the tie-breaker: when a century and a decade share a start_year
  // (20th C ↔ pre-1950 at 1900, 21st C ↔ 2000s at 2000), we want the decade
  // first and the century to anchor *after* its children — visually
  // signalling "↑ that was the 20th/21st Century."
  const eras = [...filtered].sort((a, b) => {
    if (sort === 'items') return b.counts.total - a.counts.total
    if (sort === 'publications') return b.counts.publications - a.counts.publications
    if (sort === 'oldest') {
      return a.start_year - b.start_year || (b.end_year - b.start_year) - (a.end_year - a.start_year)
    }
    // 'recent' — DESC, centuries anchor after their child decades
    return b.start_year - a.start_year || (a.end_year - a.start_year) - (b.end_year - b.start_year)
  })

  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px' }}>Eras</h1>
        <p style={{ margin: '0 0 4px', fontSize: '14px', color: 'var(--color-text-muted)', maxWidth: '60ch' }}>
          Time periods covering everything in the Knowledge Commons. Open an
          era to see what was happening then; the per-era views let you compare
          patterns of research, policy, and reporting across decades.
        </p>
        <div style={{ margin: '12px 0 4px' }}>
          <Link
            href="/eras/trends"
            style={{
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)',
              color: '#fff',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            View trends across eras →
          </Link>
        </div>
        <p className="results-count" style={{ margin: '12px 0 0' }}>
          {eras.length} {eras.length === 1 ? 'era' : 'eras'}
          {show !== 'all' ? ` (${show === 'decades' ? 'decades only' : 'centuries only'})` : ''}
        </p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h2 className="filter-label">Sort By</h2>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl({ sort, show }, { sort: opt.value })}
                  style={sort === opt.value ? activeStyle : inactiveStyle}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h2 className="filter-label">Show</h2>
            {SHOW_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl({ sort, show }, { show: opt.value })}
                  style={show === opt.value ? activeStyle : inactiveStyle}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h2 className="filter-label">About</h2>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '4px 0', lineHeight: 1.5 }}>
              Centuries anchor their child decades. <em>Pre-1950</em> is a
              single bucket because per-decade sample sizes before then are too
              thin for stable comparison.
            </p>
          </div>
        </aside>

        <div className="result-cards" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {eras.length === 0 ? (
            <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
              No eras match the current filter.
            </p>
          ) : (
            eras.map((e) => <EraCard key={e.id} era={e} />)
          )}
        </div>
      </div>
    </>
  )
}
