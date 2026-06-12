import Link from 'next/link'
import { getDb } from '../../lib/db'
import {
  getDiversityAcrossEras,
  RESEARCH_SOURCES,
  type EraCategoryBreakdown,
  type SourceCollection,
} from '@/services/eras'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Trends across eras — RMBL Knowledge Commons',
  description:
    'How discipline and methodological-approach diversity in RMBL research has changed across decades, measured as effective number of categories per era.',
}

const ALL_SOURCES: SourceCollection[] = ['publications', 'documents', 'datasets', 'stories']

// Cutoff below which a decade's effective N is too sparse to take seriously.
// Eras under this many mentions are still drawn but dimmed and marked.
const RELIABLE_MIN_MENTIONS = 100

// Stable categorical palette. First N entries used for whichever dimension
// has fewer categories; both dimensions get the same ordering so colors are
// consistent within each chart.
const PALETTE = [
  '#4e79a7', '#f28e2c', '#59a14f', '#e15759', '#76b7b2',
  '#af7aa1', '#edc949', '#9c755f', '#ff9da7', '#bab0ab',
  '#6a3d9a', '#b15928', '#1f77b4', '#33a02c', '#fb9a99',
  '#cab2d6', '#fdbf6f', '#b2df8a', '#a6cee3', '#ffff99',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a category slug ("population_ecology") for display ("Population ecology"). */
function prettifyCategory(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Collect a global ordering of categories across all eras so colors stay
 * consistent in the stacked bars even when a category drops out of one era.
 * Ordered by total mention count across all eras desc.
 */
function globalCategoryOrder(breakdowns: EraCategoryBreakdown[]): string[] {
  const totals = new Map<string, number>()
  for (const b of breakdowns) {
    for (const c of b.categories) {
      totals.set(c.category, (totals.get(c.category) ?? 0) + c.n)
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

// ---------------------------------------------------------------------------
// Headline numbers
// ---------------------------------------------------------------------------

function trendArrow(delta: number): { glyph: string; color: string; label: string } {
  if (delta > 0.3) return { glyph: '↑', color: '#15803d', label: `+${delta.toFixed(1)}` }
  if (delta < -0.3) return { glyph: '↓', color: '#b91c1c', label: delta.toFixed(1) }
  return { glyph: '→', color: 'var(--color-text-muted)', label: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` }
}

function HeadlineSummary({ breakdowns, label }: { breakdowns: EraCategoryBreakdown[]; label: string }) {
  // Compare the latest reliable era to the earliest reliable era.
  const reliable = breakdowns.filter((b) => b.total >= RELIABLE_MIN_MENTIONS)
  const first = reliable[0]
  const last = reliable[reliable.length - 1]
  if (!first || !last || first === last) {
    return (
      <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
        Not enough reliable decades to summarize a trend.
      </div>
    )
  }
  const delta = last.effective_n - first.effective_n
  const arrow = trendArrow(delta)
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '20px', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: '38px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {last.effective_n.toFixed(1)}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
          effective {label.toLowerCase()} in the {last.era_name}
        </div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
        vs.{' '}
        <strong style={{ color: 'var(--color-text)', fontWeight: 500 }}>
          {first.effective_n.toFixed(1)} in the {first.era_name}
        </strong>{' '}
        <span style={{ color: arrow.color, fontWeight: 600, marginLeft: '4px' }}>
          {arrow.glyph} {arrow.label}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line chart: effective N per era
// ---------------------------------------------------------------------------

const CHART_W = 700
const LINE_CHART_H = 230
const STACK_CHART_H = 220
const MARGIN = { top: 14, right: 16, bottom: 36, left: 42 }

function EffectiveNChart({ breakdowns }: { breakdowns: EraCategoryBreakdown[] }) {
  if (breakdowns.length === 0) return null
  const plotW = CHART_W - MARGIN.left - MARGIN.right
  const plotH = LINE_CHART_H - MARGIN.top - MARGIN.bottom

  // y-scale: 0 to max effective N, padded
  const maxY = Math.max(2, Math.ceil(Math.max(...breakdowns.map((b) => b.effective_n)) + 1))
  const yToPx = (v: number) => MARGIN.top + plotH - (v / maxY) * plotH
  // x positions evenly spaced
  const xToPx = (i: number) =>
    MARGIN.left + (breakdowns.length === 1 ? plotW / 2 : (i / (breakdowns.length - 1)) * plotW)

  const yTicks = [0, maxY / 2, maxY].map((v) => Math.round(v * 10) / 10)
  const points = breakdowns.map((b, i) => ({ x: xToPx(i), y: yToPx(b.effective_n), b }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  return (
    <svg
      role="img"
      aria-label={`Line chart of effective number of categories across ${breakdowns.length} decades`}
      viewBox={`0 0 ${CHART_W} ${LINE_CHART_H}`}
      style={{ width: '100%', height: 'auto', display: 'block', maxWidth: `${CHART_W}px` }}
    >
      {/* Y-axis grid + labels */}
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={MARGIN.left}
            x2={CHART_W - MARGIN.right}
            y1={yToPx(v)}
            y2={yToPx(v)}
            stroke="var(--color-border)"
            strokeDasharray="2 3"
          />
          <text
            x={MARGIN.left - 6}
            y={yToPx(v) + 4}
            textAnchor="end"
            fontSize="11"
            fill="var(--color-text-muted)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {v}
          </text>
        </g>
      ))}
      {/* X-axis labels */}
      {breakdowns.map((b, i) => (
        <text
          key={b.era_slug}
          x={xToPx(i)}
          y={LINE_CHART_H - MARGIN.bottom + 16}
          textAnchor="middle"
          fontSize="11"
          fill="var(--color-text-muted)"
        >
          {b.era_name}
        </text>
      ))}
      {/* Line */}
      <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      {/* Points — dimmer + smaller for sparse eras */}
      {points.map((p) => {
        const reliable = p.b.total >= RELIABLE_MIN_MENTIONS
        return (
          <g key={p.b.era_slug}>
            <circle
              cx={p.x}
              cy={p.y}
              r={reliable ? 5 : 3.5}
              fill={reliable ? 'var(--color-accent)' : 'var(--color-surface)'}
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              opacity={reliable ? 1 : 0.55}
            />
            <title>{`${p.b.era_name}: ${p.b.effective_n.toFixed(2)} effective categories from ${p.b.total.toLocaleString()} mentions${reliable ? '' : ' (sparse — interpret with caution)'}`}</title>
          </g>
        )
      })}
      {/* Y axis title */}
      <text
        transform={`translate(12 ${MARGIN.top + plotH / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize="11"
        fill="var(--color-text-muted)"
      >
        effective N
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Stacked-bar chart: category composition per era
// ---------------------------------------------------------------------------

function CompositionChart({
  breakdowns,
  categoryOrder,
}: {
  breakdowns: EraCategoryBreakdown[]
  categoryOrder: string[]
}) {
  if (breakdowns.length === 0) return null
  const plotW = CHART_W - MARGIN.left - MARGIN.right
  const plotH = STACK_CHART_H - MARGIN.top - MARGIN.bottom

  const gap = 6
  const barW = (plotW - gap * (breakdowns.length - 1)) / breakdowns.length
  const colorFor = (slug: string) => PALETTE[categoryOrder.indexOf(slug) % PALETTE.length]

  return (
    <svg
      role="img"
      aria-label="Stacked composition of categories per decade"
      viewBox={`0 0 ${CHART_W} ${STACK_CHART_H}`}
      style={{ width: '100%', height: 'auto', display: 'block', maxWidth: `${CHART_W}px` }}
    >
      {/* y ticks at 0/50/100% */}
      {[0, 0.5, 1].map((p) => (
        <g key={p}>
          <line
            x1={MARGIN.left}
            x2={CHART_W - MARGIN.right}
            y1={MARGIN.top + plotH - p * plotH}
            y2={MARGIN.top + plotH - p * plotH}
            stroke="var(--color-border)"
            strokeDasharray="2 3"
          />
          <text
            x={MARGIN.left - 6}
            y={MARGIN.top + plotH - p * plotH + 4}
            textAnchor="end"
            fontSize="11"
            fill="var(--color-text-muted)"
          >
            {Math.round(p * 100)}%
          </text>
        </g>
      ))}

      {/* Bars */}
      {breakdowns.map((b, i) => {
        const x = MARGIN.left + i * (barW + gap)
        // Render segments in global order so colors line up across bars.
        let cumPx = 0
        // Build lookup from this era's categories
        const m = new Map(b.categories.map((c) => [c.category, c]))
        return (
          <g key={b.era_slug}>
            {categoryOrder.map((slug) => {
              const c = m.get(slug)
              if (!c || c.share === 0) return null
              const h = c.share * plotH
              const y = MARGIN.top + plotH - cumPx - h
              cumPx += h
              return (
                <g key={slug}>
                  <rect x={x} y={y} width={barW} height={h} fill={colorFor(slug)} opacity={b.total >= RELIABLE_MIN_MENTIONS ? 1 : 0.45} />
                  <title>{`${b.era_name} · ${prettifyCategory(slug)}: ${(c.share * 100).toFixed(1)}% (${c.n.toLocaleString()} of ${b.total.toLocaleString()})`}</title>
                </g>
              )
            })}
            <text
              x={x + barW / 2}
              y={STACK_CHART_H - MARGIN.bottom + 16}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-text-muted)"
            >
              {b.era_name}
            </text>
            <text
              x={x + barW / 2}
              y={STACK_CHART_H - MARGIN.bottom + 28}
              textAnchor="middle"
              fontSize="9"
              fill="var(--color-text-muted)"
              opacity={b.total >= RELIABLE_MIN_MENTIONS ? 0.7 : 0.4}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {b.total >= 1000 ? `${(b.total / 1000).toFixed(1)}k` : b.total}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend({ categoryOrder }: { categoryOrder: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: '8px', fontSize: '12px' }}>
      {categoryOrder.map((slug, i) => (
        <div key={slug} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              background: PALETTE[i % PALETTE.length],
              borderRadius: '2px',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--color-text)' }}>{prettifyCategory(slug)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel (one per dimension)
// ---------------------------------------------------------------------------

function DiversityPanel({
  title,
  subtitle,
  metricLabel,
  breakdowns,
}: {
  title: string
  subtitle: string
  metricLabel: string
  breakdowns: EraCategoryBreakdown[]
}) {
  const categoryOrder = globalCategoryOrder(breakdowns)
  return (
    <section style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px', maxWidth: '60ch' }}>
        {subtitle}
      </p>
      <HeadlineSummary breakdowns={breakdowns} label={metricLabel} />

      <div style={{ marginTop: '20px' }}>
        <EffectiveNChart breakdowns={breakdowns} />
      </div>

      <h3 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', margin: '24px 0 8px' }}>
        Composition
      </h3>
      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
        Share of mentions in each {metricLabel.toLowerCase()} per decade. Numbers under each bar are total mentions for that decade.
      </p>
      <CompositionChart breakdowns={breakdowns} categoryOrder={categoryOrder} />
      <Legend categoryOrder={categoryOrder} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Source-lens toggle (URL-driven, no client component needed)
// ---------------------------------------------------------------------------

function LensToggle({ active }: { active: 'research' | 'all' }) {
  const chip = (label: string, value: 'research' | 'all', href: string) => (
    <Link
      key={value}
      href={href}
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--radius-sm)',
        background: active === value ? 'var(--color-accent)' : 'var(--color-surface)',
        color: active === value ? '#fff' : 'var(--color-text)',
        border: '1px solid var(--color-border)',
        textDecoration: 'none',
        fontSize: '12px',
        fontWeight: active === value ? 600 : 400,
      }}
    >
      {label}
    </Link>
  )
  return (
    <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
      {chip('Research only', 'research', '/eras/trends?lens=research')}
      {chip('All sources', 'all', '/eras/trends?lens=all')}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ErasTrendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const lens: 'research' | 'all' = params.lens === 'all' ? 'all' : 'research'
  const sources = lens === 'research' ? RESEARCH_SOURCES : ALL_SOURCES

  const db = getDb()
  const [scopes, protocolCats] = await Promise.all([
    getDiversityAcrossEras(db, 'scope', sources),
    getDiversityAcrossEras(db, 'protocol_category', sources),
  ])

  return (
    <>
      <div className="search-results-header">
        <Link href="/eras" style={{ fontSize: '13px', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          ← All eras
        </Link>
        <h1 style={{ fontSize: '26px', fontWeight: 600, margin: '8px 0 4px' }}>Trends across eras</h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', margin: 0, maxWidth: '70ch' }}>
          Is research becoming more diverse over time? Each chart below shows the{' '}
          <em>effective number of categories</em> per decade — Shannon entropy
          transformed so the number is interpretable as &ldquo;as if there were N
          equally-weighted categories.&rdquo; Higher = more even spread across many
          categories; lower = concentration in a few.
        </p>
        <LensToggle active={lens} />
      </div>

      <DiversityPanel
        title="Disciplines"
        subtitle="Research disciplines represented in extracted concepts (population ecology, hydrology, evolution, biogeochemistry, …). The discipline lens for the diversity question."
        metricLabel="Disciplines"
        breakdowns={scopes}
      />

      <DiversityPanel
        title="Methodological approaches"
        subtitle="Protocol categories — sampling, measurement, experimental, computational, observational, analytical, laboratory — capturing how the research was conducted."
        metricLabel="Approaches"
        breakdowns={protocolCats}
      />

      <section style={{ marginTop: '32px', padding: '14px 16px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--color-text)' }}>Caveat:</strong>{' '}
        Decades before the 1990s have thin extraction coverage (the full-text PDF
        coverage gap discussed in the broader plan), so their effective-N
        estimates are based on very few mentions and should be read as suggestive
        rather than definitive. Sparse decades are dimmed in the charts; hover any
        point or bar segment for the underlying mention count. The reliable
        signal is the 1990s onward.
      </section>
    </>
  )
}
