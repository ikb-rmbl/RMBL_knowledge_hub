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
