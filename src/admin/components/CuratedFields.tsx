'use client'

import { useField } from '@payloadcms/ui'
import type React from 'react'

/**
 * Sidebar panel showing which fields on the current document are flagged as
 * admin-curated. Each entry has a × that "releases" the field — removing it
 * from the array so pipeline writes are allowed to update that cell again.
 * The actual save still happens when the admin clicks Save; this widget only
 * mutates form state.
 */
export const CuratedFields: React.FC = () => {
  const { value, setValue } = useField<string[]>({ path: 'curatedFields' })
  const list = Array.isArray(value) ? value : []

  const release = (field: string) => {
    setValue(list.filter((f) => f !== field))
  }

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
        Curated fields {list.length > 0 && `(${list.length})`}
      </div>

      {list.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--theme-elevation-500)' }}>
          None yet. Any field you edit will be tracked here automatically so
          the next pipeline run won&apos;t overwrite it.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', marginBottom: '0.5rem' }}>
            Pipeline writes skip these cells. Click × to release a field back
            to the pipeline.
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {list.map((field) => (
              <li
                key={field}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  padding: '2px 6px',
                  background: 'var(--theme-elevation-100)',
                  borderRadius: '3px',
                }}
              >
                <span style={{ flex: 1 }}>{field}</span>
                <button
                  type="button"
                  onClick={() => release(field)}
                  title={`Release ${field} back to the pipeline`}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--theme-elevation-600)',
                    fontSize: '14px',
                    lineHeight: 1,
                    padding: '0 4px',
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', marginTop: '0.5rem' }}>
            Changes save when you click Save.
          </div>
        </>
      )}
    </div>
  )
}

export default CuratedFields
