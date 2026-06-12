import Link from 'next/link'
import { getDb } from '../lib/db'
import { listErasWithCounts, isCenturyEra, type EraWithCounts } from '@/services/eras'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Eras — RMBL Knowledge Commons',
  description:
    'Time periods covering research, community documents, datasets, and stories from the Gunnison Basin. Open an era to see what was happening then; compare eras to see how patterns of research and policy have changed.',
}

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
        borderLeft: century
          ? '3px solid var(--color-accent)'
          : '3px solid transparent',
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

export default async function ErasPage() {
  const db = getDb()
  const eras = await listErasWithCounts(db)

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px' }}>Eras</h1>
        <p style={{ margin: '0 0 4px', fontSize: '14px', color: 'var(--color-text-muted)', maxWidth: '60ch' }}>
          Time periods covering everything in the Knowledge Commons. Open an
          era to see what was happening then; the per-era views will let you
          compare patterns of research, policy, and reporting across decades.
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
        <p style={{ margin: '12px 0 16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
          {eras.length} eras · centuries shown as anchors for their decades. <em>Pre-1950</em> is a single bucket because per-decade sample sizes before then are too thin for stable comparison.
        </p>
      </div>

      <div className="result-cards" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {eras.map((e) => (
          <EraCard key={e.id} era={e} />
        ))}
      </div>
    </>
  )
}
