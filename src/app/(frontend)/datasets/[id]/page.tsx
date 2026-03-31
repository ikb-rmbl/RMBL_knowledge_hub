import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

export default async function DatasetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })

  let dataset
  try {
    dataset = await payload.findByID({ collection: 'datasets', id })
  } catch {
    notFound()
  }

  const creators = Array.isArray(dataset.creators)
    ? dataset.creators.map((c: any) => c.name).filter(Boolean)
    : []

  const tags = Array.isArray(dataset.tags)
    ? dataset.tags.map((t: any) => (typeof t === 'object' ? t.name : t)).filter(Boolean)
    : []

  const dataFormats = Array.isArray(dataset.dataFormat) ? dataset.dataFormat : []

  const licenseLabels: Record<string, string> = {
    cc_by_4: 'CC-BY 4.0',
    cc_by_sa_4: 'CC-BY-SA 4.0',
    cc_by_nc_4: 'CC-BY-NC 4.0',
    cc0: 'CC0 (Public Domain)',
    mit: 'MIT License',
    other: 'See source for details',
  }

  const temporalExtent = dataset.temporalExtent as { start?: string; end?: string } | undefined
  const spatialExtent = dataset.spatialExtent as {
    southBoundLatitude?: number
    northBoundLatitude?: number
    westBoundLongitude?: number
    eastBoundLongitude?: number
  } | null

  return (
    <div className="detail">
      <Link href="/search?type=datasets" className="detail-back">
        &larr; Back to Datasets
      </Link>

      <span className="badge badge-dataset">Dataset</span>
      <h1>{dataset.title}</h1>

      <div className="detail-meta">
        {creators.length > 0 && (
          <div>
            <strong>Creators:</strong> {creators.join(', ')}
          </div>
        )}
        <div>
          <strong>Year:</strong> {dataset.publicationYear}
        </div>
        {dataset.doi && (
          <div>
            <strong>DOI:</strong>{' '}
            <a href={`https://doi.org/${dataset.doi}`} target="_blank" rel="noopener noreferrer">
              {dataset.doi}
            </a>
          </div>
        )}
        {dataset.license && (
          <div>
            <strong>License:</strong> {licenseLabels[dataset.license] || dataset.license}
          </div>
        )}
        {dataFormats.length > 0 && (
          <div>
            <strong>Format:</strong> {dataFormats.join(', ').toUpperCase()}
          </div>
        )}
        {dataset.fileSize && (
          <div>
            <strong>Size:</strong> {dataset.fileSize}
          </div>
        )}
        {dataset.spatialDescription && (
          <div>
            <strong>Location:</strong> {dataset.spatialDescription}
          </div>
        )}
        {temporalExtent?.start && (
          <div>
            <strong>Temporal extent:</strong> {temporalExtent.start.slice(0, 10)}
            {temporalExtent.end ? ` to ${temporalExtent.end.slice(0, 10)}` : ''}
          </div>
        )}
        {spatialExtent && (
          <div>
            <strong>Bounding box:</strong>{' '}
            {spatialExtent.southBoundLatitude?.toFixed(3)}&deg;N to{' '}
            {spatialExtent.northBoundLatitude?.toFixed(3)}&deg;N,{' '}
            {spatialExtent.westBoundLongitude?.toFixed(3)}&deg;W to{' '}
            {spatialExtent.eastBoundLongitude?.toFixed(3)}&deg;W
          </div>
        )}
        {dataset.dataPublisher && (
          <div>
            <strong>Publisher:</strong> {dataset.dataPublisher}
          </div>
        )}
        {tags.length > 0 && (
          <div>
            <strong>Tags:</strong>{' '}
            {tags.map((tag: string, i: number) => (
              <span key={i}>
                {i > 0 && ', '}
                <Link href={`/search?topic=${encodeURIComponent(tag)}`}>{tag}</Link>
              </span>
            ))}
          </div>
        )}
      </div>

      {dataset.description && (
        <div className="detail-section">
          <h2>Description</h2>
          <p>
            {typeof dataset.description === 'string'
              ? dataset.description
              : 'See source for full description.'}
          </p>
        </div>
      )}

      <div className="detail-actions">
        {dataset.downloadUrl && (
          <a
            className="detail-action-primary"
            href={dataset.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download Data
          </a>
        )}
        {dataset.externalCatalogUrl && (
          <a
            className="detail-action-secondary"
            href={dataset.externalCatalogUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View in Catalog
          </a>
        )}
        {dataset.doi && (
          <a
            className="detail-action-secondary"
            href={`https://doi.org/${dataset.doi}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View DOI Record
          </a>
        )}
      </div>
    </div>
  )
}
