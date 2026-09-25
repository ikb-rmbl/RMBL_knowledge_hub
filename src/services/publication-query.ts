/**
 * Publication advanced-query builder — field-scoped filters for publications,
 * shared by the `/search` advanced panel and the `/api/v1/export-search`
 * endpoint so "export" hands back exactly the result set on screen.
 *
 * Replicates the legacy RMBL Publications DB advanced form (Title / Author /
 * Keyword / Year start-end / Type) plus Journal and DOI. Fields AND together,
 * matching legacy behavior: every filled box narrows the set.
 *
 * Text fields match by case-insensitive substring rather than tsvector. That's
 * the legacy semantic ("part of a title") and it's what makes an Author box
 * useful — "Inouye" should hit without the searcher guessing initials. The
 * trigram indexes in z-2026-09-22-01 keep it off a sequential scan.
 */

/** Sorts the advanced panel adds on top of the unified-search sorts. */
export type PublicationSort =
  | 'relevance'
  | 'newest'
  | 'oldest'
  | 'title'
  | 'title-desc'
  | 'most-cited'
  | 'most-cited-internal'
  | 'year-type-author'
  | 'author'

export interface PublicationFilters {
  /** Free-text query; runs against search_vector (title/abstract/authors/keywords/full text). */
  q?: string
  title?: string
  author?: string
  keyword?: string
  journal?: string
  doi?: string
  yearFrom?: number | null
  yearTo?: number | null
  pubType?: string
  /** RMBL-research flag; only 'yes' filters (tri-state column, NULL = unreviewed). */
  rmblOnly?: boolean
  /** Program / campaign membership — a key of PROGRAM_FILTERS. */
  program?: ProgramKey
  /** Pre-resolved publication ids from a project assignment, or null for no project filter. */
  projectPubIds?: number[] | null
  /** Topic ids (parent + children, already resolved), or empty for no topic filter. */
  topicIds?: string[]
}

/**
 * Program / campaign filters. Only programs with a curated per-publication
 * flag belong here: the auto-assigned publication↔project links are
 * false-positive-heavy (see SHOW_PROJECT_LINKS), so the other RMBL programs
 * stay off until their membership is curated. Column names are fixed here,
 * never taken from the request.
 */
export const PROGRAM_FILTERS = {
  sfa: { label: 'Watershed Function SFA', column: 'sfa_program', payloadField: 'sfaProgram' },
  sail: { label: 'SAIL campaign', column: 'sail_program', payloadField: 'sailProgram' },
} as const
export type ProgramKey = keyof typeof PROGRAM_FILTERS

export function parseProgram(v: string | undefined | null): ProgramKey | undefined {
  return v && Object.prototype.hasOwnProperty.call(PROGRAM_FILTERS, v) ? (v as ProgramKey) : undefined
}

/** The advanced-panel fields, in render order. `q` is deliberately excluded —
 *  it's the quick box above the panel, not a panel field. */
export const ADVANCED_FIELDS = ['title', 'author', 'keyword', 'journal', 'doi'] as const
export type AdvancedField = (typeof ADVANCED_FIELDS)[number]

const MAX_FIELD_LENGTH = 200

/** Trim, drop empties, and cap length. Returns undefined for a field that
 *  shouldn't contribute a predicate. */
function clean(v: string | undefined | null): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (!t) return undefined
  return t.slice(0, MAX_FIELD_LENGTH)
}

function cleanYear(v: string | undefined | null): number | null {
  if (!v) return null
  const n = parseInt(String(v), 10)
  if (!Number.isFinite(n) || n < 1000 || n > 3000) return null
  return n
}

/**
 * Strip a DOI down to its bare form so `10.1234/abc`, `doi:10.1234/abc` and
 * `https://doi.org/10.1234/abc` all match the same stored value.
 */
export function normalizeDoiQuery(v: string): string {
  return v
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase()
}

/** Parse raw query-string values into validated filters. */
export function parsePublicationFilters(
  raw: Record<string, string | undefined>,
  projectPubIds: number[] | null = null,
): PublicationFilters {
  return {
    q: clean(raw.q),
    title: clean(raw.title),
    author: clean(raw.author),
    keyword: clean(raw.keyword),
    journal: clean(raw.journal),
    doi: clean(raw.doi),
    yearFrom: cleanYear(raw.yearFrom),
    yearTo: cleanYear(raw.yearTo),
    pubType: clean(raw.pubType),
    rmblOnly: raw.rmbl === 'yes',
    program: parseProgram(raw.program),
    projectPubIds,
  }
}

/** True when at least one advanced-panel field is in play, i.e. the panel
 *  should render open and the advanced query path should run. */
export function hasAdvancedFilters(f: PublicationFilters): boolean {
  return ADVANCED_FIELDS.some((k) => Boolean(f[k]))
}

export interface BuiltWhere {
  /** WHERE body without the `WHERE` keyword; 'TRUE' when unfiltered. */
  sql: string
  params: any[]
}

/**
 * Build the WHERE body for a publications query aliased as `p`.
 *
 * `startIndex` is the first $n placeholder to use, so callers that already
 * hold parameters (limit/offset, a second collection's query) can splice this
 * in without renumbering.
 */
export function buildPublicationWhere(f: PublicationFilters, startIndex = 1): BuiltWhere {
  const clauses: string[] = []
  const params: any[] = []
  let i = startIndex
  const add = (value: any): string => {
    params.push(value)
    return `$${i++}`
  }

  if (f.q) clauses.push(`p.search_vector @@ plainto_tsquery('english', ${add(f.q)})`)
  if (f.title) clauses.push(`p.title ILIKE ${add(`%${f.title}%`)}`)

  if (f.author) {
    // Match against family, given, and both assembled orderings, so
    // "Inouye", "David Inouye" and "Inouye, David" all land.
    const p = add(`%${f.author}%`)
    clauses.push(
      `EXISTS (SELECT 1 FROM publications_authors a
               WHERE a._parent_id = p.id
                 AND (a.family ILIKE ${p} OR a.given ILIKE ${p}
                      OR (a.given || ' ' || a.family) ILIKE ${p}
                      OR (a.family || ', ' || a.given) ILIKE ${p}))`,
    )
  }

  if (f.keyword) {
    clauses.push(
      `EXISTS (SELECT 1 FROM publications_keywords k
               WHERE k._parent_id = p.id AND k.keyword ILIKE ${add(`%${f.keyword}%`)})`,
    )
  }

  if (f.journal) clauses.push(`p.journal ILIKE ${add(`%${f.journal}%`)}`)

  if (f.doi) {
    // Stored DOIs are bare (`10.x/y`); the user may paste a resolver URL.
    clauses.push(`lower(p.doi) LIKE ${add(`%${normalizeDoiQuery(f.doi)}%`)}`)
  }

  if (f.yearFrom != null) clauses.push(`p.year >= ${add(f.yearFrom)}`)
  if (f.yearTo != null) clauses.push(`p.year <= ${add(f.yearTo)}`)
  if (f.pubType) clauses.push(`p.publication_type = ${add(f.pubType)}`)
  if (f.rmblOnly) clauses.push(`p.rmbl_research = 'yes'`)
  if (f.program) clauses.push(`p.${PROGRAM_FILTERS[f.program].column} = 'yes'`)
  if (f.projectPubIds) {
    // An empty assignment list must match nothing, not everything.
    clauses.push(`p.id = ANY(${add(f.projectPubIds.length > 0 ? f.projectPubIds : [-1])})`)
  }
  if (f.topicIds && f.topicIds.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM publications_rels tr
               WHERE tr.parent_id = p.id AND tr.path = 'researchTopics'
                 AND tr.topics_id = ANY(${add(f.topicIds.map((t) => parseInt(t, 10)))}))`,
    )
  }

  return { sql: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE', params }
}

/** First author's family name, for the Author and legacy composite sorts.
 *  `publications_authors._order` is the ground truth for author order —
 *  `authors_rels."order"` was rebuilt from it (see fix-author-order.ts). */
const FIRST_AUTHOR_SQL = `(SELECT a.family FROM publications_authors a
                           WHERE a._parent_id = p.id ORDER BY a._order LIMIT 1)`

/** ORDER BY body for a publications query aliased as `p`. */
export function publicationOrderBy(sort: PublicationSort): string {
  switch (sort) {
    case 'newest': return 'p.year DESC NULLS LAST'
    case 'oldest': return 'p.year ASC NULLS LAST'
    case 'title': return 'p.title ASC'
    case 'title-desc': return 'p.title DESC'
    case 'most-cited': return 'p.external_citation_count DESC NULLS LAST'
    case 'most-cited-internal':
      return '(SELECT count(*) FROM references_cited r WHERE r.target_publication_id = p.id) DESC'
    case 'author': return `${FIRST_AUTHOR_SQL} ASC NULLS LAST`
    // The legacy database's default ordering.
    case 'year-type-author':
      return `p.year DESC NULLS LAST, p.publication_type ASC, ${FIRST_AUTHOR_SQL} ASC NULLS LAST`
    case 'relevance':
    default:
      // Only meaningful with a text query; the caller substitutes rank.
      return 'p.year DESC NULLS LAST'
  }
}
