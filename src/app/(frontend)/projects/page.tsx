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

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
]

const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: '-name', label: 'Name (Z-A)' },
  { value: 'pi', label: 'PI (A-Z)' },
]

interface ProjectsParams {
  type?: string
  status?: string
  field?: string
  sort?: string
  q?: string
}

function buildUrl(current: ProjectsParams, overrides: Record<string, string | undefined>): string {
  const merged = { ...current, ...overrides }
  const p = new URLSearchParams()
  if (merged.type) p.set('type', merged.type)
  if (merged.status) p.set('status', merged.status)
  if (merged.field) p.set('field', merged.field)
  if (merged.sort) p.set('sort', merged.sort)
  if (merged.q) p.set('q', merged.q)
  const qs = p.toString()
  return `/projects${qs ? '?' + qs : ''}`
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<ProjectsParams> }) {
  const params = await searchParams
  const typeFilter = params.type || ''
  const statusFilter = params.status || ''
  const fieldFilter = params.field || ''
  const sortParam = params.sort || 'name'
  const query = params.q || ''

  const payload = await getPayload({ config })

  const where: any = {}
  if (typeFilter) where.projectType = { equals: typeFilter }
  if (statusFilter) where.status = { equals: statusFilter }
  if (fieldFilter) where.fieldOfScience = { contains: fieldFilter }
  if (query) where.or = [
    { name: { contains: query } },
    { pi: { contains: query } },
    { description: { contains: query } },
  ]

  const projects = await payload.find({
    collection: 'projects',
    where,
    limit: 200,
    sort: sortParam,
    depth: 0,
  })

  // Group by type for display — exclude child plans from top-level list
  const programs = projects.docs.filter((p) => p.projectType === 'program' || p.projectType === 'campaign')
  const plans = projects.docs.filter((p) => p.projectType === 'research_plan' && !p.parentProject)

  // Collect unique fields of science for sidebar
  const allProjects = await payload.find({ collection: 'projects', limit: 200, depth: 0 })
  const fieldCounts = new Map<string, number>()
  for (const p of allProjects.docs) {
    const field = p.fieldOfScience as string
    if (field) fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1)
  }
  const fieldOptions = [...fieldCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Active filters
  const activeFilters: string[] = []
  if (query) activeFilters.push(`"${query}"`)
  if (typeFilter) activeFilters.push(TYPE_LABELS[typeFilter] || typeFilter)
  if (statusFilter) activeFilters.push(statusFilter)
  if (fieldFilter) activeFilters.push(fieldFilter)

  return (
    <>
      <div className="search-results-header">
        <form className="search-form" action="/projects" method="GET">
          <input className="search-input" type="text" name="q" defaultValue={query} placeholder="Search projects..." />
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          {sortParam !== 'name' && <input type="hidden" name="sort" value={sortParam} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        {/* Type chips */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <Link href={buildUrl(params, { type: undefined })} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: !typeFilter ? 'var(--color-accent)' : 'var(--color-surface)', color: !typeFilter ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>All ({projects.totalDocs})</Link>
          <Link href={buildUrl(params, { type: typeFilter === 'program' ? undefined : 'program' })} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: typeFilter === 'program' ? 'var(--color-accent)' : 'var(--color-surface)', color: typeFilter === 'program' ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>Programs</Link>
          <Link href={buildUrl(params, { type: typeFilter === 'campaign' ? undefined : 'campaign' })} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: typeFilter === 'campaign' ? 'var(--color-accent)' : 'var(--color-surface)', color: typeFilter === 'campaign' ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>Campaigns</Link>
          <Link href={buildUrl(params, { type: typeFilter === 'research_plan' ? undefined : 'research_plan' })} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', background: typeFilter === 'research_plan' ? 'var(--color-accent)' : 'var(--color-surface)', color: typeFilter === 'research_plan' ? '#fff' : 'inherit', border: '1px solid var(--color-border)', textDecoration: 'none', fontSize: '13px' }}>Research Plans</Link>
        </div>
      </div>

      <div className="search-layout">
        <aside className="filters">
          {/* Sort */}
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl(params, { sort: opt.value === 'name' ? undefined : opt.value })}
                  style={{
                    fontWeight: sortParam === opt.value ? 700 : 400,
                    color: sortParam === opt.value ? 'var(--color-accent)' : 'inherit',
                  }}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          {/* Status */}
          <div className="filter-group">
            <h4>Status</h4>
            {STATUS_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl(params, { status: statusFilter === opt.value ? undefined : opt.value })}
                  style={{
                    fontWeight: statusFilter === opt.value ? 700 : 400,
                    color: statusFilter === opt.value ? 'var(--color-accent)' : 'inherit',
                  }}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          {/* Field of Science */}
          {fieldOptions.length > 0 && (
            <div className="filter-group">
              <h4>Field of Science</h4>
              {fieldOptions.map(([field, count]) => (
                <label key={field}>
                  <Link
                    href={buildUrl(params, { field: fieldFilter === field ? undefined : field })}
                    style={{
                      fontWeight: fieldFilter === field ? 700 : 400,
                      color: fieldFilter === field ? 'var(--color-accent)' : 'inherit',
                    }}
                  >
                    {field} ({count})
                  </Link>
                </label>
              ))}
            </div>
          )}

          {/* Clear filters */}
          {activeFilters.length > 0 && (
            <div className="filter-group">
              <Link href="/projects" style={{ fontSize: '13px' }}>
                Clear all filters
              </Link>
            </div>
          )}
        </aside>

        <div>
          {/* Programs & Campaigns section at the top */}
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

          {/* Research Plans section */}
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

          {projects.docs.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>
              No projects found. Try broadening your filters.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
