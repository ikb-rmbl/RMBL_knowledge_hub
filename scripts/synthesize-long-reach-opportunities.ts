/**
 * One-shot meta-synthesis pass: read all 12 themes' per-theme reach
 * analyses and produce 5-8 distilled cross-theme "long-reach opportunities"
 * for the top-of-report planning-conversation summary.
 *
 * The output is the "if RMBL has 30 minutes for one slide on reach,
 * what shows up?" view. Each opportunity:
 *   - Names a specific external influence pathway
 *   - Cuts across multiple themes
 *   - Identifies which themes contribute to it
 *   - Names the scope (federal / multi-state / continental / global / mixed)
 *
 * Cost: ~$0.40-0.60 with Opus 4.7 (single call but with all 12 themes
 * worth of reach material as context).
 *
 * Usage:
 *   npx tsx scripts/synthesize-long-reach-opportunities.ts
 *   npx tsx scripts/synthesize-long-reach-opportunities.ts --force --model=claude-sonnet-4-6
 */

import pg from 'pg'
import { callClaudeJson } from './lib/claude-api.js'
import './lib/config.js'

const args = process.argv.slice(2)
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-opus-4-7'

const SYSTEM_PRELUDE = `You are producing the top-of-report strategic synthesis for the Rocky Mountain Biological Laboratory (RMBL). Audience: RMBL board, leadership, and select scientists deliberating about institutional planning priorities.

You will receive per-theme "reach beyond the basin" analyses for 12 cross-lens planning themes. Each per-theme analysis describes how that theme's work would influence science, policy, or practice beyond the Gunnison Basin, and lists 3-5 specific long-reach anchors with the mechanism of reach explicitly named.

Your job: synthesize ACROSS the 12 themes to produce 5-8 distilled STRATEGIC LONG-REACH OPPORTUNITIES — the high-altitude cross-cutting opportunities where RMBL's planning investments would have the most reach beyond the Gunnison Basin. This is the "if we had 30 minutes for one slide on reach, what shows up?" view.

Return JSON: an array of 5-8 opportunity entries, ranked highest-reach + most cross-cutting first. Each opportunity has:

  "title": 6-14 words naming the opportunity as a strategic category. Examples of the right shape:
    - "Mountain watershed science transferable to snow-dominated headwater systems globally"
    - "Coordinated cross-jurisdictional contaminant science for the Colorado River basin and beyond"
    - "Long-term ecological observation patterns for the NSF LTER and Critical Zone networks"
    - "Adaptive co-management frameworks usable across western public-lands agencies"

  "description": 2-4 sentences. (a) What this opportunity is; (b) WHY it has long reach — what specific mechanisms (named programs, scientific communities, geographic scales) carry RMBL's work outward; (c) what cuts across multiple themes here — i.e., why this is a cross-cutting opportunity rather than a single-theme one.

  "reach_scope": One of these labels, picked honestly:
    - "federal"        — primarily U.S. federal-level policy or programs (single-country)
    - "multi-state"    — regional/western-U.S. or multi-state (within the U.S.)
    - "continental"   — North American scope (e.g., NSF networks, continental-scale science)
    - "global"        — international scientific or policy reach
    - "mixed"         — multiple scopes blended

  "contributing_themes": Array of 1-5 EXACT theme titles (from the input) that contribute most to this opportunity. Use the theme titles verbatim. Do not invent themes.

Constraints:
- DISTINCT. Each opportunity should be a meaningfully different angle on long reach — not minor variants. Avoid two opportunities that say almost the same thing.
- GROUNDED. Only synthesize from the per-theme reach material provided. Don't invent reach claims the themes don't make.
- SPECIFIC. Name programs, networks, geographic scales, scientific communities by name. Avoid filler like "broader scientific impact."
- HONEST. If the corpus doesn't support 8 distinct cross-cutting opportunities, return fewer (5-6). Do not pad.
- INVITATIONAL voice consistent with the surrounding report.
- Ranked. First opportunity = highest aggregate reach + most cross-theme leverage. Last = still substantive but more focused.`

async function main() {
  console.log('Synthesize cross-theme long-reach opportunities')
  console.log('===============================================')
  console.log(`  model=${model}${force ? '  (--force)' : ''}${dryRun ? '  (DRY RUN)' : ''}`)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing from .env')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Skip if already populated unless --force
  const { rows: [exists] } = await db.query(`SELECT count(*)::int AS n FROM frontier_long_reach_opportunities`)
  if (exists.n > 0 && !force) {
    console.log(`  ${exists.n} opportunities already exist; use --force to re-run.`)
    await db.end()
    return
  }

  // Load all themes' reach analysis
  const { rows: themes } = await db.query(`
    SELECT id, title, opportunity, reach_summary, long_reach_anchors::text AS anchors_str, leverage_score
    FROM frontier_planning_themes
    WHERE title IS NOT NULL AND reach_summary IS NOT NULL
    ORDER BY leverage_score DESC
  `)
  const parsed = themes.map((t: any) => ({
    ...t,
    long_reach_anchors: typeof t.anchors_str === 'string' ? JSON.parse(t.anchors_str) : (t.long_reach_anchors || []),
  }))

  console.log(`\n  ${parsed.length} themes with reach analysis as input`)
  if (parsed.length === 0) {
    console.error('  No themes with reach analysis found. Run analyze-theme-reach.ts first.')
    await db.end()
    process.exit(1)
  }

  // Build content
  const lines: string[] = []
  lines.push('THEMES WITH PER-THEME REACH ANALYSES')
  lines.push('')
  let idx = 0
  for (const t of parsed) {
    idx++
    lines.push(`### Theme ${idx}: ${t.title}`)
    lines.push('')
    lines.push(`Opportunity statement: ${t.opportunity}`)
    lines.push('')
    lines.push(`Reach summary: ${t.reach_summary}`)
    lines.push('')
    lines.push(`Long-reach anchors (anchor → reach):`)
    for (const a of (t.long_reach_anchors as any[])) {
      lines.push(`  - ${a.anchor}`)
      lines.push(`    → ${a.reach}`)
    }
    lines.push('')
  }
  lines.push('Return JSON array of 5-8 strategic long-reach opportunities, ranked.')
  const content = lines.join('\n')

  if (dryRun) {
    console.log('\n=== assembled content (first 3000 chars) ===')
    console.log(content.slice(0, 3000))
    await db.end()
    return
  }

  console.log('\n  Calling Opus...')
  const { data, response } = await callClaudeJson<Array<{
    title: string
    description: string
    reach_scope: string
    contributing_themes: string[]
  }>>({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model,
    prompt: SYSTEM_PRELUDE,
    content,
    maxTokens: 4000,
  })
  console.log(`  Got ${Array.isArray(data) ? data.length : 0} opportunities ($${response.cost.toFixed(4)})`)

  if (!Array.isArray(data) || data.length === 0) {
    console.error('  Failed to parse opportunities from response')
    await db.end()
    process.exit(1)
  }

  // Resolve theme IDs from titles (so the report can hyperlink)
  const titleToId = new Map<string, number>()
  for (const t of parsed) titleToId.set(t.title, t.id)

  await db.query(`TRUNCATE frontier_long_reach_opportunities RESTART IDENTITY`)
  let rank = 0
  for (const opp of data) {
    rank++
    const contribs = (opp.contributing_themes || [])
      .filter((title) => typeof title === 'string')
      .map((title) => ({ theme_title: title, theme_id: titleToId.get(title) ?? null }))
    await db.query(
      `INSERT INTO frontier_long_reach_opportunities (rank, title, description, reach_scope, contributing_themes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [rank, opp.title.trim(), opp.description.trim(), (opp.reach_scope || 'mixed').toLowerCase(), JSON.stringify(contribs)],
    )
  }

  console.log(`\n  Wrote ${rank} opportunities`)
  console.log('\n  Top 3 by rank:')
  const { rows: top } = await db.query(`
    SELECT rank, title, reach_scope, jsonb_array_length(contributing_themes) AS n_themes
    FROM frontier_long_reach_opportunities ORDER BY rank LIMIT 3`)
  for (const o of top) {
    console.log(`    ${o.rank}. [${o.reach_scope}, ${o.n_themes} themes]  ${o.title}`)
  }

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
