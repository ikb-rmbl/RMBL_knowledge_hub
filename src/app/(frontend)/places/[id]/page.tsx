import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import FlagButton from '../../components/FlagButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [p] } = await getDb().query('SELECT name, place_type, elevation_m FROM places WHERE id = $1', [id])
  if (!p) return { title: 'Place — RMBL Knowledge Hub' }
  const details = [p.place_type?.replace(/_/g, ' '), p.elevation_m ? `${p.elevation_m}m` : null].filter(Boolean).join(', ')
  const desc = details ? `${p.name} (${details}) — geographic entity in the RMBL Knowledge Hub` : `${p.name} — geographic entity in the RMBL Knowledge Hub`
  return {
    title: `${p.name} — RMBL Knowledge Hub`,
    description: desc,
    openGraph: { title: p.name, description: desc, url: `https://rmblknowledgehub.org/places/${id}` },
  }
}

export default async function PlaceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const { rows: [place] } = await db.query('SELECT * FROM places WHERE id = $1', [id])
  if (!place) notFound()

  // Parent place
  let parentName: string | null = null
  if (place.parent_place_id) {
    const { rows: [parent] } = await db.query('SELECT name FROM places WHERE id = $1', [place.parent_place_id])
    parentName = parent?.name || null
  }

  // Child places
  const { rows: children } = await db.query(
    'SELECT id, name, place_type, elevation_m, publication_count FROM places WHERE parent_place_id = $1 ORDER BY name', [id],
  )

  // Publications mentioning this place
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type, em.role
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = 'place' AND em.entity_id = $1 AND em.collection = 'publications'
    ORDER BY p.year DESC NULLS LAST
  `, [id])

  // Datasets mentioning this place
  const { rows: datasets } = await db.query(`
    SELECT d.id, d.title, d.publication_year, d.resource_type, em.role
    FROM entity_mentions em
    JOIN datasets d ON d.id = em.item_id
    WHERE em.entity_type = 'place' AND em.entity_id = $1 AND em.collection = 'datasets'
    ORDER BY d.publication_year DESC NULLS LAST
  `, [id])

  // Documents mentioning this place
  const { rows: docs } = await db.query(`
    SELECT d.id, d.title, d.date_original, em.role
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = 'place' AND em.entity_id = $1 AND em.collection = 'documents'
    ORDER BY d.date_original DESC NULLS LAST
  `, [id])

  // Co-occurring species at this place
  const { rows: coSpecies } = await db.query(`
    SELECT s.id, s.canonical_name, s.family, COUNT(*) as shared
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = 'species'
    JOIN species s ON s.id = em2.entity_id
    WHERE em1.entity_type = 'place' AND em1.entity_id = $1
    GROUP BY s.id, s.canonical_name, s.family
    ORDER BY shared DESC LIMIT 10
  `, [id])

  return (
    <div className="detail">
      <Link href="/places" className="detail-back">&larr; Back to Places</Link>

      <span className="badge badge-place">{(place.place_type || 'place').replace(/_/g, ' ')}</span>
      <h1>{place.name}</h1>
      <FlagButton collection="places" itemId={parseInt(id)} />

      <div className="detail-meta">
        {parentName && (
          <div><strong>Part of:</strong> <Link href={`/places/${place.parent_place_id}`}>{parentName}</Link></div>
        )}
        {place.scale && <div><strong>Scale:</strong> {place.scale}</div>}
        {place.lat && place.lon && (
          <div><strong>Coordinates:</strong> {place.lat.toFixed(4)}, {place.lon.toFixed(4)}</div>
        )}
        {place.elevation_m && <div><strong>Elevation:</strong> {place.elevation_m}m</div>}
        {place.elevation_min_m && place.elevation_max_m && (
          <div><strong>Elevation range:</strong> {place.elevation_min_m}m – {place.elevation_max_m}m</div>
        )}
        {place.habitat_types?.length > 0 && (
          <div><strong>Habitat:</strong> {place.habitat_types.join(', ')}</div>
        )}
        {place.aliases?.length > 0 && (
          <div><strong>Also known as:</strong> {place.aliases.join(', ')}</div>
        )}
        {place.external_ids?.gnis && (
          <div><strong>GNIS Feature ID:</strong> {place.external_ids.gnis}</div>
        )}
        <div><strong>Papers:</strong> {place.publication_count} | <strong>Mentions:</strong> {place.mention_count}</div>
      </div>

      {place.lat && place.lon && (
        <div className="detail-section">
          <iframe
            title={`Map of ${place.name}`}
            width="100%"
            height="300"
            style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${place.lon - 0.05},${place.lat - 0.03},${place.lon + 0.05},${place.lat + 0.03}&layer=mapnik&marker=${place.lat},${place.lon}`}
          />
        </div>
      )}

      {place.description && (
        <div className="detail-section">
          <h2>Description</h2>
          <p>{place.description}</p>
        </div>
      )}

      {children.length > 0 && (
        <div className="detail-section">
          <h2>Child Places ({children.length})</h2>
          <div className="result-cards">
            {children.map((ch: any) => (
              <Link key={ch.id} href={`/places/${ch.id}`} className="result-card">
                <h3 className="result-card-title">{ch.name}</h3>
                <div className="result-card-meta">
                  <span>{(ch.place_type || '').replace(/_/g, ' ')}</span>
                  {ch.elevation_m && <span>{ch.elevation_m}m</span>}
                  {ch.publication_count > 0 && <span>{ch.publication_count} papers</span>}
                </div>
              </Link>
            ))}
          </div>
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
                  {pub.role && <span>{pub.role.replace(/_/g, ' ')}</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {datasets.length > 0 && (
        <div className="detail-section">
          <h2>Datasets ({datasets.length})</h2>
          <div className="result-cards">
            {datasets.map((ds: any) => (
              <Link key={ds.id} href={`/datasets/${ds.id}`} className="result-card">
                <div className="result-card-header">
                  <span className="badge badge-dataset">{ds.resource_type || 'Dataset'}</span>
                  <h3 className="result-card-title">{ds.title}</h3>
                </div>
                <div className="result-card-meta">
                  {ds.publication_year && <span>{ds.publication_year}</span>}
                  {ds.role && <span>{ds.role.replace(/_/g, ' ')}</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="detail-section">
          <h2>Documents ({docs.length})</h2>
          <div className="result-cards">
            {docs.map((doc: any) => {
              const yearStr = doc.date_original ? new Date(doc.date_original).getFullYear().toString() : null
              return (
                <Link key={doc.id} href={`/documents/${doc.id}`} className="result-card">
                  <div className="result-card-header">
                    <span className="badge badge-document">Document</span>
                    <h3 className="result-card-title">{doc.title}</h3>
                  </div>
                  <div className="result-card-meta">
                    {yearStr && <span>{yearStr}</span>}
                    {doc.role && <span>{doc.role.replace(/_/g, ' ')}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {coSpecies.length > 0 && (
        <div className="detail-section">
          <h2>Species Studied Here</h2>
          <div className="result-cards">
            {coSpecies.map((cs: any) => (
              <Link key={cs.id} href={`/species/${cs.id}`} className="result-card">
                <h3 className="result-card-title" style={{ fontStyle: 'italic' }}>{cs.canonical_name}</h3>
                <div className="result-card-meta">
                  {cs.family && <span>{cs.family}</span>}
                  <span>{cs.shared} shared paper{cs.shared > 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
