/**
 * Eras service — listing, lookup, and member-count helpers for the Eras
 * collection introduced in Phase 1 step 1.
 *
 * Calendar eras compute membership from each content row's date column at
 * query time (no rows in era_members). The kind enum supports future
 * 'curated' and 'theme' eras whose membership comes from era_members; the
 * count helper handles both.
 *
 * Sentinel dates are excluded: publications.year=0 and datasets.publication_year=0
 * are not counted as falling in any era (~11 publications, ~68 datasets).
 */

import type pg from 'pg'

export type EraKind = 'calendar' | 'curated' | 'theme'

export interface Era {
  id: number
  name: string
  slug: string
  start_year: number
  end_year: number
  kind: EraKind
  description: string | null
  parent_era_id: number | null
  sort_order: number
}

export interface EraMemberCounts {
  publications: number
  documents: number
  datasets: number
  stories: number
  total: number
}

export interface EraWithCounts extends Era {
  parent_slug: string | null
  parent_name: string | null
  counts: EraMemberCounts
}

const ERA_COLS =
  'id, name, slug, start_year, end_year, kind, description, parent_era_id, sort_order'

/**
 * Chronological browse order: by start_year ASC, then longer-span eras first
 * (so a century sorts ahead of its first child decade), then by sort_order.
 */
const BROWSE_ORDER =
  'ORDER BY start_year ASC, (end_year - start_year) DESC, sort_order ASC'

export async function listEras(pool: pg.Pool): Promise<Era[]> {
  const { rows } = await pool.query<Era>(
    `SELECT ${ERA_COLS} FROM eras ${BROWSE_ORDER}`,
  )
  return rows
}

export async function getEra(
  pool: pg.Pool,
  idOrSlug: number | string,
): Promise<Era | null> {
  const isId = typeof idOrSlug === 'number'
  const sql = isId
    ? `SELECT ${ERA_COLS} FROM eras WHERE id = $1`
    : `SELECT ${ERA_COLS} FROM eras WHERE slug = $1`
  const { rows } = await pool.query<Era>(sql, [idOrSlug])
  return rows[0] ?? null
}

/**
 * Member counts per content collection for a single era.
 *
 * - Calendar eras: counted by year range against publications.year,
 *   documents.date_original, datasets.publication_year, stories.date.
 * - Curated / theme eras: counted from era_members rows by collection.
 */
export async function getEraMemberCounts(
  pool: pg.Pool,
  era: Era,
): Promise<EraMemberCounts> {
  if (era.kind === 'calendar') {
    const { rows } = await pool.query<{
      publications: number
      documents: number
      datasets: number
      stories: number
    }>(
      `SELECT
         (SELECT count(*)::int FROM publications WHERE year BETWEEN $1 AND $2 AND year > 0) AS publications,
         (SELECT count(*)::int FROM documents WHERE extract(year FROM date_original) BETWEEN $1 AND $2) AS documents,
         (SELECT count(*)::int FROM datasets WHERE publication_year BETWEEN $1 AND $2 AND publication_year > 0) AS datasets,
         (SELECT count(*)::int FROM stories WHERE extract(year FROM date) BETWEEN $1 AND $2) AS stories`,
      [era.start_year, era.end_year],
    )
    const r = rows[0]
    return { ...r, total: r.publications + r.documents + r.datasets + r.stories }
  }

  // Curated / theme: count rows in era_members by target collection.
  const { rows } = await pool.query<{ collection: string; n: string }>(
    `SELECT collection, count(*)::text AS n
       FROM era_members WHERE era_id = $1 GROUP BY collection`,
    [era.id],
  )
  const counts = { publications: 0, documents: 0, datasets: 0, stories: 0 }
  for (const r of rows) {
    if (r.collection in counts) {
      ;(counts as Record<string, number>)[r.collection] = parseInt(r.n, 10)
    }
  }
  return {
    ...counts,
    total: counts.publications + counts.documents + counts.datasets + counts.stories,
  }
}

/**
 * Convenience wrapper: every era with its parent labels and per-collection
 * counts, in browse order. One round-trip for eras+parents; one count query
 * per era (N≈11, fine at this scale).
 */
export async function listErasWithCounts(
  pool: pg.Pool,
): Promise<EraWithCounts[]> {
  const { rows: eras } = await pool.query<
    Era & { parent_slug: string | null; parent_name: string | null }
  >(
    `SELECT e.${ERA_COLS.split(', ').join(', e.')},
            p.slug AS parent_slug, p.name AS parent_name
       FROM eras e
       LEFT JOIN eras p ON p.id = e.parent_era_id
      ${BROWSE_ORDER.replace(/start_year/g, 'e.start_year').replace(/end_year/g, 'e.end_year').replace(/sort_order/g, 'e.sort_order')}`,
  )

  const out: EraWithCounts[] = []
  for (const e of eras) {
    const counts = await getEraMemberCounts(pool, e)
    out.push({ ...e, counts })
  }
  return out
}

/**
 * Centuries have a much wider span than decades and serve as section
 * anchors in the browse UI.
 */
export function isCenturyEra(era: Pick<Era, 'start_year' | 'end_year'>): boolean {
  return era.end_year - era.start_year > 50
}

// ---------------------------------------------------------------------------
// Top distinctive entities for an era
// ---------------------------------------------------------------------------

export type EntityType = 'species' | 'concept' | 'protocol' | 'place' | 'stakeholder'

export interface TopEntity {
  entity_id: number
  name: string
  in_era: number
  out_era: number
  /** Log-odds-ratio z-score: how distinctive this entity is for the era vs. all other dated content. Higher = more distinctive of this era. */
  z: number
}

/**
 * Maps an EntityType to (table_name, name_column) for the JOIN that fetches
 * display names. Stakeholders use 'name' even though their detail page route
 * doesn't exist yet — the page renders them as plain text.
 */
const ENTITY_TABLES: Record<EntityType, { table: string; nameCol: string }> = {
  species: { table: 'species', nameCol: 'canonical_name' },
  concept: { table: 'concepts', nameCol: 'name' },
  protocol: { table: 'protocols', nameCol: 'name' },
  place: { table: 'places', nameCol: 'name' },
  stakeholder: { table: 'stakeholders', nameCol: 'name' },
}

export type SourceCollection = 'publications' | 'documents' | 'datasets' | 'stories'

/** Convenience lenses for the detail page. */
export const RESEARCH_SOURCES: readonly SourceCollection[] = ['publications', 'datasets']
export const POLICY_SOURCES: readonly SourceCollection[] = ['documents']

export interface TopEntitiesOptions {
  /** Max entities returned (default 15). */
  limit?: number
  /**
   * Restrict which source collections contribute mentions. The same entity
   * appears in multiple collections; restricting to e.g. publications +
   * datasets gives a "research" lens, restricting to documents gives a
   * "policy & community" lens. Default: all four collections.
   */
  sourceCollections?: readonly SourceCollection[]
  /**
   * Minimum in-era mention count required for an entity to be ranked.
   * Filters out singleton noise where the smoothing math otherwise ties
   * many one-off entities at the same z-score. Default 3.
   */
  minMentions?: number
}

/**
 * Top distinctive entities for an era, ranked by log-odds-ratio z-score
 * vs. all other dated content. This is the "what was animating research
 * in this era" measure — it surfaces entities *over-represented* in the
 * era relative to others, not just frequent overall.
 *
 * Method: Monroe/Colaresi/Quinn 2008 log-odds with a uniform Laplace
 * prior (α=1 per entity). Counts come from SQL; the math runs in TS.
 *
 * Use `sourceCollections` to segregate by research-side vs policy-side
 * sources — e.g., RESEARCH_SOURCES surfaces concepts from the literature,
 * POLICY_SOURCES surfaces what was animating community/policy documents.
 *
 * Calendar eras only for now; curated/theme eras would compute in_era
 * from era_members instead of the year range.
 */
export async function getEraTopEntities(
  pool: pg.Pool,
  era: Era,
  entityType: EntityType,
  opts: TopEntitiesOptions = {},
): Promise<TopEntity[]> {
  if (era.kind !== 'calendar') {
    // Future: implement against era_members. For Phase 1, calendar only.
    return []
  }

  const limit = opts.limit ?? 15
  const minMentions = opts.minMentions ?? 3
  const sources = opts.sourceCollections ?? (['publications', 'documents', 'datasets', 'stories'] as const)

  const { table, nameCol } = ENTITY_TABLES[entityType]

  // Per-entity in/out-era mention counts, restricted to dated content.
  // Source filter applied in the dated CTE so only the selected
  // collections contribute mentions (and thus the corpus totals as well).
  const { rows } = await pool.query<{
    entity_id: number
    name: string
    in_era: string
    out_era: string
  }>(
    `
    WITH dated AS (
      SELECT em.entity_id,
        CASE em.collection
          WHEN 'publications' THEN (SELECT NULLIF(p.year, 0)::int FROM publications p WHERE p.id = em.item_id)
          WHEN 'documents'    THEN (SELECT extract(year FROM d.date_original)::int FROM documents d WHERE d.id = em.item_id)
          WHEN 'datasets'     THEN (SELECT NULLIF(ds.publication_year, 0)::int FROM datasets ds WHERE ds.id = em.item_id)
          WHEN 'stories'      THEN (SELECT extract(year FROM s.date)::int FROM stories s WHERE s.id = em.item_id)
        END AS y
      FROM entity_mentions em
      WHERE em.entity_type = $1
        AND em.collection = ANY($4::text[])
    ),
    counts AS (
      SELECT entity_id,
             count(*) FILTER (WHERE y BETWEEN $2 AND $3) AS in_era,
             count(*) FILTER (WHERE y IS NOT NULL AND (y < $2 OR y > $3)) AS out_era
        FROM dated
       WHERE y IS NOT NULL
       GROUP BY entity_id
      HAVING count(*) FILTER (WHERE y BETWEEN $2 AND $3) >= $5
    )
    SELECT c.entity_id, ent.${nameCol} AS name, c.in_era::text, c.out_era::text
      FROM counts c
      JOIN ${table} ent ON ent.id = c.entity_id
    `,
    [entityType, era.start_year, era.end_year, sources as unknown as string[], minMentions],
  )

  // Log-odds-ratio z-score per Monroe et al with uniform Laplace prior.
  const ALPHA_I = 1
  const counts = rows.map((r) => ({
    entity_id: r.entity_id,
    name: r.name,
    in_era: parseInt(r.in_era, 10),
    out_era: parseInt(r.out_era, 10),
  }))
  const alpha0 = counts.length || 1
  const eraTotal = counts.reduce((s, r) => s + r.in_era, 0)
  const otherTotal = counts.reduce((s, r) => s + r.out_era, 0)

  const scored: TopEntity[] = counts.map((r) => {
    const numE = r.in_era + ALPHA_I
    const denE = eraTotal + alpha0
    const numN = r.out_era + ALPHA_I
    const denN = otherTotal + alpha0
    const pE = numE / denE
    const pN = numN / denN
    const delta = Math.log(pE / (1 - pE)) - Math.log(pN / (1 - pN))
    const variance = 1 / numE + 1 / numN
    const z = delta / Math.sqrt(variance)
    return { ...r, z }
  })

  scored.sort((a, b) => b.z - a.z)
  return scored.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Sample content from an era (for the detail page)
// ---------------------------------------------------------------------------

export interface EraSamplePublication {
  id: number
  title: string
  year: number
  authors: string | null
  citation_count: number | null
}
export interface EraSampleDocument {
  id: number
  title: string
  year: number
}
export interface EraSampleDataset {
  id: number
  title: string
  year: number
  citation_count: number | null
}
export interface EraSampleStory {
  id: number
  title: string
  date: string
  story_type: string | null
}

/**
 * Top-cited publications from an era. Citation count is the practical
 * "importance" signal for publications.
 */
export async function getEraTopPublications(
  pool: pg.Pool,
  era: Era,
  limit: number = 10,
): Promise<EraSamplePublication[]> {
  const { rows } = await pool.query<EraSamplePublication>(
    `
    SELECT p.id, p.title, p.year::int AS year,
           (SELECT string_agg(family, '; ' ORDER BY _order)
              FROM publications_authors a WHERE a._parent_id = p.id) AS authors,
           coalesce(p.external_citation_count, 0) AS citation_count
      FROM publications p
     WHERE p.year BETWEEN $1 AND $2 AND p.year > 0
     ORDER BY coalesce(p.external_citation_count, 0) DESC, p.year DESC
     LIMIT $3
    `,
    [era.start_year, era.end_year, limit],
  )
  return rows
}

/**
 * Most-recent documents from an era. Documents don't have citation counts;
 * recency within the era is the most useful signal.
 */
export async function getEraRecentDocuments(
  pool: pg.Pool,
  era: Era,
  limit: number = 5,
): Promise<EraSampleDocument[]> {
  const { rows } = await pool.query<EraSampleDocument>(
    `
    SELECT d.id, d.title, extract(year FROM d.date_original)::int AS year
      FROM documents d
     WHERE extract(year FROM d.date_original) BETWEEN $1 AND $2
     ORDER BY d.date_original DESC NULLS LAST
     LIMIT $3
    `,
    [era.start_year, era.end_year, limit],
  )
  return rows
}

/**
 * Top-cited datasets from an era.
 */
export async function getEraTopDatasets(
  pool: pg.Pool,
  era: Era,
  limit: number = 5,
): Promise<EraSampleDataset[]> {
  const { rows } = await pool.query<EraSampleDataset>(
    `
    SELECT ds.id, ds.title, ds.publication_year::int AS year,
           coalesce(ds.external_citation_count, 0) AS citation_count
      FROM datasets ds
     WHERE ds.publication_year BETWEEN $1 AND $2 AND ds.publication_year > 0
     ORDER BY coalesce(ds.external_citation_count, 0) DESC, ds.publication_year DESC
     LIMIT $3
    `,
    [era.start_year, era.end_year, limit],
  )
  return rows
}

/**
 * Most-recent stories from an era.
 */
export async function getEraRecentStories(
  pool: pg.Pool,
  era: Era,
  limit: number = 5,
): Promise<EraSampleStory[]> {
  const { rows } = await pool.query<EraSampleStory>(
    `
    SELECT s.id, s.title, s.date::text, s.story_type
      FROM stories s
     WHERE extract(year FROM s.date) BETWEEN $1 AND $2
     ORDER BY s.date DESC NULLS LAST
     LIMIT $3
    `,
    [era.start_year, era.end_year, limit],
  )
  return rows
}
