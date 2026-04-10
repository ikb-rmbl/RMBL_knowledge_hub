import Link from 'next/link'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from '../../lib/badges'
import { isValidOrcid } from '../../lib/url-validation'
import { getDb } from '../../lib/db'

export const dynamic = 'force-dynamic'

interface AuthorParams {
  id: string
}

function buildUrl(id: string, current: Record<string, string>, overrides: Record<string, string | undefined>): string {
  const merged = { ...current, ...overrides }
  const p = new URLSearchParams()
  if (merged.workType) p.set('workType', merged.workType)
  if (merged.sort && merged.sort !== 'newest') p.set('sort', merged.sort)
  const qs = p.toString()
  return `/authors/${id}${qs ? '?' + qs : ''}`
}

export default async function AuthorDetail({ params, searchParams }: { params: Promise<AuthorParams>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params
  const sp = await searchParams
  const workTypeFilter = sp.workType || ''
  const sortParam = sp.sort || 'newest'
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

  // Find associated projects (by pi_author_id or PI name match)
  // PI field may contain nicknames ("Dan" vs "Daniel"), multiple PIs ("Dan Blumstein, Kenneth Armitage"),
  // so we match on last name appearing in the PI field plus first-initial match
  const db = getDb()
  const nameParts = (author.displayName as string).split(/\s+/)
  const lastName = nameParts[nameParts.length - 1]
  const firstInitial = nameParts[0]?.[0] || ''
  // Match by: exact pi_author_id, exact display name, or last name + first name prefix (3+ chars)
  // First-initial-only matching is too loose (e.g. "Rick Williams" matching "Kenneth Hurst Williams")
  const firstName = nameParts[0] || ''
  const firstNamePrefix = firstName.length >= 3 ? firstName.slice(0, 3) : firstName
  const { rows: allProjects } = await db.query(
    `SELECT id, name, project_type, status, pi, field_of_science, description, parent_project_id
     FROM projects
     WHERE pi_author_id = $1
       OR lower(pi) = lower($2)
       OR (pi ILIKE $3 AND pi ILIKE $4)
     ORDER BY name`,
    [parseInt(id), author.displayName, `%${lastName}%`, `%${firstNamePrefix}%`],
  )
  // Hide child projects when their parent is already in the list
  const projectIds = new Set(allProjects.map((p: any) => p.id))
  const projects = allProjects.filter((p: any) => !p.parent_project_id || !projectIds.has(p.parent_project_id))

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
        {isValidOrcid(author.orcid as string) && (
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

      {projects.length > 0 && (() => {
        const INITIAL_SHOW = 3
        const hasMore = projects.length > INITIAL_SHOW
        const TYPE_LABELS: Record<string, string> = {
          research_plan: 'Research Plan', program: 'Program', campaign: 'Campaign', initiative: 'Initiative',
        }

        function renderProjectCard(proj: any) {
          return (
            <Link key={proj.id} className="result-card" href={`/projects/${proj.id}`}
              style={{ borderLeft: '3px solid var(--color-accent)', flex: '1 1 0', minWidth: '220px' }}>
              <div className="result-card-header">
                <span className="badge" style={{ background: 'var(--color-accent)', color: '#fff' }}>
                  {TYPE_LABELS[proj.project_type] || 'Project'}
                </span>
                <h3 className="result-card-title">{proj.name}</h3>
              </div>
              {proj.description && (
                <p className="result-card-snippet" style={{ fontSize: '13px' }}>
                  {proj.description.slice(0, 120)}{proj.description.length > 120 ? '...' : ''}
                </p>
              )}
              <div className="result-card-meta">
                {proj.status && <span>{proj.status}</span>}
                {proj.field_of_science && <span>{proj.field_of_science}</span>}
              </div>
            </Link>
          )
        }

        return (
          <div className="detail-section">
            <h2>Projects ({projects.length})</h2>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {projects.slice(0, INITIAL_SHOW).map(renderProjectCard)}
            </div>
            {hasMore && (
              <details style={{ marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                  Show {projects.length - INITIAL_SHOW} more project{projects.length - INITIAL_SHOW !== 1 ? 's' : ''}
                </summary>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {projects.slice(INITIAL_SHOW).map(renderProjectCard)}
                </div>
              </details>
            )}
          </div>
        )
      })()}

      {totalWorks > 0 && await (async () => {
        // Fetch citation counts from SQL for publications and datasets
        const pubIds = publications.filter((p: any) => typeof p === 'object').map((p: any) => p.id)
        const dsIds = datasets.filter((d: any) => typeof d === 'object').map((d: any) => d.id)
        const citationMap = new Map<string, number>()
        if (pubIds.length > 0) {
          const { rows } = await db.query('SELECT id, coalesce(external_citation_count, 0)::int as cnt FROM publications WHERE id = ANY($1::int[])', [pubIds])
          for (const r of rows) citationMap.set(String(r.id), parseInt(r.cnt) || 0)
        }
        if (dsIds.length > 0) {
          const { rows } = await db.query('SELECT id, coalesce(external_citation_count, 0)::int as cnt FROM datasets WHERE id = ANY($1::int[])', [dsIds])
          for (const r of rows) citationMap.set(String(r.id), parseInt(r.cnt) || 0)
        }

        // Build unified work items
        type WorkItem = {
          type: 'publication' | 'dataset' | 'document'
          subtype: string | null
          id: number
          title: string
          year: number | null
          meta: string[]
          citations: number
        }
        const allWorks: WorkItem[] = []

        for (const pub of publications) {
          if (typeof pub !== 'object') continue
          allWorks.push({
            type: 'publication', subtype: pub.publicationType || null,
            id: pub.id, title: pub.title, year: pub.year || null,
            meta: [pub.year ? String(pub.year) : '', pub.journal || '', pub.doi ? `DOI: ${pub.doi}` : ''].filter(Boolean),
            citations: citationMap.get(String(pub.id)) || 0,
          })
        }
        for (const ds of datasets) {
          if (typeof ds !== 'object') continue
          allWorks.push({
            type: 'dataset', subtype: ds.resourceType || null,
            id: ds.id, title: ds.title, year: ds.publicationYear || null,
            meta: [ds.publicationYear ? String(ds.publicationYear) : '', ds.doi ? `DOI: ${ds.doi}` : ''].filter(Boolean),
            citations: citationMap.get(String(ds.id)) || 0,
          })
        }
        for (const doc of documents) {
          if (typeof doc !== 'object') continue
          const yearStr = (doc.dateOriginal as string)?.slice(0, 4)
          allWorks.push({
            type: 'document', subtype: null,
            id: doc.id, title: doc.title, year: yearStr ? parseInt(yearStr) : null,
            meta: [yearStr].filter(Boolean) as string[],
            citations: 0,
          })
        }

        // Filter
        const filtered = workTypeFilter
          ? allWorks.filter((w) => w.type === workTypeFilter)
          : allWorks

        // Sort
        if (sortParam === 'most-cited') {
          filtered.sort((a, b) => {
            // Items with citations come first; zero-citation items sort by year at the end
            if (a.citations > 0 && b.citations === 0) return -1
            if (a.citations === 0 && b.citations > 0) return 1
            if (a.citations > 0 && b.citations > 0) return b.citations - a.citations
            return (b.year || 0) - (a.year || 0)
          })
        } else {
          filtered.sort((a, b) => (b.year || 0) - (a.year || 0))
        }

        const chipStyle = (active: boolean) => ({
          padding: '6px 14px', borderRadius: 'var(--radius-sm)',
          background: active ? 'var(--color-accent)' : 'var(--color-surface)',
          color: active ? '#fff' : 'inherit',
          border: '1px solid var(--color-border)', textDecoration: 'none' as const, fontSize: '13px',
        })

        const sortStyle = (active: boolean) => ({
          fontWeight: active ? 700 as const : 400 as const,
          color: active ? 'var(--color-accent)' : 'inherit',
        })

        return (
          <div className="detail-section">
            <h2>Works ({totalWorks})</h2>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <Link href={buildUrl(id, sp, { workType: undefined })} style={chipStyle(!workTypeFilter)}>All ({totalWorks})</Link>
              {publications.length > 0 && <Link href={buildUrl(id, sp, { workType: 'publication' })} style={chipStyle(workTypeFilter === 'publication')}>Publications ({publications.length})</Link>}
              {datasets.length > 0 && <Link href={buildUrl(id, sp, { workType: 'dataset' })} style={chipStyle(workTypeFilter === 'dataset')}>Datasets ({datasets.length})</Link>}
              {documents.length > 0 && <Link href={buildUrl(id, sp, { workType: 'document' })} style={chipStyle(workTypeFilter === 'document')}>Documents ({documents.length})</Link>}
            </div>

            <div style={{ display: 'flex', gap: '16px', fontSize: '13px', marginBottom: '12px' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Sort:</span>
              <Link href={buildUrl(id, sp, { sort: undefined })} style={sortStyle(sortParam === 'newest')}>Date (Newest)</Link>
              <Link href={buildUrl(id, sp, { sort: 'most-cited' })} style={sortStyle(sortParam === 'most-cited')}>Most Cited</Link>
            </div>

            <div className="result-list">
              {filtered.map((item) => {
                const slug = item.type === 'publication' ? 'publications' : item.type === 'dataset' ? 'datasets' : 'documents'
                return (
                  <Link key={`${item.type}-${item.id}`} className="result-card" href={`/${slug}/${item.id}`}>
                    <div className="result-card-header">
                      <span className={getBadgeClass(item.type)}>
                        {getBadgeLabel(item.type, item.subtype)}
                      </span>
                      <h3 className="result-card-title">{item.title}</h3>
                    </div>
                    <div className="result-card-meta">
                      {item.meta.map((m, i) => <span key={i}>{m}</span>)}
                      {item.citations > 0 && <span>{`Cited ${item.citations} times`}</span>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
