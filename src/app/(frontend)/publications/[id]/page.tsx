import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import pg from 'pg'

export const dynamic = 'force-dynamic'

let dbPool: pg.Pool | null = null
function getDb(): pg.Pool {
  if (!dbPool) dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return dbPool
}

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
              {a.orcid && (
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
        {pub.doi && (
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
        {pub.pdfLink && (
          <a className="detail-action-primary" href={pub.pdfLink} target="_blank" rel="noopener noreferrer">
            Download PDF
          </a>
        )}
        {pub.doi && (
          <a className="detail-action-secondary" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer">
            View at Publisher
          </a>
        )}
        {pub.externalUrl && !pub.doi && (
          <a className="detail-action-secondary" href={pub.externalUrl} target="_blank" rel="noopener noreferrer">
            External Link
          </a>
        )}
      </div>
    </div>
  )
}
