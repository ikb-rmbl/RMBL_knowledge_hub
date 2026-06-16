/**
 * Tier 1 LLM-artifact disclaimer — full collapsible variant.
 *
 * Used by non-Futures Tier 1 detail pages (neighborhood primers, era primers,
 * frontier syntheses). The Futures collection has its own scenario-specific
 * disclaimer variants in src/app/(frontend)/futures/lib/Disclaimer.tsx that
 * carry additional framing for the scenario/story register.
 */

import Link from 'next/link'
import { ARTIFACT_REGISTRY, type Tier1Artifact } from './registry'

const wrapStyle: React.CSSProperties = {
  margin: '0 0 24px',
  padding: '16px 20px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--rmbl-bone)',
  borderLeft: '3px solid var(--rmbl-orange)',
  borderRadius: '4px',
  fontSize: '14px',
  lineHeight: 1.55,
  color: 'var(--color-text)',
}

const headingStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  margin: '0 0 8px',
  color: 'var(--rmbl-orange-deep)',
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
}

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '13px',
  padding: '4px 0',
  color: 'var(--rmbl-orange-deep)',
}

const paraStyle: React.CSSProperties = { margin: '6px 0', lineHeight: 1.55 }

export function LlmArtifactDisclaimer({ kind }: { kind: Tier1Artifact }) {
  const copy = ARTIFACT_REGISTRY[kind]
  if (!copy) return null
  return (
    <div style={wrapStyle} role="note" aria-label={`About this ${copy.label}`}>
      <h2 style={headingStyle}>About this {copy.label}</h2>
      <p style={{ margin: '0 0 8px' }}>
        <strong>AI-generated synthesis.</strong> {copy.description}
      </p>
      <details>
        <summary style={summaryStyle}>How to read it</summary>
        <p style={paraStyle}>{copy.readingFraming}</p>
      </details>
      <p style={{ margin: '10px 0 0', fontSize: '12.5px' }}>
        <Link
          href={`/about#${copy.methodologyAnchor}`}
          style={{ color: 'var(--rmbl-orange-deep)' }}
        >
          How these were made →
        </Link>
      </p>
    </div>
  )
}
