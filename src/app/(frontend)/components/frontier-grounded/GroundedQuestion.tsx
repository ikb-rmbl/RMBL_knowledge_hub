/**
 * Render a grounded key_question or data_gap: text + inline cite chips +
 * currency badge. Used on the frontier detail page when the frontier has
 * been produced by the grounded pipeline (extraction_run_id IS NOT NULL).
 *
 * Legacy frontiers (extraction_run_id IS NULL) still hold plain strings in
 * the same jsonb columns; the page falls through to a plain <li> render
 * for those. See specification/grounded-frontiers-design.md §5.
 */

import { CiteChip, type CiteData } from './CiteChip'
import { CurrencyBadge, type AddressedBy, type Currency } from './CurrencyBadge'

export interface GroundedItem {
  text: string
  cites?: CiteData[]
  year_range?: [number, number] | null
  currency?: Currency | null
  addressed_by?: AddressedBy[] | null
  last_checked_at?: string | null
}

export function isGroundedItem(v: unknown): v is GroundedItem {
  return !!v && typeof v === 'object' && typeof (v as any).text === 'string'
}

interface PaperMeta { title: string | null; year: number | null }

export function GroundedQuestion({
  item, citeMeta, fontSize = '14px', lineHeight = 1.6,
}: {
  item: GroundedItem
  citeMeta: Map<number, PaperMeta>
  fontSize?: string
  lineHeight?: number
}) {
  const cites = item.cites ?? []
  const hasCurrencyAffordance =
    item.currency != null ||
    item.last_checked_at != null ||
    (item.addressed_by && item.addressed_by.length > 0)

  return (
    <li style={{ marginBottom: '14px', listStyle: 'none', marginLeft: '-20px' }}>
      <div style={{
        fontSize, lineHeight,
        color: 'var(--color-text-primary)',
        maxWidth: '74ch',
      }}>
        {item.text}
        {cites.length > 0 && (
          <span style={{ display: 'inline', marginLeft: '6px' }}>
            {cites.map((c, i) => (
              <span key={`${c.pub_id}-${i}`} style={{ marginRight: '3px' }}>
                <CiteChip pubId={c.pub_id} snippet={c.snippet} meta={citeMeta.get(c.pub_id)} />
              </span>
            ))}
          </span>
        )}
      </div>
      {hasCurrencyAffordance && (
        <CurrencyBadge
          currency={item.currency}
          lastCheckedAt={item.last_checked_at}
          addressedBy={item.addressed_by ?? undefined}
          citeMeta={citeMeta}
        />
      )}
    </li>
  )
}
