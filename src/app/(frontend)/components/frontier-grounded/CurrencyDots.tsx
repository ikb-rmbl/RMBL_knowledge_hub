/**
 * Inline currency rollup viz for the frontier index card — a thin
 * stacked bar showing what proportion of the frontier's questions +
 * data gaps are open / partially addressed / addressed.
 *
 * Spec §5.2 calls for "Currency: 70% open / 20% partially / 10%
 * addressed" — we render both the bar (scannable across a long list)
 * and a compact text counterpart (accessible + precise).
 *
 * Server component. Colors come from the design tokens used in the
 * detail-page currency badge so the same state reads the same way
 * across views.
 */

export interface CurrencyRollup {
  open?: number
  partially_addressed?: number
  addressed?: number
}

const COLORS = {
  open: 'rgba(110, 110, 72, 0.55)',                   // fg-muted, passive
  partially_addressed: 'rgba(107, 122, 74, 0.75)',    // moss
  addressed: 'rgba(138, 169, 184, 0.85)',             // sky
} as const

export function CurrencyDots({
  summary,
  width = 92,
  height = 6,
}: {
  summary: CurrencyRollup | null | undefined
  width?: number
  height?: number
}) {
  const open  = summary?.open ?? 0
  const part  = summary?.partially_addressed ?? 0
  const addr  = summary?.addressed ?? 0
  const total = open + part + addr
  if (total === 0) return null

  const pct = (n: number) => Math.round((n / total) * 100)
  const segments = [
    { label: 'open',                count: open, color: COLORS.open },
    { label: 'partially_addressed', count: part, color: COLORS.partially_addressed },
    { label: 'addressed',           count: addr, color: COLORS.addressed },
  ].filter(s => s.count > 0)

  const tooltip = segments
    .map(s => `${pct(s.count)}% ${s.label.replace('_', ' ')}`)
    .join(' · ')

  return (
    <span
      role="img"
      aria-label={`Currency rollup: ${tooltip}`}
      title={`Currency: ${tooltip}`}
      style={{
        display: 'inline-flex',
        width,
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
        verticalAlign: 'middle',
        background: 'var(--bg-inset)',
        border: '1px solid var(--border)',
      }}
    >
      {segments.map(s => (
        <span
          key={s.label}
          style={{
            flexGrow: s.count,
            background: s.color,
          }}
        />
      ))}
    </span>
  )
}
