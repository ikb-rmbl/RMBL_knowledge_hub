/**
 * Stories service — context assembly for the Stories pipeline.
 *
 * Stories are short literary fiction grounded in scenarios. They live as
 * version-controlled .md files at specification/stories/<set_id>/<story_slug>.md.
 * Pipeline analogous to scenarios: a YAML file lists the stories to generate;
 * each story's input loads the scenario it's grounded in as context.
 *
 * Per spec §11.
 */

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import type pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCENARIOS_ROOT = path.join(REPO_ROOT, 'specification', 'scenarios')
const STORIES_ROOT = path.join(REPO_ROOT, 'specification', 'stories')

// ---------------------------------------------------------------------------
// Story definitions YAML schema
// ---------------------------------------------------------------------------

export type StoryMode = 'inhabitation' | 'inflection-point' | 'stress-overlay'
export type ProtagonistType = 'guest_scientist' | 'rmbl_staff' | 'partner'

export interface StoryInput {
  story_slug: string
  scenario_slug: string
  mode: StoryMode
  year: number
  /** Required when mode === 'stress-overlay'. The specific stress this story dramatizes. */
  stress_overlay?: string
  /** Required when mode === 'inflection-point'. The moment-of-choice this story dramatizes. */
  inflection_point?: string
  /** Free-text POV directive. Typical: "third-person limited" or "first-person". */
  pov: string
  /**
   * Protagonist category (spec §11.2a). Defaults to `guest_scientist` —
   * see spec for when `partner` or `rmbl_staff` is the right call.
   */
  protagonist_type?: ProtagonistType
  /** A role-level description of the primary character. Not a real person. */
  primary_character_role: string
  /** A specific situation/event the story turns on. */
  scene_anchor: string
  /**
   * Slug of a frontier from the Commons (`frontiers` table). The protagonist
   * is pushing this frontier through a specific action drawn from
   * `pushing_the_frontier`. See spec §11.2a. Loaded at context-assembly time.
   */
  frontier_slug?: string
  /** Target word count for the story prose (±15% acceptable). */
  word_count_target: number
  /**
   * Public visibility flag. Defaults to false; stories cleared for Commons
   * publication get published: true (per spec §11.5).
   */
  published?: boolean
}

export interface StorySetDefinitions {
  set_id: string
  framework_version: string
  stories: StoryInput[]
}

/**
 * Load the story-definitions YAML for a set.
 * Path: specification/stories/<set_id>/_story_definitions.yaml
 */
export function loadStoryDefinitions(setId: string): StorySetDefinitions {
  const p = path.join(STORIES_ROOT, setId, '_story_definitions.yaml')
  if (!existsSync(p)) {
    throw new Error(`Story definitions not found for set "${setId}" at ${p}`)
  }
  const parsed = yaml.load(readFileSync(p, 'utf8')) as StorySetDefinitions
  if (!parsed?.set_id || parsed.set_id !== setId) {
    throw new Error(
      `Story definitions set_id ("${parsed?.set_id}") does not match expected "${setId}"`,
    )
  }
  if (!Array.isArray(parsed.stories) || parsed.stories.length === 0) {
    throw new Error(`Story definitions file has no stories for set "${setId}"`)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Scenario loading (the scenario .md is the primary context for a story)
// ---------------------------------------------------------------------------

export interface LoadedScenario {
  slug: string
  /** The full scenario .md file contents. */
  markdown: string
  /** The scenario's human-readable name from the .md header. */
  name: string
}

export function loadScenarioForStory(
  setId: string,
  scenarioSlug: string,
): LoadedScenario {
  const p = path.join(SCENARIOS_ROOT, setId, `${scenarioSlug}.md`)
  if (!existsSync(p)) {
    throw new Error(
      `Scenario file not found: ${path.relative(REPO_ROOT, p)} (set ${setId}, slug ${scenarioSlug})`,
    )
  }
  const markdown = readFileSync(p, 'utf8')
  const nameMatch = markdown.match(/^# (.+)$/m)
  return {
    slug: scenarioSlug,
    markdown,
    name: nameMatch?.[1].trim() ?? scenarioSlug,
  }
}

// ---------------------------------------------------------------------------
// Assembled context for a story-generation call
// ---------------------------------------------------------------------------

export interface AssembledStoryContext {
  setId: string
  storyInput: StoryInput
  scenario: LoadedScenario
  /** Loaded from the Commons when storyInput.frontier_slug is set (spec §11.2a). */
  frontier?: FrontierForStory
}

export function assembleStoryContext(
  setId: string,
  storySlug: string,
): AssembledStoryContext {
  const defs = loadStoryDefinitions(setId)
  const storyInput = defs.stories.find((s) => s.story_slug === storySlug)
  if (!storyInput) {
    throw new Error(`Story slug "${storySlug}" not in definitions for set "${setId}"`)
  }
  // Validate mode-specific fields.
  if (storyInput.mode === 'stress-overlay' && !storyInput.stress_overlay) {
    throw new Error(
      `Story "${storySlug}" mode=stress-overlay but stress_overlay field is empty`,
    )
  }
  if (storyInput.mode === 'inflection-point' && !storyInput.inflection_point) {
    throw new Error(
      `Story "${storySlug}" mode=inflection-point but inflection_point field is empty`,
    )
  }
  const scenario = loadScenarioForStory(setId, storyInput.scenario_slug)
  return { setId, storyInput, scenario }
}

// ---------------------------------------------------------------------------
// Frontier loading (spec §11.2a)
// ---------------------------------------------------------------------------

/**
 * Compact frontier representation surfaced to PROMPT_STORY. Picks the first
 * 3 key questions, first 2 pushing-actions, and first 1 data gap from the
 * frontier row — the LLM-synthesized order in the Commons is already
 * roughly importance-ranked.
 */
export interface FrontierForStory {
  slug: string
  title: string
  description: string
  tractability: string | null
  keyQuestions: string[]
  keyActions: { category: string; effort: string; action: string }[]
  dataGap: string | null
}

/**
 * Load a frontier from the Commons for use as a story's organizing question.
 * Returns null if the slug is not found (so a malformed YAML doesn't fail
 * the whole generation — the prompt simply skips the frontier block).
 */
export async function loadFrontierForStory(
  pool: pg.Pool,
  frontierSlug: string,
): Promise<FrontierForStory | null> {
  const { rows } = await pool.query<{
    slug: string
    title: string
    frontier_description: string | null
    tractability: string | null
    key_questions: string[] | null
    pushing_the_frontier: { category: string; effort: string; action: string }[] | null
    data_gaps: string[] | null
  }>(
    `SELECT slug, title, frontier_description, tractability,
            key_questions, pushing_the_frontier, data_gaps
       FROM frontiers WHERE slug = $1`,
    [frontierSlug],
  )
  const row = rows[0]
  if (!row) return null
  return {
    slug: row.slug,
    title: row.title,
    description: row.frontier_description ?? '',
    tractability: row.tractability,
    keyQuestions: (row.key_questions ?? []).slice(0, 3),
    keyActions: (row.pushing_the_frontier ?? []).slice(0, 2),
    dataGap: (row.data_gaps ?? [])[0] ?? null,
  }
}
