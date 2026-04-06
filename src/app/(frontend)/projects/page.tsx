import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

const TYPE_LABELS: Record<string, string> = {
  research_plan: 'Research Plan',
  program: 'Program',
  campaign: 'Campaign',
  initiative: 'Initiative',
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const params = await searchParams
  const typeFilter = params.type || ''
  const payload = await getPayload({ config })

  const where: any = {}
  if (typeFilter) where.projectType = { equals: typeFilter }

  const projects = await payload.find({
    collection: 'projects',
    where,
    limit: 200,
    sort: 'name',
    depth: 0,
  })

  // Group by type
  const programs = projects.docs.filter((p) => p.projectType === 'program' || p.projectType === 'campaign')
  const plans = projects.docs.filter((p) => p.projectType === 'research_plan')

  return (
    <div className="page-container">
      <h1>Research Projects</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '24px' }}>
        {projects.totalDocs} projects — {programs.length} programs/campaigns, {plans.length} research plans
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <Link href="/projects" style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: !typeFilter ? 'var(--color-accent)' : 'var(--color-surface)', color: !typeFilter ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>All</Link>
        <Link href="/projects?type=program" style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: typeFilter === 'program' ? 'var(--color-accent)' : 'var(--color-surface)', color: typeFilter === 'program' ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>Programs</Link>
        <Link href="/projects?type=campaign" style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: typeFilter === 'campaign' ? 'var(--color-accent)' : 'var(--color-surface)', color: typeFilter === 'campaign' ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>Campaigns</Link>
        <Link href="/projects?type=research_plan" style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: typeFilter === 'research_plan' ? 'var(--color-accent)' : 'var(--color-surface)', color: typeFilter === 'research_plan' ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>Research Plans</Link>
      </div>

      {(!typeFilter || typeFilter === 'program' || typeFilter === 'campaign') && programs.length > 0 && (
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Programs & Campaigns</h2>
          <div className="result-list">
            {programs.map((project) => (
              <Link key={project.id} className="result-card" href={`/projects/${project.id}`}>
                <div className="result-card-header">
                  <span className="badge" style={{ background: 'var(--color-accent)', color: '#fff' }}>
                    {TYPE_LABELS[project.projectType] || 'Project'}
                  </span>
                  <h3 className="result-card-title">{project.name}</h3>
                </div>
                <div className="result-card-meta">
                  {project.pi && <span>PI: {project.pi as string}</span>}
                  {project.status && <span>{project.status as string}</span>}
                  {project.fieldOfScience && <span>{project.fieldOfScience as string}</span>}
                </div>
                {project.description && (
                  <p className="result-card-snippet">
                    {(project.description as string).slice(0, 200)}{(project.description as string).length > 200 ? '...' : ''}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {(!typeFilter || typeFilter === 'research_plan') && plans.length > 0 && (
        <section>
          <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Research Plans ({plans.length})</h2>
          <div className="result-list">
            {plans.map((project) => (
              <Link key={project.id} className="result-card" href={`/projects/${project.id}`}>
                <div className="result-card-header">
                  <span className="badge badge-publication">Research Plan</span>
                  <h3 className="result-card-title">{project.name}</h3>
                </div>
                <div className="result-card-meta">
                  {project.pi && <span>PI: {project.pi as string}</span>}
                  {project.fieldOfScience && <span>{project.fieldOfScience as string}</span>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
