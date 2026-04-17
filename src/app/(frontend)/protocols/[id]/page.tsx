import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { fetchNeighborhood } from '../../lib/graph-data'
import LazyGraph from '../../components/LazyGraph'

export const dynamic = 'force-dynamic'

export default async function ProtocolDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const { rows: [protocol] } = await db.query('SELECT * FROM protocols WHERE id = $1', [id])
  if (!protocol) notFound()

  // Publications using this protocol
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type, em.role, em.metadata
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = 'protocol' AND em.entity_id = $1 AND em.collection = 'publications'
    ORDER BY p.year DESC NULLS LAST
  `, [id])

  // Documents mentioning this protocol
  const { rows: docs } = await db.query(`
    SELECT d.id, d.title, d.document_type
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = 'protocol' AND em.entity_id = $1 AND em.collection = 'documents'
    ORDER BY d.title
  `, [id])

  // Co-occurring species (studied with this protocol)
  const { rows: coSpecies } = await db.query(`
    SELECT s.id, s.canonical_name, s.family, COUNT(*) as shared
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = 'species'
    JOIN species s ON s.id = em2.entity_id
    WHERE em1.entity_type = 'protocol' AND em1.entity_id = $1
    GROUP BY s.id, s.canonical_name, s.family
    ORDER BY shared DESC LIMIT 10
  `, [id])

  // Co-occurring places
  const { rows: coPlaces } = await db.query(`
    SELECT pl.id, pl.name, pl.place_type, COUNT(*) as shared
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = 'place'
    JOIN places pl ON pl.id = em2.entity_id
    WHERE em1.entity_type = 'protocol' AND em1.entity_id = $1
    GROUP BY pl.id, pl.name, pl.place_type
    ORDER BY shared DESC LIMIT 10
  `, [id])

  return (
    <div className="detail">
      <Link href="/protocols" className="detail-back">&larr; Back to Protocols</Link>

      <span className="badge badge-protocol">{protocol.category || 'protocol'}</span>
      {protocol.standardized && <span className="badge" style={{ background: '#2e7d32', color: 'white', marginLeft: '8px' }}>standardized</span>}
      <h1>{protocol.name}</h1>

      <div className="detail-meta">
        {protocol.subcategory && <div><strong>Subcategory:</strong> {protocol.subcategory}</div>}
        {protocol.standard_reference && (
          <div><strong>Standard reference:</strong> {protocol.standard_reference}</div>
        )}
        {protocol.typical_duration && <div><strong>Typical duration:</strong> {protocol.typical_duration}</div>}
        {protocol.typical_frequency && <div><strong>Frequency:</strong> {protocol.typical_frequency}</div>}
        <div><strong>Papers:</strong> {protocol.publication_count} | <strong>Mentions:</strong> {protocol.mention_count}</div>
      </div>

      {await (async () => {
        const neighborhood = await fetchNeighborhood('protocol', parseInt(id), 30)
        if (neighborhood.nodes.length <= 1) return null
        return (
          <div className="detail-section">
            <h2>Local Knowledge Graph ({neighborhood.nodes.length} entities)</h2>
            <LazyGraph nodes={neighborhood.nodes} edges={neighborhood.edges} focalId={neighborhood.focalId} />
          </div>
        )
      })()}

      {protocol.description && (
        <div className="detail-section">
          <h2>Description</h2>
          <p>{protocol.description}</p>
        </div>
      )}

      {protocol.typical_equipment?.length > 0 && (
        <div className="detail-section">
          <h2>Typical Equipment</h2>
          <ul>
            {protocol.typical_equipment.map((eq: string, i: number) => <li key={i}>{eq}</li>)}
          </ul>
        </div>
      )}

      {protocol.output_measurements?.length > 0 && (
        <div className="detail-section">
          <h2>Output Measurements</h2>
          <ul>
            {protocol.output_measurements.map((om: string, i: number) => <li key={i}>{om}</li>)}
          </ul>
        </div>
      )}

      {pubs.length > 0 && (
        <div className="detail-section">
          <h2>Papers Using This Protocol ({pubs.length})</h2>
          <div className="result-cards">
            {pubs.map((pub: any) => (
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
        </div>
      )}

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

      {coSpecies.length > 0 && (
        <div className="detail-section">
          <h2>Species Studied With This Protocol</h2>
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

      {coPlaces.length > 0 && (
        <div className="detail-section">
          <h2>Places Where Used</h2>
          <div className="result-cards">
            {coPlaces.map((pl: any) => (
              <Link key={pl.id} href={`/places/${pl.id}`} className="result-card">
                <h3 className="result-card-title">{pl.name}</h3>
                <div className="result-card-meta">
                  <span>{(pl.place_type || '').replace(/_/g, ' ')}</span>
                  <span>{pl.shared} paper{pl.shared > 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
