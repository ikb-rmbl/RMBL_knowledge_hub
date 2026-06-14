/**
 * Scenario detail page — synopsis + stories panel + structured sections.
 *
 * Stories panel sits near the top (per spec design decision: links to the
 * narratives are first-class, not buried). All prose sections render from
 * the parsed columns on the `scenarios` table.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import {
  FUTURE_SETS,
  getScenarioBySlug,
  listStoriesForScenario,
  type StorySummary,
} from '@/services/futures'
import { ScenarioDisclaimer, ProvenanceSidebar } from '../lib/Disclaimer'
import { Prose } from '../lib/Prose'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scenario: string }>
}): Promise<Metadata> {
  const { scenario } = await params
  const sc = await getScenarioBySlug(getDb(), scenario)
  if (!sc) return { title: 'Scenario not found — RMBL Knowledge Commons' }
  return {
    title: `${sc.name} — RMBL Knowledge Commons`,
    description: sc.distinguishing_thesis?.slice(0, 200) ?? sc.synopsis?.slice(0, 200) ?? undefined,
  }
}

function tailBadge(tail: 'central' | 'upside' | 'downside') {
  switch (tail) {
    case 'upside':
      return { label: 'Upside', color: 'var(--rmbl-moss)' }
    case 'downside':
      return { label: 'Downside', color: 'var(--rmbl-aspen)' }
    default:
      return { label: 'Central', color: 'var(--rmbl-sky)' }
  }
}

function StoryRow({ s }: { s: StorySummary }) {
  return (
    <Link
      href={`/futures/${s.scenario_slug}/stories/${s.slug}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 18px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--rmbl-bone)',
        borderRadius: '4px',
        textDecoration: 'none',
        color: 'var(--color-text)',
        gap: '6px',
      }}
      className="story-row"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <span
          style={{
            fontSize: '16px',
            fontWeight: 500,
            fontFamily: 'Cormorant Garamond, Georgia, serif',
          }}
        >
          {s.title ?? s.slug}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
          {s.year} · {s.word_count} words
        </span>
      </div>
      {s.primary_character_role && (
        <span
          style={{
            fontSize: '12.5px',
            color: 'var(--color-text-muted)',
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {s.primary_character_role.split('\n')[0].slice(0, 180)}
        </span>
      )}
    </Link>
  )
}

const SECTION_STYLE: React.CSSProperties = {
  marginTop: '40px',
}

const SECTION_HEADING_STYLE: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)',
  margin: '0 0 16px',
  paddingBottom: '8px',
  borderBottom: '1px solid var(--rmbl-bone)',
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <section style={SECTION_STYLE}>
      <h2 style={SECTION_HEADING_STYLE}>{heading}</h2>
      {children}
    </section>
  )
}

export default async function ScenarioDetail({
  params,
}: {
  params: Promise<{ scenario: string }>
}) {
  const { scenario } = await params
  const db = getDb()
  const sc = await getScenarioBySlug(db, scenario)
  if (!sc) notFound()

  const stories = await listStoriesForScenario(db, scenario)
  const setMeta = FUTURE_SETS[sc.set_id]
  const tail = tailBadge(sc.set_tail)

  // Set sibling count for the disclaimer (this scenario + siblings).
  const setSize = setMeta?.set_id === 'centennial-2027' ? 12 : 3

  // Provenance metadata.
  const frameworkVersion =
    setMeta?.set_id === 'centennial-2027' ? '0.7' : setMeta?.set_id === 'centennial-2027-upside' ? '0.15' : '0.16'
  const sourcePath = `specification/scenarios/${sc.set_id}/${sc.slug}.md`

  return (
    <main
      style={{
        maxWidth: '1080px',
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}
    >
      <div style={{ marginBottom: '24px' }}>
        <Link
          href="/futures"
          style={{
            fontSize: '13px',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
          }}
        >
          ← Futures
        </Link>
      </div>

      <header style={{ marginBottom: '12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '14px',
            flexWrap: 'wrap',
          }}
        >
          <h1
            style={{
              fontSize: '40px',
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontWeight: 500,
              margin: 0,
              color: 'var(--color-text)',
              lineHeight: 1.15,
            }}
          >
            {sc.name}
          </h1>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: tail.color,
              padding: '3px 9px',
              border: `1px solid ${tail.color}`,
              borderRadius: '3px',
            }}
          >
            {tail.label}
          </span>
        </div>
        {sc.bracket_position && (
          <div
            style={{
              fontSize: '14px',
              fontStyle: 'italic',
              color: 'var(--color-text-muted)',
              marginTop: '8px',
            }}
          >
            {sc.bracket_position}
          </div>
        )}
      </header>

      <ScenarioDisclaimer
        setName={setMeta?.name ?? sc.set_id}
        setSize={setSize}
        setSlug={sc.set_id}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: '40px',
          alignItems: 'start',
        }}
        className="scenario-detail-grid"
      >
        <div>
          {sc.synopsis && (
            <Section heading="Synopsis">
              <Prose text={sc.synopsis} className="scenario-prose" />
            </Section>
          )}

          {stories.length > 0 && (
            <Section heading={`Stories grounded in this scenario (${stories.length})`}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '12px',
                }}
              >
                {stories.map((s) => (
                  <StoryRow key={s.slug} s={s} />
                ))}
              </div>
            </Section>
          )}

          <Section heading="Distinguishing thesis">
            <Prose text={sc.distinguishing_thesis} className="scenario-prose" />
          </Section>

          {sc.upside_conditions && (
            <Section heading="Upside conditions — what must hold">
              <Prose text={sc.upside_conditions} className="scenario-prose" />
            </Section>
          )}

          {sc.downside_conditions && (
            <Section heading="Downside conditions — what stacked unfavorably">
              <Prose text={sc.downside_conditions} className="scenario-prose" />
            </Section>
          )}

          {sc.setting && (
            <Section heading="Setting">
              <Prose text={sc.setting} className="scenario-prose" />
            </Section>
          )}

          {(sc.phase_1 || sc.phase_2 || sc.phase_3) && (
            <Section heading="The arc — three phases">
              {sc.phase_1 && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '17px', fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 500, margin: '0 0 8px' }}>
                    Phase 1
                  </h3>
                  <Prose text={sc.phase_1} className="scenario-prose" />
                </div>
              )}
              {sc.phase_2 && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '17px', fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 500, margin: '0 0 8px' }}>
                    Phase 2
                  </h3>
                  <Prose text={sc.phase_2} className="scenario-prose" />
                </div>
              )}
              {sc.phase_3 && (
                <div>
                  <h3 style={{ fontSize: '17px', fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 500, margin: '0 0 8px' }}>
                    Phase 3
                  </h3>
                  <Prose text={sc.phase_3} className="scenario-prose" />
                </div>
              )}
            </Section>
          )}

          {sc.audience_lens_research && (
            <Section heading="Audience lens — research">
              <Prose text={sc.audience_lens_research} className="scenario-prose" />
            </Section>
          )}
          {sc.audience_lens_institution && (
            <Section heading="Audience lens — institution">
              <Prose text={sc.audience_lens_institution} className="scenario-prose" />
            </Section>
          )}
          {sc.audience_lens_donor && (
            <Section heading="Audience lens — donor">
              <Prose text={sc.audience_lens_donor} className="scenario-prose" />
            </Section>
          )}

          {sc.plausibility_caveats && (
            <Section heading="Plausibility caveats">
              <Prose text={sc.plausibility_caveats} className="scenario-prose" />
            </Section>
          )}

          {sc.coda && (
            <Section heading="Looking further out: 2040–2050">
              <Prose text={sc.coda} className="scenario-prose" />
            </Section>
          )}

          {sc.mattering_in_2040 && (
            <Section heading="Mattering in 2040">
              <Prose text={sc.mattering_in_2040} className="scenario-prose" />
            </Section>
          )}
        </div>

        <div style={{ position: 'sticky', top: '24px' }}>
          <ProvenanceSidebar
            generatedAt={sc.generated_at}
            frameworkVersion={frameworkVersion}
            setName={setMeta?.name ?? sc.set_id}
            model="Claude Opus 4.7"
            sourcePath={sourcePath}
            itemKind="scenario"
          />
        </div>
      </div>

      <style>{`
        .scenario-prose p {
          margin: 0 0 14px;
          line-height: 1.65;
          font-size: 15.5px;
          color: var(--color-text);
        }
        .scenario-prose ul {
          padding-left: 22px;
          margin: 8px 0 14px;
        }
        .scenario-prose li {
          margin: 4px 0;
          line-height: 1.55;
          font-size: 15px;
        }
        .scenario-prose blockquote {
          margin: 14px 0;
          padding-left: 16px;
          border-left: 3px solid var(--rmbl-bone);
          color: var(--color-text-muted);
          font-style: italic;
        }
        .scenario-prose h3 {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 18px;
          font-weight: 500;
          margin: 18px 0 8px;
          color: var(--color-text);
        }
        .scenario-prose a {
          color: var(--rmbl-orange-deep);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .story-row:hover {
          border-color: var(--rmbl-orange) !important;
        }
        @media (max-width: 900px) {
          .scenario-detail-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  )
}
