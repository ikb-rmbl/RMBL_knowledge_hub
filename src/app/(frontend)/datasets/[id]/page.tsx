import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import pg from 'pg'
import { renderRelatedWorks } from '../../lib/related-works'

export const dynamic = 'force-dynamic'

let dbPool: pg.Pool | null = null
function getDb(): pg.Pool {
  if (!dbPool) dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return dbPool
}

export default async function DatasetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })

  let dataset
  try {
    dataset = await payload.findByID({ collection: 'datasets', id })
  } catch {
    notFound()
  }

  const creatorList = Array.isArray(dataset.creators) ? dataset.creators : []

  // Look up linked author records for each creator
  const creatorLinks: { name: string; id: string | null; orcid?: string }[] = []
  for (const c of creatorList as any[]) {
    if (!c.name || c.name === 'Unknown' || c.name === 'RMBL' || c.name === 'NOAA') {
      creatorLinks.push({ name: c.name, id: null })
      continue
    }
    // Parse name to get family name for lookup
    const parts = c.name.includes(',') ? c.name.split(',') : c.name.trim().split(/\s+/)
    const familyName = c.name.includes(',') ? parts[0].trim() : parts[parts.length - 1]
    if (familyName.length < 2) { creatorLinks.push({ name: c.name, id: null }); continue }

    const match = await payload.find({
      collection: 'authors',
      where: { familyName: { equals: familyName } },
      limit: 3,
      depth: 0,
    })
    const linked = match.docs.length === 1 ? match.docs[0] : null
    creatorLinks.push({
      name: c.name,
      id: linked ? String(linked.id) : null,
      orcid: c.orcid || (linked as any)?.orcid,
    })
  }

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
        {creatorLinks.length > 0 && (
          <div>
            <strong>Creators:</strong>{' '}
            {creatorLinks.map((c, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {c.id ? <Link href={`/authors/${c.id}`}>{c.name}</Link> : c.name}
                {c.orcid && (
                  <a href={`https://orcid.org/${c.orcid}`} target="_blank" rel="noopener noreferrer"
                     style={{ fontSize: '11px', marginLeft: '3px', color: 'var(--color-text-muted)' }}>
                    ORCID
                  </a>
                )}
              </span>
            ))}
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

      {await renderRelatedWorks('datasets', parseInt(id))}
      {await renderDatasetCitations(parseInt(id))}
    </div>
  )
}

async function renderDatasetCitations(datasetId: number) {
  const db = getDb()

  // External citation count
  const { rows: countRows } = await db.query(
    'SELECT external_citation_count FROM datasets WHERE id = $1',
    [datasetId],
  )
  const externalCount = parseInt(countRows[0]?.external_citation_count || '0')

  // Internal: publications that cite this dataset
  const { rows: citedByRows } = await db.query(
    `SELECT DISTINCT r.source_publication_id, p.title, p.year, p.publication_type, p.doi
     FROM references_cited r
     JOIN publications p ON p.id = r.source_publication_id
     WHERE r.target_dataset_id = $1
     ORDER BY p.year DESC
     LIMIT 50`,
    [datasetId],
  )

  if (externalCount === 0 && citedByRows.length === 0) return null

  return (
    <div className="detail-section">
      <h2>
        {externalCount > 0 && citedByRows.length > 0
          ? `Cited By (${externalCount} times, ${citedByRows.length} in Knowledge Hub)`
          : externalCount > 0
            ? `Cited ${externalCount} times`
            : `Cited By (${citedByRows.length})`}
      </h2>
      {citedByRows.length > 0 && (
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
      )}
    </div>
  )
}
