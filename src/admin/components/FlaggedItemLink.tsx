'use client'

import { useField } from '@payloadcms/ui'
import type React from 'react'

/**
 * Sidebar panel on the Flag edit page that links straight to the flagged
 * record's edit page, so a curator can jump from a flag to the item that
 * needs fixing. Renders on the `content-flags` collection only.
 *
 * Two cases:
 *   - Payload-managed collections: link straight to the admin edit page.
 *   - SQL-only tables (neighborhoods, frontiers, eras): no admin edit page
 *     exists, so link to the public detail page instead. Reading the
 *     flagged record in context is the next best thing a curator can do
 *     until a dedicated admin path for these tables lands.
 */
const EDITABLE_COLLECTIONS: Record<string, string> = {
  publications: 'Publication',
  documents: 'Document',
  datasets: 'Dataset',
  stories: 'Story',
  authors: 'Author',
  species: 'Species',
  concepts: 'Concept',
  protocols: 'Protocol',
  places: 'Place',
}

/** Public detail-page slug for SQL-only collections (no admin edit page). */
const PUBLIC_DETAIL_COLLECTIONS: Record<string, string> = {
  neighborhoods: 'Neighborhood',
  frontiers: 'Frontier',
  eras: 'Era',
}

const PUBLIC_DETAIL_PATH: Record<string, string> = {
  neighborhoods: '/neighborhoods',
  frontiers: '/frontiers',
  // Eras use a slug for their public URL; the flag only carries the
  // numeric id, so this path won't resolve directly. Surface the id
  // and let the curator look up the era by name from the flag itself.
  eras: '/eras',
}

const noteStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--theme-elevation-500)' }

export const FlaggedItemLink: React.FC = () => {
  const { value: collection } = useField<string>({ path: 'collection' })
  const { value: itemId } = useField<number>({ path: 'itemId' })
  const { value: itemTitle } = useField<string>({ path: 'itemTitle' })

  const editLabel = collection ? EDITABLE_COLLECTIONS[collection] : undefined
  const publicLabel = collection ? PUBLIC_DETAIL_COLLECTIONS[collection] : undefined
  const hasItem = Boolean(collection) && itemId !== null && itemId !== undefined

  return (
    <div
      style={{
        marginTop: '1.5rem',
        padding: '0.75rem',
        border: '1px solid var(--theme-elevation-100)',
        borderRadius: '4px',
        background: 'var(--theme-elevation-50)',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '0.5rem',
          color: 'var(--theme-elevation-600)',
        }}
      >
        Flagged item
      </div>

      {!hasItem ? (
        <div style={noteStyle}>No linked item recorded on this flag.</div>
      ) : !editLabel && !publicLabel ? (
        <div style={noteStyle}>
          {collection} #{itemId} is managed outside Payload and has no detail page.
        </div>
      ) : (
        <>
          {itemTitle && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--theme-elevation-700)',
                marginBottom: '0.5rem',
                lineHeight: 1.4,
              }}
            >
              {itemTitle}
            </div>
          )}
          <a
            href={
              editLabel
                ? `/admin/collections/${collection}/${itemId}`
                : `${PUBLIC_DETAIL_PATH[collection!]}/${itemId}`
            }
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              fontSize: '12px',
              fontWeight: 500,
              padding: '6px 12px',
              borderRadius: '4px',
              background: 'var(--theme-elevation-150)',
              color: 'var(--theme-text)',
              textDecoration: 'none',
              border: '1px solid var(--theme-elevation-200)',
            }}
          >
            {editLabel
              ? `Open ${editLabel} #${itemId} to edit →`
              : `View ${publicLabel} #${itemId} on the public site →`}
          </a>
          <div style={{ ...noteStyle, marginTop: '0.5rem' }}>
            {editLabel
              ? 'Opens in a new tab so you can return here to resolve the flag.'
              : `${publicLabel}s are managed outside Payload — the public detail page is the best place to read the flagged content in context.`}
          </div>
        </>
      )}
    </div>
  )
}

export default FlaggedItemLink
