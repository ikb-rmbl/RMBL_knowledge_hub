import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import { renderRelatedWorks } from '../../lib/related-works'
import { isHttpUrl } from '../../lib/url-validation'

export const dynamic = 'force-dynamic'

export default async function DocumentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })

  let doc
  try {
    doc = await payload.findByID({ collection: 'documents', id })
  } catch {
    notFound()
  }

  const categories = Array.isArray(doc.categories)
    ? doc.categories.map((c: any) => (typeof c === 'object' ? c.name : c))
    : []

  const geoScope = Array.isArray(doc.geographicScope)
    ? doc.geographicScope.map((g: string) => g.replace(/_/g, ' '))
    : []

  return (
    <div className="detail">
      <Link href="/search?type=documents" className="detail-back">
        &larr; Back to Documents
      </Link>

      <span className="badge badge-document">Document</span>
      <h1>{doc.title}</h1>

      <div className="detail-meta">
        {doc.dateOriginal && (
          <div>
            <strong>Date:</strong> {(doc.dateOriginal as string).slice(0, 10)}
          </div>
        )}
        {categories.length > 0 && (
          <div>
            <strong>Categories:</strong>{' '}
            {categories.map((c: string, i: number) => (
              <span key={i}>
                {i > 0 && ', '}
                <Link href={`/search?topic=${encodeURIComponent(c)}`}>{c}</Link>
              </span>
            ))}
          </div>
        )}
        {geoScope.length > 0 && (
          <div>
            <strong>Geographic scope:</strong> {geoScope.join(', ')}
          </div>
        )}
        {doc.sourceUrl && (
          <div>
            <strong>Source:</strong> Sustainable Living Library
          </div>
        )}
      </div>

      {doc.summary && (
        <div className="detail-section">
          <h2>Summary</h2>
          <p>{typeof doc.summary === 'string' ? doc.summary : 'See document for details.'}</p>
        </div>
      )}

      <div className="detail-actions">
        {isHttpUrl(doc.pdfLink as string) && (
          <a
            className="detail-action-primary"
            href={doc.pdfLink as string}
            target="_blank"
            rel="noopener noreferrer"
          >
            View PDF
          </a>
        )}
        {isHttpUrl(doc.sourceUrl as string) && (
          <a
            className="detail-action-secondary"
            href={doc.sourceUrl as string}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Source Site
          </a>
        )}
      </div>

      {await renderRelatedWorks('documents', parseInt(id))}
    </div>
  )
}
