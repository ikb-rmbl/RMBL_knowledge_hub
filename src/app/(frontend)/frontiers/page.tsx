import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Research Frontiers — RMBL Knowledge Fabric',
  description:
    'Synthesized boundaries between what scientists know and what they don\'t, with identifiable paths to push the boundary forward. Drawn from the research neighborhoods of the Rocky Mountain Biological Laboratory and the Gunnison Basin.',
}

const SORT_OPTIONS = [
  { value: 'breadth', label: 'Cross-cutting breadth' },
  { value: 'leverage', label: 'Management leverage' },
  { value: 'size', label: 'Cluster size' },
  { value: 'title', label: 'Title (A-Z)' },
]

const MGMT_FILTERS = [
  { value: '', label: 'All' },
  { value: 'regulatory', label: 'Regulatory (≥2.7)' },
  { value: 'direct', label: 'Direct (2.0-2.7)' },
  { value: 'indirect', label: 'Indirect (1.0-2.0)' },
  { value: 'basic', label: 'Basic science (<1.0)' },
]

const REACH_FILTERS = [
  { value: '', label: 'All' },
  { value: '6plus', label: '6+ neighborhoods' },
  { value: '2to5', label: '2-5 neighborhoods' },
  { value: 'single', label: 'Single neighborhood' },
]

function mgmtClause(filter: string): string {
  switch (filter) {
    case 'regulatory': return 'avg_management_relevance >= 2.7'
    case 'direct': return 'avg_management_relevance >= 2.0 AND avg_management_relevance < 2.7'
    case 'indirect': return 'avg_management_relevance >= 1.0 AND avg_management_relevance < 2.0'
    case 'basic': return 'avg_management_relevance < 1.0'
    default: return 'TRUE'
  }
}

function reachClause(filter: string): string {
  switch (filter) {
    case '6plus': return 'source_neighborhoods >= 6'
    case '2to5': return 'source_neighborhoods BETWEEN 2 AND 5'
    case 'single': return 'source_neighborhoods <= 1'
    default: return 'TRUE'
  }
}

function orderBy(sort: string): string {
  switch (sort) {
    case 'leverage': return 'avg_management_relevance DESC NULLS LAST, source_neighborhoods DESC NULLS LAST'
    case 'size': return 'source_cluster_size DESC NULLS LAST'
    case 'title': return 'title ASC'
    default: return 'source_neighborhoods DESC NULLS LAST, avg_management_relevance DESC NULLS LAST'
  }
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'inherit',
    border: '1px solid var(--color-border)',
    textDecoration: 'none',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  }
}

function mgmtBadge(score: number | null): { label: string; color: string } | null {
  if (score == null) return null
  if (score >= 2.7) return { label: 'Regulatory', color: '#a8423f' }
  if (score >= 2.0) return { label: 'Direct mgmt', color: '#a8693f' }
  if (score >= 1.0) return { label: 'Indirect mgmt', color: '#7a7a4a' }
  return { label: 'Basic science', color: '#5a6a7a' }
}

export default async function FrontiersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; mgmt?: string; reach?: string }>
}) {
  const params = await searchParams
  const sort = params.sort || 'breadth'
  const mgmt = params.mgmt || ''
  const reach = params.reach || ''

  const db = getDb()
  const { rows } = await db.query(
    `SELECT id, slug, title, cross_cutting_summary, tractability,
            source_cluster_size, source_neighborhoods, avg_management_relevance,
            jsonb_array_length(coalesce(pushing_the_frontier, '[]'::jsonb)) AS action_count,
            jsonb_array_length(coalesce(key_questions, '[]'::jsonb)) AS question_count
     FROM frontiers
     WHERE ${mgmtClause(mgmt)} AND ${reachClause(reach)}
     ORDER BY ${orderBy(sort)}`,
  )

  const { rows: [{ total }] } = await db.query(`SELECT count(*)::int AS total FROM frontiers`)

  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams()
    if (sort !== 'breadth') next.set('sort', sort)
    if (mgmt) next.set('mgmt', mgmt)
    if (reach) next.set('reach', reach)
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v); else next.delete(k)
    }
    const s = next.toString()
    return s ? `/frontiers?${s}` : '/frontiers'
  }

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 8px' }}>Research Frontiers</h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', maxWidth: '70ch', margin: 0 }}>
          Synthesized boundaries between what scientists know and what they don't, with identifiable
          paths to push the boundary forward. Each frontier is built from atomic gap-statements
          extracted across the research neighborhoods of the RMBL Knowledge Fabric, then clustered
          by semantic similarity and synthesized into a coherent narrative.{' '}
          <strong>{rows.length}</strong> shown of <strong>{total}</strong> frontiers.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', flexWrap: 'wrap', fontSize: '12px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Sort:</span>
          {SORT_OPTIONS.map((opt) => (
            <Link key={opt.value} href={buildUrl({ sort: opt.value })} style={chipStyle(sort === opt.value)}>
              {opt.label}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Mgmt:</span>
          {MGMT_FILTERS.map((opt) => (
            <Link key={opt.value} href={buildUrl({ mgmt: opt.value })} style={chipStyle(mgmt === opt.value)}>
              {opt.label}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Reach:</span>
          {REACH_FILTERS.map((opt) => (
            <Link key={opt.value} href={buildUrl({ reach: opt.value })} style={chipStyle(reach === opt.value)}>
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }}>
        {rows.map((f: any) => {
          const badge = mgmtBadge(f.avg_management_relevance != null ? Number(f.avg_management_relevance) : null)
          return (
            <Link
              key={f.id}
              href={`/frontiers/${f.id}`}
              style={{
                display: 'block', padding: '16px', borderRadius: 'var(--radius)',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                textDecoration: 'none', color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                {badge && (
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: badge.color, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {badge.label}
                  </span>
                )}
                {f.source_neighborhoods >= 6 && (
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: '#3a6b7b', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Cross-cutting
                  </span>
                )}
                {f.tractability && (
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                    {f.tractability} tractability
                  </span>
                )}
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 6px', lineHeight: 1.3 }}>
                {f.title}
              </h3>
              {f.cross_cutting_summary && (
                <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
                  {f.cross_cutting_summary}
                </p>
              )}
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <span>{f.source_cluster_size} statements</span>
                <span>{f.source_neighborhoods} neighborhood{f.source_neighborhoods !== 1 ? 's' : ''}</span>
                <span>{f.question_count} questions</span>
                <span>{f.action_count} actions</span>
              </div>
            </Link>
          )
        })}
      </div>

      {rows.length === 0 && (
        <p style={{ marginTop: '40px', color: 'var(--color-text-muted)' }}>
          No frontiers match the current filters. <Link href="/frontiers" style={{ color: 'var(--color-accent)' }}>Clear filters</Link>.
        </p>
      )}
    </div>
  )
}
