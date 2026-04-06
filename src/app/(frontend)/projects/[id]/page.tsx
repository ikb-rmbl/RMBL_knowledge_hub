import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from '../../lib/badges'
import { renderRelatedWorks } from '../../lib/related-works'

export const dynamic = 'force-dynamic'

const TYPE_LABELS: Record<string, string> = {
  research_plan: 'Research Plan',
  program: 'Program',
  campaign: 'Campaign',
  initiative: 'Initiative',
}

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })

  let project
  try {
    project = await payload.findByID({ collection: 'projects', id, depth: 1 })
  } catch {
    notFound()
  }

  const pubs = Array.isArray(project.publications) ? project.publications : []
  const datasets = Array.isArray(project.datasets) ? project.datasets : []
  const docs = Array.isArray(project.documents) ? project.documents : []

  const totalItems = pubs.length + datasets.length + docs.length

  // Find child research plans (for programs/campaigns)
  const childPlans = await payload.find({
    collection: 'projects',
    where: { parentProject: { equals: parseInt(id) } },
    limit: 50,
    sort: 'name',
    depth: 0,
  })

  // Find parent project (for research plans)
  const parentProject = project.parentProject
    ? (typeof project.parentProject === 'object' ? project.parentProject : null)
    : null

  return (
    <div className="detail">
      <Link href="/projects" className="detail-back">
        &larr; Back to Projects
      </Link>

      <span className="badge" style={{ background: 'var(--color-accent)', color: '#fff' }}>
        {TYPE_LABELS[project.projectType] || 'Project'}
      </span>
      <h1>{project.name}</h1>

      <div className="detail-meta">
        {parentProject && (
          <div>
            <strong>Part of:</strong>{' '}
            <Link href={`/projects/${(parentProject as any).id}`}>
              {(parentProject as any).name}
            </Link>
          </div>
        )}
        {project.pi && (
          <div>
            <strong>Principal Investigator:</strong> {project.pi as string}
          </div>
        )}
        {project.status && (
          <div>
            <strong>Status:</strong> {project.status as string}
          </div>
        )}
        {project.fieldOfScience && (
          <div>
            <strong>Field:</strong> {project.fieldOfScience as string}
          </div>
        )}
        {project.researchAreas && (
          <div>
            <strong>Research Areas:</strong> {project.researchAreas as string}
          </div>
        )}
        {(project.startYear || project.endYear) && (
          <div>
            <strong>Period:</strong> {project.startYear || '?'} &ndash; {project.endYear || 'present'}
          </div>
        )}
        <div>
          <strong>Items:</strong> {totalItems} ({pubs.length} publications, {datasets.length} datasets, {docs.length} documents)
        </div>
      </div>

      {project.description && (
        <div className="detail-section">
          <h2>Description</h2>
          <p>{project.description as string}</p>
        </div>
      )}

      {childPlans.docs.length > 0 && (
        <div className="detail-section">
          <h2>Research Plans ({childPlans.docs.length})</h2>
          <div className="result-list">
            {childPlans.docs.map((child: any) => (
              <Link key={child.id} className="result-card" href={`/projects/${child.id}`}>
                <div className="result-card-header">
                  <span className="badge badge-publication">Research Plan</span>
                  <h3 className="result-card-title">{child.name}</h3>
                </div>
                <div className="result-card-meta">
                  {child.pi && <span>PI: {child.pi}</span>}
                  {child.fieldOfScience && <span>{child.fieldOfScience}</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {pubs.length > 0 && (
        <div className="detail-section">
          <h2>Publications ({pubs.length})</h2>
          <div className="result-list">
            {pubs.slice(0, 50).map((pub: any) => (
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
            ))}
            {pubs.length > 50 && (
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                Showing 50 of {pubs.length} publications
              </p>
            )}
          </div>
        </div>
      )}

      {datasets.length > 0 && (
        <div className="detail-section">
          <h2>Datasets ({datasets.length})</h2>
          <div className="result-list">
            {datasets.slice(0, 30).map((ds: any) => (
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
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="detail-section">
          <h2>Documents ({docs.length})</h2>
          <div className="result-list">
            {docs.slice(0, 20).map((doc: any) => (
              <Link key={doc.id} className="result-card" href={`/documents/${doc.id}`}>
                <div className="result-card-header">
                  <span className={getBadgeClass('document')}>Document</span>
                  <h3 className="result-card-title">{doc.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
