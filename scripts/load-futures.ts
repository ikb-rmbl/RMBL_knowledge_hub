/**
 * Load Future Scenarios + companion narratives into the database.
 *
 * Source: specification/scenarios/<set>/ and specification/stories/<set>/.
 * Tables: scenarios + scenario_stories (see scripts/sql/add-futures.sql).
 *
 * Idempotent: TRUNCATE+INSERT. Re-run after any regen.
 *
 * Usage:
 *   npx tsx scripts/load-futures.ts
 *   npx tsx scripts/load-futures.ts --dry-run
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import yaml from 'js-yaml'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SCENARIOS_ROOT = path.join(REPO_ROOT, 'specification', 'scenarios')
const STORIES_ROOT = path.join(REPO_ROOT, 'specification', 'stories')

// ----------------------------------------------------------------------------
// Set discovery and tail derivation
// ----------------------------------------------------------------------------

function discoverSets(): string[] {
  return readdirSync(SCENARIOS_ROOT).filter((d) =>
    existsSync(path.join(SCENARIOS_ROOT, d, '_definitions.yaml')),
  )
}

function setTail(setId: string): 'central' | 'upside' | 'downside' {
  if (setId.endsWith('-upside')) return 'upside'
  if (setId.endsWith('-downside')) return 'downside'
  return 'central'
}

// ----------------------------------------------------------------------------
// Scenario parsing
// ----------------------------------------------------------------------------

interface ScenarioYaml {
  slug: string
  name: string
  version: string
  distinguishing_thesis?: string
  mattering_in_2040?: string
  upside_conditions?: string
  downside_conditions?: string
  campaign_magnitude?: {
    target_m_dollars?: number
    range_m_dollars?: [number, number]
    bracket_position?: string
  }
  continuity_innovation_split?: {
    continuity_pct?: number
    innovation_pct?: number
  }
  frontier_portfolio?: string[]
}

interface SetYaml {
  set_id: string
  set_metadata: { name: string; description?: string; framework_version?: string }
  scenarios: ScenarioYaml[]
}

/**
 * Extract a single section by its header. Sections in scenario .md are level-2
 * headers (## Foo). Returns the text between this header and the next level-2
 * header (or end of file), with the header line itself stripped.
 */
function extractSection(markdown: string, headerPattern: RegExp): string | null {
  const lines = markdown.split('\n')
  const startIdx = lines.findIndex((l) => headerPattern.test(l))
  if (startIdx === -1) return null
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## [A-Z]/.test(lines[i])) {
      endIdx = i
      break
    }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim() || null
}

/**
 * Extract a single Phase subsection (### Phase N: ...) from the arc section.
 */
function extractPhase(markdown: string, phase: 1 | 2 | 3): string | null {
  const lines = markdown.split('\n')
  const startIdx = lines.findIndex((l) =>
    new RegExp(`^### Phase ${phase}\\b`).test(l),
  )
  if (startIdx === -1) return null
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || /^### Phase \d/.test(lines[i])) {
      endIdx = i
      break
    }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim() || null
}

interface ParsedScenario {
  slug: string
  set_id: string
  set_tail: 'central' | 'upside' | 'downside'
  name: string
  version: string
  distinguishing_thesis: string | null
  mattering_in_2040: string | null
  upside_conditions: string | null
  downside_conditions: string | null
  campaign_target_m_dollars: number | null
  campaign_range_min_m: number | null
  campaign_range_max_m: number | null
  bracket_position: string | null
  continuity_pct: number | null
  innovation_pct: number | null
  frontier_portfolio: string[]
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
  full_markdown: string
}

function loadScenariosForSet(setId: string): ParsedScenario[] {
  const yamlPath = path.join(SCENARIOS_ROOT, setId, '_definitions.yaml')
  const defs = yaml.load(readFileSync(yamlPath, 'utf8')) as SetYaml
  const tail = setTail(setId)
  const out: ParsedScenario[] = []
  for (const sc of defs.scenarios) {
    const mdPath = path.join(SCENARIOS_ROOT, setId, `${sc.slug}.md`)
    if (!existsSync(mdPath)) {
      console.warn(`  ⚠️  Missing scenario .md for ${setId}/${sc.slug} — skipping`)
      continue
    }
    const md = readFileSync(mdPath, 'utf8')
    const range = sc.campaign_magnitude?.range_m_dollars ?? null
    out.push({
      slug: sc.slug,
      set_id: setId,
      set_tail: tail,
      name: sc.name,
      version: sc.version,
      distinguishing_thesis: sc.distinguishing_thesis ?? null,
      mattering_in_2040: sc.mattering_in_2040 ?? null,
      upside_conditions: sc.upside_conditions ?? null,
      downside_conditions: sc.downside_conditions ?? null,
      campaign_target_m_dollars: sc.campaign_magnitude?.target_m_dollars ?? null,
      campaign_range_min_m: range?.[0] ?? null,
      campaign_range_max_m: range?.[1] ?? null,
      bracket_position: sc.campaign_magnitude?.bracket_position ?? null,
      continuity_pct: sc.continuity_innovation_split?.continuity_pct ?? null,
      innovation_pct: sc.continuity_innovation_split?.innovation_pct ?? null,
      frontier_portfolio: sc.frontier_portfolio ?? [],
      synopsis: extractSection(md, /^## Synopsis\b/),
      setting: extractSection(md, /^## Setting\b/),
      phase_1: extractPhase(md, 1),
      phase_2: extractPhase(md, 2),
      phase_3: extractPhase(md, 3),
      lines_of_inquiry: extractSection(md, /^## Lines of inquiry\b/),
      moments_of_choice: extractSection(md, /^## Moments of choice\b/),
      audience_lens_research: extractSection(md, /^## Audience lens — research\b/),
      audience_lens_institution: extractSection(md, /^## Audience lens — institution\b/),
      audience_lens_donor: extractSection(md, /^## Audience lens — donor\b/),
      overlay_robustness: extractSection(md, /^## Overlay robustness\b/),
      plausibility_caveats: extractSection(md, /^## Plausibility caveats\b/),
      coda: extractSection(md, /^## Looking further out\b/),
      full_markdown: md,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// Story parsing
// ----------------------------------------------------------------------------

interface StoryYaml {
  story_slug: string
  scenario_slug: string
  mode: 'inhabitation' | 'inflection-point' | 'stress-overlay'
  year: number
  stress_overlay?: string
  inflection_point?: string
  pov: string
  protagonist_type?: string
  primary_character_role: string
  scene_anchor: string
  frontier_slug?: string
  word_count_target: number
  published?: boolean
}

interface StorySetYaml {
  set_id: string
  framework_version?: string
  stories: StoryYaml[]
}

interface ParsedStory {
  slug: string
  scenario_slug: string
  set_id: string
  set_tail: 'central' | 'upside' | 'downside'
  mode: 'inhabitation' | 'inflection-point' | 'stress-overlay'
  year: number
  stress_overlay: string | null
  inflection_point: string | null
  pov: string
  protagonist_type: string | null
  primary_character_role: string
  scene_anchor: string
  frontier_slug: string | null
  title: string | null
  body: string | null
  word_count: number | null
  word_count_target: number
  published: boolean
  full_markdown: string
}

function loadStoriesForSet(setId: string): ParsedStory[] {
  const yamlPath = path.join(STORIES_ROOT, setId, '_story_definitions.yaml')
  if (!existsSync(yamlPath)) return []
  const defs = yaml.load(readFileSync(yamlPath, 'utf8')) as StorySetYaml
  const tail = setTail(setId)
  const out: ParsedStory[] = []
  for (const st of defs.stories) {
    const mdPath = path.join(STORIES_ROOT, setId, `${st.story_slug}.md`)
    if (!existsSync(mdPath)) {
      console.warn(`  ⚠️  Missing story .md for ${setId}/${st.story_slug} — skipping`)
      continue
    }
    const md = readFileSync(mdPath, 'utf8')

    // Parse the metadata header line for word count + published flag.
    const headerMatch = md.match(/Word count: (\d+).*Published: (yes|internal-only|no)/)
    const wordCount = headerMatch ? parseInt(headerMatch[1], 10) : null
    const publishedFromMd = headerMatch ? headerMatch[2] === 'yes' : false

    // Title: first `# Foo` line after the `---` divider.
    const titleMatch = md.match(/^# (.+)$/m)
    const title = titleMatch?.[1].trim() ?? null

    // Body: everything after the title line.
    let body: string | null = null
    if (titleMatch) {
      const titleIdx = md.indexOf(titleMatch[0])
      body = md.slice(titleIdx + titleMatch[0].length).trim()
    }

    out.push({
      slug: st.story_slug,
      scenario_slug: st.scenario_slug,
      set_id: setId,
      set_tail: tail,
      mode: st.mode,
      year: st.year,
      stress_overlay: st.stress_overlay ?? null,
      inflection_point: st.inflection_point ?? null,
      pov: st.pov,
      protagonist_type: st.protagonist_type ?? null,
      primary_character_role: st.primary_character_role,
      scene_anchor: st.scene_anchor,
      frontier_slug: st.frontier_slug ?? null,
      title,
      body,
      word_count: wordCount,
      word_count_target: st.word_count_target,
      published: st.published ?? publishedFromMd,
      full_markdown: md,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log(`Loading futures (dryRun=${dryRun})`)

  const sets = discoverSets()
  console.log(`  Discovered ${sets.length} sets: ${sets.join(', ')}`)

  const scenarios: ParsedScenario[] = []
  const stories: ParsedStory[] = []
  for (const setId of sets) {
    const setScenarios = loadScenariosForSet(setId)
    const setStories = loadStoriesForSet(setId)
    console.log(
      `  ${setId}: ${setScenarios.length} scenarios, ${setStories.length} stories`,
    )
    scenarios.push(...setScenarios)
    stories.push(...setStories)
  }

  console.log(`\nTotal: ${scenarios.length} scenarios, ${stories.length} stories`)

  if (dryRun) {
    console.log('\n(DRY RUN — not writing)')
    console.log('\nSample scenario:')
    console.log({
      slug: scenarios[0]?.slug,
      set_id: scenarios[0]?.set_id,
      set_tail: scenarios[0]?.set_tail,
      bracket_position: scenarios[0]?.bracket_position,
      synopsis_len: scenarios[0]?.synopsis?.length,
    })
    console.log('\nSample story:')
    console.log({
      slug: stories[0]?.slug,
      scenario_slug: stories[0]?.scenario_slug,
      title: stories[0]?.title,
      word_count: stories[0]?.word_count,
      body_len: stories[0]?.body?.length,
    })
    return
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 4,
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Truncate both tables; CASCADE handles scenario_stories' FK to scenarios.
    await client.query('TRUNCATE TABLE scenario_stories, scenarios RESTART IDENTITY CASCADE')

    for (const sc of scenarios) {
      await client.query(
        `INSERT INTO scenarios (
          slug, set_id, set_tail, name, version,
          distinguishing_thesis, mattering_in_2040,
          upside_conditions, downside_conditions,
          campaign_target_m_dollars, campaign_range_min_m, campaign_range_max_m, bracket_position,
          continuity_pct, innovation_pct, frontier_portfolio,
          synopsis, setting, phase_1, phase_2, phase_3,
          lines_of_inquiry, moments_of_choice,
          audience_lens_research, audience_lens_institution, audience_lens_donor,
          overlay_robustness, plausibility_caveats, coda,
          full_markdown
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7,
          $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20, $21,
          $22, $23,
          $24, $25, $26,
          $27, $28, $29,
          $30
        )`,
        [
          sc.slug, sc.set_id, sc.set_tail, sc.name, sc.version,
          sc.distinguishing_thesis, sc.mattering_in_2040,
          sc.upside_conditions, sc.downside_conditions,
          sc.campaign_target_m_dollars, sc.campaign_range_min_m, sc.campaign_range_max_m, sc.bracket_position,
          sc.continuity_pct, sc.innovation_pct, JSON.stringify(sc.frontier_portfolio),
          sc.synopsis, sc.setting, sc.phase_1, sc.phase_2, sc.phase_3,
          sc.lines_of_inquiry, sc.moments_of_choice,
          sc.audience_lens_research, sc.audience_lens_institution, sc.audience_lens_donor,
          sc.overlay_robustness, sc.plausibility_caveats, sc.coda,
          sc.full_markdown,
        ],
      )
    }

    for (const st of stories) {
      await client.query(
        `INSERT INTO scenario_stories (
          slug, scenario_slug, set_id, set_tail,
          mode, year, stress_overlay, inflection_point,
          pov, protagonist_type, primary_character_role, scene_anchor,
          frontier_slug,
          title, body, word_count,
          word_count_target, published,
          full_markdown
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13,
          $14, $15, $16,
          $17, $18,
          $19
        )`,
        [
          st.slug, st.scenario_slug, st.set_id, st.set_tail,
          st.mode, st.year, st.stress_overlay, st.inflection_point,
          st.pov, st.protagonist_type, st.primary_character_role, st.scene_anchor,
          st.frontier_slug,
          st.title, st.body, st.word_count,
          st.word_count_target, st.published,
          st.full_markdown,
        ],
      )
    }

    await client.query('COMMIT')
    console.log(`\n✓ Loaded ${scenarios.length} scenarios + ${stories.length} stories`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
