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
// Trends across eras: category diversity (step 4a)
// ---------------------------------------------------------------------------

/**
 * The two category dimensions available with 100% coverage in the corpus.
 * - 'scope' is concept.scope (research discipline)
 * - 'protocol_category' is protocol.category (methodological approach)
 *
 * Topics taxonomy exists but 0 content items are tagged. concept.disciplines
 * and protocol.disciplines arrays exist but are unpopulated. Both excluded.
 */
export type CategoryDimension = 'scope' | 'protocol_category'

export interface EraCategoryBreakdown {
  era_id: number
  era_slug: string
  era_name: string
  start_year: number
  end_year: number
  /** All non-null categories present in this era, ranked by mention count. */
  categories: Array<{ category: string; n: number; share: number }>
  /** Total mentions of this category dimension in this era (across the source filter). */
  total: number
  /** Shannon entropy H = -Σ p·ln(p). 0 when fully concentrated, ln(K) when uniform across K. */
  shannon_h: number
  /**
   * Shannon's effective number of categories: exp(H). Hill number q=1.
   * Sensitive to *all* categories (long tail counts proportionally to share).
   * Use to answer "how many disciplines are in play, broadly?"
   */
  effective_n: number
  /**
   * Inverse Simpson's effective number of categories: 1 / Σ p². Hill q=2.
   * Weighted toward the dominant categories — long tail nearly invisible.
   * Use to answer "how evenly distributed are the *common* disciplines?"
   * Tends to track visual "stacked-bar evenness" better than Shannon does.
   */
  inverse_simpson: number
}

/**
 * For every decade-spanning calendar era, return its category breakdown
 * (counts + share) and diversity metrics (Shannon entropy + effective N).
 * Used by the /eras/trends page to answer "is research diversity rising?"
 *
 * Centuries (span > 50) and curated/theme eras are excluded — the chart is
 * decade-only.
 */
export async function getDiversityAcrossEras(
  pool: pg.Pool,
  dimension: CategoryDimension,
  sources: readonly SourceCollection[] = RESEARCH_SOURCES,
): Promise<EraCategoryBreakdown[]> {
  // Lookup table joins. For 'scope' we want concept.scope; for 'protocol_category'
  // we want protocol.category. Entity_type filter follows from the dimension.
  const config =
    dimension === 'scope'
      ? { entityType: 'concept', joinTable: 'concepts', categoryCol: 'scope' }
      : { entityType: 'protocol', joinTable: 'protocols', categoryCol: 'category' }

  const { rows } = await pool.query<{
    era_id: number
    era_slug: string
    era_name: string
    start_year: number
    end_year: number
    category: string
    n: string
  }>(
    `
    WITH dated AS (
      SELECT em.entity_id,
        CASE em.collection
          WHEN 'publications' THEN (SELECT NULLIF(p.year,0)::int FROM publications p WHERE p.id=em.item_id)
          WHEN 'documents'    THEN (SELECT extract(year FROM d.date_original)::int FROM documents d WHERE d.id=em.item_id)
          WHEN 'datasets'     THEN (SELECT NULLIF(ds.publication_year,0)::int FROM datasets ds WHERE ds.id=em.item_id)
          WHEN 'stories'      THEN (SELECT extract(year FROM s.date)::int FROM stories s WHERE s.id=em.item_id)
        END AS y
      FROM entity_mentions em
      WHERE em.entity_type = $1 AND em.collection = ANY($2::text[])
    )
    SELECT e.id AS era_id, e.slug AS era_slug, e.name AS era_name,
           e.start_year, e.end_year,
           cat.${config.categoryCol} AS category,
           count(*)::text AS n
      FROM dated d
      JOIN ${config.joinTable} cat ON cat.id = d.entity_id
      JOIN eras e ON e.kind = 'calendar'
                AND (e.end_year - e.start_year) < 50
                AND d.y BETWEEN e.start_year AND e.end_year
     WHERE d.y IS NOT NULL AND cat.${config.categoryCol} IS NOT NULL
     GROUP BY e.id, e.slug, e.name, e.start_year, e.end_year, cat.${config.categoryCol}
     ORDER BY e.start_year ASC, count(*) DESC
    `,
    [config.entityType, sources as unknown as string[]],
  )

  // Group by era and compute Shannon entropy + effective N per era in TS.
  const byEra = new Map<number, EraCategoryBreakdown>()
  for (const r of rows) {
    const eraId = r.era_id
    if (!byEra.has(eraId)) {
      byEra.set(eraId, {
        era_id: eraId,
        era_slug: r.era_slug,
        era_name: r.era_name,
        start_year: r.start_year,
        end_year: r.end_year,
        categories: [],
        total: 0,
        shannon_h: 0,
        effective_n: 0,
        inverse_simpson: 0,
      })
    }
    const bucket = byEra.get(eraId)!
    bucket.categories.push({ category: r.category, n: parseInt(r.n, 10), share: 0 })
  }

  const out: EraCategoryBreakdown[] = []
  for (const bucket of byEra.values()) {
    const total = bucket.categories.reduce((s, c) => s + c.n, 0)
    bucket.total = total
    let h = 0
    let sumP2 = 0
    for (const c of bucket.categories) {
      c.share = total > 0 ? c.n / total : 0
      if (c.share > 0) {
        h -= c.share * Math.log(c.share)
        sumP2 += c.share * c.share
      }
    }
    bucket.shannon_h = h
    bucket.effective_n = Math.exp(h)
    bucket.inverse_simpson = sumP2 > 0 ? 1 / sumP2 : 0
    out.push(bucket)
  }
  out.sort((a, b) => a.start_year - b.start_year)
  return out
}

export interface EraSamplePublication {
  id: number
  title: string
  year: number
  authors: string | null
  citation_count: number | null
  /**
   * Number of basin publications that cite this paper (source_publication_id
   * IS NOT NULL in references_cited). null when the paper is not in the
   * internal-citation top bucket.
   */
  internal_citation_count: number | null
  /**
   * Distinct entity count for this paper across species, places, protocols,
   * concepts, stakeholders. null when the paper is not in the grounded top
   * bucket (or has no entity_mentions rows).
   */
  distinct_basin_entities: number | null
  /** 1-indexed rank within era for each signal, or null if not in top bucket. */
  rank_external: number | null
  rank_internal: number | null
  rank_grounded: number | null
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
 * Landmark candidate publications from an era, drawn from three signals so
 * we don't only see what the world cited:
 *   - external citations (global significance, via OpenAlex)
 *   - basin-internal citations (basin colleagues building on the paper)
 *   - distinct basin entities mentioned (depth of basin engagement)
 *
 * We pull top 25 by each signal, union them, and order by how many of the
 * three signals each paper qualified for, then by its best rank in any
 * signal. The LLM consumer is expected to render the per-signal ranks so
 * it can name what kind of landmark a paper is — globally pivotal,
 * locally foundational, or basin-grounded.
 *
 * `limit` caps the final union; with three top-25 lists and partial
 * overlap, expect 30–60 candidates before the cap.
 */
export async function getEraTopPublications(
  pool: pg.Pool,
  era: Era,
  limit: number = 30,
): Promise<EraSamplePublication[]> {
  const { rows } = await pool.query<EraSamplePublication>(
    `
    WITH ext AS (
      SELECT id,
             coalesce(external_citation_count, 0) AS ext_count,
             row_number() OVER (
               ORDER BY coalesce(external_citation_count, 0) DESC, year DESC
             ) AS rank_ext
        FROM publications
       WHERE year BETWEEN $1 AND $2 AND year > 0
       ORDER BY coalesce(external_citation_count, 0) DESC, year DESC
       LIMIT 25
    ),
    internal_cites AS (
      SELECT p.id,
             count(*)::int AS int_count,
             row_number() OVER (
               ORDER BY count(*) DESC, p.year DESC
             ) AS rank_int
        FROM publications p
        JOIN references_cited rc
          ON rc.target_publication_id = p.id
         AND rc.source_publication_id IS NOT NULL
       WHERE p.year BETWEEN $1 AND $2 AND p.year > 0
       GROUP BY p.id, p.year
       ORDER BY count(*) DESC, p.year DESC
       LIMIT 25
    ),
    grounded AS (
      SELECT p.id,
             count(DISTINCT (em.entity_type, em.entity_id))::int AS distinct_ents,
             row_number() OVER (
               ORDER BY count(DISTINCT (em.entity_type, em.entity_id)) DESC, p.year DESC
             ) AS rank_grnd
        FROM publications p
        JOIN entity_mentions em
          ON em.collection = 'publications' AND em.item_id = p.id
       WHERE p.year BETWEEN $1 AND $2 AND p.year > 0
       GROUP BY p.id, p.year
       ORDER BY count(DISTINCT (em.entity_type, em.entity_id)) DESC, p.year DESC
       LIMIT 25
    ),
    union_ids AS (
      SELECT id FROM ext
      UNION SELECT id FROM internal_cites
      UNION SELECT id FROM grounded
    )
    SELECT p.id,
           p.title,
           p.year::int AS year,
           (SELECT string_agg(family, '; ' ORDER BY _order)
              FROM publications_authors a WHERE a._parent_id = p.id) AS authors,
           coalesce(p.external_citation_count, 0)::int AS citation_count,
           internal_cites.int_count AS internal_citation_count,
           grounded.distinct_ents AS distinct_basin_entities,
           ext.rank_ext::int AS rank_external,
           internal_cites.rank_int::int AS rank_internal,
           grounded.rank_grnd::int AS rank_grounded
      FROM union_ids u
      JOIN publications p ON p.id = u.id
      LEFT JOIN ext ON ext.id = u.id
      LEFT JOIN internal_cites ON internal_cites.id = u.id
      LEFT JOIN grounded ON grounded.id = u.id
     ORDER BY
       -- prioritize papers that appear in more buckets
       ((CASE WHEN ext.rank_ext IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN internal_cites.rank_int IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN grounded.rank_grnd IS NULL THEN 0 ELSE 1 END)) DESC,
       -- then by best rank achieved in any single bucket
       least(coalesce(ext.rank_ext, 9999),
             coalesce(internal_cites.rank_int, 9999),
             coalesce(grounded.rank_grnd, 9999)) ASC
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

// ---------------------------------------------------------------------------
// Author cohorts across eras (community renewal)
//
// For each decade, the active research community is segmented by the decade
// of each author's first publication in the corpus. Pure measurement — no
// inference. Answers: is the community renewing, and how much continuity is
// there across decades? Pairs naturally with the diversity panels.
// ---------------------------------------------------------------------------

export interface CohortSegment {
  cohort_slug: string
  cohort_name: string
  cohort_start_year: number
  n: number
  /** Share of the era's active community in this cohort (0-1). */
  share: number
}

export interface EraCohortBreakdown {
  era_id: number
  era_slug: string
  era_name: string
  start_year: number
  end_year: number
  /** Total distinct authors active in this era. */
  total_active: number
  /** Authors whose first publication falls in this era (cohort_slug === era_slug). */
  new_in_era: number
  /** Cohorts in chronological order (oldest first). */
  cohorts: CohortSegment[]
}

/**
 * For every decade-spanning calendar era, return the active-author breakdown
 * by first-publication cohort. Cohorts are themselves the same decade eras.
 *
 * Author identity uses lower(family)|lower(given) pairs — same approach as
 * the unique-authors metric in the corpus-context section. Mildly inflated
 * by spelling variations on the same person, but trends are robust.
 */
export async function getAuthorCohortsByEra(
  pool: pg.Pool,
): Promise<EraCohortBreakdown[]> {
  const { rows } = await pool.query<{
    era_id: number
    era_slug: string
    era_name: string
    era_start: number
    era_end: number
    cohort_slug: string
    cohort_name: string
    cohort_start: number
    n: string
  }>(`
    WITH author_first AS (
      SELECT lower(coalesce(a.family,'')) || '|' || lower(coalesce(a.given,'')) AS author_key,
             min(p.year::int) AS first_year
        FROM publications_authors a
        JOIN publications p ON p.id = a._parent_id
       WHERE p.year > 0 AND p.year::int >= 1900 AND coalesce(a.family,'') <> ''
       GROUP BY 1
    ),
    era_author AS (
      SELECT DISTINCT
             lower(coalesce(a.family,'')) || '|' || lower(coalesce(a.given,'')) AS author_key,
             e.id AS era_id, e.slug AS era_slug, e.name AS era_name,
             e.start_year AS era_start, e.end_year AS era_end
        FROM publications_authors a
        JOIN publications p ON p.id = a._parent_id
        JOIN eras e ON e.kind = 'calendar' AND (e.end_year - e.start_year) < 50
                    AND p.year::int BETWEEN e.start_year AND e.end_year
       WHERE p.year > 0 AND p.year::int >= 1900 AND coalesce(a.family,'') <> ''
    )
    SELECT ea.era_id, ea.era_slug, ea.era_name, ea.era_start, ea.era_end,
           ce.slug AS cohort_slug, ce.name AS cohort_name, ce.start_year AS cohort_start,
           count(*)::text AS n
      FROM era_author ea
      JOIN author_first af ON af.author_key = ea.author_key
      JOIN eras ce ON ce.kind = 'calendar' AND (ce.end_year - ce.start_year) < 50
                  AND af.first_year BETWEEN ce.start_year AND ce.end_year
     GROUP BY ea.era_id, ea.era_slug, ea.era_name, ea.era_start, ea.era_end,
              ce.id, ce.slug, ce.name, ce.start_year
     ORDER BY ea.era_start ASC, ce.start_year ASC
  `)

  // Group by era, compute totals + new-in-era + shares.
  const byEra = new Map<number, EraCohortBreakdown>()
  for (const r of rows) {
    let bucket = byEra.get(r.era_id)
    if (!bucket) {
      bucket = {
        era_id: r.era_id,
        era_slug: r.era_slug,
        era_name: r.era_name,
        start_year: r.era_start,
        end_year: r.era_end,
        total_active: 0,
        new_in_era: 0,
        cohorts: [],
      }
      byEra.set(r.era_id, bucket)
    }
    const n = parseInt(r.n, 10)
    bucket.cohorts.push({
      cohort_slug: r.cohort_slug,
      cohort_name: r.cohort_name,
      cohort_start_year: r.cohort_start,
      n,
      share: 0, // filled in below
    })
    bucket.total_active += n
    if (r.cohort_slug === r.era_slug) bucket.new_in_era = n
  }

  const out: EraCohortBreakdown[] = []
  for (const bucket of byEra.values()) {
    for (const c of bucket.cohorts) {
      c.share = bucket.total_active > 0 ? c.n / bucket.total_active : 0
    }
    out.push(bucket)
  }
  out.sort((a, b) => a.start_year - b.start_year)
  return out
}

// ---------------------------------------------------------------------------
// Publication-context trends across eras (corpus volume + collaboration +
// coverage + engagement). All six metrics in one round trip via CTEs.
// Publication-bound by design — there's no "documents version" of avg
// co-authors or full-text coverage, so the source-lens toggle doesn't apply
// here. The items-per-era line is lens-aware and uses listErasWithCounts
// downstream.
// ---------------------------------------------------------------------------

export interface PublicationContextRow {
  era_id: number
  era_slug: string
  era_name: string
  start_year: number
  end_year: number
  /** Total publications dated within this era (year>0). Used as denominator for several rates and as a reliability gauge. */
  n_pubs: number
  /** Publications with substantive full text (>500 chars). */
  n_fulltext: number
  /** Share of publications with full text (0-1). */
  share_fulltext: number
  /** Average authors per publication (among publications with at least one author row). */
  avg_authors: number
  /** Distinct (family + given) author identities appearing on publications dated within the era. */
  unique_authors: number
  /** Average references per publication (refs_count / n_pubs; pubs with no extracted refs count as 0). */
  avg_refs: number
  /** Share of extracted references that resolve to another known publication/document/dataset (0-1). */
  share_internal_refs: number
}

export async function getPublicationContextByEra(pool: pg.Pool): Promise<PublicationContextRow[]> {
  const { rows } = await pool.query<{
    era_id: number
    era_slug: string
    era_name: string
    start_year: number
    end_year: number
    n_pubs: string
    n_fulltext: string
    avg_authors: string
    unique_authors: string
    total_refs: string
    internal_refs: string
  }>(`
    WITH pub_era AS (
      SELECT p.id AS pub_id, p.year::int AS year,
             e.id AS era_id, e.slug AS era_slug, e.name AS era_name,
             e.start_year, e.end_year,
             (p.full_text IS NOT NULL AND length(p.full_text) > 500) AS has_fulltext
        FROM publications p
        JOIN eras e
          ON e.kind = 'calendar' AND (e.end_year - e.start_year) < 50
         AND p.year::int BETWEEN e.start_year AND e.end_year
       WHERE p.year > 0 AND p.year::int >= 1900
    ),
    pub_counts AS (
      SELECT era_id, era_slug, era_name, start_year, end_year,
             count(*)::int AS n_pubs,
             count(*) FILTER (WHERE has_fulltext)::int AS n_fulltext
        FROM pub_era
       GROUP BY era_id, era_slug, era_name, start_year, end_year
    ),
    author_stats AS (
      SELECT pe.era_id,
             count(*)::numeric AS author_rows,
             count(DISTINCT a._parent_id)::int AS pubs_with_any_author,
             count(DISTINCT lower(coalesce(a.family, '')) || '|' || lower(coalesce(a.given, '')))::int AS unique_authors
        FROM pub_era pe
        JOIN publications_authors a ON a._parent_id = pe.pub_id
       GROUP BY pe.era_id
    ),
    ref_stats AS (
      SELECT pe.era_id,
             count(*)::numeric AS total_refs,
             count(*) FILTER (
               WHERE r.target_publication_id IS NOT NULL
                  OR r.target_document_id IS NOT NULL
                  OR r.target_dataset_id IS NOT NULL
             )::numeric AS internal_refs
        FROM pub_era pe
        JOIN references_cited r ON r.source_publication_id = pe.pub_id
       GROUP BY pe.era_id
    )
    SELECT pc.era_id, pc.era_slug, pc.era_name, pc.start_year, pc.end_year,
           pc.n_pubs::text, pc.n_fulltext::text,
           coalesce((a.author_rows / NULLIF(a.pubs_with_any_author, 0))::text, '0') AS avg_authors,
           coalesce(a.unique_authors::text, '0') AS unique_authors,
           coalesce(r.total_refs::text, '0') AS total_refs,
           coalesce(r.internal_refs::text, '0') AS internal_refs
      FROM pub_counts pc
      LEFT JOIN author_stats a ON a.era_id = pc.era_id
      LEFT JOIN ref_stats r ON r.era_id = pc.era_id
     ORDER BY pc.start_year ASC, (pc.end_year - pc.start_year) DESC
  `)

  return rows.map((r) => {
    const nPubs = parseInt(r.n_pubs, 10)
    const nFt = parseInt(r.n_fulltext, 10)
    const totalRefs = parseFloat(r.total_refs)
    const internalRefs = parseFloat(r.internal_refs)
    return {
      era_id: r.era_id,
      era_slug: r.era_slug,
      era_name: r.era_name,
      start_year: r.start_year,
      end_year: r.end_year,
      n_pubs: nPubs,
      n_fulltext: nFt,
      share_fulltext: nPubs > 0 ? nFt / nPubs : 0,
      avg_authors: parseFloat(r.avg_authors),
      unique_authors: parseInt(r.unique_authors, 10),
      avg_refs: nPubs > 0 ? totalRefs / nPubs : 0,
      share_internal_refs: totalRefs > 0 ? internalRefs / totalRefs : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Era trajectory snapshot (what's new / rising / fading in this era)
//
// Distinct from getEraTopEntities (cross-sectional distinctiveness, "what's
// over-represented in this era vs. all other dated content"). The trajectory
// snapshot answers temporal questions:
//   - new in this era      → entities making their first corpus appearance
//   - rising               → entities present prior, now growing fastest
//   - fading               → entities prominent prior, now declining
//
// Metric for rising/fading: pairwise log-odds-ratio z-score between this era
// and the immediately preceding decade-or-bucket era. Same Monroe et al
// machinery as the distinctiveness ranking, but the comparison cohort is the
// prior era instead of "everything else."
// ---------------------------------------------------------------------------

export interface TrajectoryEntity {
  entity_id: number
  entity_type: EntityType
  name: string
  n_in_era: number
  n_in_prior: number
  /** Min year of any mention of this entity in dated content. */
  first_year: number
  /**
   * Pairwise log-odds-ratio z-score, this era vs prior era. Positive = rising,
   * negative = fading. NaN for "new" entities (no prior baseline).
   */
  z_score: number
}

export interface EraTrajectorySnapshot {
  hasPrior: boolean
  prior_era_name: string | null
  prior_era_slug: string | null
  newInEra: TrajectoryEntity[]
  rising: TrajectoryEntity[]
  fading: TrajectoryEntity[]
}

interface TrajectoryRawRow {
  entity_id: number
  name: string
  n_curr: string
  n_prior: string
  first_year: number
}

async function fetchTrajectoryForType(
  pool: pg.Pool,
  entityType: EntityType,
  era: Era,
  priorEra: Era,
  sources: readonly SourceCollection[],
): Promise<TrajectoryEntity[]> {
  const { table, nameCol } = ENTITY_TABLES[entityType]

  const { rows } = await pool.query<TrajectoryRawRow>(
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
        AND em.collection = ANY($2::text[])
    ),
    per_entity AS (
      SELECT entity_id,
             count(*) FILTER (WHERE y BETWEEN $3 AND $4)::int AS n_curr,
             count(*) FILTER (WHERE y BETWEEN $5 AND $6)::int AS n_prior,
             min(y) AS first_year
        FROM dated
       WHERE y IS NOT NULL
       GROUP BY entity_id
      HAVING count(*) FILTER (WHERE y BETWEEN $3 AND $4) > 0
          OR count(*) FILTER (WHERE y BETWEEN $5 AND $6) > 0
    )
    SELECT pe.entity_id, ent.${nameCol} AS name,
           pe.n_curr::text, pe.n_prior::text, pe.first_year
      FROM per_entity pe
      JOIN ${table} ent ON ent.id = pe.entity_id
    `,
    [entityType, sources as unknown as string[], era.start_year, era.end_year, priorEra.start_year, priorEra.end_year],
  )

  const counts = rows.map((r) => ({
    entity_id: r.entity_id,
    entity_type: entityType,
    name: r.name,
    n_in_era: parseInt(r.n_curr, 10),
    n_in_prior: parseInt(r.n_prior, 10),
    first_year: r.first_year,
  }))

  // Pairwise log-odds-ratio z-score with uniform Laplace prior.
  const ALPHA = 1
  const alpha0 = counts.length || 1
  const totalCurr = counts.reduce((s, r) => s + r.n_in_era, 0)
  const totalPrior = counts.reduce((s, r) => s + r.n_in_prior, 0)

  return counts.map((r) => {
    const numCurr = r.n_in_era + ALPHA
    const denCurr = totalCurr + alpha0
    const numPrior = r.n_in_prior + ALPHA
    const denPrior = totalPrior + alpha0
    const pCurr = numCurr / denCurr
    const pPrior = numPrior / denPrior
    const delta = Math.log(pCurr / (1 - pCurr)) - Math.log(pPrior / (1 - pPrior))
    const variance = 1 / numCurr + 1 / numPrior
    const z = delta / Math.sqrt(variance)
    return { ...r, z_score: z }
  })
}

/**
 * Three lists summarizing what changed entering this era — new arrivals,
 * fastest-rising entities, and fading entities. Mixed across all entity
 * types (concept / species / protocol / place / stakeholder) and tagged so
 * the UI can color-code chips by type.
 *
 * If the era has no prior calendar era (e.g. pre-1950), the rising/fading
 * lists are empty but newInEra still populates.
 */
export async function getEraTrajectorySnapshot(
  pool: pg.Pool,
  era: Era,
  options: {
    sources?: readonly SourceCollection[]
    /** Max entries returned per list. */
    limit?: number
    /** Min mentions in current era for rising/new candidacy. */
    minMentionsRising?: number
    /** Min mentions in prior era for fading candidacy. */
    minMentionsFading?: number
  } = {},
): Promise<EraTrajectorySnapshot> {
  if (era.kind !== 'calendar') {
    return {
      hasPrior: false,
      prior_era_name: null,
      prior_era_slug: null,
      newInEra: [],
      rising: [],
      fading: [],
    }
  }

  const limit = options.limit ?? 10
  const minMentionsRising = options.minMentionsRising ?? 3
  const minMentionsFading = options.minMentionsFading ?? 3
  const sources = options.sources ?? RESEARCH_SOURCES

  // Look up the immediately-preceding decade-or-bucket era.
  const { rows: priorRows } = await pool.query<Era>(
    `SELECT ${ERA_COLS} FROM eras
      WHERE kind = 'calendar'
        AND (end_year - start_year) < 50
        AND end_year < $1
      ORDER BY start_year DESC
      LIMIT 1`,
    [era.start_year],
  )
  const priorEra = priorRows[0] ?? null
  const hasPrior = Boolean(priorEra)

  // Collect "new" candidates from a per-type query — works even when there
  // is no prior era (e.g. pre-1950). Uses the same dated/per-entity CTE
  // shape as fetchTrajectoryForType but only needs current-era counts.
  const entityTypes: EntityType[] = ['concept', 'species', 'protocol', 'place', 'stakeholder']
  const allNew: TrajectoryEntity[] = []
  const allTrajectory: TrajectoryEntity[][] = []

  for (const t of entityTypes) {
    if (hasPrior && priorEra) {
      const trajectory = await fetchTrajectoryForType(pool, t, era, priorEra, sources)
      allTrajectory.push(trajectory)
      for (const e of trajectory) {
        if (
          e.first_year >= era.start_year &&
          e.first_year <= era.end_year &&
          e.n_in_era >= minMentionsRising
        ) {
          allNew.push(e)
        }
      }
    } else {
      // No prior — query "new" directly (anything with first_year in current era).
      const { table, nameCol } = ENTITY_TABLES[t]
      const { rows } = await pool.query<{
        entity_id: number
        name: string
        n_curr: string
        first_year: number
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
          WHERE em.entity_type = $1 AND em.collection = ANY($2::text[])
        ),
        per_entity AS (
          SELECT entity_id,
                 count(*) FILTER (WHERE y BETWEEN $3 AND $4)::int AS n_curr,
                 min(y) AS first_year
            FROM dated
           WHERE y IS NOT NULL
           GROUP BY entity_id
        )
        SELECT pe.entity_id, ent.${nameCol} AS name, pe.n_curr::text, pe.first_year
          FROM per_entity pe JOIN ${table} ent ON ent.id = pe.entity_id
         WHERE pe.first_year BETWEEN $3 AND $4 AND pe.n_curr >= $5
        `,
        [t, sources as unknown as string[], era.start_year, era.end_year, minMentionsRising],
      )
      for (const r of rows) {
        allNew.push({
          entity_id: r.entity_id,
          entity_type: t,
          name: r.name,
          n_in_era: parseInt(r.n_curr, 10),
          n_in_prior: 0,
          first_year: r.first_year,
          z_score: NaN,
        })
      }
    }
  }

  // Sort and trim each list.
  const newSorted = [...allNew].sort((a, b) => b.n_in_era - a.n_in_era).slice(0, limit)

  const allMerged = allTrajectory.flat()
  const rising = allMerged
    .filter(
      (e) =>
        e.n_in_era >= minMentionsRising &&
        e.n_in_prior >= minMentionsRising &&
        e.z_score > 0,
    )
    .sort((a, b) => b.z_score - a.z_score)
    .slice(0, limit)
  const fading = allMerged
    .filter((e) => e.n_in_prior >= minMentionsFading && e.z_score < 0)
    .sort((a, b) => a.z_score - b.z_score)
    .slice(0, limit)

  return {
    hasPrior,
    prior_era_name: priorEra?.name ?? null,
    prior_era_slug: priorEra?.slug ?? null,
    newInEra: newSorted,
    rising,
    fading,
  }
}

// ---------------------------------------------------------------------------
// Era primers (synthesized period portraits)
// ---------------------------------------------------------------------------

export interface EraPrimer {
  primer: string
  primer_model: string | null
  primer_generated_at: string | null
  key_themes: string[]
  open_questions: string[]
}

export async function getEraPrimer(pool: pg.Pool, eraId: number): Promise<EraPrimer | null> {
  const { rows } = await pool.query<{
    primer: string | null
    primer_model: string | null
    primer_generated_at: string | null
    primer_key_themes: string[] | null
    primer_open_questions: string[] | null
  }>(
    `SELECT primer, primer_model,
            primer_generated_at::text AS primer_generated_at,
            primer_key_themes, primer_open_questions
       FROM eras WHERE id = $1`,
    [eraId],
  )
  const r = rows[0]
  if (!r?.primer) return null
  return {
    primer: r.primer,
    primer_model: r.primer_model,
    primer_generated_at: r.primer_generated_at,
    key_themes: r.primer_key_themes ?? [],
    open_questions: r.primer_open_questions ?? [],
  }
}
