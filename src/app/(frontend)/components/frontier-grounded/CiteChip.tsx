/**
 * Pub-#N citation chip with a CSS-driven hover popover that reveals the
 * verbatim snippet pulled from the cited paper.
 *
 * Pure server component — the popover is CSS-only (`:hover` + `:focus-within`)
 * so we get the affordance without shipping JS or React state. Mobile users
 * who can't hover still see the chip and can tap through to /publications/[id]
 * for the full record.
 *
 * Styling lives in styles.css under `.cite-chip*`.
 */

import Link from 'next/link'

export interface CiteData {
  pub_id: number
  snippet: string
  role?: string
}

interface PaperMeta {
  title: string | null
  year: number | null
}

export function CiteChip({
  pubId, snippet, meta,
}: {
  pubId: number
  snippet: string
  meta?: PaperMeta
}) {
  const labelYear = meta?.year ? ` (${meta.year})` : ''
  const ariaLabel = meta?.title
    ? `Source: pub #${pubId}${labelYear} — ${meta.title}`
    : `Source: pub #${pubId}`

  return (
    <span className="cite-chip-wrap">
      <Link
        href={`/publications/${pubId}`}
        className="cite-chip"
        aria-label={ariaLabel}
      >
        pub #{pubId}{labelYear}
      </Link>
      <span className="cite-chip-popover" role="tooltip" aria-hidden="true">
        {meta?.title && <strong className="cite-chip-popover-title">{meta.title}</strong>}
        <span className="cite-chip-popover-snippet">&ldquo;{snippet}&rdquo;</span>
      </span>
    </span>
  )
}
