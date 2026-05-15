import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { fetchNeighborhood } from '../../lib/graph-data'
import ViewInGlobalGraphLink from '../../components/ViewInGlobalGraphLink'
import LazyGraph from '../../components/LazyGraph'
import FlagButton from '../../components/FlagButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [c] } = await getDb().query('SELECT name, definition, concept_type FROM concepts WHERE id = $1', [id])
  if (!c) return { title: 'Concept — RMBL Knowledge Fabric' }
  const desc = c.definition ? String(c.definition).slice(0, 200) : `${(c.concept_type || 'Scientific concept').replace(/_/g, ' ')} in the RMBL Knowledge Fabric`
  return {
    title: `${c.name} — RMBL Knowledge Fabric`,
    description: desc,
    openGraph: { title: c.name, description: desc, url: `https://rmblknowledgefabric.org/concepts/${id}` },
  }
}

export default async function ConceptDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const { rows: [concept] } = await db.query('SELECT * FROM concepts WHERE id = $1', [id])
  if (!concept) notFound()

  // Publications engaging with this concept
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type, em.role
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = 'concept' AND em.entity_id = $1 AND em.collection = 'publications'
    ORDER BY p.year DESC NULLS LAST
  `, [id])

  // Documents engaging with this concept
  const { rows: docs } = await db.query(`
    SELECT d.id, d.title, d.document_type
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = 'concept' AND em.entity_id = $1 AND em.collection = 'documents'
    ORDER BY d.title
  `, [id])

  // Co-occurring concepts
  const { rows: coConcepts } = await db.query(`
    SELECT c.id, c.name, c.concept_type, COUNT(*) as shared
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = 'concept' AND em2.entity_id != $1
    JOIN concepts c ON c.id = em2.entity_id
    WHERE em1.entity_type = 'concept' AND em1.entity_id = $1
    GROUP BY c.id, c.name, c.concept_type
    ORDER BY shared DESC LIMIT 10
  `, [id])

  // Co-occurring species
  const { rows: coSpecies } = await db.query(`
    SELECT s.id, s.canonical_name, s.family, COUNT(*) as shared
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = 'species'
    JOIN species s ON s.id = em2.entity_id
    WHERE em1.entity_type = 'concept' AND em1.entity_id = $1
    GROUP BY s.id, s.canonical_name, s.family
    ORDER BY shared DESC LIMIT 10
  `, [id])

  return (
    <div className="detail">
      <Link href="/concepts" className="detail-back">&larr; Back to Concepts</Link>

      <span className="badge badge-concept">{(concept.concept_type || 'concept').replace(/_/g, ' ')}</span>
      <h1>{concept.name}</h1>
      <FlagButton collection="concepts" itemId={parseInt(id)} />

      <div className="detail-meta">
        {concept.scope && <div><strong>Scope:</strong> {concept.scope.replace(/_/g, ' ')}</div>}
        {concept.disciplines?.length > 0 && <div><strong>Disciplines:</strong> {concept.disciplines.map((d: string) => d.replace(/_/g, ' ')).join(', ')}</div>}
        {concept.canonical_reference && <div><strong>Key reference:</strong> {concept.canonical_reference}</div>}
        <div><strong>Papers:</strong> {concept.publication_count} | <strong>Mentions:</strong> {concept.mention_count}</div>
      </div>

      {await (async () => {
        const neighborhood = await fetchNeighborhood('concept', parseInt(id), 60)
        if (neighborhood.nodes.length <= 1) return null
        return (
          <div className="detail-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Local Knowledge Graph (Top {neighborhood.nodes.length} entities)</h2>
              <ViewInGlobalGraphLink globalNodeId={`concept-${id}`} />
            </div>
            <LazyGraph nodes={neighborhood.nodes} edges={neighborhood.edges} focalId={neighborhood.focalId} />
          </div>
        )
      })()}

      {concept.definition && (
        <div className="detail-section">
          <h2>Definition</h2>
          <p>{concept.definition}</p>
        </div>
      )}

      {concept.aliases?.length > 0 && (
        <div className="detail-section">
          <h2>Related Terms ({concept.aliases.length})</h2>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {concept.aliases.slice(0, 10).map((alias: string) => (
              <span key={alias} style={{ padding: '4px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>{alias}</span>
            ))}
          </div>
          {concept.aliases.length > 10 && (
            <details style={{ marginTop: '8px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                Show {concept.aliases.length - 10} more
              </summary>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                {concept.aliases.slice(10).map((alias: string) => (
                  <span key={alias} style={{ padding: '4px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>{alias}</span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {pubs.length > 0 && (() => {
        const INITIAL = 10
        return (
          <div className="detail-section">
            <h2>Publications ({pubs.length})</h2>
            <div className="result-cards">
              {pubs.slice(0, INITIAL).map((pub: any) => (
                <Link key={pub.id} href={`/publications/${pub.id}`} className="result-card">
                  <div className="result-card-header">
                    <span className="badge badge-publication">{pub.publication_type || 'Article'}</span>
                    <h3 className="result-card-title">{pub.title}</h3>
                  </div>
                  <div className="result-card-meta">
                    {pub.year && <span>{pub.year}</span>}
                    {pub.journal && <span>{pub.journal}</span>}
                    {pub.role && <span>{pub.role}</span>}
                  </div>
                </Link>
              ))}
            </div>
            {pubs.length > INITIAL && (
              <details style={{ marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                  Show {pubs.length - INITIAL} more publications
                </summary>
                <div className="result-cards" style={{ marginTop: '8px' }}>
                  {pubs.slice(INITIAL).map((pub: any) => (
                    <Link key={pub.id} href={`/publications/${pub.id}`} className="result-card">
                      <div className="result-card-header">
                        <span className="badge badge-publication">{pub.publication_type || 'Article'}</span>
                        <h3 className="result-card-title">{pub.title}</h3>
                      </div>
                      <div className="result-card-meta">
                        {pub.year && <span>{pub.year}</span>}
                        {pub.journal && <span>{pub.journal}</span>}
                        {pub.role && <span>{pub.role}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })()}

      {docs.length > 0 && (() => {
        const INITIAL = 10
        return (
          <div className="detail-section">
            <h2>Documents ({docs.length})</h2>
            <div className="result-cards">
              {docs.slice(0, INITIAL).map((doc: any) => (
                <Link key={doc.id} href={`/documents/${doc.id}`} className="result-card">
                  <div className="result-card-header">
                    <span className="badge badge-document">{doc.document_type ? doc.document_type.replace(/_/g, ' ') : 'Document'}</span>
                    <h3 className="result-card-title">{doc.title}</h3>
                  </div>
                </Link>
              ))}
            </div>
            {docs.length > INITIAL && (
              <details style={{ marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>Show {docs.length - INITIAL} more documents</summary>
                <div className="result-cards" style={{ marginTop: '8px' }}>
                  {docs.slice(INITIAL).map((doc: any) => (
                    <Link key={doc.id} href={`/documents/${doc.id}`} className="result-card">
                      <div className="result-card-header">
                        <span className="badge badge-document">{doc.document_type ? doc.document_type.replace(/_/g, ' ') : 'Document'}</span>
                        <h3 className="result-card-title">{doc.title}</h3>
                      </div>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })()}

      {coConcepts.length > 0 && (
        <div className="detail-section">
          <h2>Related Concepts ({coConcepts.length})</h2>
          <div className="result-cards">
            {coConcepts.map((cc: any) => (
              <Link key={cc.id} href={`/concepts/${cc.id}`} className="result-card">
                <h3 className="result-card-title">{cc.name}</h3>
                <div className="result-card-meta">
                  {cc.concept_type && <span>{cc.concept_type.replace(/_/g, ' ')}</span>}
                  <span>{cc.shared} shared paper{cc.shared > 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {coSpecies.length > 0 && (
        <div className="detail-section">
          <h2>Frequently Associated Species</h2>
          <div className="result-cards">
            {coSpecies.map((cs: any) => (
              <Link key={cs.id} href={`/species/${cs.id}`} className="result-card">
                <h3 className="result-card-title" style={{ fontStyle: 'italic' }}>{cs.canonical_name}</h3>
                <div className="result-card-meta">
                  {cs.family && <span>{cs.family}</span>}
                  <span>{cs.shared} paper{cs.shared > 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
