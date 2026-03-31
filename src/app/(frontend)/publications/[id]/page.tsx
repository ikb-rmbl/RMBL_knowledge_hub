import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'

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

  const authors = Array.isArray(pub.authors)
    ? pub.authors.map((a: any) => `${a.family}${a.given ? ', ' + a.given : ''}`).join('; ')
    : ''

  const editors = Array.isArray(pub.editors) && pub.editors.length > 0
    ? pub.editors.map((e: any) => `${e.family}${e.given ? ', ' + e.given : ''}`).join('; ')
    : null

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
          <strong>Authors:</strong> {authors}
        </div>
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
          <a
            className="detail-action-primary"
            href={pub.pdfLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download PDF
          </a>
        )}
        {pub.doi && (
          <a
            className="detail-action-secondary"
            href={`https://doi.org/${pub.doi}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View at Publisher
          </a>
        )}
        {pub.externalUrl && !pub.doi && (
          <a
            className="detail-action-secondary"
            href={pub.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            External Link
          </a>
        )}
      </div>
    </div>
  )
}
