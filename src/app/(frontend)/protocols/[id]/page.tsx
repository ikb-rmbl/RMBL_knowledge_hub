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
  const { rows: [p] } = await getDb().query('SELECT name, description, category FROM protocols WHERE id = $1', [id])
  if (!p) return { title: 'Protocol — RMBL Knowledge Fabric' }
  const desc = p.description ? String(p.description).slice(0, 200) : `${(p.category || 'Research protocol').replace(/_/g, ' ')} in the RMBL Knowledge Fabric`
  return {
    title: `${p.name} — RMBL Knowledge Fabric`,
    description: desc,
    openGraph: { title: p.name, description: desc, url: `https://rmblknowledgefabric.org/protocols/${id}` },
  }
}

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

  // Two complementary signals for the protocol's procedural detail:
  //  1. Canonical-source paper: the earliest paper with role='introducing'.
  //     This is the *citation* anchor — methods are typically named for the
  //     paper that introduced them, regardless of where they're currently used.
  //  2. Display paper: the *most recent peer-reviewed* paper that has loaded
  //     protocol steps for this protocol. Methods evolve; we want the displayed
  //     procedure to reflect current practice. "Peer-reviewed" excludes
  //     student_papers in this corpus.
  type CanonicalPaperRef = {
    id: number; title: string; year: number | null; journal: string | null; publication_type: string | null
  }
  type CanonicalStep = {
    step_index: number; action: string | null; details: string | null;
    quantities: string | null; duration: string | null; conditions: string | null;
    equipment: string[]
  }

  // (1) Earliest introducing-role paper — for the citation pointer
  const { rows: introducingRows } = await db.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = 'protocol' AND em.entity_id = $1
      AND em.collection = 'publications' AND em.role = 'introducing'
    ORDER BY p.year ASC NULLS LAST, em.id ASC
    LIMIT 1
  `, [id])
  const introducingPaper: CanonicalPaperRef | null = introducingRows[0] || null

  // (2) Most recent peer-reviewed paper with loaded steps — for the displayed procedure
  const { rows: displayCandidates } = await db.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type,
           em.metadata->'protocolStepIndices' AS step_indices_json
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = 'protocol' AND em.entity_id = $1
      AND em.collection = 'publications'
      AND p.publication_type IN ('article', 'thesis', 'chapter', 'book')
      AND em.metadata->'protocolStepIndices' IS NOT NULL
      AND EXISTS (SELECT 1 FROM publication_protocol_steps pps WHERE pps.publication_id = p.id)
    ORDER BY p.year DESC NULLS LAST,
             jsonb_array_length(em.metadata->'protocolStepIndices') DESC,
             em.id ASC
    LIMIT 1
  `, [id])
  let displayedProcedure: {
    paper: CanonicalPaperRef
    steps: CanonicalStep[]
  } | null = null
  if (displayCandidates.length > 0) {
    const c = displayCandidates[0]
    // node-postgres usually parses jsonb natively; defensive parse just in case
    let indices: number[] = []
    if (Array.isArray(c.step_indices_json)) {
      indices = c.step_indices_json.filter((n: any) => typeof n === 'number')
    } else if (typeof c.step_indices_json === 'string') {
      try { const parsed = JSON.parse(c.step_indices_json); if (Array.isArray(parsed)) indices = parsed.filter((n: any) => typeof n === 'number') } catch {}
    }
    if (indices.length > 0) {
      const { rows: stepRows } = await db.query(`
        SELECT step_index, action, details, quantities, duration, conditions, equipment
        FROM publication_protocol_steps
        WHERE publication_id = $1 AND step_index = ANY($2)
        ORDER BY step_index ASC
      `, [c.id, indices])
      if (stepRows.length > 0) {
        displayedProcedure = {
          paper: { id: c.id, title: c.title, year: c.year, journal: c.journal, publication_type: c.publication_type },
          steps: stepRows as CanonicalStep[],
        }
      }
    }
  }

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
      <FlagButton collection="protocols" itemId={parseInt(id)} />

      <div className="detail-meta">
        {protocol.subcategory && <div><strong>Subcategory:</strong> {protocol.subcategory}</div>}
        {protocol.typical_duration && <div><strong>Typical duration:</strong> {protocol.typical_duration}</div>}
        {protocol.typical_frequency && <div><strong>Frequency:</strong> {protocol.typical_frequency}</div>}
        <div><strong>Papers:</strong> {protocol.publication_count} | <strong>Mentions:</strong> {protocol.mention_count}</div>
      </div>


      {await (async () => {
        const neighborhood = await fetchNeighborhood('protocol', parseInt(id), 60)
        if (neighborhood.nodes.length <= 1) return null
        return (
          <div className="detail-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Local Knowledge Graph (Top {neighborhood.nodes.length} entities)</h2>
              <ViewInGlobalGraphLink globalNodeId={`protocol-${id}`} />
            </div>
            <LazyGraph nodes={neighborhood.nodes} edges={neighborhood.edges} focalId={neighborhood.focalId} />
          </div>
        )
      })()}

      {protocol.description && (
        <div className="detail-section">
          <h2>Method synopsis</h2>
          <p style={{ fontSize: '15px', lineHeight: 1.6 }}>{protocol.description}</p>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px', fontStyle: 'italic' }}>
            Synthesized from method descriptions across {protocol.publication_count} paper
            {protocol.publication_count !== 1 ? 's' : ''} using this protocol.
          </p>
        </div>
      )}

      {displayedProcedure && (() => {
        const dp = displayedProcedure!
        const sameAsIntroducing = introducingPaper && introducingPaper.id === dp.paper.id
        const heading = sameAsIntroducing
          ? 'Procedure as described in the canonical source'
          : 'Procedure from a recent peer-reviewed implementation'
        return (
          <div className="detail-section">
            <h2>{heading}</h2>
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
              {sameAsIntroducing ? (
                <>
                  Steps below were extracted from the paper that introduces this protocol —{' '}
                  <Link href={`/publications/${dp.paper.id}`} style={{ color: 'var(--color-accent)', fontWeight: 500 }}>
                    {dp.paper.title}
                  </Link>
                  {dp.paper.year ? ` (${dp.paper.year})` : ''}
                  {dp.paper.journal ? `, ${dp.paper.journal}` : ''}.
                </>
              ) : (
                <>
                  Steps below were extracted from the most recent peer-reviewed implementation of this
                  protocol in the corpus —{' '}
                  <Link href={`/publications/${dp.paper.id}`} style={{ color: 'var(--color-accent)', fontWeight: 500 }}>
                    {dp.paper.title}
                  </Link>
                  {dp.paper.year ? ` (${dp.paper.year})` : ''}
                  {dp.paper.journal ? `, ${dp.paper.journal}` : ''}
                  {introducingPaper && (
                    <>
                      . The protocol was originally introduced by{' '}
                      <Link href={`/publications/${introducingPaper.id}`} style={{ color: 'var(--color-accent)', fontWeight: 500 }}>
                        {introducingPaper.title}
                      </Link>
                      {introducingPaper.year ? ` (${introducingPaper.year})` : ''}
                      {introducingPaper.journal ? `, ${introducingPaper.journal}` : ''}
                    </>
                  )}
                  .
                </>
              )}
              {' '}Implementations in other papers (listed below) may differ.
            </p>
            <ol style={{ paddingLeft: '20px', margin: 0 }}>
              {dp.steps.map((s) => (
                <li key={s.step_index} style={{ marginBottom: '16px', lineHeight: 1.55 }}>
                  {s.action && <div style={{ fontWeight: 600, fontSize: '15px' }}>{s.action}</div>}
                  {s.details && <div style={{ fontSize: '14px', marginTop: '4px' }}>{s.details}</div>}
                  {(s.quantities || s.duration || s.conditions) && (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                      {s.quantities && <span><strong style={{ color: 'var(--color-text-secondary)' }}>Quantities:</strong> {s.quantities}</span>}
                      {s.duration && <span><strong style={{ color: 'var(--color-text-secondary)' }}>Duration:</strong> {s.duration}</span>}
                      {s.conditions && <span><strong style={{ color: 'var(--color-text-secondary)' }}>Conditions:</strong> {s.conditions}</span>}
                    </div>
                  )}
                  {s.equipment && s.equipment.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                      <strong style={{ color: 'var(--color-text-secondary)' }}>Equipment:</strong>{' '}
                      {s.equipment.join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )
      })()}

      {protocol.prerequisites?.length > 0 && (
        <div className="detail-section">
          <h2>Prerequisites</h2>
          <ul>
            {protocol.prerequisites.map((pr: string, i: number) => <li key={i}>{pr}</li>)}
          </ul>
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

