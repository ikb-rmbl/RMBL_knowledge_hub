/**
 * Compact inline provenance badge — renders at the top of an AI-generated
 * section so visitors see "🤖 AI-generated · {model} · {date} · methodology"
 * without scrolling to the sidebar.
 *
 * Companion to LlmProvenanceSidebar; both look the artifact's copy up in
 * `registry.ts`. The badge is the at-a-glance signal; the sidebar carries
 * the full metadata, methodology link, and (post-#58) the AI-quality
 * report-issue link.
 *
 * Render this *above* the section header, not inside it — that way the
 * badge sits between the page chrome and the AI-authored prose, where a
 * reader's eye is already settling. See issue #49.
 */

import { ARTIFACT_REGISTRY, type Tier1Artifact } from './registry'

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  margin: '0 0 12px',
  padding: '6px 10px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--rmbl-bone)',
  borderLeft: '3px solid var(--rmbl-orange)',
  borderRadius: '4px',
  fontSize: '12px',
  lineHeight: 1.4,
  color: 'var(--color-text-muted)',
  width: 'fit-content',
  maxWidth: '100%',
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--rmbl-orange-deep)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontSize: '11px',
}

const sepStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  opacity: 0.5,
}

const linkStyle: React.CSSProperties = {
  color: 'var(--rmbl-orange-deep)',
  textDecoration: 'underline',
}

/** Visual pill for "Reviewed by a curator" / "Awaiting curator review".
 *  Renders as the last segment inside the badge. */
function CurationPill({ curated }: { curated: boolean }) {
  if (curated) {
    return (
      <span
        title="A human curator has reviewed and may have edited this content."
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '999px',
          background: 'var(--rmbl-moss)',
          color: '#fff',
          fontWeight: 600,
          fontSize: '11px',
        }}
      >
        <span aria-hidden="true">✓</span> Reviewed by a curator
      </span>
    )
  }
  return (
    <span
      title="This AI-generated content has not yet been reviewed by a curator."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        background: 'transparent',
        border: '1px dashed var(--color-text-muted)',
        color: 'var(--color-text-muted)',
        fontWeight: 500,
        fontSize: '11px',
      }}
    >
      <span aria-hidden="true">◯</span> Awaiting curator review
    </span>
  )
}

export function LlmProvenanceBadge({
  kind,
  generatedAt,
  model,
  curated = false,
}: {
  kind: Tier1Artifact
  generatedAt: string | Date | null | undefined
  model: string | null | undefined
  /** Pass true when an admin has edited the corresponding AI-generated
   *  field on this row (i.e. it's in `curated_fields`). When omitted, the
   *  badge shows "Awaiting curator review". */
  curated?: boolean
}) {
  const copy = ARTIFACT_REGISTRY[kind]
  if (!copy) return null

  const date = generatedAt ? new Date(generatedAt) : null
  const dateStr =
    date && !isNaN(date.getTime())
      ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : null
  const modelStr = model ? MODEL_LABELS[model] ?? model : null

  return (
    <div
      style={wrapStyle}
      role="note"
      aria-label={`AI-generated ${copy.label}`}
    >
      <span style={labelStyle} aria-hidden="true">🤖 AI-generated</span>
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {copy.label}
      </span>
      {modelStr && (
        <>
          <span style={sepStyle}>·</span>
          <span title="Model used to generate this content">{modelStr}</span>
        </>
      )}
      {dateStr && (
        <>
          <span style={sepStyle}>·</span>
          <span title="Generation date">{dateStr}</span>
        </>
      )}
      <span style={sepStyle}>·</span>
      <a
        href={`/about#${copy.methodologyAnchor}`}
        style={linkStyle}
        aria-label={`Read the methodology for ${copy.label}`}
      >
        Methodology
      </a>
      <span style={sepStyle}>·</span>
      <CurationPill curated={curated} />
    </div>
  )
}
