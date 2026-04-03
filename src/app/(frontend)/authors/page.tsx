import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

interface AuthorSearchParams {
  q?: string
  page?: string
  letter?: string
}

const PAGE_SIZE = 50

export default async function AuthorsPage({ searchParams }: { searchParams: Promise<AuthorSearchParams> }) {
  const params = await searchParams
  const query = params.q || ''
  const letter = params.letter || ''
  const page = Math.max(1, parseInt(params.page || '1'))

  const payload = await getPayload({ config })

  const where: any = {}
  if (query) {
    where.or = [
      { displayName: { contains: query } },
      { familyName: { contains: query } },
      { orcid: { contains: query } },
      { affiliation: { contains: query } },
    ]
  } else if (letter) {
    where.familyName = { like: `${letter}%` }
  }

  const authors = await payload.find({
    collection: 'authors',
    where,
    limit: PAGE_SIZE,
    page,
    sort: 'familyName',
  })

  // Get letter counts for the alphabet nav
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Browse Authors</h1>

        <form className="search-form" action="/authors" method="GET">
          <input
            className="search-input"
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by name, affiliation, or ORCID..."
          />
          <button className="search-button" type="submit">Search</button>
        </form>

        <div className="type-chips" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
          <Link className={`type-chip ${!letter && !query ? 'active' : ''}`} href="/authors">All</Link>
          {alphabet.map((l) => (
            <Link
              key={l}
              className={`type-chip ${letter === l ? 'active' : ''}`}
              href={`/authors?letter=${l}`}
              style={{ minWidth: '32px', textAlign: 'center', padding: '4px 6px' }}
            >
              {l}
            </Link>
          ))}
        </div>

        <p className="results-count">
          {authors.totalDocs.toLocaleString()} author{authors.totalDocs !== 1 ? 's' : ''}
          {query ? ` matching "${query}"` : ''}
          {letter ? ` starting with ${letter}` : ''}
        </p>
      </div>

      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 24px 48px' }}>
        <div className="result-list">
          {authors.docs.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>
              No authors found.
            </p>
          )}
          {authors.docs.map((author) => {
            const pubCount = Array.isArray(author.publications) ? author.publications.length : 0
            const dsCount = Array.isArray(author.datasets) ? author.datasets.length : 0
            const docCount = Array.isArray(author.documents) ? author.documents.length : 0
            const totalWorks = pubCount + dsCount + docCount

            return (
              <Link
                key={author.id}
                className="result-card"
                href={`/authors/${author.id}`}
              >
                <div className="result-card-header">
                  <h3 className="result-card-title">{author.displayName}</h3>
                </div>
                <div className="result-card-meta">
                  {author.affiliation && <span>{author.affiliation}</span>}
                  {author.orcid && (
                    <span>ORCID: {author.orcid}</span>
                  )}
                  <span>
                    {totalWorks} work{totalWorks !== 1 ? 's' : ''}
                    {pubCount > 0 ? ` (${pubCount} pub${pubCount !== 1 ? 's' : ''})` : ''}
                    {dsCount > 0 ? ` (${dsCount} dataset${dsCount !== 1 ? 's' : ''})` : ''}
                    {docCount > 0 ? ` (${docCount} doc${docCount !== 1 ? 's' : ''})` : ''}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>

        {authors.totalPages > 1 && (
          <div className="pagination">
            {page > 1 && (
              <Link href={`/authors?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(letter ? { letter } : {}), page: String(page - 1) })}`}>
                Prev
              </Link>
            )}
            {Array.from({ length: Math.min(authors.totalPages, 7) }, (_, i) => {
              let p: number
              if (authors.totalPages <= 7) p = i + 1
              else if (page <= 4) p = i + 1
              else if (page >= authors.totalPages - 3) p = authors.totalPages - 6 + i
              else p = page - 3 + i
              return (
                <Link
                  key={p}
                  className={p === page ? 'active' : ''}
                  href={`/authors?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(letter ? { letter } : {}), page: String(p) })}`}
                >
                  {p}
                </Link>
              )
            })}
            {page < authors.totalPages && (
              <Link href={`/authors?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(letter ? { letter } : {}), page: String(page + 1) })}`}>
                Next
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  )
}
