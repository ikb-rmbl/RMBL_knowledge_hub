/**
 * Per-artifact provenance metadata block. Renders inside any sidebar.
 * Compact list of: artifact kind, generation date, model, source script link.
 *
 * Falls back gracefully when fields are NULL — only renders rows that have
 * values. Existing pre-backfill artifacts will show whatever is recorded.
 *
 * When `collection` and `itemId` are provided, also renders a small inline
 * "Report an AI-quality issue" link that opens FlagButton pre-loaded with
 * the ai_quality_issue reason. Intentionally co-located with the provenance
 * block — the affordance is most useful right next to the artifact metadata.
 */

import { ARTIFACT_REGISTRY, type Tier1Artifact } from './registry'
import FlagButton from '../FlagButton'

const containerStyle: React.CSSProperties = {
  padding: '14px 16px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--rmbl-bone)',
  borderRadius: '4px',
  fontSize: '12.5px',
  lineHeight: 1.55,
  color: 'var(--color-text-muted)',
}

const labelStyle: React.CSSProperties = {
  fontSize: '10.5px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '8px',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
}

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
}

export function LlmProvenanceSidebar({
  kind,
  generatedAt,
  model,
  collection,
  itemId,
}: {
  kind: Tier1Artifact
  generatedAt: string | Date | null | undefined
  model: string | null | undefined
  /** When both are provided, render an inline AI-quality flag link below
   *  the provenance block. Wires through to FlagButton with the
   *  ai_quality_issue reason pre-filled. */
  collection?: string
  itemId?: number
}) {
  const copy = ARTIFACT_REGISTRY[kind]
  if (!copy) return null

  const date = generatedAt ? new Date(generatedAt) : null
  const dateStr =
    date && !isNaN(date.getTime())
      ? date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null
  const modelStr = model ? MODEL_LABELS[model] ?? model : null

  return (
    <aside style={containerStyle} aria-label="Provenance">
      <div style={labelStyle}>About this {copy.label}</div>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: '12px',
          rowGap: '5px',
        }}
      >
        <dt>Type</dt>
        <dd style={{ margin: 0 }}>{copy.label.replace(/^./, (c) => c.toUpperCase())}</dd>
        {dateStr && (
          <>
            <dt>Generated</dt>
            <dd style={{ margin: 0 }}>{dateStr}</dd>
          </>
        )}
        {modelStr && (
          <>
            <dt>Model</dt>
            <dd style={{ margin: 0 }}>{modelStr}</dd>
          </>
        )}
        <dt>Pipeline</dt>
        <dd style={{ margin: 0 }}>
          <a
            href={`https://github.com/ikb-rmbl/RMBL_knowledge_hub/blob/main/${copy.scriptPath}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--rmbl-orange-deep)' }}
          >
            {copy.scriptPath.split('/').pop()}
          </a>
        </dd>
      </dl>
      {collection && itemId !== undefined && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--rmbl-bone)' }}>
          <FlagButton
            collection={collection}
            itemId={itemId}
            prefilledReason="ai_quality_issue"
            triggerLabel="Report an AI-quality issue with this content"
          />
        </div>
      )}
    </aside>
  )
}
