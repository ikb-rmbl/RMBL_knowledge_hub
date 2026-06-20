/**
 * Currency badge for a grounded frontier item (key_question or data_gap).
 *
 * Three states: open / partially_addressed / addressed. Each carries a
 * colored dot, a short label, the last-checked date if known, and (when
 * not open) chips linking to the addressing paper(s) with the LLM's
 * rationale on hover via the native title tooltip.
 *
 * Pure server component — colored dots + chips are static markup, the
 * tooltip is browser-native. Validator output is described in
 * specification/grounded-frontiers-design.md §4.4 + §5.
 */

import Link from 'next/link'

export type Currency = 'open' | 'partially_addressed' | 'addressed'

export interface AddressedBy {
  pub_id: number
  mode: string
  rationale?: string
}

interface PaperMeta { title: string | null; year: number | null }

const STATES: Record<Currency, { icon: string; label: string; bg: string; fg: string }> = {
  open: {
    icon: '◯',
    label: 'Open',
    // Soft cream-on-fg muted — feels passive, "not yet addressed".
    bg: 'rgba(110, 110, 72, 0.10)',
    fg: 'var(--fg-2)',
  },
  partially_addressed: {
    icon: '◐',
    label: 'Partially addressed',
    // Moss — progress but not closed.
    bg: 'rgba(107, 122, 74, 0.18)',
    fg: '#4d5a36',
  },
  addressed: {
    icon: '●',
    label: 'Likely addressed',
    // Sky — closed.
    bg: 'rgba(138, 169, 184, 0.22)',
    fg: '#33606f',
  },
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return null
  }
}

export function CurrencyBadge({
  currency, lastCheckedAt, addressedBy, citeMeta,
}: {
  currency?: Currency | null
  lastCheckedAt?: string | null
  addressedBy?: AddressedBy[] | null
  citeMeta: Map<number, PaperMeta>
}) {
  const c: Currency = currency ?? 'open'
  const s = STATES[c]
  const lastDate = formatDate(lastCheckedAt)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '1px 8px', borderRadius: '10px',
        background: s.bg, color: s.fg,
        fontSize: '11px', fontWeight: 500, letterSpacing: '0.02em',
      }}>
        <span aria-hidden="true" style={{ fontSize: '11px', lineHeight: 1 }}>{s.icon}</span>
        {s.label}
      </span>
      {lastDate && (
        <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>
          last checked {lastDate}
        </span>
      )}
      {addressedBy && addressedBy.length > 0 && (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '2px' }}>
            by
          </span>
          {addressedBy.map((a) => {
            const m = citeMeta.get(a.pub_id)
            const chipBg = a.mode === 'addressed'
              ? 'rgba(138, 169, 184, 0.25)'
              : 'rgba(107, 122, 74, 0.20)'
            const titleAttr = [
              m?.title ? `${m.title}${m.year ? ` (${m.year})` : ''}` : `pub #${a.pub_id}`,
              a.rationale ? `\n\n${a.rationale}` : '',
            ].filter(Boolean).join('')
            return (
              <Link
                key={a.pub_id}
                href={`/publications/${a.pub_id}`}
                title={titleAttr}
                style={{
                  display: 'inline-block', padding: '0 6px', borderRadius: '3px',
                  background: chipBg, color: 'var(--color-text-secondary)',
                  fontSize: '11px', textDecoration: 'none',
                }}>
                pub #{a.pub_id}{m?.year ? ` (${m.year})` : ''}
              </Link>
            )
          })}
        </span>
      )}
    </div>
  )
}
