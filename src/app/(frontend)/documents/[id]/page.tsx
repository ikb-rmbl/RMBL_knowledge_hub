import Link from 'next/link'
import type { Metadata } from 'next'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import { renderRelatedWorks } from '../../lib/related-works'
import { isHttpUrl } from '../../lib/url-validation'
import { getDb } from '../../lib/db'
import { STAKEHOLDER_COLORS } from '../../lib/graph-colors'
import { fetchItemNetwork } from '../../lib/graph-data'
import ViewInGlobalGraphLink from '../../components/ViewInGlobalGraphLink'
import LazyGraph from '../../components/LazyGraph'
import FlagButton from '../../components/FlagButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [d] } = await getDb().query("SELECT title, summary::text as summary, document_type FROM documents WHERE id = $1", [id])
  if (!d) return { title: 'Document — RMBL Knowledge Fabric' }
  const desc = d.summary ? String(d.summary).slice(0, 200) : `${(d.document_type || 'Document').replace(/_/g, ' ')} from the RMBL Knowledge Fabric`
  return {
    title: `${d.title} — RMBL Knowledge Fabric`,
    description: desc,
    openGraph: { title: d.title, description: desc, url: `https://rmblknowledgefabric.org/documents/${id}` },
  }
}

const DOC_TYPE_LABELS: Record<string, string> = {
  technical_report: 'Technical Report',
  correspondence: 'Correspondence',
  news_article: 'News Article',
  environmental_assessment: 'Environmental Assessment',
  management_plan: 'Management Plan',
  legislation: 'Legislation',
  county_plan: 'County Plan',
  water_report: 'Water Report',
  recreation_study: 'Recreation Study',
  land_use_plan: 'Land Use Plan',
  wildlife_survey: 'Wildlife Survey',
  mining_permit: 'Mining Permit',
  other: 'Document',
}

const INITIAL_SHOW = 8

export default async function DocumentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })
  const db = getDb()

  let doc
  try {
    doc = await payload.findByID({ collection: 'documents', id })
  } catch {
    notFound()
  }

  const docId = parseInt(id)

  const categories = Array.isArray(doc.categories)
    ? doc.categories.map((c: any) => (typeof c === 'object' ? c.name : c))
    : []

  const geoScope = Array.isArray(doc.geographicScope)
    ? doc.geographicScope.map((g: string) => g.replace(/_/g, ' '))
    : []

  // Fetch extracted entities
  const [
    { rows: places },
    { rows: concepts },
    { rows: species },
    { rows: protocols },
    { rows: stakeholders },
    { rows: references },
  ] = await Promise.all([
    db.query(`
      SELECT p.id, p.name, p.place_type, p.elevation_m, p.lat, p.lon
      FROM entity_mentions em JOIN places p ON p.id = em.entity_id
      WHERE em.entity_type = 'place' AND em.collection = 'documents' AND em.item_id = $1
      ORDER BY p.publication_count DESC NULLS LAST
    `, [docId]),
    db.query(`
      SELECT c.id, c.name, c.concept_type, c.scope
      FROM entity_mentions em JOIN concepts c ON c.id = em.entity_id
      WHERE em.entity_type = 'concept' AND em.collection = 'documents' AND em.item_id = $1
      ORDER BY c.publication_count DESC NULLS LAST
    `, [docId]),
    db.query(`
      SELECT s.id, s.canonical_name, s.common_names, s.family
      FROM entity_mentions em JOIN species s ON s.id = em.entity_id
      WHERE em.entity_type = 'species' AND em.collection = 'documents' AND em.item_id = $1
      ORDER BY s.publication_count DESC NULLS LAST
    `, [docId]),
    db.query(`
      SELECT p.id, p.name, p.category
      FROM entity_mentions em JOIN protocols p ON p.id = em.entity_id
      WHERE em.entity_type = 'protocol' AND em.collection = 'documents' AND em.item_id = $1
      ORDER BY p.publication_count DESC NULLS LAST
    `, [docId]),
    db.query(`
      SELECT s.id, s.name, s.stakeholder_type, s.document_count
      FROM entity_mentions em JOIN stakeholders s ON s.id = em.entity_id
      WHERE em.entity_type = 'stakeholder' AND em.collection = 'documents' AND em.item_id = $1
      ORDER BY s.document_count DESC NULLS LAST
    `, [docId]),
    db.query(`
      SELECT cited_title, cited_authors, cited_year, cited_doi, raw_citation, reference_category
      FROM references_cited
      WHERE source_document_id = $1
      ORDER BY reference_category NULLS LAST, cited_year DESC NULLS LAST
    `, [docId]),
  ])

  // Group references by category
  const refsByCategory = new Map<string, any[]>()
  for (const r of references) {
    const cat = r.reference_category || 'other'
    if (!refsByCategory.has(cat)) refsByCategory.set(cat, [])
    refsByCategory.get(cat)!.push(r)
  }

  const docAny = doc as any
  const docTypeLabel = docAny.documentType
    ? (DOC_TYPE_LABELS[docAny.documentType as string] || String(docAny.documentType).replace(/_/g, ' '))
    : 'Document'

  // Build date string
  let dateStr = ''
  if (doc.dateOriginal) dateStr = (doc.dateOriginal as string).slice(0, 10)
  else if (docAny.dateRangeStart || docAny.dateRangeEnd) {
    const startY = docAny.dateRangeStart ? String(docAny.dateRangeStart).slice(0, 4) : null
    const endY = docAny.dateRangeEnd ? String(docAny.dateRangeEnd).slice(0, 4) : null
    if (startY && endY && startY !== endY) dateStr = `${startY}–${endY}`
    else dateStr = startY || endY || ''
  }

  return (
    <div className="detail">
      <Link href="/search?type=documents" className="detail-back">
        &larr; Back to Documents
      </Link>

      <span className="badge badge-document">{docTypeLabel}</span>
      <h1>{doc.title}</h1>
      <FlagButton collection="documents" itemId={parseInt(id)} />

      <div className="detail-meta">
        {dateStr && <div><strong>Date:</strong> {dateStr}</div>}
        {categories.length > 0 && (
          <div>
            <strong>Categories:</strong>{' '}
            {categories.map((c: string, i: number) => (
              <span key={i}>
                {i > 0 && ', '}
                <Link href={`/search?topic=${encodeURIComponent(c)}`}>{c}</Link>
              </span>
            ))}
          </div>
        )}
        {geoScope.length > 0 && <div><strong>Geographic scope:</strong> {geoScope.join(', ')}</div>}
        {doc.sourceUrl && <div><strong>Source:</strong> Sustainable Living Library</div>}
      </div>

      {doc.summary && (
        <div className="detail-section">
          <h2>Summary</h2>
          <p>{typeof doc.summary === 'string' ? doc.summary : 'See document for details.'}</p>
        </div>
      )}

      <div className="detail-actions">
        {!doc.pdfRestricted && isHttpUrl(doc.pdfLink as string) && (
          <a className="detail-action-primary" href={doc.pdfLink as string} target="_blank" rel="noopener noreferrer">View PDF</a>
        )}
        {isHttpUrl(doc.sourceUrl as string) && (
          <a className="detail-action-secondary" href={doc.sourceUrl as string} target="_blank" rel="noopener noreferrer">View on Source Site</a>
        )}
      </div>

      {/* Local Knowledge Graph */}
      {await (async () => {
        const network = await fetchItemNetwork('documents', docId, doc.title as string, 60)
        if (network.nodes.length <= 1) return null
        return (
          <div className="detail-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Local Knowledge Graph (Top {network.nodes.length} entities)</h2>
              <ViewInGlobalGraphLink globalNodeId={`document-${docId}`} />
            </div>
            <LazyGraph nodes={network.nodes} edges={network.edges} focalId={network.focalId} />
          </div>
        )
      })()}

      {/* Stakeholders */}
      {stakeholders.length > 0 && (
        <div className="detail-section">
          <h2>Stakeholders ({stakeholders.length})</h2>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
            Agencies, organizations, and groups mentioned as actors in this document.
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {stakeholders.slice(0, INITIAL_SHOW).map((s: any) => (
              <StakeholderChip key={s.id} s={s} />
            ))}
          </div>
          {stakeholders.length > INITIAL_SHOW && (
            <details style={{ marginTop: '8px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                Show {stakeholders.length - INITIAL_SHOW} more
              </summary>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                {stakeholders.slice(INITIAL_SHOW).map((s: any) => (
                  <StakeholderChip key={s.id} s={s} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Places */}
      {places.length > 0 && (
        <EntitySection title="Places" items={places} slug="places" labelKey="name" initialShow={INITIAL_SHOW} />
      )}

      {/* Concepts */}
      {concepts.length > 0 && (
        <EntitySection title="Concepts & Topics" items={concepts} slug="concepts" labelKey="name" initialShow={INITIAL_SHOW} />
      )}

      {/* Species */}
      {species.length > 0 && (
        <EntitySection title="Species" items={species} slug="species" labelKey="canonical_name" italic initialShow={INITIAL_SHOW} />
      )}

      {/* Protocols */}
      {protocols.length > 0 && (
        <EntitySection title="Protocols" items={protocols} slug="protocols" labelKey="name" initialShow={INITIAL_SHOW} />
      )}

      {/* External References Cited */}
      {references.length > 0 && (
        <div className="detail-section">
          <h2>External References Cited ({references.length})</h2>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
            Works cited by this document, grouped by type.
          </p>
          {[...refsByCategory.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([cat, refs]) => (
              <div key={cat} style={{ marginTop: '12px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 6px', color: 'var(--color-text-secondary)' }}>
                  {cat.replace(/_/g, ' ')} ({refs.length})
                </h3>
                <ul style={{ fontSize: '13px', lineHeight: 1.5, margin: 0, paddingLeft: '20px' }}>
                  {refs.slice(0, 5).map((r: any, i: number) => (
                    <li key={i}>
                      <span>{r.cited_title}</span>
                      {r.cited_year && <span style={{ color: 'var(--color-text-muted)' }}> ({r.cited_year})</span>}
                      {r.cited_authors && <span style={{ color: 'var(--color-text-muted)' }}> — {r.cited_authors}</span>}
                    </li>
                  ))}
                </ul>
                {refs.length > 5 && (
                  <details style={{ marginTop: '4px', paddingLeft: '20px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--color-accent)' }}>
                      Show {refs.length - 5} more {cat.replace(/_/g, ' ')}
                    </summary>
                    <ul style={{ fontSize: '13px', lineHeight: 1.5, margin: '6px 0 0', paddingLeft: 0 }}>
                      {refs.slice(5).map((r: any, i: number) => (
                        <li key={i}>
                          <span>{r.cited_title}</span>
                          {r.cited_year && <span style={{ color: 'var(--color-text-muted)' }}> ({r.cited_year})</span>}
                          {r.cited_authors && <span style={{ color: 'var(--color-text-muted)' }}> — {r.cited_authors}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
        </div>
      )}

      {await renderRelatedWorks('documents', docId)}
    </div>
  )

  function StakeholderChip({ s }: { s: any }) {
    const color = STAKEHOLDER_COLORS[s.stakeholder_type] || STAKEHOLDER_COLORS.other
    return (
      <span style={{
        padding: '4px 10px', borderRadius: '12px', fontSize: '12px',
        background: color, color: '#fff', whiteSpace: 'nowrap',
      }} title={`${s.stakeholder_type?.replace(/_/g, ' ') || 'other'} · mentioned in ${s.document_count} documents`}>
        {s.name}
      </span>
    )
  }
}

function EntitySection({ title, items, slug, labelKey, italic, initialShow }: {
  title: string
  items: any[]
  slug: string
  labelKey: string
  italic?: boolean
  initialShow: number
}) {
  return (
    <div className="detail-section">
      <h2>{title} ({items.length})</h2>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {items.slice(0, initialShow).map((item: any) => (
          <Link key={item.id} href={`/${slug}/${item.id}`}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              textDecoration: 'none', fontStyle: italic ? 'italic' : undefined,
            }}>
            {item[labelKey]}
          </Link>
        ))}
      </div>
      {items.length > initialShow && (
        <details style={{ marginTop: '8px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
            Show {items.length - initialShow} more
          </summary>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
            {items.slice(initialShow).map((item: any) => (
              <Link key={item.id} href={`/${slug}/${item.id}`}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  textDecoration: 'none', fontStyle: italic ? 'italic' : undefined,
                }}>
                {item[labelKey]}
              </Link>
            ))}
          </div>
        </details>
      )}


    </div>
  )
}
