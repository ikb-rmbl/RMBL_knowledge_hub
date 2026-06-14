/**
 * Futures browse page — three stacked sections (Central / Upside / Downside),
 * each with the set's framing paragraph and a grid of scenario cards.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'
import { listSetsWithScenarios, type ScenarioSummary } from '@/services/futures'
import { BrowseDisclaimer } from './lib/Disclaimer'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Futures — RMBL Knowledge Commons',
  description:
    'Future scenarios and companion narratives for the RMBL Centennial Campaign — planning artifacts mapping a strategic decision space, with central, upside, and downside companion sets.',
}

function bracketBadge(tail: ScenarioSummary['set_tail']): { label: string; color: string } {
  switch (tail) {
    case 'upside':
      return { label: 'Upside', color: 'var(--rmbl-moss)' }
    case 'downside':
      return { label: 'Downside', color: 'var(--rmbl-aspen)' }
    default:
      return { label: 'Central', color: 'var(--rmbl-sky)' }
  }
}

function ScenarioCard({ s }: { s: ScenarioSummary }) {
  const tail = bracketBadge(s.set_tail)
  return (
    <Link
      href={`/futures/${s.slug}`}
      style={{
        display: 'block',
        padding: '20px 22px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--rmbl-bone)',
        borderRadius: '6px',
        textDecoration: 'none',
        color: 'var(--color-text)',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
      className="scenario-card"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          marginBottom: '10px',
        }}
      >
        <h3
          style={{
            fontSize: '20px',
            fontWeight: 500,
            margin: 0,
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            lineHeight: 1.25,
            color: 'var(--color-text)',
          }}
        >
          {s.name}
        </h3>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: tail.color,
            whiteSpace: 'nowrap',
            padding: '2px 8px',
            border: `1px solid ${tail.color}`,
            borderRadius: '3px',
          }}
        >
          {tail.label}
        </span>
      </div>
      {s.bracket_position && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--color-text-muted)',
            marginBottom: '12px',
            fontStyle: 'italic',
          }}
        >
          {s.bracket_position}
        </div>
      )}
      {s.distinguishing_thesis && (
        <p
          style={{
            margin: '0 0 12px',
            fontSize: '14px',
            lineHeight: 1.55,
            color: 'var(--color-text)',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {s.distinguishing_thesis}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          fontSize: '12px',
          color: 'var(--color-text-muted)',
        }}
      >
        {s.continuity_pct !== null && s.innovation_pct !== null && (
          <span>
            {s.continuity_pct}% continuity / {s.innovation_pct}% innovation
          </span>
        )}
        {s.story_count > 0 && (
          <span>
            {s.story_count} {s.story_count === 1 ? 'story' : 'stories'}
          </span>
        )}
      </div>
    </Link>
  )
}

export default async function FuturesBrowse() {
  const sets = await listSetsWithScenarios(getDb())

  return (
    <main
      style={{
        maxWidth: '1080px',
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}
    >
      <header style={{ marginBottom: '36px' }}>
        <h1
          style={{
            fontSize: '42px',
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontWeight: 500,
            margin: '0 0 12px',
            color: 'var(--color-text)',
          }}
        >
          Futures
        </h1>
        <p
          style={{
            fontSize: '17px',
            lineHeight: 1.55,
            color: 'var(--color-text-muted)',
            margin: 0,
            maxWidth: '720px',
          }}
        >
          Future scenarios and companion narratives mapping the strategic
          decision space for RMBL's 2027–2029 Centennial Campaign. Eighteen
          scenarios across three sets, with eighteen literary stories grounded
          in specific scenarios for inhabit-able reading.
        </p>
      </header>

      <BrowseDisclaimer />

      {sets.map(({ set, scenarios }) => {
        if (scenarios.length === 0) return null
        return (
          <section key={set.set_id} style={{ marginBottom: '56px' }}>
            <div style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '28px',
                  fontFamily: 'Cormorant Garamond, Georgia, serif',
                  fontWeight: 500,
                  margin: '0 0 10px',
                  color: 'var(--color-text)',
                }}
              >
                {set.name}
              </h2>
              <p
                style={{
                  fontSize: '15px',
                  lineHeight: 1.6,
                  color: 'var(--color-text-muted)',
                  margin: 0,
                  maxWidth: '780px',
                }}
              >
                {set.description}
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {scenarios.map((s) => (
                <ScenarioCard key={s.slug} s={s} />
              ))}
            </div>
          </section>
        )
      })}

      <style>{`
        .scenario-card:hover {
          border-color: var(--rmbl-orange) !important;
          transform: translateY(-1px);
        }
      `}</style>
    </main>
  )
}
