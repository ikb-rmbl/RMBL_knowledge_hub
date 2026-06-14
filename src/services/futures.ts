/**
 * Futures service — DB-querying layer for the /futures UI routes.
 *
 * Distinct from `src/services/scenarios.ts` (which handles the LLM authoring
 * pipeline). This service reads from the `scenarios` + `scenario_stories`
 * SQL tables populated by `scripts/load-futures.ts`.
 *
 * Routes consume these for browse + detail rendering.
 */

import type pg from 'pg'

export type SetTail = 'central' | 'upside' | 'downside'

export interface FutureSetMeta {
  set_id: string
  set_tail: SetTail
  name: string
  /** Short description rendered above each set on the browse page. */
  description: string
}

/**
 * Set-level metadata, expressed as static config rather than a separate
 * table. Three sets currently; new sets get a line here.
 */
export const FUTURE_SETS: Record<string, FutureSetMeta> = {
  'centennial-2027': {
    set_id: 'centennial-2027',
    set_tail: 'central',
    name: 'Centennial Campaign 2027',
    description:
      'Twelve scenarios spanning the realistic magnitude bracket of the 2027–2029 Centennial Campaign, each anchored on a distinct strategic thesis. Strategic-planning artifacts for board, leadership, and donor conversation in the central case.',
  },
  'centennial-2027-upside': {
    set_id: 'centennial-2027-upside',
    set_tail: 'upside',
    name: 'Upside Companion Set',
    description:
      'Three scenarios exploring what becomes possible when several favorable conditions stack — RMBL fundraising over-performance, expansion of public and private science funding, and a durable shift in public attitudes integrating environmental research into policy. Distinct from the central set in framing and audience: leadership-and-board inspiration about what compounding investments could enable.',
  },
  'centennial-2027-downside': {
    set_id: 'centennial-2027-downside',
    set_tail: 'downside',
    name: 'Downside Companion Set',
    description:
      'Three scenarios exploring what becomes the texture of basin science when unfavorable conditions stack — institutional, environmental, or political-legitimacy pressure intersecting. Used for risk identification, resilience planning, and leadership preparation for the conditions under which constraint becomes the operating reality. Hardship without collapse.',
  },
}

export const SET_TAIL_ORDER: SetTail[] = ['central', 'upside', 'downside']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioSummary {
  slug: string
  set_id: string
  set_tail: SetTail
  name: string
  version: string
  distinguishing_thesis: string | null
  bracket_position: string | null
  continuity_pct: number | null
  innovation_pct: number | null
  frontier_portfolio: string[]
  story_count: number
}

export interface ScenarioDetail extends ScenarioSummary {
  mattering_in_2040: string | null
  upside_conditions: string | null
  downside_conditions: string | null
  campaign_target_m_dollars: number | null
  campaign_range_min_m: number | null
  campaign_range_max_m: number | null
  synopsis: string | null
  setting: string | null
  phase_1: string | null
  phase_2: string | null
  phase_3: string | null
  lines_of_inquiry: string | null
  moments_of_choice: string | null
  audience_lens_research: string | null
  audience_lens_institution: string | null
  audience_lens_donor: string | null
  overlay_robustness: string | null
  plausibility_caveats: string | null
  coda: string | null
  generated_at: string
  updated_at: string
}

export interface StorySummary {
  slug: string
  scenario_slug: string
  set_id: string
  set_tail: SetTail
  title: string | null
  year: number
  mode: 'inhabitation' | 'inflection-point' | 'stress-overlay'
  protagonist_type: string | null
  primary_character_role: string
  word_count: number | null
  frontier_slug: string | null
  published: boolean
}

export interface StoryDetail extends StorySummary {
  scenario_name: string | null
  stress_overlay: string | null
  inflection_point: string | null
  pov: string
  scene_anchor: string
  body: string | null
  generated_at: string
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all sets, each with its scenarios (summary) and per-scenario story
 * count. Ordered by central → upside → downside, then by display order
 * within each set (currently insertion order from the YAML).
 */
export async function listSetsWithScenarios(
  pool: pg.Pool,
): Promise<
  Array<{ set: FutureSetMeta; scenarios: ScenarioSummary[] }>
> {
  const { rows } = await pool.query<{
    slug: string
    set_id: string
    set_tail: SetTail
    name: string
    version: string
    distinguishing_thesis: string | null
    bracket_position: string | null
    continuity_pct: number | null
    innovation_pct: number | null
    frontier_portfolio: string[]
    story_count: string
  }>(
    `SELECT s.slug, s.set_id, s.set_tail, s.name, s.version,
            s.distinguishing_thesis, s.bracket_position,
            s.continuity_pct, s.innovation_pct,
            s.frontier_portfolio,
            COALESCE(
              (SELECT count(*)::int FROM scenario_stories ss WHERE ss.scenario_slug = s.slug),
              0
            )::text AS story_count
       FROM scenarios s
       ORDER BY s.set_id, s.id`,
  )

  const bySet: Record<string, ScenarioSummary[]> = {}
  for (const r of rows) {
    const summary: ScenarioSummary = {
      slug: r.slug,
      set_id: r.set_id,
      set_tail: r.set_tail,
      name: r.name,
      version: r.version,
      distinguishing_thesis: r.distinguishing_thesis,
      bracket_position: r.bracket_position,
      continuity_pct: r.continuity_pct,
      innovation_pct: r.innovation_pct,
      frontier_portfolio: r.frontier_portfolio ?? [],
      story_count: parseInt(r.story_count, 10),
    }
    ;(bySet[r.set_id] ??= []).push(summary)
  }

  return SET_TAIL_ORDER.flatMap((tail) =>
    Object.values(FUTURE_SETS)
      .filter((s) => s.set_tail === tail)
      .map((set) => ({ set, scenarios: bySet[set.set_id] ?? [] })),
  )
}

export async function getScenarioBySlug(
  pool: pg.Pool,
  slug: string,
): Promise<ScenarioDetail | null> {
  const { rows } = await pool.query<ScenarioDetail & { story_count: string }>(
    `SELECT s.*,
            (SELECT count(*)::int FROM scenario_stories ss WHERE ss.scenario_slug = s.slug)::text AS story_count
       FROM scenarios s WHERE s.slug = $1`,
    [slug],
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    ...r,
    story_count: parseInt(r.story_count, 10),
    frontier_portfolio: r.frontier_portfolio ?? [],
  }
}

export async function listStoriesForScenario(
  pool: pg.Pool,
  scenarioSlug: string,
): Promise<StorySummary[]> {
  const { rows } = await pool.query<StorySummary>(
    `SELECT slug, scenario_slug, set_id, set_tail,
            title, year, mode, protagonist_type, primary_character_role,
            word_count, frontier_slug, published
       FROM scenario_stories
       WHERE scenario_slug = $1
       ORDER BY year, slug`,
    [scenarioSlug],
  )
  return rows
}

export async function getStoryBySlug(
  pool: pg.Pool,
  slug: string,
): Promise<StoryDetail | null> {
  const { rows } = await pool.query<
    StoryDetail & { scenario_name: string | null }
  >(
    `SELECT ss.slug, ss.scenario_slug, ss.set_id, ss.set_tail,
            ss.title, ss.year, ss.mode, ss.protagonist_type,
            ss.primary_character_role, ss.word_count, ss.frontier_slug,
            ss.published,
            ss.stress_overlay, ss.inflection_point, ss.pov, ss.scene_anchor,
            ss.body, ss.generated_at,
            sc.name AS scenario_name
       FROM scenario_stories ss
       LEFT JOIN scenarios sc ON sc.slug = ss.scenario_slug
       WHERE ss.slug = $1`,
    [slug],
  )
  return rows[0] ?? null
}
