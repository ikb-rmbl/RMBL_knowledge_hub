/**
 * Use Claude Opus 4.7 to synthesize each cross-lens planning theme into
 * a planning-conversation-ready description: title, invitational
 * "opportunity" statement, framing summary, distilled planning anchors,
 * and honest considerations.
 *
 * Audience: RMBL board, leadership, and select scientists. Voice is
 * INVITATIONAL ("RMBL has a unique opportunity to..."), not directive,
 * because the audience will make their own decisions about whether to
 * act on each theme.
 *
 * Inputs per theme: title + summary + top 4 key_items per constituent
 * cluster, plus theme-level metadata (cluster count, type distribution,
 * frontier reach).
 *
 * Cost: ~$0.20 per theme with Opus 4.7. ~$2.50 total for 12-14 themes.
 *
 * Resume-able: by default skips themes with non-NULL title. Use --force
 * to re-synthesize.
 *
 * Usage:
 *   npx tsx scripts/describe-planning-themes.ts
 *   npx tsx scripts/describe-planning-themes.ts --limit=2 --force
 *   npx tsx scripts/describe-planning-themes.ts --model=claude-sonnet-4-6
 */

import pg from 'pg'
import { callClaudeJson } from './lib/claude-api.js'
import './lib/config.js'

const args = process.argv.slice(2)
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10)
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-opus-4-7'

// Cap on key_items shown per cluster (keep prompt manageable for large themes)
const KEY_ITEMS_PER_CLUSTER = 4

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PRELUDE = `You are helping the Rocky Mountain Biological Laboratory (RMBL) — a long-running mountain-ecosystem field research station in Gothic, Colorado — synthesize cross-lens planning themes for institutional planning.

RMBL has built a "Frontier Planning Corpus" by extracting structured planning items out of 98 synthesized research frontiers. Items come in five lenses: concrete ACTIONS (what to do), key QUESTIONS (what to answer), DATA GAPS (what records are missing), BARRIERS (what's blocking progress), and IMPACTS (what management decisions depend on the work). Each lens was clustered independently. A second-order clustering then grouped those clusters into THEMES — sets of clusters whose summaries describe the same substantive area from different angles.

You'll receive ONE theme: its constituent clusters and metadata. Your job is to produce a planning-conversation-ready synthesis that names the substantive area, frames why RMBL is distinctively positioned to act in it, and gives concrete planning anchors. The audience is the RMBL board, leadership, and select scientists deliberating about strategic priorities. They want clarity AND agency — they will make their own decisions about whether to act.

Voice and constraints:
- INVITATIONAL, NOT DIRECTIVE. Use "RMBL has a unique opportunity to..." or "RMBL is positioned to..." or "RMBL could anchor...". Do NOT use "RMBL should..." or "RMBL must..." — preserve the audience's agency to decide.
- HONEST about tradeoffs. Each theme has tensions: what would this trade off against, where might RMBL's contribution be limited, what would require partnership rather than RMBL alone? Name these candidly in "considerations".
- GROUNDED. Do not invent constituent material — work only from the clusters provided.
- NEUTRAL on operational specifics. Do not propose funding amounts, hiring numbers, project timelines, or institutional structures. Strategic framing only.
- LENS-AWARE. Note the cross-lens distribution honestly. A theme dominated by impacts (e.g., 15 impact clusters + 2 actions + 2 questions) is a stakeholder-decision lens — different planning posture than a balanced theme.

Return JSON with these fields:

  "title": 6-12 words. A noun phrase naming the substantive area as a planning category. Examples of the right shape: "Cross-jurisdictional coordination for basin-scale water governance science," "Mountain observatory networks and coupled climate-ecology modeling," "Mechanistic ecology of plant-pollinator-microbe interactions under change." Avoid filler like "research program," "capacity," "framework" appended on top.

  "opportunity": ONE sentence starting with "RMBL has a unique opportunity to..." (or a close variant: "RMBL is positioned to...", "RMBL could anchor...", "RMBL is well placed to..."). Name the distinctive thing RMBL is suited to do in this area — what is it about RMBL specifically (long-term field presence in mountain ecosystems, sustained partnerships, scientific breadth, basin-scale focus) that makes this an opportunity rather than just generic research demand?

  "summary": 3-5 sentences of flowing prose. (a) What this substantive area is in concrete terms. (b) How it shows up across the lenses — which kinds of evidence converge here and what that convergence means as a planning signal. (c) What pushing forward in this area would actually look like — the shape of the work, not specific projects.

  "planning_anchors": JSON array of 5-8 concrete items synthesized across the constituent clusters. Each anchor should:
    - Be specific enough that the board can evaluate it
    - Be broad enough to subsume multiple cluster items
    - Mix action, data, and research-program framing as the theme contains
    - Avoid duplicating the title or each other

  "considerations": ONE paragraph (3-5 sentences) that honestly names tradeoffs and limits. Useful framings:
    - What this would trade off against (other strategic priorities, existing capacity)
    - Where partnerships are essential (RMBL alone cannot)
    - What RMBL might NOT be best positioned to do within this area
    - Where the underlying corpus is itself uncertain or contested
    - Where the theme is heavy in one lens — e.g., mostly impacts (stakeholder pull) versus mostly actions (RMBL push) — and what that means

End of constraints.`

// ---------------------------------------------------------------------------
// Theme content assembly
// ---------------------------------------------------------------------------

function formatDistribution(dist: Record<string, number>): string {
  return Object.entries(dist || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')
}

interface ClusterContent {
  item_type: string
  title: string
  summary: string
  key_items: string[]
  item_count: number
  frontier_count: number
}

function buildContent(theme: {
  cluster_count: number
  item_count: number
  frontier_count: number
  type_distribution: Record<string, number>
  clusters: ClusterContent[]
}): string {
  const lines: string[] = []
  lines.push('THEME METADATA')
  lines.push(`  Constituent clusters: ${theme.cluster_count}`)
  lines.push(`  Total atomic items in this theme: ${theme.item_count}`)
  lines.push(`  Distinct frontiers contributing: ${theme.frontier_count}`)
  lines.push(`  Cluster distribution by lens: ${formatDistribution(theme.type_distribution)}`)
  lines.push('')
  lines.push('CONSTITUENT CLUSTERS (each with its title, summary, and top distilled items)')
  lines.push('')
  // Order clusters by item type then size so reader sees lens grouping
  const sorted = [...theme.clusters].sort((a, b) => {
    if (a.item_type !== b.item_type) return a.item_type.localeCompare(b.item_type)
    return b.item_count - a.item_count
  })
  let idx = 0
  for (const c of sorted) {
    idx++
    lines.push(`${idx}. [${c.item_type}] ${c.title}`)
    lines.push(`   (${c.item_count} items across ${c.frontier_count} frontiers)`)
    lines.push(`   ${c.summary}`)
    lines.push('')
    lines.push('   Top distilled items:')
    for (const item of c.key_items.slice(0, KEY_ITEMS_PER_CLUSTER)) {
      lines.push(`     • ${item}`)
    }
    lines.push('')
  }
  lines.push(`Return JSON with fields: title, opportunity, summary, planning_anchors (array), considerations.`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Describe cross-lens planning themes')
  console.log('===================================')
  console.log(`  model=${model}${limit ? `  limit=${limit}` : ''}${force ? '  (--force)' : ''}${dryRun ? '  (DRY RUN)' : ''}`)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing from .env')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const where = force ? '' : 'WHERE title IS NULL'
  const limitSql = limit > 0 ? `LIMIT ${limit}` : ''
  const { rows: themes } = await db.query(`
    SELECT id, cluster_count, item_count, frontier_count, type_distribution
    FROM frontier_planning_themes ${where}
    ORDER BY leverage_score DESC ${limitSql}
  `)
  console.log(`\n  ${themes.length} themes to describe`)
  if (themes.length === 0) { await db.end(); return }

  let totalCost = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < themes.length; i++) {
    const t = themes[i]
    process.stdout.write(`\n[${i + 1}/${themes.length}] theme ${t.id} (${t.cluster_count} clusters, ${t.item_count} items)... `)

    // Load constituent clusters with their LLM-generated content
    const { rows: clusterRows } = await db.query(`
      SELECT item_type, title, summary, key_items::text AS key_items_str,
             item_count, frontier_count
      FROM frontier_planning_clusters
      WHERE theme_id = $1 AND title IS NOT NULL
      ORDER BY item_count DESC`, [t.id])
    const clusters: ClusterContent[] = clusterRows.map((r: any) => ({
      item_type: r.item_type,
      title: r.title,
      summary: r.summary,
      key_items: typeof r.key_items_str === 'string' ? JSON.parse(r.key_items_str) : (r.key_items || []),
      item_count: r.item_count,
      frontier_count: r.frontier_count,
    }))

    const content = buildContent({
      cluster_count: t.cluster_count,
      item_count: t.item_count,
      frontier_count: t.frontier_count,
      type_distribution: t.type_distribution || {},
      clusters,
    })

    if (dryRun) {
      console.log('(dry run)')
      if (i === 0) {
        console.log('\n=== sample assembled prompt (first theme) ===')
        console.log(SYSTEM_PRELUDE.slice(0, 500) + '...[truncated]')
        console.log('\n=== sample content (first 1500 chars) ===')
        console.log(content.slice(0, 1500))
      }
      continue
    }

    try {
      const { data, response } = await callClaudeJson<{
        title: string; opportunity: string; summary: string;
        planning_anchors: string[]; considerations: string
      }>({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model,
        prompt: SYSTEM_PRELUDE,
        content,
        maxTokens: 3000,
      })
      totalCost += response.cost
      if (!data || !data.title || !data.summary || !data.opportunity || !Array.isArray(data.planning_anchors) || !data.considerations) {
        console.log(`FAILED (missing fields)`)
        failed++
        continue
      }
      const anchors = data.planning_anchors
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, 10)
      await db.query(
        `UPDATE frontier_planning_themes
         SET title = $1, opportunity = $2, summary = $3, planning_anchors = $4::jsonb, considerations = $5
         WHERE id = $6`,
        [
          data.title.trim(),
          data.opportunity.trim(),
          data.summary.trim(),
          JSON.stringify(anchors),
          data.considerations.trim(),
          t.id,
        ],
      )
      succeeded++
      process.stdout.write(`OK ($${response.cost.toFixed(4)}, ${anchors.length} anchors)  "${data.title.slice(0, 72)}${data.title.length > 72 ? '…' : ''}"`)
    } catch (err: any) {
      console.log(`FAILED: ${err.message?.slice(0, 100)}`)
      failed++
    }
  }

  console.log(`\n\nDone: ${succeeded} described, ${failed} failed, total cost $${totalCost.toFixed(2)}`)
  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
