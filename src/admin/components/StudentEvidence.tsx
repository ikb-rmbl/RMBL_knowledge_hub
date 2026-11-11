'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

type Tag = { name: string; reu: boolean; program: string; counted: boolean; reason: string; studentPaperId: number | null }
type Evidence = {
  undergradAuthor: string | null
  undergradCurated: boolean
  legacyFlag: boolean
  tags: Tag[]
  studentPaper: {
    students: { name: string; reu: boolean | null }[]
    mentors: string[]
    source: string | null
    notes: string[]
    matchedTo: { id: number; year: number; title: string; author_name: string; student_program: string }[]
  } | null
}

const box: React.CSSProperties = { border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: '10px 12px', marginBottom: 16, fontSize: 13 }
const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)' }
const SOURCE: Record<string, string> = {
  legacy_program: 'old Publications Database program field',
  cover_page: "the paper's cover page",
  'legacy_program+cover_page': 'old Publications Database + cover page',
  ingest_2026: '2026 student-paper ingest',
  none: 'no evidence (all authors assumed students)',
}

/**
 * "Student evidence" sidebar panel: why this publication counts (or doesn't)
 * toward the /metrics student-author figures. Admin-only data — the endpoint
 * (collections/shared/studentEvidence.ts) requires a logged-in user.
 */
export const StudentEvidence: React.FC = () => {
  const { id } = useDocumentInfo()
  const [ev, setEv] = useState<Evidence | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetch(`/api/publications/${id}/student-evidence`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => { if (!cancelled) setEv(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [id])

  if (!id) return null
  if (error) return <div style={box}><strong>Student evidence</strong><div style={muted}>Could not load ({error})</div></div>
  if (!ev) return <div style={box}><strong>Student evidence</strong><div style={muted}>Loading…</div></div>

  const counted = ev.tags.filter((t) => t.counted)
  const other = ev.tags.filter((t) => !t.counted)

  return (
    <div style={box}>
      <strong>Student evidence</strong>
      <div style={{ ...muted, margin: '2px 0 8px' }}>
        Why &ldquo;Undergraduate author&rdquo; is {ev.undergradAuthor === 'yes' ? 'Yes' : ev.undergradAuthor === 'no' ? 'No' : 'unset'}
        {ev.undergradCurated ? ' (set by an admin)' : ''}. Correct a person with their Student select in the author list.
      </div>

      {counted.length > 0 && (
        <ul style={{ margin: '0 0 6px', paddingLeft: 16 }}>
          {counted.map((t) => (
            <li key={t.name} style={{ marginBottom: 4 }}>
              <strong>{t.name}</strong>{t.reu ? ' · REU' : ''}
              <div style={muted}>
                {t.studentPaperId
                  ? <a href={`/admin/collections/publications/${t.studentPaperId}`}>{t.reason}</a>
                  : t.reason}
              </div>
            </li>
          ))}
        </ul>
      )}
      {ev.legacyFlag && (
        <div style={{ marginBottom: 6 }}>
          Marked as having a student author in the old Publications Database
          {counted.length === 0 ? ' — the student is not identified.' : '.'}
        </div>
      )}
      {counted.length === 0 && !ev.legacyFlag && !ev.studentPaper && <div style={muted}>No student-author evidence.</div>}
      {other.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={muted}>{other.length} other tag{other.length > 1 ? 's' : ''} (not counted)</summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {other.map((t) => <li key={t.name} style={muted}>{t.name} — {t.reason}</li>)}
          </ul>
        </details>
      )}

      {ev.studentPaper && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--theme-elevation-100)', paddingTop: 8 }}>
          <div><strong>As a student paper</strong> <span style={muted}>(from {SOURCE[ev.studentPaper.source ?? 'none'] ?? ev.studentPaper.source})</span></div>
          <div>Students: {ev.studentPaper.students.map((s) => `${s.name}${s.reu ? ' (REU)' : ''}`).join('; ') || '—'}</div>
          <div>Mentors: {ev.studentPaper.mentors.join('; ') || '—'}</div>
          {ev.studentPaper.notes.length > 0 && <div style={muted}>{ev.studentPaper.notes.join(' · ')}</div>}
          <div style={{ marginTop: 6 }}>
            Matched to {ev.studentPaper.matchedTo.length} peer-reviewed publication{ev.studentPaper.matchedTo.length === 1 ? '' : 's'}:
            <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
              {ev.studentPaper.matchedTo.map((m) => (
                <li key={`${m.id}-${m.author_name}`}>
                  <a href={`/admin/collections/publications/${m.id}`}>{m.year} {m.title}</a>
                  <span style={muted}> — {m.author_name}{m.student_program === 'reu' ? ' (REU)' : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
