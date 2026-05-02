import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { fetchNeighborhood } from '../../lib/graph-data'
import { JsonLd, speciesJsonLd } from '../../lib/json-ld'
import LazyGraph from '../../components/LazyGraph'
import FlagButton from '../../components/FlagButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [s] } = await getDb().query('SELECT canonical_name, common_names, rank FROM species WHERE id = $1', [id])
  if (!s) return { title: 'Species — RMBL Knowledge Hub' }
  const common = s.common_names?.length ? ` (${s.common_names[0]})` : ''
  return {
    title: `${s.canonical_name}${common} — RMBL Knowledge Hub`,
    description: `${s.rank || 'Species'}: ${s.canonical_name}${common}. Research publications and knowledge graph from RMBL.`,
    openGraph: { title: `${s.canonical_name}${common}`, url: `https://rmblknowledgehub.org/species/${id}` },
  }
}

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

  // Get documents mentioning this species
  const { rows: docs } = await db.query(`
    SELECT d.id, d.title, d.document_type
    FROM entity_mentions em
    JOIN documents d ON d.id = em.item_id
    WHERE em.entity_type = 'species' AND em.entity_id = $1 AND em.collection = 'documents'
    ORDER BY d.title
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

  // Build external resource links — ordered: RMBL-local first, then broader databases
  const encodedName = encodeURIComponent(species.canonical_name)
  const isSpeciesRank = species.rank === 'species' || species.rank === 'subspecies'
  const specimenLinks: { label: string; url: string; description: string }[] = []

  // --- RMBL-local links first ---

  // RMBL Herbarium (plants/fungi only)
  if (species.kingdom === 'Plantae' || species.kingdom === 'Fungi') {
    specimenLinks.push({
      label: 'RMBL Collections',
      url: `https://soroherbaria.org/portal/collections/listtabledisplay.php?taxa=${encodedName}&usethes=1&taxontype=2&db[]=112`,
      description: 'RMBL Herbarium specimens in the Southern Rocky Mountain Herbaria',
    })
  }

  // RMBL Mammals (mammals only)
  if (species.kingdom === 'Animalia' && species.class_name === 'Mammalia') {
    specimenLinks.push({
      label: 'RMBL Collections',
      url: `https://cvcoll.org/portal/collections/list.php?taxa=${encodedName}&usethes=1&taxontype=2&db[]=1024`,
      description: 'RMBL mammal skins, skulls, and skeletons',
    })
  }

  // RMBL Insects / Arthropods (via SCAN network)
  if (species.kingdom === 'Animalia' && (species.phylum === 'Arthropoda' || species.class_name === 'Insecta')) {
    specimenLinks.push({
      label: 'RMBL Collections',
      url: `https://scan-bugs.org/portal/collections/list.php?taxa=${encodedName}&usethes=1&taxontype=2`,
      description: 'RMBL insect specimens via SCAN Arthropod Network',
    })
  }

  // iNaturalist RMBL Biota project (all taxa at species rank)
  if (isSpeciesRank) {
    specimenLinks.push({
      label: 'iNaturalist',
      url: `https://www.inaturalist.org/observations?project_id=rmbl-biota&taxon_name=${encodedName}`,
      description: 'RMBL Biota project observations',
    })
  }

  // --- Broader databases ---

  // iDigBio (all taxa — aggregates specimens across all North American collections)
  if (isSpeciesRank) {
    specimenLinks.push({
      label: 'iDigBio',
      url: `https://portal.idigbio.org/portal/search?rq=${encodeURIComponent(JSON.stringify({ scientificname: species.canonical_name }))}`,
      description: 'Digitized specimens across North American collections',
    })
  }

  // NCBI / GenBank (all taxa — genomic resources)
  if (isSpeciesRank) {
    const parts = species.canonical_name.split(/\s+/)
    const genus = parts[0]
    // Search both genus-level and species-level: (Genus) OR "Genus species"
    const ncbiQuery = `(${genus}) OR "${species.canonical_name}"`
    specimenLinks.push({
      label: 'GenBank',
      url: `https://www.ncbi.nlm.nih.gov/search/all/?term=${encodeURIComponent(ncbiQuery)}`,
      description: 'NCBI genomic resources (sequences, genomes, proteins)',
    })
  }

  return (
    <div className="detail">
      <JsonLd data={speciesJsonLd(species)} />
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
            <strong>External:</strong>{' '}
            {specimenLinks.map((link, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.description}>{link.label}</a>
              </span>
            ))}
          </div>
        )}
        <div><strong>Papers:</strong> {species.publication_count} | <strong>Mentions:</strong> {species.mention_count}</div>
      </div>

      {species.description && (
        <div className="detail-section">
          <h2>Description</h2>
          <p>{species.description}</p>
        </div>
      )}

      {await (async () => {
        const neighborhood = await fetchNeighborhood('species', parseInt(id), 30)
        if (neighborhood.nodes.length <= 1) return null
        return (
          <div className="detail-section">
            <h2>Local Knowledge Graph ({neighborhood.nodes.length} entities)</h2>
            <LazyGraph
              nodes={neighborhood.nodes}
              edges={neighborhood.edges}
              focalId={neighborhood.focalId}
            />
          </div>
        )
      })()}

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

      <FlagButton collection="species" itemId={parseInt(id)} />
    </div>
  )
}
