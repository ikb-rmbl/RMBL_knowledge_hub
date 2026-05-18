/**
 * Per-theme LLM analysis of "reach beyond the Gunnison Basin": which
 * specific programs, decision processes, scientific communities, and
 * geographic scales each theme would influence outside RMBL's home basin.
 *
 * Reads each theme's existing content (title, opportunity, summary,
 * planning_anchors, considerations, constituent cluster titles) and writes
 * back two fields:
 *   - reach_summary: 2-4 sentence paragraph naming external reach
 *   - long_reach_anchors: JSON array of 3-5 entries, each {anchor, reach}
 *
 * Honest about themes that are largely basin-local — the prompt explicitly
 * instructs the model NOT to manufacture reach where the corpus doesn't
 * support it.
 *
 * Cost: ~$0.15-0.20 per theme with Opus 4.7. ~$2-3 total for 12 themes.
 *
 * Usage:
 *   npx tsx scripts/analyze-theme-reach.ts
 *   npx tsx scripts/analyze-theme-reach.ts --limit=1 --force
 *   npx tsx scripts/analyze-theme-reach.ts --model=claude-sonnet-4-6
 */

import pg from 'pg'
import { callClaudeJson } from './lib/claude-api.js'
import './lib/config.js'

const args = process.argv.slice(2)
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10)
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-opus-4-7'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PRELUDE = `You are helping the Rocky Mountain Biological Laboratory (RMBL) identify how each cross-lens planning theme would influence science, policy, and practice BEYOND the Gunnison Basin. The basin is RMBL's home and primary research location, but RMBL leadership wants to surface where the work would also have state, national, multi-state, continental, or global reach — and where it would not.

You will receive ONE theme: its title, "opportunity" statement, framing summary, planning anchors, considerations paragraph, and the titles of its constituent clusters (which carry geographic and program signals). Your job is to identify and articulate the theme's reach BEYOND the Gunnison Basin specifically.

Return JSON with two fields:

  "reach_summary": A 2-4 sentence paragraph naming specifically how this theme's work would influence science, policy, or practice outside the Gunnison Basin. Reference SPECIFIC named programs (e.g., NEPA, FERC relicensing, Upper Colorado River Endangered Fish Recovery Program, EPA Clean Air Act source attribution, USDA grazing standards, UMTRA Title II disposal cells, NSF Long-Term Ecological Research network), decision processes, geographic scales (multi-state, Colorado River basin, western U.S., snow-dominated mountain systems globally), and scientific communities (e.g., "mountain hydrology research community," "alpine ecology community," "long-term ecological research stations globally") where the corpus actually supports those claims.

  If the theme is genuinely basin-local with limited external reach, SAY SO HONESTLY in this paragraph. Do not manufacture reach where the corpus doesn't support it. Themes whose impacts and anchors mostly name Gunnison County, the Upper Gunnison Basin, or specific basin agencies are appropriately framed as basin-anchored — that is a legitimate analytic finding.

  "long_reach_anchors": JSON array of 3-5 entries. Each entry must have:

    - "anchor": A specific work item — drawn from or closely synthesized from the theme's planning_anchors — that has particular reach beyond the basin. Use language close to the source anchors; do not invent new work. If a theme is largely basin-local, list the 3 entries with the MOST reach (even if reach is modest) rather than padding with fabricated long-reach items.

    - "reach": A specific claim about where this anchor's reach extends and through what mechanism. Examples of the right shape:
        * "Sets precedent for multi-state Colorado River compact administration through the Upper Colorado River Endangered Fish Recovery Program"
        * "Provides a generalizable framework for predicting mountain watershed response to changing snow regimes, transferable to other snow-dominated headwater systems in the western U.S. and globally"
        * "Informs EPA Clean Air Act source-attribution methods used across western U.S. national parks and wilderness areas"
        * "Establishes data-stewardship and translation patterns transferable to other long-term ecological research stations in the NSF LTER network"
        * "Influences NRC and DOE Office of Legacy Management standards for uranium mill tailings disposal cells nationally"

Constraints:
- GROUNDED. Only claim reach that the theme's content actually supports — referenced programs, geographies, and communities should come from or be reasonably inferable from the theme material.
- SPECIFIC. Name programs, agencies, decisions, scientific communities, and geographic scales explicitly. Avoid filler like "globally relevant" or "broader scientific impact" without specifics.
- HONEST. If a theme is mostly basin-local, the reach_summary should acknowledge this candidly. Do not pretend a county-zoning theme has global reach.
- INVITATIONAL voice. Use "would influence," "is positioned to inform," "could anchor." Do not use "must" or "should."
- Lens-aware. A theme dominated by IMPACT clusters often has more identifiable reach (named federal/state programs); a theme dominated by basin-specific demographic or fiscal data may have less.`

// ---------------------------------------------------------------------------
// Content assembly
// ---------------------------------------------------------------------------

function buildContent(t: any, clusterTitles: { item_type: string; title: string }[]): string {
  const lines: string[] = []
  lines.push('THEME')
  lines.push('')
  lines.push(`TITLE: ${t.title}`)
  lines.push('')
  lines.push(`OPPORTUNITY: ${t.opportunity}`)
  lines.push('')
  lines.push(`SUMMARY: ${t.summary}`)
  lines.push('')
  lines.push('PLANNING ANCHORS:')
  for (const a of (t.planning_anchors || [])) lines.push(`  - ${a}`)
  lines.push('')
  lines.push(`CONSIDERATIONS: ${t.considerations}`)
  lines.push('')
  lines.push('CONSTITUENT CLUSTER TITLES (grouped by lens — these carry the geographic and program signals):')
  const byType = new Map<string, string[]>()
  for (const c of clusterTitles) {
    if (!byType.has(c.item_type)) byType.set(c.item_type, [])
    byType.get(c.item_type)!.push(c.title)
  }
  for (const [type, titles] of [...byType.entries()].sort()) {
    lines.push(`  ${type}:`)
    for (const ti of titles) lines.push(`    - ${ti}`)
  }
  lines.push('')
  lines.push('Return JSON with fields: reach_summary, long_reach_anchors (array of {anchor, reach}).')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Analyze theme reach beyond the basin')
  console.log('====================================')
  console.log(`  model=${model}${limit ? `  limit=${limit}` : ''}${force ? '  (--force)' : ''}${dryRun ? '  (DRY RUN)' : ''}`)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing from .env')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const where = force ? 'WHERE title IS NOT NULL' : 'WHERE title IS NOT NULL AND reach_summary IS NULL'
  const limitSql = limit > 0 ? `LIMIT ${limit}` : ''
  const { rows: themes } = await db.query(`
    SELECT id, title, opportunity, summary,
           planning_anchors::text AS anchors_str, considerations
    FROM frontier_planning_themes
    ${where}
    ORDER BY leverage_score DESC ${limitSql}
  `)
  const parsedThemes = themes.map((t: any) => ({
    ...t,
    planning_anchors: typeof t.anchors_str === 'string' ? JSON.parse(t.anchors_str) : (t.planning_anchors || []),
  }))

  console.log(`\n  ${parsedThemes.length} themes to analyze`)
  if (parsedThemes.length === 0) { await db.end(); return }

  let totalCost = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < parsedThemes.length; i++) {
    const t = parsedThemes[i]
    process.stdout.write(`\n[${i + 1}/${parsedThemes.length}] theme ${t.id} ("${t.title.slice(0, 60)}…")  `)

    // Pull constituent cluster titles for context (geographic + program signals)
    const { rows: clusterTitles } = await db.query(
      `SELECT item_type, title FROM frontier_planning_clusters
       WHERE theme_id = $1 AND title IS NOT NULL
       ORDER BY item_type, item_count DESC`,
      [t.id],
    )

    const content = buildContent(t, clusterTitles)

    if (dryRun) {
      console.log('(dry run)')
      if (i === 0) {
        console.log('\n=== sample assembled content ===')
        console.log(content.slice(0, 2000))
      }
      continue
    }

    try {
      const { data, response } = await callClaudeJson<{
        reach_summary: string;
        long_reach_anchors: { anchor: string; reach: string }[];
      }>({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model,
        prompt: SYSTEM_PRELUDE,
        content,
        maxTokens: 1500,
      })
      totalCost += response.cost
      if (!data || !data.reach_summary || !Array.isArray(data.long_reach_anchors)) {
        console.log(`FAILED (missing fields)`)
        failed++
        continue
      }
      const anchors = data.long_reach_anchors
        .filter((a) => a && typeof a.anchor === 'string' && typeof a.reach === 'string')
        .map((a) => ({ anchor: a.anchor.trim(), reach: a.reach.trim() }))
        .slice(0, 5)
      await db.query(
        `UPDATE frontier_planning_themes SET reach_summary = $1, long_reach_anchors = $2::jsonb WHERE id = $3`,
        [data.reach_summary.trim(), JSON.stringify(anchors), t.id],
      )
      succeeded++
      process.stdout.write(`OK ($${response.cost.toFixed(4)}, ${anchors.length} anchors)`)
    } catch (err: any) {
      console.log(`FAILED: ${err.message?.slice(0, 100)}`)
      failed++
    }
  }

  console.log(`\n\nDone: ${succeeded} analyzed, ${failed} failed, total cost $${totalCost.toFixed(2)}`)
  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
