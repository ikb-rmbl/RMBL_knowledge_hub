/**
 * Scenarios service — context assembly for the Future Scenarios pipeline.
 *
 * Future Scenarios are version-controlled markdown files in the repo (under
 * `specification/scenarios/<set_id>/<slug>.md`), not DB rows. This service
 * handles the inputs the generation pipeline needs:
 *
 *   - Spec section extraction from Future_scenarios_framework.md
 *   - Definitions YAML loading from specification/scenarios/<set_id>/
 *   - Commons grounding (era primers, frontiers, planning themes)
 *   - Sibling-scenario discovery for cross-scenario consistency
 *
 * Composed primarily from existing service primitives (eras, frontiers). The
 * spec-section extractor and YAML loader are the only fresh capabilities.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import type pg from 'pg'

import { getEraPrimer } from './eras.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Walk up to repo root from src/services/ → ../../..
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SPEC_PATH = path.join(REPO_ROOT, 'specification', 'Future_scenarios_framework.md')
const SCENARIOS_ROOT = path.join(REPO_ROOT, 'specification', 'scenarios')

// ---------------------------------------------------------------------------
// Definitions YAML schema
// ---------------------------------------------------------------------------

export interface ScenarioInput {
  slug: string
  name: string
  version: string
  /**
   * 2–4 sentences naming the central strategic claim this scenario makes —
   * the bet no other scenario in the set makes. Required from spec v0.7
   * (see §2.7). The thesis is the organizing principle every prose section
   * must trace back to.
   */
  distinguishing_thesis: string
  /**
   * 2–4 sentence completion of "In 2040, RMBL matters because..." consistent
   * with the distinguishing_thesis. Required from spec v0.7 (see §2.7).
   * Forward-looking statement of consequence.
   */
  mattering_in_2040: string
  campaign_magnitude: {
    target_m_dollars: number
    range_m_dollars: [number, number]
    bracket_position: string
  }
  continuity_innovation_split: {
    continuity_pct: number
    innovation_pct: number
  }
  frontier_portfolio: string[]
}

export interface ScenarioSetDefinitions {
  set_id: string
  set_metadata: {
    name: string
    description?: string
    framework_version: string
    time_window: {
      primary_start: number
      primary_end: number
      coda_end: number
    }
  }
  scenarios: ScenarioInput[]
}

/**
 * Load the definitions YAML for a scenario set.
 *
 * Path: specification/scenarios/<set_id>/_definitions.yaml
 */
export function loadDefinitions(setId: string): ScenarioSetDefinitions {
  const defsPath = path.join(SCENARIOS_ROOT, setId, '_definitions.yaml')
  if (!existsSync(defsPath)) {
    throw new Error(
      `Definitions file not found for set "${setId}" at ${defsPath}`,
    )
  }
  const raw = readFileSync(defsPath, 'utf8')
  const parsed = yaml.load(raw) as ScenarioSetDefinitions
  if (!parsed?.set_id || parsed.set_id !== setId) {
    throw new Error(
      `Definitions file set_id ("${parsed?.set_id}") does not match expected "${setId}"`,
    )
  }
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(`Definitions file has no scenarios for set "${setId}"`)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Spec section extraction
// ---------------------------------------------------------------------------

export interface SpecSections {
  /** §3.1 Durable: RMBL's operating model */
  operating_model: string
  /** §3.2 Time-bound: the current moment */
  current_moment: string
  /** §3.3 Implications for scenario authoring and LLM prompts */
  llm_implications: string
  /** §6 Candidate research frontiers (entire section). */
  candidate_frontiers: string
  /** §7.1 Required field rules */
  required_rules: string
  /** §7.2 Forbidden patterns */
  forbidden_patterns: string
  /** §9.1 Public-facing scope and framing */
  public_facing: string
}

/**
 * Parse the Future_scenarios_framework.md spec and extract the sections
 * the scenario-generation prompt uses as preamble. Section boundaries are
 * detected by the markdown headers (`### 3.1 Durable...`, `## 6. Candidate...`,
 * etc.); content runs from after the header to immediately before the next
 * `##` or `### N.N` header at the same or higher level.
 */
export function parseSpecSections(): SpecSections {
  const raw = readFileSync(SPEC_PATH, 'utf8')
  const lines = raw.split('\n')

  function extractSection(headerPattern: RegExp): string {
    const startIdx = lines.findIndex((l) => headerPattern.test(l))
    if (startIdx === -1) {
      throw new Error(`Spec section not found: ${headerPattern}`)
    }
    // Find next header at same or higher level (## or ### N.N).
    const headerLevel = lines[startIdx].match(/^#+/)?.[0].length ?? 2
    let endIdx = lines.length
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      const m = l.match(/^(#+) /)
      if (!m) continue
      if (m[1].length <= headerLevel) {
        endIdx = i
        break
      }
    }
    // Include the header line itself for readability inside the prompt.
    return lines.slice(startIdx, endIdx).join('\n').trim()
  }

  return {
    operating_model: extractSection(/^### 3\.1 Durable:/),
    current_moment: extractSection(/^### 3\.2 Time-bound:/),
    llm_implications: extractSection(/^### 3\.3 Implications for scenario authoring/),
    candidate_frontiers: extractSection(/^## 6\. Candidate research frontiers/),
    required_rules: extractSection(/^### 7\.1 Required field rules/),
    forbidden_patterns: extractSection(/^### 7\.2 Forbidden patterns/),
    public_facing: extractSection(/^### 9\.1 Public-facing scope and framing/),
  }
}

// ---------------------------------------------------------------------------
// Commons grounding
// ---------------------------------------------------------------------------

export interface CommonsGrounding {
  most_recent_era: {
    slug: string
    name: string
    primer: string
  } | null
  century_era: {
    slug: string
    name: string
    primer: string
  } | null
  planning_themes: Array<{
    id: number
    title: string
    summary: string | null
  }>
}

/**
 * Pull the Commons artifacts the scenario prompt grounds on: the most recent
 * decade-or-bucket era primer (2021–25 currently), the most recent century
 * primer (21st century), and the cross-lens planning themes. Frontiers come
 * via a separate function so the portfolio filter applies.
 */
export async function getCommonsGrounding(
  pool: pg.Pool,
): Promise<CommonsGrounding> {
  // Most recent decade-or-bucket era with a primer.
  const { rows: recentEra } = await pool.query<{
    id: number
    slug: string
    name: string
  }>(
    `SELECT id, slug, name FROM eras
      WHERE kind = 'calendar' AND (end_year - start_year) < 50
      ORDER BY start_year DESC LIMIT 1`,
  )
  const mostRecentPrimer =
    recentEra[0] ? await getEraPrimer(pool, recentEra[0].id) : null

  // Most recent century-scale era with a primer (21st century).
  const { rows: centuryEra } = await pool.query<{
    id: number
    slug: string
    name: string
  }>(
    `SELECT id, slug, name FROM eras
      WHERE kind = 'calendar' AND (end_year - start_year) > 50
      ORDER BY start_year DESC LIMIT 1`,
  )
  const centuryPrimer =
    centuryEra[0] ? await getEraPrimer(pool, centuryEra[0].id) : null

  // Planning-pipeline themes (cross-lens strategic synthesis).
  const { rows: themes } = await pool.query<{
    id: number
    title: string
    summary: string | null
  }>(
    `SELECT id, title, summary
       FROM frontier_planning_themes
      ORDER BY id ASC`,
  )

  return {
    most_recent_era: recentEra[0] && mostRecentPrimer
      ? {
          slug: recentEra[0].slug,
          name: recentEra[0].name,
          primer: mostRecentPrimer.primer,
        }
      : null,
    century_era: centuryEra[0] && centuryPrimer
      ? {
          slug: centuryEra[0].slug,
          name: centuryEra[0].name,
          primer: centuryPrimer.primer,
        }
      : null,
    planning_themes: themes,
  }
}

// ---------------------------------------------------------------------------
// Frontier portfolio resolution
// ---------------------------------------------------------------------------

export interface ResolvedFrontier {
  id: string
  /** Description text from spec §6 if F.X.N-style id; from Commons if numeric. */
  description: string
  /** Source — spec means an F-prefixed candidate; commons means a numeric DB id. */
  source: 'spec' | 'commons'
}

/**
 * Resolve a frontier portfolio's IDs to their descriptions. F-prefixed IDs
 * (F.cont.1, F.innov.5, F.both.3) resolve to spec §6 entries; numeric IDs
 * resolve to Commons Frontier rows.
 *
 * Returns descriptions as plain text suitable for inclusion in the prompt.
 */
export async function resolveFrontierPortfolio(
  pool: pg.Pool,
  portfolio: string[],
  candidateFrontiersText: string,
): Promise<ResolvedFrontier[]> {
  const out: ResolvedFrontier[] = []
  for (const id of portfolio) {
    if (/^F\.(cont|innov|both)\.\d+$/.test(id)) {
      // Spec-defined candidate. Extract the bullet describing it from §6.
      const re = new RegExp(`- \\*\\*${id.replace(/\./g, '\\.')} —[\\s\\S]*?(?=\\n- \\*\\*F\\.|\\n### |\\n## |$)`, 'm')
      const m = candidateFrontiersText.match(re)
      out.push({
        id,
        description: m ? m[0].trim() : `(${id} — not found in spec §6)`,
        source: 'spec',
      })
    } else if (/^\d+$/.test(id)) {
      // Commons Frontier numeric id.
      const { rows } = await pool.query<{
        id: number
        name: string
        summary: string | null
      }>(`SELECT id, name, summary FROM frontiers WHERE id = $1`, [parseInt(id, 10)])
      const fr = rows[0]
      out.push({
        id,
        description: fr
          ? `**Frontier #${fr.id} — ${fr.name}.** ${fr.summary ?? '(no summary)'}`
          : `(Commons frontier #${id} — not found)`,
        source: 'commons',
      })
    } else {
      out.push({
        id,
        description: `(unrecognized frontier id: ${id})`,
        source: 'spec',
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Sibling scenarios for cross-scenario consistency
// ---------------------------------------------------------------------------

export interface SiblingScenario {
  slug: string
  /** Inline title from the .md heading. */
  name: string
  /** Synopsis section text if extractable, otherwise empty. */
  synopsis: string
  /** Shared inflection IDs already used by this scenario. */
  shared_inflection_ids: string[]
}

/**
 * Find sibling scenarios in the same set on disk. The pipeline uses these to
 * inform cross-scenario consistency — particularly to identify which
 * `shared_inflection_id` slugs are already in use, so a new scenario can
 * reuse them when modeling the same choice.
 */
export function loadSiblingScenarios(
  setId: string,
  excludeSlug?: string,
): SiblingScenario[] {
  const dir = path.join(SCENARIOS_ROOT, setId)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('_'),
  )
  const out: SiblingScenario[] = []
  for (const file of files) {
    const slug = file.replace(/\.md$/, '')
    if (slug === excludeSlug) continue
    const raw = readFileSync(path.join(dir, file), 'utf8')
    const nameMatch = raw.match(/^# (.+)$/m)
    const synopsisMatch = raw.match(/## Synopsis\s+([\s\S]*?)(?=\n##|\n---)/)
    const inflectionMatches = raw.match(/Shared inflection: `([^`]+)`/g) ?? []
    const sharedIds = inflectionMatches
      .map((m) => m.match(/`([^`]+)`/)?.[1])
      .filter((v): v is string => !!v)
    out.push({
      slug,
      name: nameMatch?.[1].trim() ?? slug,
      synopsis: synopsisMatch?.[1].trim() ?? '',
      shared_inflection_ids: Array.from(new Set(sharedIds)),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Assembled context for the generation prompt
// ---------------------------------------------------------------------------

export interface AssembledScenarioContext {
  setDefinitions: ScenarioSetDefinitions
  scenarioInput: ScenarioInput
  spec: SpecSections
  grounding: CommonsGrounding
  frontiers: ResolvedFrontier[]
  siblings: SiblingScenario[]
}

/**
 * Assemble everything the generation prompt needs for one scenario.
 */
export async function assembleScenarioContext(
  pool: pg.Pool,
  setId: string,
  slug: string,
): Promise<AssembledScenarioContext> {
  const setDefinitions = loadDefinitions(setId)
  const scenarioInput = setDefinitions.scenarios.find((s) => s.slug === slug)
  if (!scenarioInput) {
    throw new Error(`Scenario slug "${slug}" not found in definitions for set "${setId}"`)
  }
  const spec = parseSpecSections()
  const grounding = await getCommonsGrounding(pool)
  const frontiers = await resolveFrontierPortfolio(
    pool,
    scenarioInput.frontier_portfolio,
    spec.candidate_frontiers,
  )
  const siblings = loadSiblingScenarios(setId, slug)
  return { setDefinitions, scenarioInput, spec, grounding, frontiers, siblings }
}
