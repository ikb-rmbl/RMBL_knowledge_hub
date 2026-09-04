import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'
import { isHttpUrl } from '../lib/url-validation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Datasets — RMBL Knowledge Commons',
  description:
    'Browse research datasets from RMBL and the Gunnison Basin: long-term records, spatial data products, and repository holdings — filterable by data coverage, place, method, taxon, license, and access.',
}

const PAGE_SIZE = 20

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'cited', label: 'Most Cited' },
  { value: 'coverage', label: 'Longest Record' },
  { value: 'title', label: 'Title (A–Z)' },
]

const LICENSE_LABELS: Record<string, string> = {
  cc_by_4: 'CC-BY 4.0', cc_by_sa_4: 'CC-BY-SA 4.0', cc_by_nc_4: 'CC-BY-NC 4.0',
  cc0: 'CC0', mit: 'MIT', other: 'Other / unknown',
}

const REPO_LABELS: Record<string, string> = { s3: 'RMBL SDP', ess_dive: 'ESS-DIVE', other: 'Other repositories' }

/** Chip-style boolean/entity filters preserved across links. */
function buildUrl(params: Record<string, string>, overrides: Record<string, string | undefined>): string {
  const merged: Record<string, string | undefined> = { ...params, ...overrides }
  const p = new URLSearchParams()
  for (const k of ['q', 'place', 'protocol', 'species', 'license', 'repo', 'format', 'keyword', 'variable', 'download', 'longterm', 'haspub', 'from', 'to', 'sort']) {
    if (merged[k]) p.set(k, merged[k]!)
  }
  if (merged.page && merged.page !== '1') p.set('page', merged.page)
  const qs = p.toString()
  return qs ? `/datasets?${qs}` : '/datasets'
}

export default async function DatasetsBrowse({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const db = getDb()
  const page = Math.max(1, parseInt(params.page || '1'))
  const offset = (page - 1) * PAGE_SIZE
  const sort = params.sort || 'newest'

  const where: string[] = []
  const values: any[] = []
  let i = 1
  const push = (clause: string, v?: any) => {
    where.push(clause)
    if (v !== undefined) { values.push(v); i++ }
  }

  if (params.q) push(`(d.title ILIKE $${i} OR d.description ILIKE $${i})`, `%${params.q}%`)
  for (const [key, etype] of [['place', 'place'], ['protocol', 'protocol'], ['species', 'species']] as const) {
    if (params[key] && /^\d+$/.test(params[key])) {
      push(`EXISTS (SELECT 1 FROM entity_mentions em WHERE em.collection='datasets' AND em.item_id = d.id AND em.entity_type='${etype}' AND em.entity_id = $${i})`, parseInt(params[key]))
    }
  }
  if (params.license && /^[a-z0-9_]+$/.test(params.license)) push(`d.license = $${i}`, params.license)
  if (params.repo && /^[a-z0-9_]+$/.test(params.repo)) push(`d.repository = $${i}`, params.repo)
  if (params.format && /^[a-z0-9_]+$/.test(params.format)) {
    push(`EXISTS (SELECT 1 FROM datasets_data_format f WHERE f.parent_id = d.id AND f.value = $${i})`, params.format)
  }
  if (params.keyword) push(`d.keywords @> ARRAY[$${i}]::text[]`, params.keyword)
  if (params.variable) push(`d.variables @> ARRAY[$${i}]::text[]`, params.variable)
  if (params.download === '1') push(`d.download_url IS NOT NULL`)
  if (params.haspub === '1') {
    push(`(EXISTS (SELECT 1 FROM references_cited rc WHERE rc.target_dataset_id = d.id)
       OR EXISTS (SELECT 1 FROM datasets_rels dr WHERE dr.parent_id = d.id AND dr.path = 'relatedPublications'))`)
  }
  if (params.longterm === '1') {
    push(`d.temporal_extent_start IS NOT NULL AND d.temporal_extent_end IS NOT NULL
      AND extract(year FROM d.temporal_extent_end) - extract(year FROM d.temporal_extent_start) >= 10`)
  }
  // Data-coverage overlap (data years, NOT publication year)
  const from = params.from && /^\d{4}$/.test(params.from) ? parseInt(params.from) : null
  const to = params.to && /^\d{4}$/.test(params.to) ? parseInt(params.to) : null
  if (from) push(`d.temporal_extent_end >= make_date($${i}, 1, 1)`, from)
  if (to) push(`d.temporal_extent_start <= make_date($${i}, 12, 31)`, to)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const orderSql =
    sort === 'cited' ? `coalesce(d.external_citation_count, 0) DESC, d.publication_year DESC NULLS LAST`
    : sort === 'coverage' ? `(extract(year FROM d.temporal_extent_end) - extract(year FROM d.temporal_extent_start)) DESC NULLS LAST`
    : sort === 'title' ? `d.title ASC`
    : `d.publication_year DESC NULLS LAST, d.id DESC`

  const [{ rows }, { rows: [{ total }] }, facets] = await Promise.all([
    db.query(
      `SELECT d.id, d.title, d.publication_year, d.repository, d.license, d.download_url,
              d.external_citation_count, d.sdp_catalog_id, d.gsd,
              d.temporal_extent_start, d.temporal_extent_end,
              (SELECT string_agg(DISTINCT p.name, ' · ') FROM (
                 SELECT pl.name FROM entity_mentions em JOIN places pl ON pl.id = em.entity_id
                 WHERE em.collection='datasets' AND em.item_id = d.id AND em.entity_type='place'
                 LIMIT 3) p) AS place_names
       FROM datasets d ${whereSql} ORDER BY ${orderSql} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      values,
    ),
    db.query(`SELECT count(*)::int AS total FROM datasets d ${whereSql}`, values),
    Promise.all([
      db.query(`SELECT em.entity_id AS id, pl.name, count(*)::int AS n FROM entity_mentions em JOIN places pl ON pl.id = em.entity_id
                WHERE em.collection='datasets' AND em.entity_type='place' GROUP BY 1,2 ORDER BY n DESC LIMIT 10`),
      db.query(`SELECT em.entity_id AS id, pr.name, count(*)::int AS n FROM entity_mentions em JOIN protocols pr ON pr.id = em.entity_id
                WHERE em.collection='datasets' AND em.entity_type='protocol' GROUP BY 1,2 ORDER BY n DESC LIMIT 10`),
      db.query(`SELECT em.entity_id AS id, sp.canonical_name AS name, count(*)::int AS n FROM entity_mentions em JOIN species sp ON sp.id = em.entity_id
                WHERE em.collection='datasets' AND em.entity_type='species' GROUP BY 1,2 ORDER BY n DESC LIMIT 10`),
      db.query(`SELECT license AS v, count(*)::int AS n FROM datasets WHERE license IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
      db.query(`SELECT repository AS v, count(*)::int AS n FROM datasets WHERE repository IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
      db.query(`SELECT f.value AS v, count(DISTINCT f.parent_id)::int AS n FROM datasets_data_format f GROUP BY 1 ORDER BY n DESC LIMIT 8`),
      db.query(`SELECT v, count(*)::int AS n FROM (SELECT unnest(keywords) AS v FROM datasets) u GROUP BY 1 ORDER BY n DESC LIMIT 14`),
      db.query(`SELECT v, count(*)::int AS n FROM (SELECT unnest(variables) AS v FROM datasets) u GROUP BY 1 ORDER BY n DESC LIMIT 14`),
    ]),
  ])
  const [placeFacet, protocolFacet, speciesFacet, licenseFacet, repoFacet, formatFacet, keywordFacet, variableFacet] = facets.map((f) => f.rows)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fmtYear = (d: string | null) => (d ? new Date(d).getUTCFullYear() : null)

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 'var(--r-pill)', fontSize: 'var(--fs-caption)', textDecoration: 'none',
    border: '1px solid var(--color-border)', color: active ? '#fff' : 'inherit',
    background: active ? 'var(--color-badge-data)' : 'var(--color-surface)',
  })
  const facetLink = (active: boolean): React.CSSProperties => ({
    fontWeight: active ? 700 : 400, color: active ? 'var(--color-accent)' : 'inherit', textDecoration: 'none', fontSize: '13px',
  })

  const entityFacetBlock = (label: string, key: 'place' | 'protocol' | 'species', rows: any[], italic = false) => (
    <div className="filter-group">
      <h2 className="filter-label">{label}</h2>
      {rows.map((r) => (
        <label key={r.id} style={{ display: 'block' }}>
          <Link href={buildUrl(params, { [key]: params[key] === String(r.id) ? undefined : String(r.id), page: undefined })}
                style={{ ...facetLink(params[key] === String(r.id)), fontStyle: italic ? 'italic' : undefined }}>
            {r.name} ({r.n})
          </Link>
        </label>
      ))}
    </div>
  )

  const activeSummary = [
    params.q ? `matching “${params.q}”` : null,
    params.longterm === '1' ? 'long-term records' : null,
    params.haspub === '1' ? 'with companion publication' : null,
    params.download === '1' ? 'direct download' : null,
    from || to ? `covering ${from ?? '…'}–${to ?? '…'}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Datasets</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          Research datasets from RMBL, the Spatial Data Platform, and partner repositories.
          Coverage filters use <strong>data years</strong> (when measurements were made), not publication dates.
        </p>
        <form className="search-form" action="/datasets" method="GET">
          <label htmlFor="datasets-q" className="sr-only">Search datasets</label>
          <input id="datasets-q" className="search-input" type="text" name="q" aria-label="Search datasets"
                 defaultValue={params.q || ''} placeholder="Search datasets..." />
          {Object.entries(params).filter(([k, v]) => !['q', 'page'].includes(k) && v).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <button className="search-button" type="submit">Search</button>
        </form>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <Link href={buildUrl(params, { longterm: params.longterm === '1' ? undefined : '1', page: undefined })} style={chip(params.longterm === '1')}>
            Long-term records (10+ yrs)
          </Link>
          <Link href={buildUrl(params, { haspub: params.haspub === '1' ? undefined : '1', page: undefined })} style={chip(params.haspub === '1')}>
            Has companion publication
          </Link>
          <Link href={buildUrl(params, { download: params.download === '1' ? undefined : '1', page: undefined })} style={chip(params.download === '1')}>
            Direct download
          </Link>
          <Link href="/explore/datasets" style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: '12px', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', textDecoration: 'none' }}>Explore Dataset Graph</Link>
        </div>

        <p className="results-count" aria-live="polite">
          {total.toLocaleString()} dataset{total === 1 ? '' : 's'}{activeSummary ? ` · ${activeSummary}` : ''}
        </p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h2 className="filter-label">Sort By</h2>
            {SORT_OPTIONS.map((o) => (
              <label key={o.value} style={{ display: 'block' }}>
                <Link href={buildUrl(params, { sort: o.value === 'newest' ? undefined : o.value, page: undefined })} style={facetLink(sort === o.value)}>
                  {o.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h2 className="filter-label">Data Coverage</h2>
            <form action="/datasets" method="GET">
              {Object.entries(params).filter(([k]) => !['from', 'to', 'page'].includes(k)).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input name="from" type="number" placeholder="From" defaultValue={params.from || ''} min={1900} max={2030} aria-label="Coverage from year"
                       style={{ width: '68px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>–</span>
                <input name="to" type="number" placeholder="To" defaultValue={params.to || ''} min={1900} max={2030} aria-label="Coverage to year"
                       style={{ width: '68px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                <button type="submit" style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer' }}>Go</button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>years the data covers</div>
            </form>
          </div>

          {entityFacetBlock('Place', 'place', placeFacet)}
          {entityFacetBlock('Method', 'protocol', protocolFacet)}
          {entityFacetBlock('Taxon', 'species', speciesFacet, true)}

          {variableFacet.length > 0 && (
            <div className="filter-group">
              <h2 className="filter-label">Variables</h2>
              {variableFacet.map((r: any) => (
                <label key={r.v} style={{ display: 'block' }}>
                  <Link href={buildUrl(params, { variable: params.variable === r.v ? undefined : r.v, page: undefined })} style={facetLink(params.variable === r.v)}>
                    {r.v} ({r.n})
                  </Link>
                </label>
              ))}
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>from ESS-DIVE data dictionaries</div>
            </div>
          )}

          {keywordFacet.length > 0 && (
            <div className="filter-group">
              <h2 className="filter-label">Keywords</h2>
              {keywordFacet.map((r: any) => (
                <label key={r.v} style={{ display: 'block' }}>
                  <Link href={buildUrl(params, { keyword: params.keyword === r.v ? undefined : r.v, page: undefined })} style={facetLink(params.keyword === r.v)}>
                    {r.v} ({r.n})
                  </Link>
                </label>
              ))}
            </div>
          )}

          {formatFacet.length > 0 && (
            <div className="filter-group">
              <h2 className="filter-label">Format</h2>
              {formatFacet.map((r: any) => (
                <label key={r.v} style={{ display: 'block' }}>
                  <Link href={buildUrl(params, { format: params.format === r.v ? undefined : r.v, page: undefined })} style={facetLink(params.format === r.v)}>
                    {r.v} ({r.n})
                  </Link>
                </label>
              ))}
            </div>
          )}

          <div className="filter-group">
            <h2 className="filter-label">License</h2>
            {licenseFacet.map((r: any) => (
              <label key={r.v} style={{ display: 'block' }}>
                <Link href={buildUrl(params, { license: params.license === r.v ? undefined : r.v, page: undefined })} style={facetLink(params.license === r.v)}>
                  {LICENSE_LABELS[r.v] ?? r.v} ({r.n})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h2 className="filter-label">Repository</h2>
            {repoFacet.map((r: any) => (
              <label key={r.v} style={{ display: 'block' }}>
                <Link href={buildUrl(params, { repo: params.repo === r.v ? undefined : r.v, page: undefined })} style={facetLink(params.repo === r.v)}>
                  {REPO_LABELS[r.v] ?? r.v} ({r.n})
                </Link>
              </label>
            ))}
          </div>
        </aside>

        <div>
          {rows.length === 0 && <p style={{ color: 'var(--fg-2)' }}>No datasets match these filters.</p>}
          {rows.map((d: any) => {
            const y0 = fmtYear(d.temporal_extent_start)
            const y1 = fmtYear(d.temporal_extent_end)
            const span = y0 !== null && y1 !== null ? y1 - y0 : null
            return (
              <div key={d.id} className="result-card" style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="badge badge-dataset">{REPO_LABELS[d.repository] ?? 'Dataset'}</span>
                  {span !== null && span >= 10 && (
                    <span className="badge" style={{ background: 'var(--color-surface)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}>
                      {span}-year record
                    </span>
                  )}
                </div>
                <h3 style={{ margin: '6px 0 4px' }}>
                  <Link href={`/datasets/${d.id}`}>{d.title}</Link>
                </h3>
                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {d.publication_year && <span>Published {d.publication_year}</span>}
                  {y0 !== null && y1 !== null && <span>Data {y0}–{y1}</span>}
                  {d.gsd && <span>{d.gsd < 1 ? `${Math.round(d.gsd * 100)} cm` : `${d.gsd} m`} resolution</span>}
                  {d.external_citation_count > 0 && <span>{d.external_citation_count} citation{d.external_citation_count === 1 ? '' : 's'}</span>}
                  {isHttpUrl(d.download_url) && <span>direct download</span>}
                  {d.place_names && <span>{d.place_names}</span>}
                </div>
              </div>
            )
          })}

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '12px', marginTop: '18px', fontSize: '14px' }}>
              {page > 1 && <Link href={buildUrl(params, { page: String(page - 1) })}>&larr; Previous</Link>}
              <span style={{ color: 'var(--color-text-muted)' }}>Page {page} of {totalPages}</span>
              {page < totalPages && <Link href={buildUrl(params, { page: String(page + 1) })}>Next &rarr;</Link>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
