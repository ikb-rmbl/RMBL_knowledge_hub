import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'

export const dynamic = 'force-dynamic'

export default async function SpeciesDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const { rows: [species] } = await db.query('SELECT * FROM species WHERE id = $1', [id])
  if (!species) notFound()

  // Get publications mentioning this species
  const { rows: pubs } = await db.query(`
    SELECT p.id, p.title, p.year, p.journal, p.publication_type, p.doi, em.role
    FROM entity_mentions em
    JOIN publications p ON p.id = em.item_id
    WHERE em.entity_type = 'species' AND em.entity_id = $1 AND em.collection = 'publications'
    ORDER BY p.year DESC NULLS LAST, p.title
  `, [id])

  // Get co-occurring species (shared papers)
  const { rows: coSpecies } = await db.query(`
    SELECT s.id, s.canonical_name, s.family, COUNT(*) as shared_papers
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.collection = em1.collection AND em2.item_id = em1.item_id
      AND em2.entity_type = 'species' AND em2.entity_id != $1
    JOIN species s ON s.id = em2.entity_id
    WHERE em1.entity_type = 'species' AND em1.entity_id = $1
    GROUP BY s.id, s.canonical_name, s.family
    ORDER BY shared_papers DESC
    LIMIT 10
  `, [id])

  const taxonomy = [species.kingdom, species.phylum, species.class_name, species.order_name, species.family].filter(Boolean)

  // Build specimen collection links based on taxonomy
  // Each link filters to RMBL specimens where possible (via db[]=collid or recordset filter)
  const encodedName = encodeURIComponent(species.canonical_name)
  const specimenLinks: { label: string; url: string; allUrl?: string; description: string }[] = []

  if (species.kingdom === 'Plantae' || species.kingdom === 'Fungi') {
    specimenLinks.push({
      label: 'RMBL Herbarium',
      // db[]=112 filters to RMBL herbarium collection in SORO portal
      url: `https://soroherbaria.org/portal/collections/listtabledisplay.php?taxa=${encodedName}&usethes=1&taxontype=2&db[]=112`,
      allUrl: `https://soroherbaria.org/portal/collections/listtabledisplay.php?taxa=${encodedName}&usethes=1&taxontype=2`,
      description: 'RMBL specimens in the Southern Rocky Mountain Herbaria',
    })
  }
  if (species.kingdom === 'Animalia' && species.class_name === 'Mammalia') {
    specimenLinks.push({
      label: 'RMBL Mammal Collection',
      // CVColl portal (not CSVColl) with db[]=1024 for RMBL mammals
      url: `https://cvcoll.org/portal/collections/list.php?taxa=${encodedName}&usethes=1&taxontype=2&db[]=1024`,
      allUrl: `https://cvcoll.org/portal/collections/list.php?taxa=${encodedName}&usethes=1&taxontype=2`,
      description: 'RMBL specimens in the Consortium of Small Vertebrate Collections',
    })
    // Also link to iDigBio which has broader mammal coverage
    specimenLinks.push({
      label: 'iDigBio Specimens',
      url: `https://portal.idigbio.org/portal/search?rq=${encodeURIComponent(JSON.stringify({ scientificname: species.canonical_name }))}`,
      description: 'All digitized specimens across North American collections',
    })
  }
  if (species.kingdom === 'Animalia' && (species.phylum === 'Arthropoda' || species.class_name === 'Insecta')) {
    specimenLinks.push({
      label: 'SCAN Arthropods',
      url: `https://scan-bugs.org/portal/collections/list.php?taxa=${encodedName}&usethes=1&taxontype=2`,
      description: 'Symbiota Collections of Arthropods Network',
    })
  }

  return (
    <div className="detail">
      <Link href="/species" className="detail-back">&larr; Back to Species</Link>

      <span className="badge badge-species">{species.rank}</span>
      <h1 style={{ fontStyle: 'italic' }}>{species.canonical_name}</h1>

      <div className="detail-meta">
        {species.common_names?.length > 0 && (
          <div><strong>Common names:</strong> {species.common_names.join(', ')}</div>
        )}
        {species.authority && (
          <div><strong>Authority:</strong> {species.authority}</div>
        )}
        {taxonomy.length > 0 && (
          <div><strong>Taxonomy:</strong> {taxonomy.join(' > ')}</div>
        )}
        {species.conservation_status && (
          <div><strong>IUCN Status:</strong> {species.conservation_status}</div>
        )}
        {species.native_to_rmbl && (
          <div><strong>Regional status:</strong> {species.native_to_rmbl}</div>
        )}
        {species.ecological_roles?.length > 0 && (
          <div><strong>Roles:</strong> {species.ecological_roles.join(', ')}</div>
        )}
        {species.external_ids?.itis && (
          <div>
            <strong>ITIS TSN:</strong>{' '}
            <a href={`https://www.itis.gov/servlet/SingleRpt/SingleRpt?search_topic=TSN&search_value=${species.external_ids.itis}`}
               target="_blank" rel="noopener noreferrer">
              {species.external_ids.itis}
            </a>
          </div>
        )}
        {species.synonyms?.length > 0 && (
          <div><strong>Synonyms:</strong> {species.synonyms.join(', ')}</div>
        )}
        {specimenLinks.length > 0 && (
          <div>
            <strong>Specimen collections:</strong>{' '}
            {specimenLinks.map((link, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                {link.allUrl && (
                  <> (<a href={link.allUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>all collections</a>)</>
                )}
              </span>
            ))}
          </div>
        )}
        <div><strong>Papers:</strong> {species.publication_count} | <strong>Mentions:</strong> {species.mention_count}</div>
      </div>

      {specimenLinks.length > 0 && (
        <div className="detail-actions">
          {specimenLinks.map((link, i) => (
            <a key={i} className="detail-action-secondary" href={link.url}
               target="_blank" rel="noopener noreferrer"
               title={link.description}>
              {link.label}
            </a>
          ))}
        </div>
      )}

      {species.description && (
        <div className="detail-section">
          <h2>Description</h2>
          <p>{species.description}</p>
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
                  {pub.role && <span>Role: {pub.role}</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {coSpecies.length > 0 && (
        <div className="detail-section">
          <h2>Co-occurring Species</h2>
          <div className="result-cards">
            {coSpecies.map((cs: any) => (
              <Link key={cs.id} href={`/species/${cs.id}`} className="result-card">
                <h3 className="result-card-title" style={{ fontStyle: 'italic' }}>{cs.canonical_name}</h3>
                <div className="result-card-meta">
                  {cs.family && <span>{cs.family}</span>}
                  <span>{cs.shared_papers} shared paper{cs.shared_papers > 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
