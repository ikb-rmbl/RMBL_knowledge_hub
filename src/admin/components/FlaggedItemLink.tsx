'use client'

import { useField } from '@payloadcms/ui'
import type React from 'react'

/**
 * Sidebar panel on the Flag edit page that links straight to the flagged
 * record's edit page, so a curator can jump from a flag to the item that
 * needs fixing. Renders on the `content-flags` collection only.
 *
 * The flag's `collection` value maps 1:1 to the target collection's Payload
 * admin slug for every flaggable collection that lives in Payload. The one
 * exception is `neighborhoods`, which is a SQL-only table with no admin edit
 * page — that case shows an explanatory note instead of a dead link.
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

const noteStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--theme-elevation-500)' }

export const FlaggedItemLink: React.FC = () => {
  const { value: collection } = useField<string>({ path: 'collection' })
  const { value: itemId } = useField<number>({ path: 'itemId' })
  const { value: itemTitle } = useField<string>({ path: 'itemTitle' })

  const label = collection ? EDITABLE_COLLECTIONS[collection] : undefined
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
      ) : !label ? (
        <div style={noteStyle}>
          {collection} #{itemId} is managed outside Payload and has no edit page.
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
            href={`/admin/collections/${collection}/${itemId}`}
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
            Open {label} #{itemId} to edit →
          </a>
          <div style={{ ...noteStyle, marginTop: '0.5rem' }}>
            Opens in a new tab so you can return here to resolve the flag.
          </div>
        </>
      )}
    </div>
  )
}

export default FlaggedItemLink
