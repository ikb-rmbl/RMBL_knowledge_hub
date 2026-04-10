import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Where } from 'payload'
import { getBadgeLabel, getBadgeClass } from '../lib/badges'
import type { SearchResult as FtsResult } from '../api/search/route'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

/** Strip all HTML tags from a string */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** Full-text search using PostgreSQL tsvector with ranked results and snippets */
async function tsvectorSearch(
  query: string,
  typeFilter: string,
  sortBy: string,
  limit: number,
  offset: number,
): Promise<{ results: ResultItem[]; total: number }> {
  const db = getDb()
  const results: ResultItem[] = []
  let total = 0

  // Map sort param to SQL ORDER BY per collection
  function orderBy(dateCol: string, collection: string): string {
    switch (sortBy) {
      case 'oldest': return `${dateCol} ASC NULLS LAST`
      case 'title': return 'title ASC'
      case 'title-desc': return 'title DESC'
      case 'newest': return `${dateCol} DESC NULLS LAST`
      case 'most-cited':
        return collection === 'documents' ? 'rank DESC' : 'external_citation_count DESC NULLS LAST'
      case 'most-cited-internal':
        return collection === 'documents' ? 'rank DESC' : 'internal_citation_count DESC NULLS LAST'
      case 'relevance':
      default: return 'rank DESC'
    }
  }

  const searchDocs = !typeFilter || typeFilter === 'documents'
  const searchPubs = !typeFilter || typeFilter === 'publications'
  const searchData = !typeFilter || typeFilter === 'datasets'

  if (searchDocs) {
    const { rows } = await db.query(
      `SELECT id, title,
              ts_headline('english', coalesce(full_text, title, ''), plainto_tsquery('english', $1),
                'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>') as snippet,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank,
              date_original
       FROM documents WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBy('date_original', 'documents')} LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    )
    for (const row of rows) {
      const yearStr = row.date_original ? new Date(row.date_original).getFullYear().toString() : null
      results.push({ collection: 'document', subtype: null, id: String(row.id), title: row.title, snippet: row.snippet || '', year: yearStr ? parseInt(yearStr) : null, meta: [yearStr].filter(Boolean) as string[], rank: parseFloat(row.rank) || 0 })
    }
    const countRes = await db.query("SELECT count(*)::int FROM documents WHERE search_vector @@ plainto_tsquery('english', $1)", [query])
    total += countRes.rows[0].count
  }

  if (searchPubs) {
    const { rows } = await db.query(
      `SELECT p.id, p.title, p.year, p.journal, p.doi, p.publication_type,
              ts_headline('english', coalesce(p.abstract, p.full_text, p.title, ''), plainto_tsquery('english', $1),
                'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>') as snippet,
              ts_rank(p.search_vector, plainto_tsquery('english', $1)) as rank,
              coalesce(p.external_citation_count, 0) as external_citation_count,
              (SELECT count(*)::int FROM references_cited r WHERE r.target_publication_id = p.id) as internal_citation_count
       FROM publications p WHERE p.search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBy('p.year', 'publications')} LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    )
    for (const row of rows) {
      results.push({ collection: 'publication', subtype: row.publication_type || null, id: String(row.id), title: row.title, snippet: row.snippet || '', year: row.year || null, meta: [row.journal, row.year ? String(row.year) : '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean), rank: parseFloat(row.rank) || 0, externalCitationCount: row.external_citation_count, internalCitationCount: row.internal_citation_count })
    }
    const countRes = await db.query("SELECT count(*)::int FROM publications WHERE search_vector @@ plainto_tsquery('english', $1)", [query])
    total += countRes.rows[0].count
  }

  if (searchData) {
    const { rows } = await db.query(
      `SELECT d.id, d.title, d.publication_year, d.resource_type,
              ts_headline('english', coalesce(d.full_text, d.title, ''), plainto_tsquery('english', $1),
                'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>') as snippet,
              ts_rank(d.search_vector, plainto_tsquery('english', $1)) as rank,
              coalesce(d.external_citation_count, 0) as external_citation_count,
              (SELECT count(*)::int FROM references_cited r WHERE r.target_dataset_id = d.id) as internal_citation_count
       FROM datasets d WHERE d.search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ${orderBy('d.publication_year', 'datasets')} LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    )
    for (const row of rows) {
      results.push({ collection: 'dataset', subtype: row.resource_type || null, id: String(row.id), title: row.title, snippet: row.snippet || '', year: row.publication_year || null, meta: [row.publication_year ? String(row.publication_year) : ''].filter(Boolean), rank: parseFloat(row.rank) || 0, externalCitationCount: row.external_citation_count, internalCitationCount: row.internal_citation_count })
    }
    const countRes = await db.query("SELECT count(*)::int FROM datasets WHERE search_vector @@ plainto_tsquery('english', $1)", [query])
    total += countRes.rows[0].count
  }

  // Re-sort merged results across collections (critical for relevance — without this,
  // documents appear before publications regardless of ts_rank score)
  if (sortBy === 'relevance') results.sort((a, b) => (b.rank || 0) - (a.rank || 0))
  else if (sortBy === 'newest') results.sort((a, b) => (b.year || 0) - (a.year || 0))
  else if (sortBy === 'oldest') results.sort((a, b) => (a.year || 0) - (b.year || 0))
  else if (sortBy === 'title') results.sort((a, b) => a.title.localeCompare(b.title))
  else if (sortBy === 'title-desc') results.sort((a, b) => b.title.localeCompare(a.title))
  else if (sortBy === 'most-cited') results.sort((a, b) => (b.externalCitationCount || 0) - (a.externalCitationCount || 0))
  else if (sortBy === 'most-cited-internal') results.sort((a, b) => (b.internalCitationCount || 0) - (a.internalCitationCount || 0))
  return { results: results.slice(0, limit), total }
}

const PUB_TYPE_OPTIONS = [
  { value: 'article', label: 'Journal Article' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book Chapter' },
  { value: 'student_paper', label: 'Student Paper' },
  { value: 'other', label: 'Other' },
]

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Date (Newest)' },
  { value: 'oldest', label: 'Date (Oldest)' },
  { value: 'title', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
  { value: 'most-cited', label: 'Most Cited' },
  { value: 'most-cited-internal', label: 'Most Cited (in Hub)' },
]

interface SearchParams {
  q?: string
  type?: string
  topic?: string
  pubType?: string
  yearFrom?: string
  yearTo?: string
  sort?: string
  page?: string
}

type ResultItem = {
  collection: 'document' | 'publication' | 'dataset'
  subtype: string | null
  id: string
  title: string
  snippet: string
  year: number | null
  meta: string[]
  rank?: number
  externalCitationCount?: number
  internalCitationCount?: number
}

/** Build a URL preserving all current filters, overriding specific params */
function buildUrl(current: SearchParams, overrides: Record<string, string | undefined>): string {
  const merged = { ...current, ...overrides }
  const p = new URLSearchParams()
  if (merged.q) p.set('q', merged.q)
  if (merged.type) p.set('type', merged.type)
  if (merged.topic) p.set('topic', merged.topic)
  if (merged.pubType) p.set('pubType', merged.pubType)
  if (merged.yearFrom) p.set('yearFrom', merged.yearFrom)
  if (merged.yearTo) p.set('yearTo', merged.yearTo)
  if (merged.sort) p.set('sort', merged.sort)
  if (merged.page && merged.page !== '1') p.set('page', merged.page)
  return `/search?${p.toString()}`
}

/** Map our sort param to a Payload sort string per collection */
function payloadSort(sortParam: string, collection: 'documents' | 'publications' | 'datasets'): string {
  const dateField =
    collection === 'publications' ? 'year' : collection === 'datasets' ? 'publicationYear' : 'dateOriginal'
  switch (sortParam) {
    case 'oldest':
      return dateField
    case 'title':
      return 'title'
    case 'title-desc':
      return '-title'
    case 'newest':
    default:
      return `-${dateField}`
  }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const query = params.q || ''
  const typeFilter = params.type || ''
  const topicFilter = params.topic || ''
  const pubTypeFilter = params.pubType || ''
  const yearFrom = params.yearFrom ? parseInt(params.yearFrom) : null
  const yearTo = params.yearTo ? parseInt(params.yearTo) : null
  const defaultSort = query ? 'relevance' : (typeFilter === 'publications' ? 'most-cited' : 'newest')
  const sortParam = params.sort || defaultSort
  const page = Math.max(1, parseInt(params.page || '1'))

  const payload = await getPayload({ config })

  // Use tsvector full-text search when there's a query text
  // This provides ranked results with stemming and snippet highlighting
  const useFts = Boolean(query) && !topicFilter && !pubTypeFilter && !yearFrom && !yearTo
  let results: ResultItem[] = []
  let totalResults = 0

  if (useFts) {
    const ftsOffset = (page - 1) * PAGE_SIZE
    const fts = await tsvectorSearch(query, typeFilter, sortParam, PAGE_SIZE, ftsOffset)
    results = fts.results
    totalResults = fts.total
  }

  // Resolve topic ID — if it's a parent topic, also include all children
  let topicIds: string[] = []
  if (topicFilter) {
    const topicResult = await payload.find({
      collection: 'topics',
      where: { name: { equals: topicFilter } },
      limit: 1,
    })
    if (topicResult.docs.length > 0) {
      const parentId = String(topicResult.docs[0].id)
      topicIds = [parentId]
      // Check for children
      const children = await payload.find({
        collection: 'topics',
        where: { parent: { equals: parentId } },
        limit: 500,
      })
      topicIds.push(...children.docs.map((c) => String(c.id)))
    }
  }

  if (!useFts) {
  // Payload-based search (used when browsing with filters but no text query,
  // or when combining text query with topic/date/pubType filters)

  const searchDocs = !typeFilter || typeFilter === 'documents'
  const searchPubs = !typeFilter || typeFilter === 'publications'
  const searchData = !typeFilter || typeFilter === 'datasets'

  // Topic filter: match any of the IDs (parent + children)
  const topicWhere = (field: string): Where =>
    topicIds.length === 1
      ? { [field]: { equals: topicIds[0] } }
      : topicIds.length > 1
        ? { or: topicIds.map((id) => ({ [field]: { equals: id } })) }
        : {}

  // --- Build where clauses ---
  const docWhere: Where = {}
  if (query) docWhere.title = { contains: query }
  if (topicIds.length > 0) Object.assign(docWhere, topicWhere('categories'))
  if (yearFrom) docWhere['dateOriginal'] = { ...(docWhere['dateOriginal'] as any), greater_than_equal: `${yearFrom}-01-01` }
  if (yearTo) docWhere['dateOriginal'] = { ...(docWhere['dateOriginal'] as any), less_than_equal: `${yearTo}-12-31` }

  const pubWhere: Where = {}
  if (query) pubWhere.title = { contains: query }
  if (topicIds.length > 0) Object.assign(pubWhere, topicWhere('researchTopics'))
  if (pubTypeFilter) pubWhere.publicationType = { equals: pubTypeFilter }
  if (yearFrom) pubWhere.year = { ...(pubWhere.year as any), greater_than_equal: yearFrom }
  if (yearTo) pubWhere.year = { ...(pubWhere.year as any), less_than_equal: yearTo }

  const dataWhere: Where = {}
  if (query) dataWhere.title = { contains: query }
  if (topicIds.length > 0) Object.assign(dataWhere, topicWhere('tags'))
  if (yearFrom) dataWhere.publicationYear = { ...(dataWhere.publicationYear as any), greater_than_equal: yearFrom }
  if (yearTo) dataWhere.publicationYear = { ...(dataWhere.publicationYear as any), less_than_equal: yearTo }

  // --- Fetch counts for all searched collections ---
  const [docTotal, pubTotal, dataTotal] = await Promise.all([
    searchDocs ? payload.count({ collection: 'documents', where: docWhere }) : { totalDocs: 0 },
    searchPubs ? payload.count({ collection: 'publications', where: pubWhere }) : { totalDocs: 0 },
    searchData ? payload.count({ collection: 'datasets', where: dataWhere }) : { totalDocs: 0 },
  ])
  totalResults = docTotal.totalDocs + pubTotal.totalDocs + dataTotal.totalDocs

  // --- For single-collection view, paginate directly ---
  // --- For "All" view, compute per-collection offsets to interleave results ---
  const isCitationSort = sortParam === 'most-cited' || sortParam === 'most-cited-internal'

  if (typeFilter) {
    // Single collection: straightforward pagination
    if (searchDocs) {
      const docs = await payload.find({ collection: 'documents', where: docWhere, limit: PAGE_SIZE, page, sort: payloadSort(sortParam, 'documents') })
      for (const doc of docs.docs) {
        const yearStr = (doc.dateOriginal as string)?.slice(0, 4)
        results.push({ collection: 'document', subtype: null, id: String(doc.id), title: doc.title, snippet: typeof doc.summary === 'string' ? stripTags(doc.summary) : '', year: yearStr ? parseInt(yearStr) : null, meta: [yearStr, ...(doc.geographicScope as string[] || [])].filter(Boolean) })
      }
    }
    if (searchPubs) {
      if (isCitationSort) {
        // Use direct SQL for citation sorts (Payload can't sort by custom columns)
        const db = getDb()
        const citationOrderCol = sortParam === 'most-cited' ? 'external_citation_count' : `(SELECT count(*) FROM references_cited r WHERE r.target_publication_id = p.id)`
        const offset = (page - 1) * PAGE_SIZE
        const whereClauses: string[] = []
        const params: any[] = []
        let paramIdx = 1
        if (query) { whereClauses.push(`title ILIKE $${paramIdx}`); params.push(`%${query}%`); paramIdx++ }
        if (pubTypeFilter) { whereClauses.push(`publication_type = $${paramIdx}`); params.push(pubTypeFilter); paramIdx++ }
        if (yearFrom) { whereClauses.push(`year >= $${paramIdx}`); params.push(yearFrom); paramIdx++ }
        if (yearTo) { whereClauses.push(`year <= $${paramIdx}`); params.push(yearTo); paramIdx++ }
        const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
        const { rows } = await db.query(
          `SELECT p.id, p.title, p.year, p.journal, p.doi, p.publication_type, p.abstract,
                  coalesce(p.external_citation_count, 0) as external_citation_count,
                  (SELECT count(*)::int FROM references_cited r WHERE r.target_publication_id = p.id) as internal_citation_count
           FROM publications p ${whereStr}
           ORDER BY ${citationOrderCol} DESC NULLS LAST
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, PAGE_SIZE, offset],
        )
        for (const row of rows) {
          results.push({ collection: 'publication', subtype: row.publication_type || null, id: String(row.id), title: row.title, snippet: row.abstract ? stripTags(row.abstract) : '', year: row.year || null, meta: [row.year ? String(row.year) : '', row.journal || '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean), externalCitationCount: row.external_citation_count, internalCitationCount: row.internal_citation_count })
        }
      } else {
        const pubs = await payload.find({ collection: 'publications', where: pubWhere, limit: PAGE_SIZE, page, sort: payloadSort(sortParam, 'publications') })
        for (const pub of pubs.docs) {
          const authors = Array.isArray(pub.authors) ? pub.authors.slice(0, 3).map((a: any) => `${a.family}${a.given ? ' ' + a.given : ''}`).join(', ') : ''
          results.push({ collection: 'publication', subtype: pub.publicationType || null, id: String(pub.id), title: pub.title, snippet: pub.abstract ? stripTags(pub.abstract) : '', year: pub.year || null, meta: [authors, pub.year ? String(pub.year) : '', pub.journal || '', pub.doi ? `DOI: ${pub.doi}` : ''].filter(Boolean) })
        }
      }
    }
    if (searchData) {
      if (isCitationSort) {
        const db = getDb()
        const citationOrderCol = sortParam === 'most-cited' ? 'external_citation_count' : `(SELECT count(*) FROM references_cited r WHERE r.target_dataset_id = d.id)`
        const offset = (page - 1) * PAGE_SIZE
        const whereClauses: string[] = []
        const params: any[] = []
        let paramIdx = 1
        if (query) { whereClauses.push(`title ILIKE $${paramIdx}`); params.push(`%${query}%`); paramIdx++ }
        if (yearFrom) { whereClauses.push(`publication_year >= $${paramIdx}`); params.push(yearFrom); paramIdx++ }
        if (yearTo) { whereClauses.push(`publication_year <= $${paramIdx}`); params.push(yearTo); paramIdx++ }
        const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
        const { rows } = await db.query(
          `SELECT d.id, d.title, d.publication_year, d.resource_type, d.description, d.doi,
                  coalesce(d.external_citation_count, 0) as external_citation_count,
                  (SELECT count(*)::int FROM references_cited r WHERE r.target_dataset_id = d.id) as internal_citation_count
           FROM datasets d ${whereStr}
           ORDER BY ${citationOrderCol} DESC NULLS LAST
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, PAGE_SIZE, offset],
        )
        for (const row of rows) {
          results.push({ collection: 'dataset', subtype: row.resource_type || null, id: String(row.id), title: row.title, snippet: row.description && typeof row.description === 'string' ? stripTags(row.description) : '', year: row.publication_year || null, meta: [row.publication_year ? String(row.publication_year) : '', row.doi ? `DOI: ${row.doi}` : ''].filter(Boolean), externalCitationCount: row.external_citation_count, internalCitationCount: row.internal_citation_count })
        }
      } else {
        const datasets = await payload.find({ collection: 'datasets', where: dataWhere, limit: PAGE_SIZE, page, sort: payloadSort(sortParam, 'datasets') })
        for (const ds of datasets.docs) {
          const creators = Array.isArray(ds.creators) ? ds.creators.slice(0, 3).map((c: any) => c.name).join(', ') : ''
          results.push({ collection: 'dataset', subtype: ds.resourceType || null, id: String(ds.id), title: ds.title, snippet: ds.description && typeof ds.description === 'string' ? stripTags(ds.description) : '', year: ds.publicationYear || null, meta: [creators, ds.publicationYear ? String(ds.publicationYear) : '', ds.doi ? `DOI: ${ds.doi}` : ''].filter(Boolean) })
        }
      }
    }
  } else {
    // "All" view: proportional pagination across collections
    // Allocate PAGE_SIZE slots proportionally to each collection's result count
    const total = totalResults || 1
    const docSlots = Math.round((docTotal.totalDocs / total) * PAGE_SIZE) || (docTotal.totalDocs > 0 ? 1 : 0)
    const dataSlots = Math.round((dataTotal.totalDocs / total) * PAGE_SIZE) || (dataTotal.totalDocs > 0 ? 1 : 0)
    const pubSlots = PAGE_SIZE - docSlots - dataSlots

    // Calculate per-collection page from the global page
    const docPage = Math.ceil((page * docSlots) / (docSlots || 1))
    const pubPage = Math.ceil((page * pubSlots) / (pubSlots || 1))
    const dataPage = Math.ceil((page * dataSlots) / (dataSlots || 1))

    const [docs, pubs, datasets] = await Promise.all([
      docSlots > 0 ? payload.find({ collection: 'documents', where: docWhere, limit: docSlots, page: docPage, sort: payloadSort(sortParam, 'documents') }) : { docs: [] },
      pubSlots > 0 ? payload.find({ collection: 'publications', where: pubWhere, limit: pubSlots, page: pubPage, sort: payloadSort(sortParam, 'publications') }) : { docs: [] },
      dataSlots > 0 ? payload.find({ collection: 'datasets', where: dataWhere, limit: dataSlots, page: dataPage, sort: payloadSort(sortParam, 'datasets') }) : { docs: [] },
    ])

    for (const doc of docs.docs) {
      const yearStr = (doc.dateOriginal as string)?.slice(0, 4)
      results.push({ collection: 'document', subtype: null, id: String(doc.id), title: doc.title, snippet: typeof doc.summary === 'string' ? stripTags(doc.summary) : '', year: yearStr ? parseInt(yearStr) : null, meta: [yearStr, ...(doc.geographicScope as string[] || [])].filter(Boolean) })
    }
    for (const pub of pubs.docs) {
      const authors = Array.isArray(pub.authors) ? pub.authors.slice(0, 3).map((a: any) => `${a.family}${a.given ? ' ' + a.given : ''}`).join(', ') : ''
      results.push({ collection: 'publication', subtype: pub.publicationType || null, id: String(pub.id), title: pub.title, snippet: pub.abstract ? stripTags(pub.abstract) : '', year: pub.year || null, meta: [authors, pub.year ? String(pub.year) : '', pub.journal || '', pub.doi ? `DOI: ${pub.doi}` : ''].filter(Boolean) })
    }
    for (const ds of datasets.docs) {
      const creators = Array.isArray(ds.creators) ? ds.creators.slice(0, 3).map((c: any) => c.name).join(', ') : ''
      results.push({ collection: 'dataset', subtype: ds.resourceType || null, id: String(ds.id), title: ds.title, snippet: ds.description && typeof ds.description === 'string' ? stripTags(ds.description) : '', year: ds.publicationYear || null, meta: [creators, ds.publicationYear ? String(ds.publicationYear) : '', ds.doi ? `DOI: ${ds.doi}` : ''].filter(Boolean) })
    }

    // Sort merged results
    if (sortParam === 'newest') results.sort((a, b) => (b.year || 0) - (a.year || 0))
    else if (sortParam === 'oldest') results.sort((a, b) => (a.year || 0) - (b.year || 0))
    else if (sortParam === 'title') results.sort((a, b) => a.title.localeCompare(b.title))
    else if (sortParam === 'title-desc') results.sort((a, b) => b.title.localeCompare(a.title))
    else if (sortParam === 'most-cited') results.sort((a, b) => (b.externalCitationCount || 0) - (a.externalCitationCount || 0))
    else if (sortParam === 'most-cited-internal') results.sort((a, b) => (b.internalCitationCount || 0) - (a.internalCitationCount || 0))
  }

  // Enrich results with citation counts from SQL (for display in result cards)
  // Runs for both FTS and Payload paths — skips items that already have counts
  {
    const db = getDb()
    const pubIds = results.filter((r) => r.collection === 'publication' && r.externalCitationCount == null).map((r) => parseInt(r.id))
    const dsIds = results.filter((r) => r.collection === 'dataset' && r.externalCitationCount == null).map((r) => parseInt(r.id))

    if (pubIds.length > 0) {
      const { rows: pubCounts } = await db.query(
        `SELECT id, coalesce(external_citation_count, 0) as ext
         FROM publications WHERE id = ANY($1)`,
        [pubIds],
      )
      const countMap = new Map(pubCounts.map((r: any) => [String(r.id), r.ext]))
      for (const r of results) {
        if (r.collection === 'publication' && r.externalCitationCount == null) {
          r.externalCitationCount = countMap.get(r.id) || 0
        }
      }
    }
    if (dsIds.length > 0) {
      const { rows: dsCounts } = await db.query(
        `SELECT id, coalesce(external_citation_count, 0) as ext
         FROM datasets WHERE id = ANY($1)`,
        [dsIds],
      )
      const countMap = new Map(dsCounts.map((r: any) => [String(r.id), r.ext]))
      for (const r of results) {
        if (r.collection === 'dataset' && r.externalCitationCount == null) {
          r.externalCitationCount = countMap.get(r.id) || 0
        }
      }
    }
  }

  } // end if (!useFts)

  const totalPages = Math.ceil(totalResults / PAGE_SIZE)

  // --- Entity search: surface matching species/places/protocols/concepts above results ---
  type EntityMatch = {
    type: 'species' | 'place' | 'protocol' | 'concept'
    id: number
    name: string
    detail: string
    snippet: string
    count: number
  }
  const entityMatches: EntityMatch[] = []

  if (query && query.length >= 2 && page === 1) {
    const db2 = getDb()
    const likeQ = `%${query}%`

    // Search each entity table — up to 5 per type, show 3 initially with expand
    const [spRows, plRows, prRows, coRows] = await Promise.all([
      db2.query(
        `SELECT id, canonical_name as name,
                coalesce(family, '') as detail,
                coalesce(common_names[1], '') || CASE WHEN kingdom IS NOT NULL THEN ' · ' || kingdom ELSE '' END as snippet,
                publication_count as count
         FROM species WHERE publication_count > 0
         AND (canonical_name ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(common_names) cn WHERE cn ILIKE $1) OR EXISTS (SELECT 1 FROM unnest(synonyms) syn WHERE syn ILIKE $1))
         ORDER BY publication_count DESC LIMIT 5`, [likeQ]),
      db2.query(
        `SELECT id, name,
                coalesce(place_type, '') as detail,
                coalesce(habitat_types[1], '') || CASE WHEN elevation_m IS NOT NULL THEN ' · ' || elevation_m || 'm' ELSE '' END as snippet,
                publication_count as count
         FROM places WHERE publication_count > 0
         AND (name ILIKE $1 OR $1 = ANY(aliases))
         ORDER BY publication_count DESC LIMIT 5`, [likeQ]),
      db2.query(
        `SELECT id, name,
                coalesce(category, '') as detail,
                coalesce(LEFT(description, 120), '') as snippet,
                publication_count as count
         FROM protocols WHERE name ILIKE $1 OR description ILIKE $1
         ORDER BY publication_count DESC LIMIT 5`, [likeQ]),
      db2.query(
        `SELECT id, name,
                coalesce(concept_type, '') as detail,
                coalesce(LEFT(definition, 120), '') as snippet,
                publication_count as count
         FROM concepts WHERE publication_count > 0
         AND (name ILIKE $1 OR $1 = ANY(aliases))
         ORDER BY publication_count DESC LIMIT 5`, [likeQ]),
    ])

    for (const r of spRows.rows) entityMatches.push({ type: 'species', ...r })
    for (const r of plRows.rows) entityMatches.push({ type: 'place', ...r })
    for (const r of prRows.rows) entityMatches.push({ type: 'protocol', ...r })
    for (const r of coRows.rows) entityMatches.push({ type: 'concept', ...r })

    // Sort by publication count descending
    entityMatches.sort((a, b) => b.count - a.count)
  }

  // Topics for sidebar — organized by group
  const SIDEBAR_TOPIC_GROUPS = [
    { group: 'Life Sciences', topics: ['Flowering & Pollination', 'Wildlife Behavior', 'Alpine & Subalpine Ecology', 'Forest Ecology', 'Freshwater Ecology', 'Plant Biology', 'Insect Ecology', 'Vertebrate Biology', 'Microbial Ecology', 'Genetics & Evolution', 'Biodiversity & Conservation', 'Invasive Species & Disturbance'] },
    { group: 'Earth & Water', topics: ['Hydrology & Watersheds', 'Snow & Ice', 'Groundwater', 'Water Quality', 'Geology & Tectonics', 'Soil Science', 'Geochemistry & Isotopes', 'Paleontology & Paleoecology'] },
    { group: 'Climate', topics: ['Climate Change Impacts', 'Weather & Atmospheric Science', 'Biogeochemical Cycling', 'Environmental Contamination'] },
    { group: 'Human Dimensions', topics: ['Mining & Mineral Resources', 'Land & Water Management', 'Archaeology & Cultural History', 'Community Planning', 'Energy Development', 'Recreation & Tourism'] },
    { group: 'Technology', topics: ['Remote Sensing & Imagery', 'Geospatial Analysis', 'Field Methods & Monitoring', 'Data Science & Modeling'] },
    { group: 'Places', topics: ['RMBL & Gothic', 'Gunnison Basin', 'Western Colorado Landscapes', 'Research Programs'] },
    { group: 'Education', topics: ['Science Education & Pedagogy', 'Mentoring & Research Training'] },
  ]

  // Active filter description
  const activeFilters: string[] = []
  if (query) activeFilters.push(`"${query}"`)
  if (topicFilter) activeFilters.push(`topic: ${topicFilter}`)
  if (pubTypeFilter) activeFilters.push(`type: ${PUB_TYPE_OPTIONS.find((o) => o.value === pubTypeFilter)?.label}`)
  if (yearFrom || yearTo) activeFilters.push(`years: ${yearFrom || '...'}-${yearTo || '...'}`)

  return (
    <>
      <div className="search-results-header">
        <form className="search-form" action="/search" method="GET">
          <input className="search-input" type="text" name="q" defaultValue={query} placeholder="Search..." />
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          {topicFilter && <input type="hidden" name="topic" value={topicFilter} />}
          {pubTypeFilter && <input type="hidden" name="pubType" value={pubTypeFilter} />}
          {yearFrom && <input type="hidden" name="yearFrom" value={String(yearFrom)} />}
          {yearTo && <input type="hidden" name="yearTo" value={String(yearTo)} />}
          {sortParam !== defaultSort && <input type="hidden" name="sort" value={sortParam} />}
          <button className="search-button" type="submit">Search</button>
        </form>

        <div className="type-chips" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
          <Link className={`type-chip ${!typeFilter ? 'active' : ''}`} href={buildUrl(params, { type: undefined, pubType: undefined, page: undefined })}>All</Link>
          <Link className={`type-chip ${typeFilter === 'documents' ? 'active' : ''}`} href={buildUrl(params, { type: 'documents', pubType: undefined, page: undefined })}>Documents</Link>
          <Link className={`type-chip ${typeFilter === 'publications' ? 'active' : ''}`} href={buildUrl(params, { type: 'publications', page: undefined })}>Publications</Link>
          <Link className={`type-chip ${typeFilter === 'datasets' ? 'active' : ''}`} href={buildUrl(params, { type: 'datasets', pubType: undefined, page: undefined })}>Datasets</Link>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="results-count">
            {totalResults.toLocaleString()} result{totalResults !== 1 ? 's' : ''}
            {activeFilters.length > 0 ? ` — ${activeFilters.join(', ')}` : ''}
          </p>
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
                  href={buildUrl(params, { sort: opt.value === defaultSort ? undefined : opt.value, page: undefined })}
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

          {/* Publication type (only when viewing publications or all) */}
          {(!typeFilter || typeFilter === 'publications') && (
            <div className="filter-group">
              <h4>Publication Type</h4>
              {PUB_TYPE_OPTIONS.map((opt) => (
                <label key={opt.value}>
                  <Link
                    href={buildUrl(params, {
                      pubType: pubTypeFilter === opt.value ? undefined : opt.value,
                      type: typeFilter || 'publications',
                      page: undefined,
                    })}
                    style={{
                      fontWeight: pubTypeFilter === opt.value ? 700 : 400,
                      color: pubTypeFilter === opt.value ? 'var(--color-accent)' : 'inherit',
                    }}
                  >
                    {opt.label}
                  </Link>
                </label>
              ))}
              {pubTypeFilter && (
                <Link href={buildUrl(params, { pubType: undefined, page: undefined })} style={{ fontSize: '13px', marginTop: '8px', display: 'block' }}>
                  Clear type filter
                </Link>
              )}
            </div>
          )}

          {/* Date range */}
          <div className="filter-group">
            <h4>Date Range</h4>
            <form action="/search" method="GET" className="date-filter-form">
              {/* Carry forward all current params */}
              {query && <input type="hidden" name="q" value={query} />}
              {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
              {topicFilter && <input type="hidden" name="topic" value={topicFilter} />}
              {pubTypeFilter && <input type="hidden" name="pubType" value={pubTypeFilter} />}
              {sortParam !== defaultSort && <input type="hidden" name="sort" value={sortParam} />}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="number"
                  name="yearFrom"
                  placeholder="From"
                  defaultValue={yearFrom || ''}
                  min={1900}
                  max={2030}
                  style={{ width: '70px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                <input
                  type="number"
                  name="yearTo"
                  placeholder="To"
                  defaultValue={yearTo || ''}
                  min={1900}
                  max={2030}
                  style={{ width: '70px', padding: '4px 6px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    background: 'var(--color-accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                  }}
                >
                  Go
                </button>
              </div>
            </form>
            {(yearFrom || yearTo) && (
              <Link href={buildUrl(params, { yearFrom: undefined, yearTo: undefined, page: undefined })} style={{ fontSize: '13px', marginTop: '8px', display: 'block' }}>
                Clear date filter
              </Link>
            )}
          </div>

          {/* Topics */}
          {SIDEBAR_TOPIC_GROUPS.map((g) => (
            <div className="filter-group" key={g.group}>
              <h4>{g.group}</h4>
              {g.topics.map((name) => (
                <label key={name}>
                  <Link
                    href={buildUrl(params, {
                      topic: topicFilter === name ? undefined : name,
                      page: undefined,
                    })}
                    style={{
                      fontWeight: topicFilter === name ? 700 : 400,
                      color: topicFilter === name ? 'var(--color-accent)' : 'inherit',
                    }}
                  >
                    {name}
                  </Link>
                </label>
              ))}
            </div>
          ))}
          {topicFilter && (
            <div className="filter-group">
              <Link href={buildUrl(params, { topic: undefined, page: undefined })} style={{ fontSize: '13px' }}>
                Clear topic filter
              </Link>
            </div>
          )}
        </aside>

        <div>
          {entityMatches.length > 0 && (() => {
            const INITIAL_SHOW = 3
            const hasMore = entityMatches.length > INITIAL_SHOW

            function renderEntityCard(em: EntityMatch) {
              const href = `/${em.type === 'species' ? 'species' : em.type === 'place' ? 'places' : em.type === 'protocol' ? 'protocols' : 'concepts'}/${em.id}`
              const badgeClass = em.type === 'species' ? 'badge-species' : em.type === 'place' ? 'badge-place' : em.type === 'protocol' ? 'badge-protocol' : 'badge-concept'
              return (
                <Link key={`${em.type}-${em.id}`} className="result-card" href={href}
                  style={{ borderLeft: '3px solid var(--color-accent)', flex: '1 1 0', minWidth: '220px' }}>
                  <div className="result-card-header">
                    <span className={`badge ${badgeClass}`}>{em.type}</span>
                    <h3 className="result-card-title" style={em.type === 'species' ? { fontStyle: 'italic' } : undefined}>
                      {em.name}
                    </h3>
                  </div>
                  {em.snippet && (
                    <p className="result-card-snippet" style={{ fontSize: '13px' }}>
                      {em.snippet.slice(0, 120)}{em.snippet.length > 120 ? '...' : ''}
                    </p>
                  )}
                  <div className="result-card-meta">
                    {em.detail && <span>{em.detail.replace(/_/g, ' ')}</span>}
                    <span>{em.count} paper{em.count !== 1 ? 's' : ''}</span>
                  </div>
                </Link>
              )
            }

            return (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {entityMatches.slice(0, INITIAL_SHOW).map(renderEntityCard)}
                </div>
                {hasMore && (
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                      Show {entityMatches.length - INITIAL_SHOW} more matching entities
                    </summary>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                      {entityMatches.slice(INITIAL_SHOW).map(renderEntityCard)}
                    </div>
                  </details>
                )}
              </div>
            )
          })()}

          <div className="result-list">
            {results.length === 0 && entityMatches.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', padding: '20px 0' }}>
                No results found. Try a different search term or broaden your filters.
              </p>
            )}
            {results.map((item) => {
              const slug = item.collection === 'document' ? 'documents' : item.collection === 'publication' ? 'publications' : 'datasets'
              return (
              <Link
                key={`${item.collection}-${item.id}`}
                className="result-card"
                href={`/${slug}/${item.id}`}
              >
                <div className="result-card-header">
                  <span className={getBadgeClass(item.collection)}>
                    {getBadgeLabel(item.collection, item.subtype)}
                  </span>
                  <h3 className="result-card-title">{item.title}</h3>
                </div>
                {item.snippet && (() => {
                  // FTS snippets have <mark> highlights from ts_headline; non-FTS are plain text.
                  // Split on <mark>/<\/mark> tags and render safely without dangerouslySetInnerHTML.
                  const text = item.snippet.replace(/<(?!\/?mark\b)[^>]*>/gi, '').replace(/&[a-z]+;/gi, ' ').slice(0, 300)
                  const parts = text.split(/(<mark>|<\/mark>)/gi)
                  let inMark = false
                  const elements: React.ReactNode[] = []
                  for (let i = 0; i < parts.length; i++) {
                    if (parts[i].toLowerCase() === '<mark>') { inMark = true; continue }
                    if (parts[i].toLowerCase() === '</mark>') { inMark = false; continue }
                    if (parts[i]) {
                      elements.push(inMark ? <mark key={i}>{parts[i]}</mark> : parts[i])
                    }
                  }
                  return <p className="result-card-snippet">{elements}</p>
                })()}
                <div className="result-card-meta">
                  {item.meta.map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                  {item.externalCitationCount != null && item.externalCitationCount > 0 && (
                    <span>Cited {item.externalCitationCount} times</span>
                  )}
                </div>
              </Link>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              {page > 1 && (
                <Link href={buildUrl(params, { page: String(page - 1) })}>Prev</Link>
              )}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                // Show pages around current page
                let p: number
                if (totalPages <= 7) {
                  p = i + 1
                } else if (page <= 4) {
                  p = i + 1
                } else if (page >= totalPages - 3) {
                  p = totalPages - 6 + i
                } else {
                  p = page - 3 + i
                }
                return (
                  <Link
                    key={p}
                    className={p === page ? 'active' : ''}
                    href={buildUrl(params, { page: String(p) })}
                  >
                    {p}
                  </Link>
                )
              })}
              {page < totalPages && (
                <Link href={buildUrl(params, { page: String(page + 1) })}>Next</Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
