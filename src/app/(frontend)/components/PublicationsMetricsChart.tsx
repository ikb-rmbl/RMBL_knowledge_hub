'use client'

/**
 * Multi-line publications-per-year chart for /metrics.
 *
 * Follows the dataviz spec: one axis, 2px lines, recessive hairline grid,
 * crosshair snapped to the nearest year with a single tooltip listing every
 * series (value leads, series name follows, line-key strokes), legend + direct
 * labels at line ends, text in text tokens (series color never carries text).
 * Series colors are validated for both site surfaces:
 *   #0f7d9e (RMBL research) · #F05028 (student authors) · #9a4ec4 (reserved: REU)
 */

import { useMemo, useRef, useState } from 'react'

export interface MetricsSeries {
  key: string
  label: string
  color: string
  /** year → count; years with no value are treated as 0 */
  values: Record<number, number>
}

interface Props {
  series: MetricsSeries[]
  yearMin: number
  yearMax: number
}

const W = 860
const H = 360
const PAD = { top: 16, right: 150, bottom: 32, left: 44 }

export default function PublicationsMetricsChart({ series, yearMin, yearMax }: Props) {
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const years = useMemo(() => {
    const ys: number[] = []
    for (let y = yearMin; y <= yearMax; y++) ys.push(y)
    return ys
  }, [yearMin, yearMax])

  const maxVal = useMemo(
    () => Math.max(1, ...series.flatMap((s) => years.map((y) => s.values[y] ?? 0))),
    [series, years],
  )

  const x = (year: number) =>
    PAD.left + ((year - yearMin) / Math.max(1, yearMax - yearMin)) * (W - PAD.left - PAD.right)
  const y = (v: number) => H - PAD.bottom - (v / maxVal) * (H - PAD.top - PAD.bottom)

  const yTicks = useMemo(() => {
    const step = maxVal <= 10 ? 2 : maxVal <= 50 ? 10 : maxVal <= 120 ? 25 : 50
    const ticks: number[] = []
    for (let v = 0; v <= maxVal; v += step) ticks.push(v)
    return ticks
  }, [maxVal])

  const xTicks = useMemo(() => {
    const span = yearMax - yearMin
    const step = span > 60 ? 20 : span > 25 ? 10 : 5
    const ticks: number[] = []
    for (let v = Math.ceil(yearMin / step) * step; v <= yearMax; v += step) ticks.push(v)
    return ticks
  }, [yearMin, yearMax])

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right)
    const year = Math.round(yearMin + frac * (yearMax - yearMin))
    setHoverYear(year >= yearMin && year <= yearMax ? year : null)
  }

  const pathFor = (s: MetricsSeries) =>
    years.map((yr, i) => `${i === 0 ? 'M' : 'L'}${x(yr).toFixed(1)},${y(s.values[yr] ?? 0).toFixed(1)}`).join('')

  const tooltipX = hoverYear !== null ? x(hoverYear) : 0
  const tooltipRight = hoverYear !== null && tooltipX > W - PAD.right - 180

  return (
    <div style={{ position: 'relative', maxWidth: `${W}px` }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Publications per year by category"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverYear(null)}
      >
        {/* recessive grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} opacity={0.6} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-text-muted)">{v}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={H - PAD.bottom + 20} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)">{v}</text>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--color-text-muted)" strokeWidth={1} />

        {/* series lines + direct labels at line ends (nudged apart if lines
            converge — final-year values are often close together) */}
        {(() => {
          const MIN_GAP = 15
          const labelYs = series
            .map((s, i) => ({ i, y: y(s.values[yearMax] ?? 0) + 4 }))
            .sort((a, b) => a.y - b.y)
          for (let k = 1; k < labelYs.length; k++) {
            if (labelYs[k].y - labelYs[k - 1].y < MIN_GAP) labelYs[k].y = labelYs[k - 1].y + MIN_GAP
          }
          const yById = new Map(labelYs.map((l) => [l.i, l.y]))
          return series.map((s, i) => (
            <g key={s.key}>
              <path d={pathFor(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              <text x={W - PAD.right + 8} y={yById.get(i)} fontSize={12} fill="var(--fg-2)">
                {s.label}
              </text>
            </g>
          ))
        })()}

        {/* crosshair + hover markers */}
        {hoverYear !== null && (
          <g>
            <line x1={tooltipX} x2={tooltipX} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-text-muted)" strokeWidth={1} opacity={0.7} />
            {series.map((s) => (
              <circle key={s.key} cx={tooltipX} cy={y(s.values[hoverYear] ?? 0)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>

      {/* single tooltip: every series at the hovered year; values lead */}
      {hoverYear !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${((tooltipRight ? tooltipX - 12 : tooltipX + 12) / W) * 100}%`,
            top: '12%',
            transform: tooltipRight ? 'translateX(-100%)' : undefined,
            background: 'var(--color-surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '8px 10px',
            fontSize: '12px',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            minWidth: '150px',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--fg-1)' }}>{hoverYear}</div>
          {series.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span aria-hidden style={{ width: '14px', height: '2px', background: s.color, display: 'inline-block' }} />
              <strong style={{ color: 'var(--fg-1)' }}>{s.values[hoverYear] ?? 0}</strong>
              <span style={{ color: 'var(--color-text-muted)' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* legend (mirrors the mark: line keys) */}
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '8px', fontSize: '13px', color: 'var(--fg-2)' }}>
        {series.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span aria-hidden style={{ width: '18px', height: '2px', background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
