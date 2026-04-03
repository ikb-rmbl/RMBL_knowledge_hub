import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from '../../lib/badges'

export const dynamic = 'force-dynamic'

export default async function AuthorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })

  let author: any
  try {
    author = await payload.findByID({ collection: 'authors', id, depth: 2 })
  } catch {
    notFound()
  }

  const publications = Array.isArray(author.publications) ? author.publications : []
  const datasets = Array.isArray(author.datasets) ? author.datasets : []
  const documents = Array.isArray(author.documents) ? author.documents : []
  const totalWorks = publications.length + datasets.length + documents.length

  return (
    <div className="detail">
      <Link href="/authors" className="detail-back">
        &larr; Back to Authors
      </Link>

      <h1>{author.displayName}</h1>

      <div className="detail-meta">
        {author.affiliation && (
          <div>
            <strong>Affiliation:</strong> {author.affiliation}
          </div>
        )}
        {author.orcid && (
          <div>
            <strong>ORCID:</strong>{' '}
            <a href={`https://orcid.org/${author.orcid}`} target="_blank" rel="noopener noreferrer">
              {author.orcid}
            </a>
          </div>
        )}
        <div>
          <strong>Works:</strong> {totalWorks} total
          ({publications.length} publication{publications.length !== 1 ? 's' : ''},
          {' '}{datasets.length} dataset{datasets.length !== 1 ? 's' : ''},
          {' '}{documents.length} document{documents.length !== 1 ? 's' : ''})
        </div>
      </div>

      {publications.length > 0 && (
        <div className="detail-section">
          <h2>Publications ({publications.length})</h2>
          <div className="result-list">
            {publications.map((pub: any) => {
              if (typeof pub !== 'object') return null
              return (
                <Link key={pub.id} className="result-card" href={`/publications/${pub.id}`}>
                  <div className="result-card-header">
                    <span className={getBadgeClass('publication')}>
                      {getBadgeLabel('publication', pub.publicationType)}
                    </span>
                    <h3 className="result-card-title">{pub.title}</h3>
                  </div>
                  <div className="result-card-meta">
                    {pub.year && <span>{pub.year}</span>}
                    {pub.journal && <span>{pub.journal}</span>}
                    {pub.doi && <span>DOI: {pub.doi}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {datasets.length > 0 && (
        <div className="detail-section">
          <h2>Datasets ({datasets.length})</h2>
          <div className="result-list">
            {datasets.map((ds: any) => {
              if (typeof ds !== 'object') return null
              return (
                <Link key={ds.id} className="result-card" href={`/datasets/${ds.id}`}>
                  <div className="result-card-header">
                    <span className={getBadgeClass('dataset')}>
                      {getBadgeLabel('dataset', ds.resourceType)}
                    </span>
                    <h3 className="result-card-title">{ds.title}</h3>
                  </div>
                  <div className="result-card-meta">
                    {ds.publicationYear && <span>{ds.publicationYear}</span>}
                    {ds.doi && <span>DOI: {ds.doi}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {documents.length > 0 && (
        <div className="detail-section">
          <h2>Documents ({documents.length})</h2>
          <div className="result-list">
            {documents.map((doc: any) => {
              if (typeof doc !== 'object') return null
              return (
                <Link key={doc.id} className="result-card" href={`/documents/${doc.id}`}>
                  <div className="result-card-header">
                    <span className={getBadgeClass('document')}>Document</span>
                    <h3 className="result-card-title">{doc.title}</h3>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
