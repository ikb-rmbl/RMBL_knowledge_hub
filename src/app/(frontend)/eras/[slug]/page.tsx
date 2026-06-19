import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { LlmArtifactDisclaimer } from '../../components/ai-artifact/Disclaimer'
import { LlmProvenanceSidebar } from '../../components/ai-artifact/ProvenanceSidebar'
import FlagButton from '../../components/FlagButton'
import {
  getEra,
  getEraMemberCounts,
  getEraPrimer,
  getEraTopEntities,
  getEraTopPublications,
  getEraRecentDocuments,
  getEraTopDatasets,
  getEraRecentStories,
  getEraTrajectorySnapshot,
  isCenturyEra,
  RESEARCH_SOURCES,
  POLICY_SOURCES,
  type Era,
  type EraPrimer,
  type EraTrajectorySnapshot,
  type TopEntity,
  type TrajectoryEntity,
  type EntityType,
} from '@/services/eras'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const db = getDb()
  const era = await getEra(db, slug)
  if (!era) return { title: 'Era not found' }
  return {
    title: `${era.name} — RMBL Knowledge Commons`,
    description:
      era.description ||
      `Content and most-distinctive entities from the ${era.name} (${era.start_year}–${era.end_year}) in the Gunnison Basin.`,
  }
}

const sectionHeading: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-text-muted)',
  margin: '0 0 12px',
}

const sectionWrap: React.CSSProperties = {
  marginTop: '32px',
}

/** Entity chip with link if a detail page exists for that type. */
function EntityChip({ entity, type }: { entity: TopEntity; type: EntityType }) {
  // stakeholders has no detail page yet; render as plain chip.
  const path =
    type === 'stakeholder' ? null : `/${type === 'concept' ? 'concepts' : type === 'place' ? 'places' : type === 'species' ? 'species' : 'protocols'}/${entity.entity_id}`

  const inner = (
    <>
      <span style={{ fontWeight: 500 }}>{entity.name}</span>
      <span
        style={{
          fontSize: '11px',
          color: 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
          marginLeft: '6px',
        }}
        title={`${entity.in_era} mentions in this era · ${entity.out_era} elsewhere · z=${entity.z.toFixed(2)}`}
      >
        {entity.in_era}
      </span>
    </>
  )

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'baseline',
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    fontSize: '13px',
    lineHeight: 1.4,
    textDecoration: 'none',
    color: 'var(--color-text)',
  }

  return path ? (
    <Link href={path} style={chipStyle}>
      {inner}
    </Link>
  ) : (
    <span style={chipStyle}>{inner}</span>
  )
}

// ---------------------------------------------------------------------------
// Primer renderer (parses the generated markdown-ish text into sections)
// ---------------------------------------------------------------------------

const ERA_PRIMER_HEADERS = new Set([
  'setting',
  'research focus',
  'community and policy context',
  'emerging directions',
  'landmark works',
  'connections',
  'references',
])

function renderInlineLinks(text: string): React.ReactNode {
  // Match [link text](/{publications|documents|datasets}/N)
  const parts = text.split(/(\[[^\]]+\]\(\/(?:publications|documents|datasets)\/\d+\))/g)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    const m = part.match(/^\[([^\]]+)\]\((\/(?:publications|documents|datasets)\/\d+)\)$/)
    if (m) {
      const linkText = m[1]
      // Citation-style links end with a 4-digit year — wrap in parens for prose.
      const isCitation = /\d{4}\s*$/.test(linkText)
      return (
        <a key={i} href={m[2]} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
          {isCitation ? `(${linkText})` : linkText}
        </a>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function PrimerRenderer({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let para: string[] = []
  let inReferences = false
  const refLines: string[] = []

  function flushPara() {
    if (para.length === 0) return
    const content = para.join(' ')
    elements.push(
      <p
        key={elements.length}
        style={{
          fontSize: '14px',
          lineHeight: 1.7,
          color: 'var(--fg-2)',
          margin: '0 0 12px',
          maxWidth: '68ch',
        }}
      >
        {renderInlineLinks(content)}
      </p>,
    )
    para = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushPara()
      continue
    }
    const headerText = trimmed.replace(/^#{1,3}\s+/, '')
    if (ERA_PRIMER_HEADERS.has(headerText.toLowerCase())) {
      flushPara()
      inReferences = headerText.toLowerCase() === 'references'
      elements.push(
        <h2
          key={elements.length}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            fontWeight: 600,
            margin: '20px 0 8px',
            color: 'var(--fg-1)',
            ...(inReferences
              ? { borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '24px' }
              : {}),
          }}
        >
          {headerText}
        </h2>,
      )
      continue
    }
    if (inReferences) {
      flushPara()
      refLines.push(trimmed)
    } else {
      para.push(trimmed)
    }
  }
  flushPara()

  // Render reference entries in source order (the prompt outputs them in
  // the order they were cited; preserve that here rather than re-sorting).
  for (const ref of refLines) {
    elements.push(
      <p
        key={elements.length}
        style={{
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--fg-3)',
          margin: '0 0 6px',
          maxWidth: '68ch',
        }}
      >
        {renderInlineLinks(ref)}
      </p>,
    )
  }

  return <>{elements}</>
}

function SynthesisSection({
  primer,
  eraName,
}: {
  primer: EraPrimer | null
  eraName: string
}) {
  if (!primer) {
    return (
      <section style={sectionWrap}>
        <h2 style={sectionHeading}>Synthesis</h2>
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}
        >
          A grounded period portrait of environmental research at RMBL and the
          Gunnison Basin during the {eraName} will appear here once the era
          primer has been generated. Today&rsquo;s view is the raw evidence
          the synthesis will draw from.
        </div>
      </section>
    )
  }
  return (
    <section style={sectionWrap}>
      <h2 style={sectionHeading}>Synthesis</h2>
      <LlmArtifactDisclaimer kind="era-primer" />
      <PrimerRenderer text={primer.primer} />
      <div style={{ marginTop: '20px', maxWidth: '420px' }}>
        <LlmProvenanceSidebar
          kind="era-primer"
          generatedAt={primer.primer_generated_at}
          model={primer.primer_model}
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Trajectory chips + "What changed" panel
// ---------------------------------------------------------------------------

const ENTITY_TYPE_PATH: Record<EntityType, string | null> = {
  concept: 'concepts',
  species: 'species',
  protocol: 'protocols',
  place: 'places',
  stakeholder: null, // no detail page
}

// Color dot per entity type, matching the graph palette so the chip dots
// agree with the global graph view.
const TYPE_DOT_COLOR: Record<EntityType, string> = {
  concept: '#7b1fa2',
  species: '#558b2f',
  protocol: '#1565c0',
  place: '#6d4c41',
  stakeholder: '#546e7a',
}

function TrajectoryChip({
  entity,
  variant,
  priorEraName,
}: {
  entity: TrajectoryEntity
  variant: 'new' | 'rising' | 'fading'
  priorEraName: string | null
}) {
  const path = ENTITY_TYPE_PATH[entity.entity_type]
  const href = path ? `/${path}/${entity.entity_id}` : null

  const tooltipParts: string[] = [
    `${entity.entity_type}: ${entity.name}`,
    `${entity.n_in_era} mentions this era`,
  ]
  if (variant !== 'new' && priorEraName) {
    tooltipParts.push(`${entity.n_in_prior} mentions in ${priorEraName}`)
    tooltipParts.push(`z=${entity.z_score.toFixed(2)} (pairwise log-odds)`)
  }
  if (variant === 'new') {
    tooltipParts.push(`First observed: ${entity.first_year}`)
  }
  const title = tooltipParts.join(' · ')

  const inner = (
    <>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: TYPE_DOT_COLOR[entity.entity_type],
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 500 }}>{entity.name}</span>
      <span
        style={{
          fontSize: '11px',
          color: 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {entity.n_in_era}
      </span>
    </>
  )

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    fontSize: '13px',
    lineHeight: 1.4,
    textDecoration: 'none',
    color: 'var(--color-text)',
  }

  return href ? (
    <Link href={href} style={chipStyle} title={title}>
      {inner}
    </Link>
  ) : (
    <span style={chipStyle} title={title}>
      {inner}
    </span>
  )
}

function TrajectorySection({
  title,
  glyph,
  hint,
  entities,
  variant,
  priorEraName,
}: {
  title: string
  glyph: string
  hint: string
  entities: TrajectoryEntity[]
  variant: 'new' | 'rising' | 'fading'
  priorEraName: string | null
}) {
  return (
    <div>
      <h3
        style={{
          fontSize: '13px',
          fontWeight: 600,
          margin: '0 0 4px',
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
        }}
      >
        <span aria-hidden="true">{glyph}</span>
        <span>{title}</span>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--color-text-muted)',
            fontWeight: 400,
            marginLeft: '4px',
          }}
        >
          {entities.length}
        </span>
      </h3>
      <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
        {hint}
      </p>
      {entities.length === 0 ? (
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Nothing crossed the threshold for this era.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {entities.map((e) => (
            <TrajectoryChip
              key={`${e.entity_type}-${e.entity_id}`}
              entity={e}
              variant={variant}
              priorEraName={priorEraName}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function WhatChangedPanel({
  trajectory,
  eraName,
}: {
  trajectory: EraTrajectorySnapshot
  eraName: string
}) {
  const { hasPrior, prior_era_name, newInEra, rising, fading } = trajectory
  // Suppress the panel entirely if there's literally nothing to show
  // (extremely sparse eras can produce empty lists across the board).
  if (!hasPrior && newInEra.length === 0) return null
  if (hasPrior && newInEra.length === 0 && rising.length === 0 && fading.length === 0) return null

  return (
    <section style={sectionWrap}>
      <h2 style={sectionHeading}>What changed</h2>
      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 16px', maxWidth: '65ch' }}>
        Entities trending into or out of the corpus around the {eraName}.{' '}
        {hasPrior && prior_era_name ? (
          <>
            Rising and Fading are ranked by pairwise log-odds-ratio z-score
            against the immediately preceding era ({prior_era_name}); New
            covers entities making their first corpus appearance in this era.
            One caveat: &ldquo;new&rdquo; partly reflects extraction coverage —
            a concept can look new only because earlier full-text was sparse.
          </>
        ) : (
          <>
            This era has no prior calendar era for comparison, so Rising and
            Fading are unavailable. New shows entities first observed in the
            corpus during this era.
          </>
        )}
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '20px',
        }}
      >
        <TrajectorySection
          title="New in this era"
          glyph="🌱"
          hint="First observed in the corpus during this era. Sorted by mentions."
          entities={newInEra}
          variant="new"
          priorEraName={prior_era_name}
        />
        {hasPrior && (
          <>
            <TrajectorySection
              title="Rising"
              glyph="↗"
              hint={`Biggest pairwise log-odds gain vs. ${prior_era_name}.`}
              entities={rising}
              variant="rising"
              priorEraName={prior_era_name}
            />
            <TrajectorySection
              title="Fading"
              glyph="↘"
              hint={`Biggest pairwise log-odds drop vs. ${prior_era_name}.`}
              entities={fading}
              variant="fading"
              priorEraName={prior_era_name}
            />
          </>
        )}
      </div>
    </section>
  )
}

function EntitySection({
  title,
  entities,
  type,
  hint,
}: {
  title: string
  entities: TopEntity[]
  type: EntityType
  hint: string
}) {
  if (entities.length === 0) {
    return (
      <section style={sectionWrap}>
        <h2 style={sectionHeading}>{title}</h2>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          No {type} mentions ranked as distinctive for this era.
        </p>
      </section>
    )
  }
  return (
    <section style={sectionWrap}>
      <h2 style={sectionHeading}>{title}</h2>
      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 10px' }}>
        {hint}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {entities.map((e) => (
          <EntityChip key={e.entity_id} entity={e} type={type} />
        ))}
      </div>
    </section>
  )
}

function CountBadge({ label, n }: { label: string; n: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        fontSize: '12px',
        whiteSpace: 'nowrap',
      }}
    >
      <strong style={{ fontWeight: 600 }}>{n.toLocaleString()}</strong>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </span>
  )
}

export default async function EraDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const db = getDb()
  const era = await getEra(db, slug)
  if (!era) notFound()

  // Fetch everything in parallel. Concepts split into two lenses to keep
  // document-flavored policy concepts from swamping research concepts in
  // mixed eras.
  const [
    counts,
    parent,
    researchConcepts,
    policyConcepts,
    topSpecies,
    topProtocols,
    topPlaces,
    topStakeholders,
    topPubs,
    recentDocs,
    topDatasets,
    recentStories,
    trajectory,
    primer,
  ] = await Promise.all([
    getEraMemberCounts(db, era),
    era.parent_era_id ? getEra(db, era.parent_era_id) : Promise.resolve<Era | null>(null),
    getEraTopEntities(db, era, 'concept', { limit: 20, sourceCollections: RESEARCH_SOURCES }),
    getEraTopEntities(db, era, 'concept', { limit: 20, sourceCollections: POLICY_SOURCES }),
    getEraTopEntities(db, era, 'species', { limit: 20 }),
    getEraTopEntities(db, era, 'protocol', { limit: 15 }),
    getEraTopEntities(db, era, 'place', { limit: 15 }),
    getEraTopEntities(db, era, 'stakeholder', { limit: 15 }),
    getEraTopPublications(db, era, 10),
    getEraRecentDocuments(db, era, 6),
    getEraTopDatasets(db, era, 6),
    getEraRecentStories(db, era, 6),
    getEraTrajectorySnapshot(db, era, { limit: 10 }),
    getEraPrimer(db, era.id),
  ])

  const century = isCenturyEra(era)
  const distinctivenessHint =
    'Ranked by log-odds-ratio z-score — over-represented in this era vs. all other dated content, not just frequent overall.'

  return (
    <div className="detail">
      <Link href="/eras" className="detail-back">
        ← All eras
      </Link>

      <h1>{era.name}</h1>
      <FlagButton collection="eras" itemId={era.id} />

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '12px',
            flexWrap: 'wrap',
            color: 'var(--color-text-muted)',
            fontSize: '14px',
          }}
        >
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {era.start_year}–{era.end_year}
          </span>
          {parent && (
            <>
              <span>·</span>
              <span>
                inside{' '}
                <Link
                  href={`/eras/${parent.slug}`}
                  style={{ color: 'var(--color-accent)' }}
                >
                  {parent.name}
                </Link>
              </span>
            </>
          )}
          {century && (
            <>
              <span>·</span>
              <span>century anchor</span>
            </>
          )}
        </div>

        {era.description && (
          <p style={{ margin: '16px 0 0', fontSize: '15px', lineHeight: 1.55, maxWidth: '65ch' }}>
            {era.description}
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px' }}>
          <CountBadge label="publications" n={counts.publications} />
          <CountBadge label="documents" n={counts.documents} />
          <CountBadge label="datasets" n={counts.datasets} />
          <CountBadge label="stories" n={counts.stories} />
        </div>

      <SynthesisSection primer={primer} eraName={era.name} />

      <WhatChangedPanel trajectory={trajectory} eraName={era.name} />

      {/* Distinctive entities — the headline of the page. Concepts split
          into research and policy lenses because the two collections speak
          very different vocabularies. */}
      <EntitySection
        title="Distinctive concepts — Research"
        entities={researchConcepts}
        type="concept"
        hint={`${distinctivenessHint} Drawn from publications and datasets only.`}
      />
      <EntitySection
        title="Distinctive concepts — Policy & community"
        entities={policyConcepts}
        type="concept"
        hint={`${distinctivenessHint} Drawn from community / policy documents only.`}
      />
      <EntitySection
        title="Distinctive species"
        entities={topSpecies}
        type="species"
        hint={distinctivenessHint}
      />
      <EntitySection
        title="Distinctive protocols & methods"
        entities={topProtocols}
        type="protocol"
        hint={distinctivenessHint}
      />
      <EntitySection
        title="Distinctive places"
        entities={topPlaces}
        type="place"
        hint={distinctivenessHint}
      />
      <EntitySection
        title="Distinctive stakeholders"
        entities={topStakeholders}
        type="stakeholder"
        hint={distinctivenessHint}
      />

      {/* Content samples */}
      <section style={sectionWrap}>
        <h2 style={sectionHeading}>Most-cited publications</h2>
        {topPubs.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            No publications dated within this era.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {topPubs.map((p) => (
              <li key={p.id} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
                <Link href={`/publications/${p.id}`} style={{ color: 'var(--color-text)', textDecoration: 'none', fontWeight: 500 }}>
                  {p.title}
                </Link>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  {p.authors && <span>{p.authors}</span>}
                  {p.authors && <span> · </span>}
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{p.year}</span>
                  {(p.citation_count ?? 0) > 0 && (
                    <>
                      {' · '}
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {(p.citation_count ?? 0).toLocaleString()} citations
                      </span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={sectionWrap}>
        <h2 style={sectionHeading}>Recent documents</h2>
        {recentDocs.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            No documents dated within this era.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {recentDocs.map((d) => (
              <li key={d.id} style={{ fontSize: '14px' }}>
                <Link href={`/documents/${d.id}`} style={{ color: 'var(--color-text)', textDecoration: 'none' }}>
                  {d.title}
                </Link>
                <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {d.year}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={sectionWrap}>
        <h2 style={sectionHeading}>Top-cited datasets</h2>
        {topDatasets.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            No datasets dated within this era.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {topDatasets.map((ds) => (
              <li key={ds.id} style={{ fontSize: '14px' }}>
                <Link href={`/datasets/${ds.id}`} style={{ color: 'var(--color-text)', textDecoration: 'none' }}>
                  {ds.title}
                </Link>
                <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {ds.year}
                  {(ds.citation_count ?? 0) > 0 && ` · ${(ds.citation_count ?? 0).toLocaleString()} cites`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={sectionWrap}>
        <h2 style={sectionHeading}>Recent stories</h2>
        {recentStories.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            No stories dated within this era.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {recentStories.map((s) => (
              <li key={s.id} style={{ fontSize: '14px' }}>
                <Link href={`/stories/${s.id}`} style={{ color: 'var(--color-text)', textDecoration: 'none' }}>
                  {s.title}
                </Link>
                <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {s.date?.slice(0, 10)}
                  {s.story_type && ` · ${s.story_type}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
