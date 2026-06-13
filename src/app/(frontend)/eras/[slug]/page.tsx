import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import {
  getEra,
  getEraMemberCounts,
  getEraTopEntities,
  getEraTopPublications,
  getEraRecentDocuments,
  getEraTopDatasets,
  getEraRecentStories,
  isCenturyEra,
  RESEARCH_SOURCES,
  POLICY_SOURCES,
  type Era,
  type TopEntity,
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
        <h3 style={sectionHeading}>{title}</h3>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          No {type} mentions ranked as distinctive for this era.
        </p>
      </section>
    )
  }
  return (
    <section style={sectionWrap}>
      <h3 style={sectionHeading}>{title}</h3>
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

      {/* Synthesis placeholder — populated by Phase 3 era-primer generation */}
      <section style={sectionWrap}>
        <h3 style={sectionHeading}>Synthesis</h3>
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
          A grounded primer describing what was happening in the {era.name} —
          drawing on the distinctive concepts, species, and content below —
          will appear here when the era-primer pipeline ships. Today’s view is
          the raw evidence the synthesis will draw from.
        </div>
      </section>

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
        <h3 style={sectionHeading}>Most-cited publications</h3>
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
        <h3 style={sectionHeading}>Recent documents</h3>
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
        <h3 style={sectionHeading}>Top-cited datasets</h3>
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
        <h3 style={sectionHeading}>Recent stories</h3>
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
