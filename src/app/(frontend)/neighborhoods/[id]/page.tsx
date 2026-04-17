import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { GRAPH_COLORS, ENTITY_TYPE_LABELS, ENTITY_SLUG_MAP, STAKEHOLDER_COLORS } from '../../lib/graph-colors'

export const dynamic = 'force-dynamic'

const BROWSE_MAP: Record<string, string> = {
  species: '/species', place: '/places', protocol: '/protocols', concept: '/concepts',
  author: '/authors', publication: '/search?type=publications', dataset: '/search?type=datasets',
  document: '/search?type=documents',
}

const TYPE_ORDER = ['species', 'concept', 'protocol', 'place', 'stakeholder', 'author', 'publication', 'document', 'dataset']
const INITIAL_SHOW = 10

function renderMeta(m: any, type: string): React.ReactNode {
  switch (type) {
    case 'species': {
      const common = Array.isArray(m.common_names) ? m.common_names.slice(0, 2).join(', ') : null
      const taxon = [m.family, m.order_name, m.kingdom].filter(Boolean).join(' \u00B7 ')
      return (
        <div className="result-card-meta">
          {common ? <span>{common}</span> : null}
          {taxon ? <span>{taxon}</span> : null}
          <span>{m.degree} paper{m.degree !== 1 ? 's' : ''}</span>
        </div>
      )
    }
    case 'concept':
      return (
        <div>
          {m.definition ? (
            <p className="result-card-snippet">
              {String(m.definition).slice(0, 150)}{String(m.definition).length > 150 ? '...' : ''}
            </p>
          ) : null}
          <div className="result-card-meta">
            {m.concept_type ? <span>{String(m.concept_type).replace(/_/g, ' ')}</span> : null}
            {m.scope ? <span>{String(m.scope).replace(/_/g, ' ')}</span> : null}
            <span>{m.degree} paper{m.degree !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )
    case 'protocol':
      return (
        <div>
          {m.description ? (
            <p className="result-card-snippet">
              {String(m.description).slice(0, 150)}{String(m.description).length > 150 ? '...' : ''}
            </p>
          ) : null}
          <div className="result-card-meta">
            {m.category ? <span>{String(m.category).replace(/_/g, ' ')}</span> : null}
            {m.standardized ? <span style={{ color: 'var(--color-accent)' }}>standardized</span> : null}
            <span>{m.degree} paper{m.degree !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )
    case 'place':
      return (
        <div className="result-card-meta">
          {m.place_type ? <span>{String(m.place_type).replace(/_/g, ' ')}</span> : null}
          {m.elevation_m ? <span>{m.elevation_m}m</span> : null}
          {m.lat && m.lon ? <span>{Number(m.lat).toFixed(3)}, {Number(m.lon).toFixed(3)}</span> : null}
          <span>{m.degree} paper{m.degree !== 1 ? 's' : ''}</span>
        </div>
      )
    case 'author':
      return (
        <div className="result-card-meta">
          {m.affiliation ? <span>{String(m.affiliation).length > 60 ? String(m.affiliation).slice(0, 60) + '...' : String(m.affiliation)}</span> : null}
          {m.orcid ? <span>ORCID: {String(m.orcid)}</span> : null}
          <span>{m.work_count || m.degree} work{(m.work_count || m.degree) !== 1 ? 's' : ''}</span>
        </div>
      )
    case 'publication':
      return (
        <div className="result-card-meta">
          {m.year ? <span>{m.year}</span> : null}
          {m.journal ? <span>{String(m.journal)}</span> : null}
          {m.publication_type ? <span>{String(m.publication_type).replace(/_/g, ' ')}</span> : null}
        </div>
      )
    case 'dataset':
      return (
        <div>
          {m.description ? (
            <p className="result-card-snippet">
              {String(m.description).slice(0, 150)}{String(m.description).length > 150 ? '...' : ''}
            </p>
          ) : null}
          <div className="result-card-meta">
            {m.repository ? <span>{String(m.repository)}</span> : null}
            {m.publication_year ? <span>{m.publication_year}</span> : null}
          </div>
        </div>
      )
    case 'document':
      return (
        <div>
          {m.summary ? (
            <p className="result-card-snippet">
              {String(m.summary).replace(/^"|"$/g, '').slice(0, 150)}{String(m.summary).length > 150 ? '...' : ''}
            </p>
          ) : null}
          <div className="result-card-meta">
            {m.document_type ? <span>{String(m.document_type).replace(/_/g, ' ')}</span> : null}
            {m.date_year ? <span>{m.date_year}</span> : null}
          </div>
        </div>
      )
    case 'stakeholder':
      return (
        <div className="result-card-meta">
          {m.stakeholder_type ? (
            <span style={{
              padding: '1px 8px', borderRadius: '8px', fontSize: '11px',
              background: STAKEHOLDER_COLORS[m.stakeholder_type] || STAKEHOLDER_COLORS.other,
              color: '#fff',
            }}>
              {String(m.stakeholder_type).replace(/_/g, ' ')}
            </span>
          ) : null}
          <span>{m.document_count || 0} doc{(m.document_count || 0) !== 1 ? 's' : ''}</span>
          {(m.publication_count || 0) > 0 && <span>{m.publication_count} pub{m.publication_count !== 1 ? 's' : ''}</span>}
        </div>
      )
    default:
      return (
        <div className="result-card-meta">
          <span>{m.degree} paper{m.degree !== 1 ? 's' : ''}</span>
        </div>
      )
  }
}

function renderCard(m: any, type: string, slug: string) {
  const hasDetailPage = type !== 'stakeholder' // stakeholders have no /stakeholders/[id] page yet
  const content = (
    <>
      <h3 className="result-card-title" style={{
        fontStyle: type === 'species' ? 'italic' : undefined,
      }}>
        {m.label}
      </h3>
      {renderMeta(m, type)}
    </>
  )
  if (hasDetailPage) {
    return (
      <Link key={m.entity_id} href={`/${slug}/${m.entity_id}`} className="result-card">
        {content}
      </Link>
    )
  }
  return <div key={m.entity_id} className="result-card" style={{ cursor: 'default' }}>{content}</div>
}

export default async function NeighborhoodDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const { rows: [neighborhood] } = await db.query('SELECT * FROM neighborhoods WHERE id = $1', [id])
  if (!neighborhood) notFound()

  const typeCounts: Record<string, number> = neighborhood.type_counts || {}
  const themes: string[] = neighborhood.themes || []

  // Fetch enriched members per type with JOINs to source tables
  const [
    { rows: speciesMembers },
    { rows: conceptMembers },
    { rows: protocolMembers },
    { rows: placeMembers },
    { rows: authorMembers },
    { rows: pubMembers },
    { rows: datasetMembers },
    { rows: documentMembers },
    { rows: stakeholderMembers },
  ] = await Promise.all([
    db.query(`
      SELECT nm.entity_id, nm.label, nm.degree,
        s.common_names, s.family, s.order_name, s.kingdom, s.rank
      FROM neighborhood_members nm
      LEFT JOIN species s ON s.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'species'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, nm.label, nm.degree,
        c.definition, c.concept_type, c.scope
      FROM neighborhood_members nm
      LEFT JOIN concepts c ON c.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'concept'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, nm.label, nm.degree,
        p.category, p.description, p.standardized
      FROM neighborhood_members nm
      LEFT JOIN protocols p ON p.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'protocol'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, nm.label, nm.degree,
        pl.place_type, pl.scale, pl.elevation_m, pl.lat, pl.lon
      FROM neighborhood_members nm
      LEFT JOIN places pl ON pl.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'place'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, nm.label, nm.degree,
        a.orcid, a.affiliation, a.work_count
      FROM neighborhood_members nm
      LEFT JOIN authors a ON a.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'author'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, COALESCE(p.title, nm.label) as label, nm.degree,
        p.year, p.journal, p.publication_type, p.doi
      FROM neighborhood_members nm
      LEFT JOIN publications p ON p.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'publication'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, COALESCE(d.title, nm.label) as label, nm.degree,
        d.repository, d.publication_year, d.description
      FROM neighborhood_members nm
      LEFT JOIN datasets d ON d.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'dataset'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, COALESCE(d.title, nm.label) as label, nm.degree,
        d.document_type, d.summary::text as summary,
        EXTRACT(YEAR FROM d.date_original)::int as date_year
      FROM neighborhood_members nm
      LEFT JOIN documents d ON d.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'document'
      ORDER BY nm.degree DESC
    `, [id]),
    db.query(`
      SELECT nm.entity_id, COALESCE(s.name, nm.label) as label, nm.degree,
        s.stakeholder_type, s.document_count, s.publication_count
      FROM neighborhood_members nm
      LEFT JOIN stakeholders s ON s.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'stakeholder'
      ORDER BY nm.degree DESC
    `, [id]),
  ])

  const membersByType: Record<string, any[]> = {
    species: speciesMembers,
    concept: conceptMembers,
    protocol: protocolMembers,
    place: placeMembers,
    author: authorMembers,
    publication: pubMembers,
    dataset: datasetMembers,
    document: documentMembers,
    stakeholder: stakeholderMembers,
  }

  return (
    <div className="detail">
      <Link href="/neighborhoods" className="detail-back">&larr; Back to Neighborhoods</Link>

      <span className="badge" style={{ background: 'var(--color-accent)', color: '#fff' }}>{neighborhood.size} items</span>
      <h1>{neighborhood.title}</h1>

      {neighborhood.summary && (
        <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginTop: '8px' }}>
          {neighborhood.summary}
        </p>
      )}

      <div className="detail-meta">
        {Object.entries(typeCounts)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .map(([type, count]) => (
            <span key={type} style={{ marginRight: '12px' }}>
              <strong style={{ color: GRAPH_COLORS[type] || 'inherit' }}>{ENTITY_TYPE_LABELS[type] || type}:</strong> {String(count)}
            </span>
          ))}
      </div>

      {themes.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '16px 0' }}>
          {themes.map((t) => (
            <span key={t} style={{
              padding: '4px 12px', borderRadius: '12px', fontSize: '12px',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {TYPE_ORDER.map((type) => {
        const members = membersByType[type]
        if (!members || members.length === 0) return null
        const slug = ENTITY_SLUG_MAP[type] || type
        return (
          <div key={type} className="detail-section">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: GRAPH_COLORS[type] || '#999', display: 'inline-block',
              }} />
              {BROWSE_MAP[type] ? (
                <Link href={`${BROWSE_MAP[type]}${BROWSE_MAP[type].includes('?') ? '&' : '?'}neighborhood=${id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {ENTITY_TYPE_LABELS[type] || type} ({members.length}) &rarr;
                </Link>
              ) : (
                <span>{ENTITY_TYPE_LABELS[type] || type} ({members.length})</span>
              )}
            </h2>
            <div className="result-cards">
              {members.slice(0, INITIAL_SHOW).map((m: any) => renderCard(m, type, slug))}
            </div>
            {members.length > INITIAL_SHOW && (
              <details style={{ marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                  Show {members.length - INITIAL_SHOW} more {(ENTITY_TYPE_LABELS[type] || type).toLowerCase()}s
                </summary>
                <div className="result-cards" style={{ marginTop: '8px' }}>
                  {members.slice(INITIAL_SHOW).map((m: any) => renderCard(m, type, slug))}
                </div>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
