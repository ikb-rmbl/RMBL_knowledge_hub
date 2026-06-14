/**
 * Story detail page — reading-first layout.
 *
 * Header disclaimer box → title → prose centered and generously spaced
 * (Cormorant Garamond for the literary read) → footer disclaimer note.
 * Sidebar carries provenance metadata.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../../../lib/db'
import { FUTURE_SETS, getStoryBySlug } from '@/services/futures'
import {
  ProvenanceSidebar,
  StoryFootDisclaimer,
  StoryHeadDisclaimer,
} from '../../../lib/Disclaimer'
import { Prose } from '../../../lib/Prose'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scenario: string; story: string }>
}): Promise<Metadata> {
  const { story } = await params
  const s = await getStoryBySlug(getDb(), story)
  if (!s) return { title: 'Story not found — RMBL Knowledge Commons' }
  return {
    title: `${s.title ?? s.slug} — RMBL Knowledge Commons`,
    description: `Short literary fiction grounded in the ${s.scenario_name ?? 'scenario'} scenario, year ${s.year}.`,
  }
}

export default async function StoryDetail({
  params,
}: {
  params: Promise<{ scenario: string; story: string }>
}) {
  const { story } = await params
  const s = await getStoryBySlug(getDb(), story)
  if (!s) notFound()

  const setMeta = FUTURE_SETS[s.set_id]
  const frameworkVersion =
    setMeta?.set_id === 'centennial-2027' ? '0.13' : setMeta?.set_id === 'centennial-2027-upside' ? '0.15' : '0.16'
  const sourcePath = `specification/stories/${s.set_id}/${s.slug}.md`

  return (
    <main
      style={{
        maxWidth: '1080px',
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}
    >
      <div style={{ marginBottom: '20px' }}>
        <Link
          href={`/futures/${s.scenario_slug}`}
          style={{
            fontSize: '13px',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
          }}
        >
          ← {s.scenario_name ?? 'Scenario'}
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 260px',
          gap: '40px',
          alignItems: 'start',
        }}
        className="story-detail-grid"
      >
        <div>
          <StoryHeadDisclaimer
            scenarioName={s.scenario_name ?? s.scenario_slug}
            scenarioSlug={s.scenario_slug}
          />

          <header style={{ marginBottom: '32px' }}>
            <h1
              style={{
                fontSize: '44px',
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                fontWeight: 500,
                margin: '0 0 12px',
                color: 'var(--color-text)',
                lineHeight: 1.15,
              }}
            >
              {s.title ?? s.slug}
            </h1>
            <div
              style={{
                fontSize: '13px',
                color: 'var(--color-text-muted)',
                letterSpacing: '0.03em',
              }}
            >
              {s.year} · {s.word_count} words ·{' '}
              {s.mode === 'stress-overlay'
                ? 'Stress-overlay mode'
                : s.mode === 'inflection-point'
                ? 'Inflection-point mode'
                : 'Inhabitation mode'}
            </div>
          </header>

          <article
            className="story-body"
            style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '19px',
              lineHeight: 1.65,
              color: 'var(--color-text)',
              maxWidth: '680px',
            }}
          >
            <Prose text={s.body} />
          </article>

          <StoryFootDisclaimer
            scenarioName={s.scenario_name ?? s.scenario_slug}
            scenarioSlug={s.scenario_slug}
          />
        </div>

        <div style={{ position: 'sticky', top: '24px' }}>
          <ProvenanceSidebar
            generatedAt={s.generated_at}
            frameworkVersion={frameworkVersion}
            setName={setMeta?.name ?? s.set_id}
            model="Claude Opus 4.7"
            sourcePath={sourcePath}
            itemKind="story"
          />

          {(s.protagonist_type || s.frontier_slug) && (
            <div
              style={{
                marginTop: '16px',
                padding: '16px 18px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--rmbl-bone)',
                borderRadius: '4px',
                fontSize: '13px',
                lineHeight: 1.55,
                color: 'var(--color-text-muted)',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '10px',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                }}
              >
                Protagonist
              </div>
              {s.protagonist_type && (
                <div style={{ marginBottom: '8px', color: 'var(--color-text)' }}>
                  {s.protagonist_type === 'guest_scientist'
                    ? 'Guest scientist'
                    : s.protagonist_type === 'rmbl_staff'
                    ? 'RMBL staff'
                    : 'Partner (agency / tribe / district)'}
                </div>
              )}
              {s.frontier_slug && (
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>Frontier: </span>
                  <span style={{ color: 'var(--color-text)' }}>
                    {s.frontier_slug.replace(/-/g, ' ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .story-body p {
          margin: 0 0 20px;
        }
        .story-body em {
          font-style: italic;
        }
        .story-body strong {
          font-weight: 600;
        }
        .story-body a {
          color: var(--rmbl-orange-deep);
        }
        @media (max-width: 900px) {
          .story-detail-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  )
}
