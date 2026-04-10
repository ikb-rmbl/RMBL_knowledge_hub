import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'

export const dynamic = 'force-dynamic'

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

      <div className="detail-meta">
        {concept.scope && <div><strong>Scope:</strong> {concept.scope.replace(/_/g, ' ')}</div>}
        {concept.aliases?.length > 0 && <div><strong>Also known as:</strong> {concept.aliases.join(', ')}</div>}
        {concept.canonical_reference && <div><strong>Key reference:</strong> {concept.canonical_reference}</div>}
        <div><strong>Papers:</strong> {concept.publication_count} | <strong>Mentions:</strong> {concept.mention_count}</div>
      </div>

      {concept.definition && (
        <div className="detail-section">
          <h2>Definition</h2>
          <p>{concept.definition}</p>
        </div>
      )}

      {pubs.length > 0 && (
        <div className="detail-section">
          <h2>Publications ({pubs.length})</h2>
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

      {coConcepts.length > 0 && (
        <div className="detail-section">
          <h2>Related Concepts</h2>
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
