import Link from 'next/link'
import { getDb } from '../../lib/db'
import {
  getAuthorCohortsByEra,
  getDiversityAcrossEras,
  getPublicationContextByEra,
  isCenturyEra,
  listErasWithCounts,
  RESEARCH_SOURCES,
  type CategoryDimension,
  type EraCategoryBreakdown,
  type EraCohortBreakdown,
  type EraWithCounts,
  type PublicationContextRow,
  type SourceCollection,
} from '@/services/eras'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'How has RMBL research changed over time? — RMBL Knowledge Commons',
  description:
    'Several views of how RMBL research has changed across eras: corpus growth, full-text coverage, community evolution, discipline and methodological diversification, and the generational composition of authors active in each era.',
}

const ALL_SOURCES: SourceCollection[] = ['publications', 'documents', 'datasets', 'stories']

// Cutoff below which a decade's effective N is too sparse to take seriously.
// Eras under this many mentions are still drawn but dimmed and marked.
// Reliability cutoff per dimension. Concept mentions are denser than
// protocol mentions (typically 3–5x), so a single threshold either dims too
// few sparse concept eras or too many real protocol eras. Calibrated so the
// same era reads as reliable in both panels (e.g. 1996–2000 has 338 concept
// mentions, 63 protocol mentions — both above their respective cutoffs).
const RELIABLE_MIN_MENTIONS_BY_DIMENSION: Record<CategoryDimension, number> = {
  scope: 100,
  protocol_category: 50,
}

function reliableMinFor(dimension: CategoryDimension): number {
  return RELIABLE_MIN_MENTIONS_BY_DIMENSION[dimension]
}

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

// Stable categorical palette used for dimensions that don't have a natural
// thematic grouping (protocol categories). 8-color Tableau-style set, legible
// alongside a neutral Other bin.
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
// Concept-scope domain grouping
//
// Concept scopes split into three thematic families. The composition chart
// uses this both for ordering (life sciences cluster together, earth sciences
// cluster together, cross-cutting at the top of the stack) and for color
// scheme (warm reds/oranges for life, cool blues/teals for earth, neutrals
// for cross-cutting). Boundary categories (biogeochemistry, landscape) are
// best-effort classifications and easy to move if a curator disagrees.
// ---------------------------------------------------------------------------

type ScopeDomain = 'earth' | 'life' | 'cross'

const SCOPE_DOMAINS: Record<string, ScopeDomain> = {
  // Earth sciences — geo / hydro / climate / spatial
  climate: 'earth',
  hydrology: 'earth',
  biogeochemistry: 'earth',
  water_resources: 'earth',
  general_geology: 'earth',
  geology: 'earth',
  geochemistry: 'earth',
  geophysical: 'earth',
  geophysics: 'earth',
  geomorphology: 'earth',
  paleontology: 'earth',
  geochronology: 'earth',
  landscape: 'earth',
  remote_sensing: 'earth',
  // Life sciences — biological / ecological / organismal
  population_ecology: 'life',
  community_ecology: 'life',
  general_ecology: 'life',
  evolution: 'life',
  behavioral_ecology: 'life',
  molecular: 'life',
  plant_ecology: 'life',
  plant_physiology: 'life',
  'plant physiology': 'life',
  physiological: 'life',
  chemical_ecology: 'life',
  pollination_ecology: 'life',
  biochemistry: 'life',
  biogeography: 'life',
  reproduction: 'life',
  social_behavior: 'life',
  immunology: 'life',
  conservation: 'life',
  environmental_stress: 'life',
  // Everything else defaults to 'cross': methodological, community_planning,
  // environmental_review, energy, film_studies, etc.
}

function scopeDomain(slug: string): ScopeDomain {
  return SCOPE_DOMAINS[slug] ?? 'cross'
}

// Stack order (first = bottom of stack). Earth at the ground, life above,
// cross-cutting up top, Other above that.
const DOMAIN_STACK_ORDER: ScopeDomain[] = ['earth', 'life', 'cross']

// Domain-specific palettes. Each has enough range that individual categories
// within the family stay distinguishable.
const EARTH_PALETTE = [
  '#1f4e79', // navy
  '#2e6f9b', // steel blue
  '#4e79a7', // muted blue
  '#76b7b2', // teal
  '#5d7e8f', // slate
  '#3d8b78', // forest green-blue
]

const LIFE_PALETTE = [
  '#a83232', // brick red
  '#d62728', // red
  '#e07a5f', // terracotta
  '#f28e2c', // orange
  '#edc949', // mustard
  '#af7aa1', // dusty purple-pink
]

const CROSS_PALETTE = [
  '#7d7d7d', // medium gray
  '#a39584', // taupe
  '#9c755f', // brown
]

function paletteFor(domain: ScopeDomain): string[] {
  if (domain === 'earth') return EARTH_PALETTE
  if (domain === 'life') return LIFE_PALETTE
  return CROSS_PALETTE
}

const DOMAIN_LABELS: Record<ScopeDomain, string> = {
  earth: 'Earth sciences',
  life: 'Life sciences',
  cross: 'Cross-cutting',
}

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
 * an OTHER_KEY bin if there's a tail.
 *
 * For dimension='scope', the returned order groups by domain (earth → life
 * → cross) so life sciences cluster together in both the stack and the
 * legend. Within each domain, categories stay in count-desc order.
 *
 * For dimension='protocol_category', returned in pure count-desc order
 * (no domain grouping applies — protocol categories are methods, not
 * disciplines).
 */
function topCategoriesWithOther(
  breakdowns: EraCategoryBreakdown[],
  dimension: CategoryDimension,
): string[] {
  const totals = new Map<string, number>()
  for (const b of breakdowns) {
    for (const c of b.categories) {
      totals.set(c.category, (totals.get(c.category) ?? 0) + c.n)
    }
  }
  const sortedByCount = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
  const topByCount = sortedByCount.slice(0, TOP_N_CATEGORIES)
  const hasTail = sortedByCount.length > TOP_N_CATEGORIES

  let ordered: string[]
  if (dimension === 'scope') {
    // Group by domain in stack order; within each group preserve count desc.
    ordered = []
    for (const domain of DOMAIN_STACK_ORDER) {
      for (const slug of topByCount) {
        if (scopeDomain(slug) === domain) ordered.push(slug)
      }
    }
  } else {
    ordered = topByCount
  }

  if (hasTail) ordered.push(OTHER_KEY)
  return ordered
}

/**
 * Color resolution shared between CompositionChart and Legend, dimension
 * aware so the scope panel gets the domain palettes and the protocol-category
 * panel keeps the simple Tableau-style PALETTE.
 */
function colorForCategory(
  slug: string,
  categoryOrder: string[],
  dimension: CategoryDimension,
): string {
  if (slug === OTHER_KEY) return OTHER_COLOR
  if (dimension !== 'scope') {
    const named = categoryOrder.filter((k) => k !== OTHER_KEY)
    const idx = named.indexOf(slug)
    return PALETTE[idx >= 0 ? idx % PALETTE.length : 0]
  }
  // Scope: pick the palette by the category's domain; index by position
  // within its own domain in the (already domain-grouped) categoryOrder.
  const domain = scopeDomain(slug)
  const palette = paletteFor(domain)
  const sameDomain = categoryOrder.filter(
    (k) => k !== OTHER_KEY && scopeDomain(k) === domain,
  )
  const idx = sameDomain.indexOf(slug)
  return palette[idx >= 0 ? idx % palette.length : 0]
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

function HeadlineSummary({ breakdowns, reliableMin }: { breakdowns: EraCategoryBreakdown[]; reliableMin: number }) {
  // Compare the latest reliable era to the earliest reliable era.
  const reliable = breakdowns.filter((b) => b.total >= reliableMin)
  const first = reliable[0]
  const last = reliable[reliable.length - 1]
  if (!first || !last || first === last) {
    return (
      <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
        Not enough reliable eras to summarize a trend.
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

function EffectiveNChart({ breakdowns, reliableMin }: { breakdowns: EraCategoryBreakdown[]; reliableMin: number }) {
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
      aria-label={`Line chart comparing Shannon and Inverse Simpson effective number of categories across ${breakdowns.length} eras`}
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
              const reliable = p.b.total >= reliableMin
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
  dimension,
  reliableMin,
}: {
  breakdowns: EraCategoryBreakdown[]
  categoryOrder: string[]
  dimension: CategoryDimension
  reliableMin: number
}) {
  if (breakdowns.length === 0) return null
  const plotW = CHART_W - MARGIN.left - MARGIN.right
  const plotH = STACK_CHART_H - MARGIN.top - MARGIN.bottom

  const gap = 6
  const barW = (plotW - gap * (breakdowns.length - 1)) / breakdowns.length
  const colorFor = (slug: string) => colorForCategory(slug, categoryOrder, dimension)

  return (
    <svg
      role="img"
      aria-label="Stacked composition of categories per era"
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
                  <rect x={x} y={y} width={barW} height={h} fill={colorFor(slug)} opacity={b.total >= reliableMin ? 1 : 0.45} />
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
              opacity={b.total >= reliableMin ? 0.7 : 0.4}
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

function Swatch({ slug, color }: { slug: string; color: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span
        style={{
          display: 'inline-block',
          width: '12px',
          height: '12px',
          background: color,
          borderRadius: '2px',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: 'var(--color-text)',
          fontStyle: slug === OTHER_KEY ? 'italic' : 'normal',
        }}
      >
        {prettifyCategory(slug)}
      </span>
    </div>
  )
}

function Legend({
  categoryOrder,
  dimension,
}: {
  categoryOrder: string[]
  dimension: CategoryDimension
}) {
  const colorFor = (slug: string) => colorForCategory(slug, categoryOrder, dimension)

  // Non-scope dimensions: simple flat legend.
  if (dimension !== 'scope') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: '8px', fontSize: '12px' }}>
        {categoryOrder.map((slug) => (
          <Swatch key={slug} slug={slug} color={colorFor(slug)} />
        ))}
      </div>
    )
  }

  // Scope: group by domain, with each domain on its own row labelled at the
  // left so the user can read off "these are the life-sciences categories,
  // these are the earth-sciences categories" at a glance.
  const named = categoryOrder.filter((k) => k !== OTHER_KEY)
  const groups = DOMAIN_STACK_ORDER.map((d) => ({
    domain: d,
    label: DOMAIN_LABELS[d],
    slugs: named.filter((s) => scopeDomain(s) === d),
  })).filter((g) => g.slugs.length > 0)
  const hasOther = categoryOrder.includes(OTHER_KEY)

  return (
    <div style={{ marginTop: '8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {groups.map((g) => (
        <div key={g.domain} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
              minWidth: '110px',
            }}
          >
            {g.label}
          </span>
          {g.slugs.map((slug) => (
            <Swatch key={slug} slug={slug} color={colorFor(slug)} />
          ))}
        </div>
      ))}
      {hasOther && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
              minWidth: '110px',
            }}
          >
            Tail
          </span>
          <Swatch slug={OTHER_KEY} color={OTHER_COLOR} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corpus context: small line charts that frame the diversity story.
// ---------------------------------------------------------------------------

const MINI_W = 280
const MINI_H = 130
const MINI_MARGIN = { top: 10, right: 8, bottom: 22, left: 30 }
const CONTEXT_COLOR = '#3a6b7b'

/** A single decade's data point for a mini chart. */
interface MiniPoint {
  era_slug: string
  era_name: string
  value: number
  /** Used to dim points below the reliability cutoff. */
  reliable: boolean
}

/**
 * Compact line chart used for the corpus-context panel. One line, axis
 * labels at the corners only, hover titles on each dot.
 */
function MiniChart({
  title,
  subtitle,
  points,
  format,
  unit,
}: {
  title: string
  subtitle: string
  points: MiniPoint[]
  format: (v: number) => string
  unit?: string
}) {
  if (points.length === 0) return null
  const plotW = MINI_W - MINI_MARGIN.left - MINI_MARGIN.right
  const plotH = MINI_H - MINI_MARGIN.top - MINI_MARGIN.bottom

  const ys = points.map((p) => p.value)
  const rawMax = Math.max(...ys)
  const maxY = rawMax > 0 ? rawMax * 1.1 : 1
  const yToPx = (v: number) => MINI_MARGIN.top + plotH - (v / maxY) * plotH
  const xToPx = (i: number) =>
    MINI_MARGIN.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)

  const pts = points.map((p, i) => ({ x: xToPx(i), y: yToPx(p.value), p }))
  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const latestReliable = [...points].reverse().find((p) => p.reliable) ?? points[points.length - 1]

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{title}</div>
        <div
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: CONTEXT_COLOR,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
          title={`Latest reliable era: ${latestReliable.era_name}`}
        >
          {format(latestReliable.value)}
          {unit && (
            <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '3px' }}>
              {unit}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{subtitle}</div>
      <svg
        viewBox={`0 0 ${MINI_W} ${MINI_H}`}
        role="img"
        aria-label={`${title} per era`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {/* y axis tick at top + baseline at bottom */}
        <line
          x1={MINI_MARGIN.left}
          x2={MINI_W - MINI_MARGIN.right}
          y1={MINI_MARGIN.top + plotH}
          y2={MINI_MARGIN.top + plotH}
          stroke="var(--color-border)"
        />
        <text
          x={MINI_MARGIN.left - 4}
          y={MINI_MARGIN.top + 8}
          textAnchor="end"
          fontSize="9"
          fill="var(--color-text-muted)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {format(maxY)}
        </text>
        <text
          x={MINI_MARGIN.left - 4}
          y={MINI_MARGIN.top + plotH + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--color-text-muted)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          0
        </text>
        {/* x axis labels at extreme decades only — keeps the chart legible */}
        <text
          x={pts[0].x}
          y={MINI_H - 6}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-text-muted)"
        >
          {points[0].era_name}
        </text>
        <text
          x={pts[pts.length - 1].x}
          y={MINI_H - 6}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-text-muted)"
        >
          {points[points.length - 1].era_name}
        </text>
        <path d={linePath} fill="none" stroke={CONTEXT_COLOR} strokeWidth="1.8" />
        {pts.map((p) => (
          <g key={p.p.era_slug}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.p.reliable ? 3 : 2}
              fill={p.p.reliable ? CONTEXT_COLOR : 'var(--color-surface)'}
              stroke={CONTEXT_COLOR}
              strokeWidth="1.2"
              opacity={p.p.reliable ? 1 : 0.55}
            />
            <title>{`${p.p.era_name}: ${format(p.p.value)}${unit ?? ''}${p.p.reliable ? '' : ' (sparse)'}`}</title>
          </g>
        ))}
      </svg>
    </div>
  )
}

/**
 * Reliability gauge for the publication-context metrics — same idea as the
 * diversity charts but the cutoff is publication count rather than mention
 * count. Decades with very few publications produce noisy ratios.
 */
const RELIABLE_MIN_PUBS = 50

function buildContextPoints(
  rows: PublicationContextRow[],
  getter: (r: PublicationContextRow) => number,
): MiniPoint[] {
  return rows.map((r) => ({
    era_slug: r.era_slug,
    era_name: r.era_name,
    value: getter(r),
    reliable: r.n_pubs >= RELIABLE_MIN_PUBS,
  }))
}

function buildItemsPoints(
  eras: EraWithCounts[],
  sources: readonly SourceCollection[],
): MiniPoint[] {
  const decadeEras = eras.filter((e) => !isCenturyEra(e))
  return decadeEras.map((e) => {
    const total = sources.reduce(
      (sum, c) => sum + e.counts[c as 'publications' | 'documents' | 'datasets' | 'stories'],
      0,
    )
    // Reliability for "items per decade" is essentially "did we have any
    // content from this decade" — use total > 20 as a low bar.
    return {
      era_slug: e.slug,
      era_name: e.name,
      value: total,
      reliable: total >= 20,
    }
  })
}

const fmtInt = (v: number) => Math.round(v).toLocaleString()
const fmtFixed1 = (v: number) => v.toFixed(1)
const fmtPct = (v: number) => `${Math.round(v * 100)}%`

function CorpusContext({
  pubContext,
  eras,
  lens,
  sources,
}: {
  pubContext: PublicationContextRow[]
  eras: EraWithCounts[]
  lens: 'research' | 'all'
  sources: readonly SourceCollection[]
}) {
  // Decade order only — drop centuries from the publication-context rows.
  const decadeContext = pubContext.filter((r) => r.end_year - r.start_year < 50)

  return (
    <section style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--color-border)' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 6px' }}>Corpus context</h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 14px', maxWidth: '70ch', lineHeight: 1.55 }}>
        Six trends framing the diversity story above: how the corpus grew, how
        well-covered it is by full text, how the research community changed,
        and how internally connected the literature became. The{' '}
        <strong>items-per-era</strong> chart respects the{' '}
        {lens === 'research' ? 'research' : 'all-sources'} lens
        ({sources.join(' + ')}); the other five are inherently
        publication-bound (no &ldquo;documents version&rdquo; of average
        co-authors), so they show publications regardless of lens.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
        }}
      >
        <MiniChart
          title="Items per era"
          subtitle={`Total ${sources.join(' + ')} dated within each era.`}
          points={buildItemsPoints(eras, sources)}
          format={fmtInt}
        />
        <MiniChart
          title="Full-text coverage"
          subtitle="Share of publications with substantive full text — frames the diversity reliability."
          points={buildContextPoints(decadeContext, (r) => r.share_fulltext)}
          format={fmtPct}
        />
        <MiniChart
          title="References per paper"
          subtitle="Average extracted references per publication — connection to the broader literature."
          points={buildContextPoints(decadeContext, (r) => r.avg_refs)}
          format={fmtFixed1}
        />
        <MiniChart
          title="Unique researchers"
          subtitle="Distinct authors publishing in the era — community growth signal."
          points={buildContextPoints(decadeContext, (r) => r.unique_authors)}
          format={fmtInt}
        />
        <MiniChart
          title="Co-authors per paper"
          subtitle="Average authors per publication — collaboration signal."
          points={buildContextPoints(decadeContext, (r) => r.avg_authors)}
          format={fmtFixed1}
        />
        <MiniChart
          title="Internal citations"
          subtitle="Share of references that point to other RMBL publications/documents/datasets — the corpus citing itself."
          points={buildContextPoints(decadeContext, (r) => r.share_internal_refs)}
          format={fmtPct}
        />
      </div>
    </section>
  )
}


// ---------------------------------------------------------------------------
// Community composition — author cohorts per era
// ---------------------------------------------------------------------------

// Sequential cohort palette: oldest cohorts dark (foundational), newest
// cohort light (recent arrival). Reads as deep-roots-bottom, fresh-top.
// One color per era bucket (10 colors total, matching the reshape-eras.sql
// migration: pre-1950, 1950s–60s, 1970s–80s, then 5-year buckets through
// 2021–25).
const COHORT_PALETTE: Record<string, string> = {
  'pre-1950':  '#182740',
  '1950s-60s': '#213353',
  '1970s':     '#283e63',
  '1980s':     '#314975',
  '1991-95':   '#3d5c91',
  '1996-2000': '#4d72a4',
  '2001-05':   '#6086b6',
  '2006-10':   '#769ac4',
  '2011-15':   '#8db0d1',
  '2016-20':   '#a4c2dc',
  '2021-25':   '#bcd5e8',
}

function cohortColor(slug: string): string {
  return COHORT_PALETTE[slug] ?? 'var(--color-text-muted)'
}

function CohortHeadline({ breakdowns }: { breakdowns: EraCohortBreakdown[] }) {
  // Latest reliable era — same RELIABLE_MIN_MENTIONS doesn't apply here;
  // for cohort math we just want a non-empty era. Pick the last one.
  const last = breakdowns[breakdowns.length - 1]
  if (!last) return null
  const newShare = last.total_active > 0 ? last.new_in_era / last.total_active : 0
  const prevDecade = breakdowns[breakdowns.length - 2]
  const sustained = prevDecade
    ? last.cohorts
        .filter((c) => c.cohort_start_year < last.start_year)
        .reduce((s, c) => s + c.n, 0)
    : 0

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '24px', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: '34px', fontWeight: 600, lineHeight: 1, color: '#3b6ca6', fontVariantNumeric: 'tabular-nums' }}>
          {last.new_in_era.toLocaleString()}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          new researchers first published in the {last.era_name}
          {' '}({(newShare * 100).toFixed(0)}% of {last.total_active.toLocaleString()} active)
        </div>
      </div>
      {prevDecade && (
        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', maxWidth: '40ch' }}>
          {sustained.toLocaleString()} continued from earlier cohorts — the
          long tail of researchers whose first publications go back as far as{' '}
          {breakdowns[0].era_name} contribute to institutional memory.
        </div>
      )}
    </div>
  )
}

function CohortChart({ breakdowns }: { breakdowns: EraCohortBreakdown[] }) {
  if (breakdowns.length === 0) return null
  const plotW = CHART_W - MARGIN.left - MARGIN.right
  const plotH = STACK_CHART_H - MARGIN.top - MARGIN.bottom
  const gap = 6
  const barW = (plotW - gap * (breakdowns.length - 1)) / breakdowns.length

  const maxY = Math.max(1, ...breakdowns.map((b) => b.total_active))

  // Order: chronologically — oldest cohort at bottom, newest at top.
  // The cohort_start_year ordering already gives us this from the service.
  return (
    <svg
      role="img"
      aria-label={`Stacked bars of active research community per era by first-publication cohort`}
      viewBox={`0 0 ${CHART_W} ${STACK_CHART_H}`}
      style={{ width: '100%', height: 'auto', display: 'block', maxWidth: `${CHART_W}px` }}
    >
      {/* y axis ticks */}
      {[0, maxY / 2, maxY].map((v) => (
        <g key={v}>
          <line
            x1={MARGIN.left}
            x2={CHART_W - MARGIN.right}
            y1={MARGIN.top + plotH - (v / maxY) * plotH}
            y2={MARGIN.top + plotH - (v / maxY) * plotH}
            stroke="var(--color-border)"
            strokeDasharray="2 3"
          />
          <text
            x={MARGIN.left - 6}
            y={MARGIN.top + plotH - (v / maxY) * plotH + 4}
            textAnchor="end"
            fontSize="11"
            fill="var(--color-text-muted)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(v).toLocaleString()}
          </text>
        </g>
      ))}

      {breakdowns.map((b, i) => {
        const x = MARGIN.left + i * (barW + gap)
        const sortedCohorts = [...b.cohorts].sort((a, b) => a.cohort_start_year - b.cohort_start_year)
        let cumPx = 0
        return (
          <g key={b.era_slug}>
            {sortedCohorts.map((c) => {
              const h = (c.n / maxY) * plotH
              const y = MARGIN.top + plotH - cumPx - h
              cumPx += h
              return (
                <g key={c.cohort_slug}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill={cohortColor(c.cohort_slug)}
                  />
                  <title>{`${b.era_name} · ${c.cohort_name} cohort: ${c.n.toLocaleString()} (${(c.share * 100).toFixed(1)}%)`}</title>
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
              opacity={0.7}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {b.total_active >= 1000 ? `${(b.total_active / 1000).toFixed(1)}k` : b.total_active}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function CohortLegend({ breakdowns }: { breakdowns: EraCohortBreakdown[] }) {
  // Gather all cohorts that appear across all eras, in chronological order.
  const seen = new Set<string>()
  const all: { slug: string; name: string; start: number }[] = []
  for (const b of breakdowns) {
    for (const c of b.cohorts) {
      if (!seen.has(c.cohort_slug)) {
        seen.add(c.cohort_slug)
        all.push({ slug: c.cohort_slug, name: c.cohort_name, start: c.cohort_start_year })
      }
    }
  }
  all.sort((a, b) => a.start - b.start)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: '8px', fontSize: '12px' }}>
      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        First-publication cohort:
      </span>
      {all.map((c) => (
        <div key={c.slug} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              background: cohortColor(c.slug),
              borderRadius: '2px',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--color-text)' }}>{c.name}</span>
        </div>
      ))}
    </div>
  )
}

function CommunityCompositionPanel({ breakdowns }: { breakdowns: EraCohortBreakdown[] }) {
  // Drop centuries — chart is decade-only.
  const decades = breakdowns.filter((b) => b.end_year - b.start_year < 50)
  return (
    <section style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px' }}>
        Community composition by cohort
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px', maxWidth: '60ch' }}>
        Pure measurement, no inference. Each bar is the research community
        active in that era, segmented by the era of each author&rsquo;s first
        publication in the corpus. Reads as the community&rsquo;s
        generational layers: deep cohorts at the bottom carry institutional
        memory; the lighter top layer is the era&rsquo;s new arrivals.
      </p>
      <CohortHeadline breakdowns={decades} />

      <h3 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', margin: '24px 0 8px' }}>
        Generational layers
      </h3>
      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
        Total active researchers per era. Numbers under each bar are the
        active community size. Author identity is keyed on
        (family + given) name pairs — small inflation possible from
        spelling variations; the trend is robust.
      </p>
      <CohortChart breakdowns={decades} />
      <CohortLegend breakdowns={decades} />
    </section>
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
  dimension,
}: {
  title: string
  subtitle: string
  metricLabel: string
  breakdowns: EraCategoryBreakdown[]
  dimension: CategoryDimension
}) {
  const categoryOrder = topCategoriesWithOther(breakdowns, dimension)
  const collapsed = collapseBreakdowns(breakdowns, categoryOrder)
  const reliableMin = reliableMinFor(dimension)
  return (
    <section style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px', maxWidth: '60ch' }}>
        {subtitle}
      </p>
      <HeadlineSummary breakdowns={breakdowns} reliableMin={reliableMin} />

      <div style={{ marginTop: '20px' }}>
        <EffectiveNChart breakdowns={breakdowns} reliableMin={reliableMin} />
      </div>

      <h3 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', margin: '24px 0 8px' }}>
        Composition
      </h3>
      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
        Share of mentions in each {metricLabel.toLowerCase()} per era. Numbers under each bar are total mentions for that era.
        {dimension === 'scope' && ' Categories are grouped by domain: earth sciences (cool palette) at the bottom of each bar, life sciences (warm palette) above, cross-cutting categories on top.'}
      </p>
      <CompositionChart breakdowns={collapsed} categoryOrder={categoryOrder} dimension={dimension} reliableMin={reliableMin} />
      <Legend categoryOrder={categoryOrder} dimension={dimension} />
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
  const [scopes, protocolCats, cohorts, pubContext, eraCounts] = await Promise.all([
    getDiversityAcrossEras(db, 'scope', sources),
    getDiversityAcrossEras(db, 'protocol_category', sources),
    getAuthorCohortsByEra(db),
    getPublicationContextByEra(db),
    listErasWithCounts(db),
  ])

  return (
    <div style={{ maxWidth: `${PAGE_MAX_W}px`, margin: '0 auto', padding: '0 16px' }}>
      <div className="search-results-header">
        <Link href="/eras" style={{ fontSize: '13px', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          ← All eras
        </Link>
        <h1 style={{ fontSize: '26px', fontWeight: 600, margin: '8px 0 4px' }}>
          How has RMBL research changed over time?
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', margin: 0, maxWidth: '70ch' }}>
          Several views of the basin&rsquo;s research across eras. The{' '}
          <strong>Corpus context</strong> section traces scale — how the
          published record grew, how well-covered it is by full text, how the
          community expanded. The <strong>Disciplines</strong> and{' '}
          <strong>Methodological approaches</strong> panels measure how the
          breadth and evenness of research shifted. The{' '}
          <strong>Community composition</strong> chart maps the generational
          layers of authors active in each era. Together they sketch how the
          basin&rsquo;s research has changed over the past 75+ years.
        </p>
        <LensToggle active={lens} />
      </div>

      <CorpusContext
        pubContext={pubContext}
        eras={eraCounts}
        lens={lens}
        sources={sources}
      />

      <section
        style={{
          marginTop: '32px',
          padding: '12px 16px',
          background: 'var(--color-surface)',
          borderLeft: `3px solid ${SHANNON_COLOR}`,
          borderRadius: 'var(--radius-sm)',
          fontSize: '13px',
          lineHeight: 1.6,
          color: 'var(--color-text)',
        }}
      >
        The next two panels both report{' '}
        <strong>two complementary diversity measures</strong>, in{' '}
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
        dimension="scope"
      />

      <DiversityPanel
        title="Methodological approaches"
        subtitle="Protocol categories — sampling, measurement, experimental, computational, observational, analytical, laboratory — capturing how the research was conducted."
        metricLabel="Approaches"
        breakdowns={protocolCats}
        dimension="protocol_category"
      />

      <CommunityCompositionPanel breakdowns={cohorts} />

      <section style={{ marginTop: '32px', padding: '14px 16px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--color-text)' }}>Caveat:</strong>{' '}
        Eras before the 1990s have thin extraction coverage (the full-text PDF
        coverage gap discussed in the broader plan), so their effective-N
        estimates are based on very few mentions and should be read as suggestive
        rather than definitive. Sparse eras are dimmed in the charts; hover any
        point or bar segment for the underlying mention count. The reliable
        signal is the 1990s onward.
      </section>
    </div>
  )
}
