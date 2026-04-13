import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import { renderRelatedWorks } from '../../lib/related-works'
import { getDb } from '../../lib/db'
import { isHttpUrl, isValidOrcid, isValidDoi } from '../../lib/url-validation'

export const dynamic = 'force-dynamic'

export default async function PublicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })

  let pub
  try {
    pub = await payload.findByID({ collection: 'publications', id })
  } catch {
    notFound()
  }

  const authorList = Array.isArray(pub.authors) ? pub.authors : []

  // Look up linked author records for each author
  const authorLinks: { name: string; id: string | null; orcid?: string }[] = []
  for (const a of authorList as any[]) {
    const display = `${a.family}${a.given ? ', ' + a.given : ''}`
    if (a.family) {
      const match = await payload.find({
        collection: 'authors',
        where: { familyName: { equals: a.family } },
        limit: 5,
        depth: 0,
      })
      // Find best match by given name initial
      const initial = a.given?.charAt(0)?.toUpperCase()
      const linked = match.docs.find((m: any) =>
        !initial || m.givenName?.charAt(0)?.toUpperCase() === initial,
      )
      authorLinks.push({
        name: display,
        id: linked ? String(linked.id) : null,
        orcid: (a.orcid || linked?.orcid) as string | undefined,
      })
    } else {
      authorLinks.push({ name: display, id: null })
    }
  }

  const editors = Array.isArray(pub.editors) && pub.editors.length > 0
    ? pub.editors.map((e: any) => `${e.family}${e.given ? ', ' + e.given : ''}`).join('; ')
    : null

  // Fetch mentors for student papers (stored in SQL, not in Payload schema)
  let mentors: { name: string; authorId: string | null }[] = []
  if (pub.publicationType === 'student_paper') {
    const db = getDb()
    const { rows } = await db.query(
      'SELECT name FROM publications_mentors WHERE _parent_id = $1 ORDER BY _order',
      [parseInt(id)],
    )
    for (const row of rows) {
      // Try to link mentor to author record
      const match = await payload.find({
        collection: 'authors',
        where: { familyName: { equals: row.name.split(/\s+/).pop() || '' } },
        limit: 3,
        depth: 0,
      })
      const linked = match.docs.length === 1 ? match.docs[0] : null
      mentors.push({ name: row.name, authorId: linked ? String(linked.id) : null })
    }
  }

  const keywords = Array.isArray(pub.keywords)
    ? pub.keywords.map((k: any) => k.keyword).filter(Boolean)
    : []

  const typeLabels: Record<string, string> = {
    article: 'Journal Article',
    thesis: 'Thesis',
    book: 'Book',
    chapter: 'Book Chapter',
    student_paper: 'Student Paper',
    other: 'Other',
  }

  return (
    <div className="detail">
      <Link href="/search?type=publications" className="detail-back">
        &larr; Back to Publications
      </Link>

      <span className="badge badge-publication">
        {typeLabels[pub.publicationType] || 'Publication'}
      </span>
      <h1>{pub.title}</h1>

      <div className="detail-meta">
        <div>
          <strong>Authors:</strong>{' '}
          {authorLinks.map((a, i) => (
            <span key={i}>
              {i > 0 && '; '}
              {a.id ? (
                <Link href={`/authors/${a.id}`}>{a.name}</Link>
              ) : (
                a.name
              )}
              {isValidOrcid(a.orcid) && (
                <a href={`https://orcid.org/${a.orcid}`} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: '11px', marginLeft: '3px', color: 'var(--color-text-muted)' }}>
                  ORCID
                </a>
              )}
            </span>
          ))}
        </div>
        {mentors.length > 0 && (
          <div>
            <strong>Mentor{mentors.length > 1 ? 's' : ''}:</strong>{' '}
            {mentors.map((m, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {m.authorId ? <Link href={`/authors/${m.authorId}`}>{m.name}</Link> : m.name}
              </span>
            ))}
          </div>
        )}
        <div>
          <strong>Year:</strong> {pub.year}
        </div>
        {pub.journal && (
          <div>
            <strong>Journal:</strong> {pub.journal}
            {pub.volume && `, Vol. ${pub.volume}`}
            {pub.issue && `(${pub.issue})`}
            {pub.pages && `, pp. ${pub.pages}`}
          </div>
        )}
        {pub.publisher && (
          <div>
            <strong>Publisher:</strong> {pub.publisher}
          </div>
        )}
        {editors && (
          <div>
            <strong>Editors:</strong> {editors}
          </div>
        )}
        {isValidDoi(pub.doi) && (
          <div>
            <strong>DOI:</strong>{' '}
            <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer">
              {pub.doi}
            </a>
          </div>
        )}
        {keywords.length > 0 && (
          <div>
            <strong>Keywords:</strong> {keywords.join(', ')}
          </div>
        )}
      </div>

      {pub.abstract && (
        <div className="detail-section">
          <h2>Abstract</h2>
          <p>{pub.abstract}</p>
        </div>
      )}

      <div className="detail-actions">
        {!pub.pdfRestricted && isHttpUrl(pub.pdfLink) && (
          <a className="detail-action-primary" href={pub.pdfLink} target="_blank" rel="noopener noreferrer">
            Download PDF
          </a>
        )}
        {isValidDoi(pub.doi) && (
          <a className="detail-action-secondary" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer">
            View at Publisher
          </a>
        )}
        {isHttpUrl(pub.externalUrl) && !pub.doi && (
          <a className="detail-action-secondary" href={pub.externalUrl} target="_blank" rel="noopener noreferrer">
            External Link
          </a>
        )}
      </div>

      {await renderEntitySections(parseInt(id))}
      {await renderRelatedWorks('publications', parseInt(id))}
      {await renderCitationSections(parseInt(id), payload)}
    </div>
  )
}

async function renderEntitySections(pubId: number) {
  const db = getDb()
  const INITIAL = 10

  const [spRows, plRows, prRows, coRows] = await Promise.all([
    db.query(`
      SELECT s.id, s.canonical_name as name, s.family, s.kingdom, em.role,
             s.publication_count, 'species' as entity_type
      FROM entity_mentions em JOIN species s ON s.id = em.entity_id
      WHERE em.entity_type = 'species' AND em.collection = 'publications' AND em.item_id = $1`, [pubId]),
    db.query(`
      SELECT p.id, p.name, p.place_type, p.elevation_m, em.role,
             p.publication_count, 'place' as entity_type
      FROM entity_mentions em JOIN places p ON p.id = em.entity_id
      WHERE em.entity_type = 'place' AND em.collection = 'publications' AND em.item_id = $1`, [pubId]),
    db.query(`
      SELECT p.id, p.name, p.category, p.standardized, em.role,
             p.publication_count, 'protocol' as entity_type
      FROM entity_mentions em JOIN protocols p ON p.id = em.entity_id
      WHERE em.entity_type = 'protocol' AND em.collection = 'publications' AND em.item_id = $1`, [pubId]),
    db.query(`
      SELECT c.id, c.name, c.concept_type, c.scope, em.role,
             c.publication_count, 'concept' as entity_type
      FROM entity_mentions em JOIN concepts c ON c.id = em.entity_id
      WHERE em.entity_type = 'concept' AND em.collection = 'publications' AND em.item_id = $1`, [pubId]),
  ])

  const allEntities = [
    ...spRows.rows, ...plRows.rows, ...prRows.rows, ...coRows.rows,
  ].sort((a, b) => (b.publication_count || 0) - (a.publication_count || 0))

  if (allEntities.length === 0) return null

  function renderEntityCard(e: any) {
    const type = e.entity_type
    const href = `/${type === 'species' ? 'species' : type === 'place' ? 'places' : type === 'protocol' ? 'protocols' : 'concepts'}/${e.id}`
    const badgeClass = type === 'species' ? 'badge-species' : type === 'place' ? 'badge-place' : type === 'protocol' ? 'badge-protocol' : 'badge-concept'
    const badgeLabel = type === 'species' ? (e.kingdom || 'species')
      : type === 'place' ? (e.place_type || 'place').replace(/_/g, ' ')
      : type === 'protocol' ? (e.category || 'protocol')
      : (e.concept_type || 'concept').replace(/_/g, ' ')

    return (
      <Link key={`${type}-${e.id}`} href={href} className="result-card">
        <div className="result-card-header">
          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
          {type === 'protocol' && e.standardized && <span className="badge" style={{ background: '#2e7d32', color: 'white' }}>standardized</span>}
          <h3 className="result-card-title" style={type === 'species' ? { fontStyle: 'italic' } : undefined}>{e.name}</h3>
        </div>
        <div className="result-card-meta">
          {type === 'species' && e.family && <span>{e.family}</span>}
          {type === 'place' && e.elevation_m && <span>{e.elevation_m}m</span>}
          {type === 'concept' && e.scope && <span>{e.scope.replace(/_/g, ' ')}</span>}
          {e.role && <span>{e.role}</span>}
        </div>
      </Link>
    )
  }

  return (
    <div className="detail-section">
      <h2>Knowledge Graph ({allEntities.length})</h2>
      <div className="result-cards">
        {allEntities.slice(0, INITIAL).map(renderEntityCard)}
      </div>
      {allEntities.length > INITIAL && (
        <details style={{ marginTop: '8px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
            Show {allEntities.length - INITIAL} more linked entities
          </summary>
          <div className="result-cards" style={{ marginTop: '8px' }}>
            {allEntities.slice(INITIAL).map(renderEntityCard)}
          </div>
        </details>
      )}
    </div>
  )
}

async function renderCitationSections(pubId: number, payload: any) {
  const db = getDb()

  // External citation count (from OpenAlex)
  const { rows: citationCountRows } = await db.query(
    'SELECT external_citation_count FROM publications WHERE id = $1',
    [pubId],
  )
  const externalCitationCount = parseInt(citationCountRows[0]?.external_citation_count || '0')

  // Cited by: publications that cite THIS work
  const { rows: citedByRows } = await db.query(
    `SELECT DISTINCT r.source_publication_id, p.title, p.year, p.publication_type, p.doi
     FROM references_cited r
     JOIN publications p ON p.id = r.source_publication_id
     WHERE r.target_publication_id = $1
     ORDER BY p.year DESC
     LIMIT 50`,
    [pubId],
  )

  // References: works that THIS publication cites (internal only for linking)
  const { rows: internalRefs } = await db.query(
    `SELECT r.cited_title, r.cited_authors, r.cited_year, r.cited_doi, r.cited_journal,
            r.target_publication_id, r.target_dataset_id, r.match_confidence,
            tp.title as target_pub_title, td.title as target_ds_title
     FROM references_cited r
     LEFT JOIN publications tp ON tp.id = r.target_publication_id
     LEFT JOIN datasets td ON td.id = r.target_dataset_id
     WHERE r.source_publication_id = $1 AND r.link_type = 'internal'
     ORDER BY r.cited_year DESC NULLS LAST
     LIMIT 100`,
    [pubId],
  )

  // External references count
  const { rows: extCount } = await db.query(
    'SELECT count(*) FROM references_cited WHERE source_publication_id = $1 AND link_type = $2',
    [pubId, 'external'],
  )
  const externalCount = parseInt(extCount[0]?.count || '0')

  // Total reference count
  const totalRefCount = internalRefs.length + externalCount

  return (
    <>
      {(externalCitationCount > 0 || citedByRows.length > 0) && (
        <div className="detail-section">
          <h2>
            {externalCitationCount > 0 && citedByRows.length > 0
              ? `Cited By (${externalCitationCount} times, ${citedByRows.length} in Knowledge Hub)`
              : externalCitationCount > 0
                ? `Cited ${externalCitationCount} times`
                : `Cited By (${citedByRows.length})`}
          </h2>
          <div className="result-list">
            {citedByRows.map((row: any) => (
              <Link
                key={row.source_publication_id}
                className="result-card"
                href={`/publications/${row.source_publication_id}`}
              >
                <div className="result-card-header">
                  <span className="badge badge-publication">
                    {row.publication_type === 'article' ? 'Article' :
                     row.publication_type === 'student_paper' ? 'Student Paper' :
                     row.publication_type === 'thesis' ? 'Thesis' : 'Publication'}
                  </span>
                  <h3 className="result-card-title">{row.title}</h3>
                </div>
                <div className="result-card-meta">
                  {row.year && <span>{row.year}</span>}
                  {row.doi && <span>DOI: {row.doi}</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {totalRefCount > 0 && (
        <div className="detail-section">
          <h2>References ({totalRefCount})</h2>
          {internalRefs.length > 0 && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
                {internalRefs.length} in Knowledge Hub{externalCount > 0 ? `, ${externalCount} external` : ''}
              </p>
              <div className="result-list">
                {internalRefs.map((row: any, i: number) => {
                  const targetTitle = row.target_pub_title || row.target_ds_title || row.cited_title || 'Untitled'
                  const href = row.target_publication_id
                    ? `/publications/${row.target_publication_id}`
                    : row.target_dataset_id
                      ? `/datasets/${row.target_dataset_id}`
                      : null

                  return href ? (
                    <Link key={i} className="result-card" href={href}>
                      <div className="result-card-header">
                        <span className={`badge ${row.target_dataset_id ? 'badge-dataset' : 'badge-publication'}`}>
                          {row.target_dataset_id ? 'Dataset' : 'Publication'}
                        </span>
                        <h3 className="result-card-title">{targetTitle}</h3>
                      </div>
                      <div className="result-card-meta">
                        {row.cited_year && <span>{row.cited_year}</span>}
                        {row.cited_journal && <span>{row.cited_journal}</span>}
                        {row.cited_doi && <span>DOI: {row.cited_doi}</span>}
                      </div>
                    </Link>
                  ) : null
                })}
              </div>
            </>
          )}
          {internalRefs.length === 0 && externalCount > 0 && (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              {externalCount} references to works outside the Knowledge Hub
            </p>
          )}
        </div>
      )}
    </>
  )
}
