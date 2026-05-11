'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

type Flag = {
  id: number
  reason: string
  description?: string | null
  status: string
  createdAt: string
}

const REASON_LABEL: Record<string, string> = {
  incorrect_data: 'Incorrect data',
  duplicate: 'Duplicate',
  missing_info: 'Missing info',
  outdated: 'Outdated',
  inappropriate: 'Inappropriate',
  broken_link: 'Broken link',
  other: 'Other',
}

const STATUS_COLOR: Record<string, string> = {
  open: '#c2410c',
  in_review: '#1d4ed8',
  resolved: '#15803d',
  rejected: '#6b7280',
}

export const FlagsForItem: React.FC = () => {
  const { id, collectionSlug } = useDocumentInfo()
  const [flags, setFlags] = useState<Flag[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !collectionSlug) return
    let cancelled = false
    const url = `/api/content-flags?where[collection][equals]=${encodeURIComponent(
      collectionSlug,
    )}&where[itemId][equals]=${encodeURIComponent(String(id))}&sort=-createdAt&limit=20`
    fetch(url, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setFlags(data.docs || [])
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [id, collectionSlug])

  if (!id) return null

  const openCount = flags?.filter((f) => f.status === 'open' || f.status === 'in_review').length ?? 0

  return (
    <div style={{ marginTop: '1.5rem', padding: '0.75rem', border: '1px solid var(--theme-elevation-100)', borderRadius: '4px', background: 'var(--theme-elevation-50)' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem', color: 'var(--theme-elevation-600)' }}>
        Curation flags {flags && `(${flags.length}${openCount > 0 ? `, ${openCount} open` : ''})`}
      </div>
      {error && <div style={{ fontSize: '12px', color: '#b91c1c' }}>Error loading flags: {error}</div>}
      {!error && flags === null && <div style={{ fontSize: '12px', color: 'var(--theme-elevation-500)' }}>Loading…</div>}
      {!error && flags && flags.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--theme-elevation-500)' }}>No flags submitted.</div>
      )}
      {!error && flags && flags.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {flags.map((f) => (
            <li key={f.id} style={{ fontSize: '12px', lineHeight: 1.4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                <span style={{ background: STATUS_COLOR[f.status] || '#6b7280', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  {f.status.replace('_', ' ')}
                </span>
                <span style={{ fontWeight: 500 }}>{REASON_LABEL[f.reason] || f.reason}</span>
                <span style={{ color: 'var(--theme-elevation-500)', marginLeft: 'auto' }}>
                  {new Date(f.createdAt).toLocaleDateString()}
                </span>
              </div>
              {f.description && (
                <div style={{ color: 'var(--theme-elevation-700)', marginBottom: '2px' }}>
                  {f.description.length > 120 ? f.description.slice(0, 120) + '…' : f.description}
                </div>
              )}
              <a href={`/admin/collections/content-flags/${f.id}`} style={{ fontSize: '11px', color: 'var(--theme-elevation-600)' }}>
                View flag #{f.id} →
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default FlagsForItem
