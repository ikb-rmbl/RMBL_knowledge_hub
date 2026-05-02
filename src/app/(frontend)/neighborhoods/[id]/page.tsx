import Link from 'next/link'
import type { Metadata } from 'next'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { GRAPH_COLORS, ENTITY_TYPE_LABELS, ENTITY_SLUG_MAP, STAKEHOLDER_COLORS } from '../../lib/graph-colors'
import { JsonLd, neighborhoodJsonLd } from '../../lib/json-ld'
import ExploreEntityGraph from '../../components/ExploreEntityGraph'
import FlagButton from '../../components/FlagButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [n] } = await getDb().query('SELECT title, summary FROM neighborhoods WHERE id = $1', [id])
  if (!n) return { title: 'Neighborhood — RMBL Knowledge Hub' }
  const desc = n.summary ? String(n.summary).slice(0, 200) : `Research neighborhood in the RMBL Knowledge Hub`
  return {
    title: `${n.title} — RMBL Knowledge Hub`,
    description: desc,
    openGraph: { title: n.title, description: desc, url: `https://rmblknowledgehub.org/neighborhoods/${id}` },
  }
}

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
      <JsonLd data={neighborhoodJsonLd(neighborhood)} />
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
            <a key={type} href={`#section-${type}`} style={{ marginRight: '12px', textDecoration: 'none', color: 'inherit' }}>
              <strong style={{ color: GRAPH_COLORS[type] || 'inherit' }}>{ENTITY_TYPE_LABELS[type] || type}:</strong> {String(count)}
            </a>
          ))}
      </div>

      {(() => {
        const topByType = neighborhood.top_by_type || {}
        const topEntities = Object.values(topByType).flat() as any[]
        if (topEntities.length === 0 && themes.length === 0) return null
        return (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '16px 0' }}>
            {topEntities.filter((e: any) => e.slug).map((e: any) => (
              <Link key={e.id} href={e.slug} style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '12px', textDecoration: 'none',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: GRAPH_COLORS[e.type] || 'inherit',
                fontStyle: e.type === 'species' ? 'italic' : undefined,
              }}>
                {e.name}
              </Link>
            ))}
          </div>
        )
      })()}

      {/* Local neighborhood graph — pre-computed by layout-neighborhoods.ts */}
      {(() => {
        try {
          const graphPath = join(process.cwd(), `public/graph/neighborhoods/${id}.json`)
          if (!existsSync(graphPath)) return null
          const graphData = JSON.parse(readFileSync(graphPath, 'utf-8'))
          if (!graphData.nodes || graphData.nodes.length < 3) return null

          return (
            <div className="detail-section">
              <h2>Knowledge Graph ({graphData.meta.nodeCount} nodes, {graphData.meta.edgeCount} connections)</h2>
              <ExploreEntityGraph data={graphData} detailSlug="" />
            </div>
          )
        } catch { return null }
      })()}

      {neighborhood.primer && (
        <div className="detail-section">
          <h2>Research Primer</h2>
          <PrimerRenderer text={neighborhood.primer} />
        </div>
      )}

      {TYPE_ORDER.map((type) => {
        const members = membersByType[type]
        if (!members || members.length === 0) return null
        const slug = ENTITY_SLUG_MAP[type] || type
        return (
          <div key={type} id={`section-${type}`} className="detail-section">
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

      <FlagButton collection="neighborhoods" itemId={parseInt(id)} />
    </div>
  )
}

const PRIMER_HEADERS = new Set([
  'background', 'foundational work', 'key findings', 'current frontier', 'open questions', 'references',
  'historical context', 'management actions and stakeholder roles', 'current challenges and future directions',
  'connections to research',
])

function PrimerRenderer({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let currentParagraph: string[] = []
  let inReferences = false
  const referenceLines: string[] = []

  function flushParagraph() {
    if (currentParagraph.length === 0) return
    const content = currentParagraph.join(' ')
    elements.push(
      <p key={elements.length} style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', margin: '0 0 12px', maxWidth: '68ch' }}>
        {renderInlineLinks(content)}
      </p>,
    )
    currentParagraph = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      continue
    }
    // Strip markdown header prefixes (## Background → Background)
    const headerText = trimmed.replace(/^#{1,3}\s+/, '')
    if (PRIMER_HEADERS.has(headerText.toLowerCase())) {
      flushParagraph()
      inReferences = headerText.toLowerCase() === 'references'
      elements.push(
        <h3 key={elements.length} style={{
          fontFamily: 'var(--font-sans)', fontSize: '15px', fontWeight: 600,
          margin: '20px 0 8px', color: 'var(--fg-1)',
          ...(inReferences ? { borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '24px' } : {}),
        }}>
          {headerText}
        </h3>,
      )
      continue
    }
    // Skip standalone title lines (# Title at top of policy primers)
    if (/^#\s+/.test(trimmed) && elements.length === 0) continue
    if (inReferences) {
      flushParagraph()
      referenceLines.push(trimmed)
    } else {
      currentParagraph.push(trimmed)
    }
  }
  flushParagraph()

  // Sort references alphabetically by the visible text (author last name)
  if (referenceLines.length > 0) {
    const sortKey = (line: string) => {
      // Strip leading parens like "(2021)." to get to author name
      const cleaned = line.replace(/^\(\d{4}\)\.\s*/, '')
      return cleaned.toLowerCase()
    }
    referenceLines.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    for (const ref of referenceLines) {
      elements.push(
        <p key={elements.length} style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--fg-3)', margin: '0 0 6px', maxWidth: '68ch' }}>
          {renderReferenceEntry(ref)}
        </p>,
      )
    }
  }

  return <>{elements}</>
}

/** Convert [text](/publications/N) and [text](/documents/N) markdown links to <a> tags */
function renderInlineLinks(text: string): React.ReactNode {
  const parts = text.split(/(\[[^\]]+\]\(\/(?:publications|documents)\/\d+\))/g)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\((\/(?:publications|documents)\/\d+)\)$/)
    if (match) {
      const linkText = match[1]
      // Wrap author-year citations in parentheses: "Blumstein et al., 2025" → "(Blumstein et al., 2025)"
      const isCitation = /\d{4}$/.test(linkText)
      return <a key={i} href={match[2]} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{isCitation ? `(${linkText})` : linkText}</a>
    }
    return part
  })
}

/** Render a reference entry: strip the trailing citation link and replace with arrow */
function renderReferenceEntry(text: string): React.ReactNode {
  // Match trailing [Author et al., Year](/publications/N) or [title](/documents/N)
  const linkMatch = text.match(/\[([^\]]+)\]\((\/(?:publications|documents)\/\d+)\)\s*$/)
  if (!linkMatch) return text

  // Strip the link from the text to get the reference body
  let body = text.slice(0, linkMatch.index).trim()
  const href = linkMatch[2]

  // Extract author from link text for repairs: "Author et al., Year" → "Author et al."
  const authorYear = linkMatch[1]
  const authorOnly = authorYear.replace(/,\s*\d{4}$/, '').trim()

  // Fix lines starting with (Year). — prepend author from link
  if (/^\(\d{4}\)\./.test(body)) {
    body = body.replace(/^\(\d{4}\)/, `${authorOnly} ${body.match(/^\(\d{4}\)/)?.[0]}`)
  }
  // Fix lines starting with "Anonymous" — replace with author from link
  if (/^Anonymous\b/i.test(body) && authorOnly && authorOnly !== 'Unknown') {
    body = body.replace(/^Anonymous/i, authorOnly)
  }

  return (
    <>
      {body}{' '}
      <a href={href} style={{ color: 'var(--accent)', textDecoration: 'none' }}>→</a>
    </>
  )
}
