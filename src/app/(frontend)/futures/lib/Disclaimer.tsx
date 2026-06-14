/**
 * Disclaimers and provenance metadata for the Futures collection.
 *
 * Three variants:
 *   - browse:   the page-level framing on /futures
 *   - scenario: short under-title note on /futures/[scenario]
 *   - story-head + story-foot: brackets the literary text on the story page
 *
 * Plus a `ProvenanceSidebar` that surfaces generation-time metadata
 * (date, framework version, model) per-artifact.
 *
 * The language deliberately avoids both undermining the artifacts' usefulness
 * and overstating their certainty. They are planning artifacts in a register
 * the spec deliberately makes plural, contingency-honest, and what-is-
 * forgone-explicit.
 */

import Link from 'next/link'

const wrapStyle: React.CSSProperties = {
  margin: '0 0 32px',
  padding: '20px 24px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--rmbl-bone)',
  borderLeft: '3px solid var(--rmbl-orange)',
  borderRadius: '4px',
  fontSize: '14px',
  lineHeight: 1.55,
  color: 'var(--color-text)',
}

const headingStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  margin: '0 0 12px',
  color: 'var(--rmbl-orange-deep)',
  letterSpacing: '0.02em',
}

const noteStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
  lineHeight: 1.55,
  margin: '24px 0',
}

/** Browse page (`/futures`) — full three-paragraph framing at the top. */
export function BrowseDisclaimer() {
  return (
    <div style={wrapStyle} role="note" aria-label="About these futures">
      <h2 style={headingStyle}>About these futures</h2>
      <p style={{ margin: '0 0 12px' }}>
        The scenarios and stories in this collection are <strong>planning
        artifacts</strong>, not forecasts or RMBL institutional commitments.
        They were generated using a structured specification (the Future
        Scenarios Framework) and an AI model (Claude Opus); the choices about
        what to explore — which contingencies, which strategic options, which
        time horizons — were made by RMBL staff and embedded in the spec.
      </p>
      <p style={{ margin: '0 0 12px' }}>
        Each scenario describes <em>one plausible state</em> of basin science
        roughly fifteen years from now, given specified conditions. Together
        they map the strategic decision space the Centennial Campaign will
        navigate. They are not predictions of what will happen, nor statements
        of what RMBL plans to do. The framework deliberately makes plurality
        (multiple scenarios), contingency-honesty (each scenario names what
        would invalidate it), and what-is-forgone explicit.
      </p>
      <p style={{ margin: '0 0 12px' }}>
        The companion stories are short literary fiction grounded in specific
        scenarios. Characters are fictional roles, not real people. The
        fictional voice helps readers inhabit possibilities the
        strategic-planning register cannot reach. They are not documentary.
      </p>
      <p style={{ margin: '12px 0 0', fontSize: '13px' }}>
        <Link href="/about#futures-methodology" style={{ color: 'var(--rmbl-orange-deep)' }}>
          How these were made →
        </Link>
      </p>
    </div>
  )
}

/** Scenario detail page — short paragraph under the title. */
export function ScenarioDisclaimer({
  setName,
  setSize,
  setSlug: _setSlug,
}: {
  setName: string
  setSize: number
  setSlug: string
}) {
  return (
    <p style={noteStyle} role="note">
      This is one of {setSize} scenarios the{' '}
      <strong style={{ fontStyle: 'normal' }}>{setName}</strong> explores. It
      is an AI-generated planning artifact, not a forecast or an RMBL
      institutional commitment. The contingencies it depends on are named in
      its plausibility-caveats and (where applicable) upside or downside
      conditions sections. See the{' '}
      <Link href="/futures" style={{ color: 'var(--rmbl-orange-deep)' }}>
        browse page
      </Link>{' '}
      for the full set, including the alternative scenarios.
    </p>
  )
}

/** Story page — prominent header box before the title. */
export function StoryHeadDisclaimer({
  scenarioName,
  scenarioSlug,
}: {
  scenarioName: string
  scenarioSlug: string
}) {
  return (
    <div style={wrapStyle} role="note" aria-label="About this story">
      <h2 style={headingStyle}>About this story</h2>
      <p style={{ margin: 0 }}>
        Short literary fiction grounded in the{' '}
        <Link
          href={`/futures/${scenarioSlug}`}
          style={{ color: 'var(--rmbl-orange-deep)', fontWeight: 500 }}
        >
          {scenarioName}
        </Link>{' '}
        scenario. Characters are fictional roles, not real RMBL staff or guest
        scientists. AI-generated companion artifact (Claude Opus), not a
        prediction or RMBL commitment. It exists to help readers inhabit one
        possible future at a register the strategic-planning artifacts cannot
        reach.
      </p>
    </div>
  )
}

/** Story page — brief italic footer after the prose. */
export function StoryFootDisclaimer({ scenarioName, scenarioSlug }: { scenarioName: string; scenarioSlug: string }) {
  return (
    <p
      style={{
        ...noteStyle,
        textAlign: 'center',
        margin: '48px auto 0',
        maxWidth: '600px',
        fontSize: '12.5px',
      }}
      role="note"
    >
      Fiction. AI-generated. Read alongside the{' '}
      <Link
        href={`/futures/${scenarioSlug}`}
        style={{ color: 'var(--color-text-muted)', textDecoration: 'underline' }}
      >
        {scenarioName}
      </Link>{' '}
      scenario it is grounded in.
    </p>
  )
}

/** Sidebar block surfaced on scenario + story detail pages. */
export function ProvenanceSidebar({
  generatedAt,
  frameworkVersion,
  setName,
  model,
  sourcePath,
  itemKind,
}: {
  generatedAt: string | Date
  frameworkVersion: string
  setName: string
  model: string
  sourcePath: string
  itemKind: 'scenario' | 'story'
}) {
  const date =
    typeof generatedAt === 'string' ? new Date(generatedAt) : generatedAt
  const dateStr = isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

  return (
    <aside
      style={{
        padding: '16px 18px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--rmbl-bone)',
        borderRadius: '4px',
        fontSize: '13px',
        lineHeight: 1.55,
        color: 'var(--color-text-muted)',
      }}
      aria-label="Provenance"
    >
      <div
        style={{
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-text-muted)',
          marginBottom: '10px',
          fontWeight: 600,
        }}
      >
        About this {itemKind}
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '12px', rowGap: '6px' }}>
        <dt style={{ color: 'var(--color-text-muted)' }}>Set</dt>
        <dd style={{ margin: 0 }}>{setName}</dd>
        {dateStr && (
          <>
            <dt style={{ color: 'var(--color-text-muted)' }}>Generated</dt>
            <dd style={{ margin: 0 }}>{dateStr}</dd>
          </>
        )}
        <dt style={{ color: 'var(--color-text-muted)' }}>Framework</dt>
        <dd style={{ margin: 0 }}>v{frameworkVersion}</dd>
        <dt style={{ color: 'var(--color-text-muted)' }}>Model</dt>
        <dd style={{ margin: 0 }}>{model}</dd>
        <dt style={{ color: 'var(--color-text-muted)' }}>Source</dt>
        <dd style={{ margin: 0 }}>
          <a
            href={`https://github.com/ikb-rmbl/RMBL_knowledge_hub/blob/main/${sourcePath}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--rmbl-orange-deep)' }}
          >
            on GitHub
          </a>
        </dd>
      </dl>
    </aside>
  )
}
