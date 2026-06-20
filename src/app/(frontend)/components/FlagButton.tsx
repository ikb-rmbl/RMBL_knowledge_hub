'use client'

import { useState } from 'react'

const REASONS = [
  { value: 'incorrect_data', label: 'Incorrect data' },
  { value: 'attribution_issue', label: 'Attribution issue (wrong author / mis-credited work)' },
  { value: 'ai_quality_issue', label: 'AI-quality issue (incorrect or low-quality AI-generated content)' },
  { value: 'duplicate', label: 'Duplicate record' },
  { value: 'missing_info', label: 'Missing information' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'broken_link', label: 'Broken link' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Other' },
]

interface FlagButtonProps {
  collection: string
  itemId: number
  /** Pre-select a reason and auto-open the form. Used by inline links
   *  e.g. the AI-quality link in LlmProvenanceSidebar. */
  prefilledReason?: string
  /** Override the default trigger label ("Report an issue with this item")
   *  for context-specific entry points. */
  triggerLabel?: string
}

export default function FlagButton({ collection, itemId, prefilledReason, triggerLabel }: FlagButtonProps) {
  // Always start collapsed. `prefilledReason` pre-selects the dropdown
  // value when the user opens the form, but it no longer auto-opens —
  // auto-opening turned the AI-quality affordance in
  // `LlmProvenanceSidebar` into a permanent expanded form on every
  // detail page that has provenance.
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState(prefilledReason || '')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const form = e.currentTarget
    const data = new FormData(form)

    try {
      const res = await fetch('/api/v1/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection,
          itemId,
          reason: data.get('reason'),
          description: data.get('description') || undefined,
          suggestion: data.get('suggestion') || undefined,
          email: data.get('email') || undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Failed to submit. Please try again.')
        return
      }

      setSubmitted(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <p style={{ fontSize: '13px', color: 'var(--accent)', marginTop: '16px' }}>
        Thank you for your feedback. An administrator will review your report.
      </p>
    )
  }

  return (
    <div style={{ marginTop: '4px', marginBottom: '8px' }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '12px', color: 'var(--fg-3)', textDecoration: 'underline',
            padding: 0,
          }}
        >
          {triggerLabel || 'Report an issue with this item'}
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: '500px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 12px', color: 'var(--fg-1)' }}>
            Report an issue
          </h4>

          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--fg-2)' }}>
            What&apos;s the issue? *
          </label>
          <select
            name="reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: '100%', padding: '6px 8px', fontSize: '13px', marginBottom: '12px',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
              background: 'var(--bg)', color: 'var(--fg-1)',
            }}
          >
            <option value="">Select a reason...</option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--fg-2)' }}>
            Description
          </label>
          <textarea
            name="description"
            placeholder="What's wrong with this record?"
            rows={3}
            maxLength={2000}
            style={{
              width: '100%', padding: '6px 8px', fontSize: '13px', marginBottom: '12px',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
              background: 'var(--bg)', color: 'var(--fg-1)', resize: 'vertical',
            }}
          />

          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--fg-2)' }}>
            Suggested correction
          </label>
          <textarea
            name="suggestion"
            placeholder="If you know the correct information, enter it here"
            rows={2}
            maxLength={2000}
            style={{
              width: '100%', padding: '6px 8px', fontSize: '13px', marginBottom: '12px',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
              background: 'var(--bg)', color: 'var(--fg-1)', resize: 'vertical',
            }}
          />

          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--fg-2)' }}>
            Your email <span style={{ fontWeight: 400, color: 'var(--fg-3)' }}>(optional, for follow-up)</span>
          </label>
          <input
            name="email"
            type="email"
            placeholder="you@example.com"
            style={{
              width: '100%', padding: '6px 8px', fontSize: '13px', marginBottom: '16px',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
              background: 'var(--bg)', color: 'var(--fg-1)',
            }}
          />

          {error && (
            <p style={{ fontSize: '13px', color: '#c62828', marginBottom: '12px' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              disabled={submitting || !reason}
              style={{
                padding: '6px 16px', fontSize: '13px', fontWeight: 500,
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                opacity: submitting || !reason ? 0.6 : 1,
              }}
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '6px 16px', fontSize: '13px',
                background: 'none', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                color: 'var(--fg-2)',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
