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

// Page content max-width (matches typical detail-page chrome and keeps SVG
// charts at a comfortable reading width on wide screens).
const PAGE_MAX_W = 960

// Stacked-bar legibility cap. Top N categories (by total mentions across all
// eras) keep their colors; everything else aggregates into a single "Other"
// bin. Without this the long tail of small categories (especially in sparse
// early eras) makes the color scale unreadable.
const TOP_N_CATEGORIES = 8
const OTHER_KEY = '__other__'
const OTHER_COLOR = 'var(--color-text-muted)'

// Stable categorical palette — 8-color Tableau-style set; legible alongside a
// neutral Other bin.
const PALETTE = [
  '#4e79a7', '#f28e2c', '#59a14f', '#e15759',
  '#76b7b2', '#af7aa1', '#edc949', '#9c755f',
]

// Series colors for the two diversity metrics on the effective-N chart.
// Shannon stays warm (accent / gold); Inverse Simpson gets the cool teal we
// already use elsewhere for research-side semantics so the two read as a
// related pair without competing.
const SHANNON_COLOR = 'var(--color-accent)'
const SIMPSON_COLOR = '#3a6b7b'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a category slug ("population_ecology") for display ("Population ecology"). */
function prettifyCategory(slug: string): string {
  if (slug === OTHER_KEY) return 'Other'
  return slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Pick the global top-N categories by total mentions across all eras, plus
 * an OTHER_KEY bin if there's a tail. Returned in stack order (top of legend
 * first → bottom of stack); colors index into PALETTE by position, with the
 * "Other" bin getting OTHER_COLOR.
 */
function topCategoriesWithOther(breakdowns: EraCategoryBreakdown[]): string[] {
  const totals = new Map<string, number>()
  for (const b of breakdowns) {
    for (const c of b.categories) {
      totals.set(c.category, (totals.get(c.category) ?? 0) + c.n)
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, TOP_N_CATEGORIES).map(([k]) => k)
  const tail = sorted.slice(TOP_N_CATEGORIES)
  if (tail.length > 0) top.push(OTHER_KEY)
  return top
}

/**
 * For each era, collapse its breakdown into the top-N named categories plus
 * an aggregated "Other" bucket. Shares stay valid (sum to ≤ 1).
 */
function collapseBreakdowns(
  breakdowns: EraCategoryBreakdown[],
  keptCategories: string[],
): EraCategoryBreakdown[] {
  const keptSet = new Set(keptCategories.filter((k) => k !== OTHER_KEY))
  return breakdowns.map((b) => {
    let otherN = 0
    const kept: typeof b.categories = []
    for (const c of b.categories) {
      if (keptSet.has(c.category)) kept.push(c)
      else otherN += c.n
    }
    if (otherN > 0 && keptCategories.includes(OTHER_KEY)) {
      kept.push({ category: OTHER_KEY, n: otherN, share: b.total > 0 ? otherN / b.total : 0 })
    }
    return { ...b, categories: kept }
  })
}

// ---------------------------------------------------------------------------
// Headline numbers
// ---------------------------------------------------------------------------

function trendArrow(delta: number): { glyph: string; color: string; label: string } {
  if (delta > 0.3) return { glyph: '↑', color: '#15803d', label: `+${delta.toFixed(1)}` }
  if (delta < -0.3) return { glyph: '↓', color: '#b91c1c', label: delta.toFixed(1) }
  return { glyph: '→', color: 'var(--color-text-muted)', label: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` }
}

function MetricColumn({
  caption,
  current,
  baseline,
  baselineEra,
  color,
}: {
  caption: string
  current: number
  baseline: number
  baselineEra: string
  color: string
}) {
  const delta = current - baseline
  const arrow = trendArrow(delta)
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
        }}
      >
        {caption}
      </div>
      <div
        style={{
          fontSize: '34px',
          fontWeight: 600,
          lineHeight: 1,
          marginTop: '4px',
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {current.toFixed(1)}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
        vs.{' '}
        <strong style={{ color: 'var(--color-text)', fontWeight: 500 }}>
          {baseline.toFixed(1)} in {baselineEra}
        </strong>{' '}
        <span style={{ color: arrow.color, fontWeight: 600, marginLeft: '4px' }}>
          {arrow.glyph} {arrow.label}
        </span>
      </div>
    </div>
  )
}

function HeadlineSummary({ breakdowns }: { breakdowns: EraCategoryBreakdown[] }) {
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
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '20px',
        maxWidth: '600px',
      }}
    >
      <MetricColumn
        caption="Broad diversity (Shannon)"
        current={last.effective_n}
        baseline={first.effective_n}
        baselineEra={first.era_name}
        color={SHANNON_COLOR}
      />
      <MetricColumn
        caption="Top-category evenness (Inverse Simpson)"
        current={last.inverse_simpson}
        baseline={first.inverse_simpson}
        baselineEra={first.era_name}
        color={SIMPSON_COLOR}
      />
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

interface ChartSeries {
  key: 'shannon' | 'simpson'
  label: string
  color: string
  getter: (b: EraCategoryBreakdown) => number
}

const CHART_SERIES: ChartSeries[] = [
  {
    key: 'shannon',
    label: 'Shannon (all categories)',
    color: SHANNON_COLOR,
    getter: (b) => b.effective_n,
  },
  {
    key: 'simpson',
    label: 'Inverse Simpson (top-weighted)',
    color: SIMPSON_COLOR,
    getter: (b) => b.inverse_simpson,
  },
]

function EffectiveNChart({ breakdowns }: { breakdowns: EraCategoryBreakdown[] }) {
  if (breakdowns.length === 0) return null
  const plotW = CHART_W - MARGIN.left - MARGIN.right
  const plotH = LINE_CHART_H - MARGIN.top - MARGIN.bottom

  // y-scale: 0 to max of EITHER metric. Inverse Simpson is always ≤ Shannon
  // effective N, so max is Shannon-bounded — but we pad based on the joint
  // max anyway.
  const allYs = breakdowns.flatMap((b) => CHART_SERIES.map((s) => s.getter(b)))
  const maxY = Math.max(2, Math.ceil(Math.max(...allYs) + 1))
  const yToPx = (v: number) => MARGIN.top + plotH - (v / maxY) * plotH
  const xToPx = (i: number) =>
    MARGIN.left + (breakdowns.length === 1 ? plotW / 2 : (i / (breakdowns.length - 1)) * plotW)

  const yTicks = [0, maxY / 2, maxY].map((v) => Math.round(v * 10) / 10)

  return (
    <svg
      role="img"
      aria-label={`Line chart comparing Shannon and Inverse Simpson effective number of categories across ${breakdowns.length} decades`}
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

      {/* Series (Shannon then Simpson) */}
      {CHART_SERIES.map((s) => {
        const points = breakdowns.map((b, i) => ({ x: xToPx(i), y: yToPx(s.getter(b)), b }))
        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
        return (
          <g key={s.key}>
            <path d={path} fill="none" stroke={s.color} strokeWidth="2" />
            {points.map((p) => {
              const reliable = p.b.total >= RELIABLE_MIN_MENTIONS
              return (
                <g key={p.b.era_slug}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={reliable ? 4 : 3}
                    fill={reliable ? s.color : 'var(--color-surface)'}
                    stroke={s.color}
                    strokeWidth="1.5"
                    opacity={reliable ? 1 : 0.55}
                  />
                  <title>{`${p.b.era_name} · ${s.label}: ${s.getter(p.b).toFixed(2)} (from ${p.b.total.toLocaleString()} mentions${reliable ? '' : '; sparse'})`}</title>
                </g>
              )
            })}
          </g>
        )
      })}

      {/* Inline legend top-right */}
      <g transform={`translate(${CHART_W - MARGIN.right - 230}, ${MARGIN.top + 2})`}>
        {CHART_SERIES.map((s, i) => (
          <g key={s.key} transform={`translate(0, ${i * 16})`}>
            <line x1={0} x2={22} y1={6} y2={6} stroke={s.color} strokeWidth="2" />
            <circle cx={11} cy={6} r="3" fill={s.color} />
            <text x={28} y={9} fontSize="11" fill="var(--color-text)">
              {s.label}
            </text>
          </g>
        ))}
      </g>

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
  const colorFor = (slug: string) => {
    if (slug === OTHER_KEY) return OTHER_COLOR
    const idx = categoryOrder.filter((k) => k !== OTHER_KEY).indexOf(slug)
    return PALETTE[idx >= 0 ? idx % PALETTE.length : 0]
  }

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
  // Same color resolution as CompositionChart so the legend always matches.
  const named = categoryOrder.filter((k) => k !== OTHER_KEY)
  const colorFor = (slug: string) =>
    slug === OTHER_KEY ? OTHER_COLOR : PALETTE[named.indexOf(slug) % PALETTE.length]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: '8px', fontSize: '12px' }}>
      {categoryOrder.map((slug) => (
        <div key={slug} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              background: colorFor(slug),
              borderRadius: '2px',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--color-text)', fontStyle: slug === OTHER_KEY ? 'italic' : 'normal' }}>
            {prettifyCategory(slug)}
          </span>
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
  const categoryOrder = topCategoriesWithOther(breakdowns)
  const collapsed = collapseBreakdowns(breakdowns, categoryOrder)
  return (
    <section style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px', maxWidth: '60ch' }}>
        {subtitle}
      </p>
      <HeadlineSummary breakdowns={breakdowns} />

      <div style={{ marginTop: '20px' }}>
        <EffectiveNChart breakdowns={breakdowns} />
      </div>

      <h3 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', margin: '24px 0 8px' }}>
        Composition
      </h3>
      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
        Share of mentions in each {metricLabel.toLowerCase()} per decade. Numbers under each bar are total mentions for that decade.
      </p>
      <CompositionChart breakdowns={collapsed} categoryOrder={categoryOrder} />
      <Legend categoryOrder={categoryOrder} />
      {categoryOrder.includes(OTHER_KEY) && (
        <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: '6px 0 0', fontStyle: 'italic' }}>
          “Other” aggregates {breakdowns.reduce(
            (max, b) => Math.max(max, b.categories.filter((c) => !categoryOrder.includes(c.category)).length),
            0,
          )}{' '}
          smaller {metricLabel.toLowerCase()} with a long-tail share. Hover any segment for the underlying share.
        </p>
      )}
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
    <div style={{ maxWidth: `${PAGE_MAX_W}px`, margin: '0 auto', padding: '0 16px' }}>
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

      <section
        style={{
          marginTop: '20px',
          padding: '12px 16px',
          background: 'var(--color-surface)',
          borderLeft: `3px solid ${SHANNON_COLOR}`,
          borderRadius: 'var(--radius-sm)',
          fontSize: '13px',
          lineHeight: 1.6,
          color: 'var(--color-text)',
        }}
      >
        Each panel below shows{' '}
        <strong>two complementary diversity measures</strong>, both in{' '}
        <em>“effective number of categories”</em> units — interpretable as
        “as if there were <em>N</em> equally-weighted categories.” A single
        number can&rsquo;t capture both the breadth of a long tail and the
        evenness of the dominant categories, so the two together tell the
        full story.
        <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
          <li>
            <strong style={{ color: SHANNON_COLOR }}>Shannon</strong> counts{' '}
            <em>every</em> category proportional to its share — sensitive to
            the long tail. Answers <em>“how many categories are in play,
              broadly?”</em>
          </li>
          <li>
            <strong style={{ color: SIMPSON_COLOR }}>Inverse Simpson</strong>{' '}
            emphasizes the dominant categories — the long tail barely
            contributes. Answers <em>“how evenly distributed are the common
              categories?”</em>
          </li>
        </ul>
        <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted)' }}>
          When the lines diverge, you learn where change is happening. Shannon
          rising faster than Inverse Simpson = more small categories appearing
          in the tail. Inverse Simpson rising faster = the dominant categories
          are becoming more evenly distributed without much change in breadth.
        </p>
      </section>

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
    </div>
  )
}
