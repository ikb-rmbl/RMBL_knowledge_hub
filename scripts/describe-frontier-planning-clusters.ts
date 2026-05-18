/**
 * Use Claude to generate a title + summary for each frontier-planning cluster.
 *
 * Each cluster is one of three item-types (action / question / data_gap),
 * clustered independently by Louvain over voyage-4 embeddings. The describe
 * step gives each cluster a planning-oriented title (kind of capacity,
 * research program, or data capability) and a descriptive summary that
 * includes how supporting/answering/closing the cluster contributes to
 * pushing its source frontiers forward.
 *
 * Defaults to Opus 4.7 (richer output matters downstream for planning
 * synthesis). Roughly $15-25 total for the ~60 substantial clusters at
 * min-items=15. Switch with --model=claude-sonnet-4-6 for ~5x cheaper.
 *
 * Resume-able: by default skips clusters that already have a non-NULL title.
 *
 * Usage:
 *   npx tsx scripts/describe-frontier-planning-clusters.ts
 *   npx tsx scripts/describe-frontier-planning-clusters.ts --item-type=action --min-items=15
 *   npx tsx scripts/describe-frontier-planning-clusters.ts --limit=3 --force      # smoke test
 *   npx tsx scripts/describe-frontier-planning-clusters.ts --model=claude-sonnet-4-6
 */

import pg from 'pg'
import { callClaudeJson } from './lib/claude-api.js'
import './lib/config.js'

const args = process.argv.slice(2)
const itemTypeArg = args.find((a) => a.startsWith('--item-type='))?.split('=')[1] || ''
const minItems = parseInt(args.find((a) => a.startsWith('--min-items='))?.split('=')[1] || '15', 10)
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10)
const force = args.includes('--force')
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-opus-4-7'
const dryRun = args.includes('--dry-run')

// Max items sent to the model per cluster. Stratified-sampled when over.
const SAMPLE_CAP = 30
// Max contributing-frontier titles to list in the metadata.
const TOP_FRONTIERS = 8

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const SYSTEM_PRELUDE = `You are helping the Rocky Mountain Biological Laboratory (RMBL) understand the planning structure embedded in its synthesized research frontiers. A "frontier" is an LLM-synthesized boundary between what scientists know and what they don't, with identifiable paths forward. Each frontier exposes five kinds of planning items: concrete ACTIONS (what to do), key QUESTIONS (what to answer), DATA GAPS (what data is needed), BARRIERS (what's blocking progress), and IMPACTS (what management decisions or stakeholders depend on the work).

An upstream clustering step has grouped semantically similar items of one type together. Your job is to read one cluster and produce a planning-oriented synthesis.

Return JSON with three fields:

  "title": A single representative item that best captures the highest-level synthesis of the cluster. Use the same syntactic form as the source items themselves:
    - For ACTION clusters: an imperative sentence ("Establish ...", "Build ...", "Convene ...")
    - For QUESTION clusters: an interrogative sentence ("How does ...", "What ...", "Can ...")
    - For DATA_GAP clusters: a noun phrase describing the data need ("Long-term ... records," "Site-resolved ... measurements")
    - For BARRIER clusters: a noun phrase or short descriptive statement naming the obstacle ("Jurisdictional fragmentation across ...", "Scale mismatch between ... and ...", "Lack of standardized protocols for ...")
    - For IMPACT clusters: a noun phrase naming the management decision, regulatory process, or stakeholder use ("Bureau of Reclamation operations and instream-flow filings," "BLM Resource Management Plan revisions")
  Stay close to the language of the source items. Do NOT add framing words like "research program," "capacity," "infrastructure," or "capability" on top — those should not appear in the title. Aim for 10-20 words.

  "summary": 4-6 sentences in this structure (flowing prose, no bullets):
    (a) The common theme across the items.
    (b) Meaningful variation in scale, domain, or approach.
    (c) How resolving the cluster connects to the related research frontiers — name 2-4 of the most important frontier connections explicitly (use the frontier titles you can see in the metadata). Use the verb that matches the item type: "Supporting these actions would advance ...", "Answering these questions would advance ...", "Closing these gaps would underwrite ...", "Removing these barriers would unlock ...", "Advancing the underlying frontiers would inform ...".

  "key_items": A JSON array of 5-10 synthesized items that reflect the most important ideas in the cluster. Each item should:
    - Be in the same syntactic form as the title (matching the rules above by item type).
    - Capture a distinct dimension of the cluster (don't restate the title or repeat each other).
    - Be a synthesis across multiple source items — neither a verbatim quote nor an abstract generalization.
    - Be specific enough to be useful; broad enough to subsume multiple source items.
    - Stay grounded in the source material.

Constraints:
  - Stay grounded in the items provided; do not infer beyond them.
  - Do not reference RMBL by name (the report's framing supplies that).
  - Do not propose new investments or recommendations — stay descriptive. A separate synthesis step will draw planning conclusions.`

const FEW_SHOT_EXAMPLE = `EXAMPLE INPUT

CLUSTER METADATA
  Item type: action
  Item count: 42  (across 28 distinct frontiers)
  Effort distribution: ambitious=22, near-term=12, major=7, consortium=1
  Category distribution: infrastructure=18, data=15, collaboration=9
  Top contributing frontiers:
    - Continental-Scale Pollinator Population Dynamics
    - Soil Microbiome Response to Warming
    - Phenological Mismatch in Subalpine Plants
    - Drought Resilience in Headwater Streams

ITEMS (showing 12 of 42)
  - [ambitious] Establish a regional automated weather and snow telemetry network spanning rain-snow transition  [from: Continental-Scale Pollinator Population Dynamics]
  - [near-term] Deploy soil moisture and temperature sensor arrays at established long-term plots  [from: Soil Microbiome Response to Warming]
  - [major] Build a distributed phenocam network coordinated with neighboring research stations  [from: Phenological Mismatch in Subalpine Plants]
  - ... 9 more

EXAMPLE OUTPUT

{
  "title": "Deploy coordinated distributed environmental sensor networks across the basin",
  "summary": "These actions converge on building physical sensor networks that produce co-registered, long-term environmental data at scales larger than any one study can support. The cluster ranges from modest sensor arrays at existing plots (near-term) through phenocam and soil-array networks (ambitious) to fully distributed multi-station telemetry (major) — the binding signal is the move from site-specific instrumentation toward coordinated networks. Supporting this work would directly enable the snowmelt-timing analyses needed in Continental-Scale Pollinator Population Dynamics, the warming-response measurements in Soil Microbiome Response to Warming, the cross-site phenological observations underlying Phenological Mismatch in Subalpine Plants, and the streamflow attribution work in Drought Resilience in Headwater Streams. The common thread is shared sensing capacity that no single project would deploy on its own.",
  "key_items": [
    "Deploy automated weather and snow telemetry across rain-snow transition zones",
    "Instrument long-term ecological plots with co-located soil moisture and temperature sensors",
    "Build a distributed phenocam network coordinated with neighboring research stations",
    "Establish a basin-wide streamflow and stage-monitoring backbone with telemetry backhaul",
    "Adopt shared sensor placement standards and data schemas to enable cross-site synthesis",
    "Maintain sustained operational and data-curation capacity for multi-decade sensor networks",
    "Add eddy-covariance flux towers and under-ice biogeochemistry probes to round out the observational backbone"
  ]
}

---`

// ---------------------------------------------------------------------------
// Stratified sampling for actions, random for other types
// ---------------------------------------------------------------------------

interface Item {
  id: number
  text: string
  effort: string | null
  category: string | null
  frontier_title: string
}

function sampleStratifiedByEffort(items: Item[], cap: number): Item[] {
  if (items.length <= cap) return items.slice()
  // Group by effort
  const buckets = new Map<string, Item[]>()
  for (const it of items) {
    const key = it.effort || 'unknown'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(it)
  }
  // Allocate per bucket proportionally, min 2 per bucket if it has any items
  const out: Item[] = []
  const total = items.length
  const allocations: { key: string; n: number }[] = []
  for (const [key, bucketItems] of buckets) {
    const proportional = Math.round(cap * bucketItems.length / total)
    const n = Math.max(2, Math.min(proportional, bucketItems.length))
    allocations.push({ key, n })
  }
  // Normalize if we over-allocated
  const allocTotal = allocations.reduce((s, a) => s + a.n, 0)
  if (allocTotal > cap) {
    const factor = cap / allocTotal
    for (const a of allocations) a.n = Math.max(1, Math.floor(a.n * factor))
  }
  // Draw randomly from each bucket
  for (const { key, n } of allocations) {
    const bucketItems = buckets.get(key)!
    const shuffled = [...bucketItems].sort(() => Math.random() - 0.5)
    out.push(...shuffled.slice(0, n))
  }
  return out
}

function sampleRandom(items: Item[], cap: number): Item[] {
  if (items.length <= cap) return items.slice()
  return [...items].sort(() => Math.random() - 0.5).slice(0, cap)
}

// ---------------------------------------------------------------------------
// Per-cluster prompt assembly
// ---------------------------------------------------------------------------

function formatItem(it: Item, itemType: string): string {
  const effortTag = itemType === 'action' && it.effort ? `[${it.effort}] ` : ''
  return `  - ${effortTag}${it.text}  [from: ${it.frontier_title}]`
}

function formatDistribution(dist: Record<string, number>): string {
  return Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')
}

function buildPrompt(args: {
  itemType: string
  itemCount: number
  frontierCount: number
  effortDist: Record<string, number>
  categoryDist: Record<string, number>
  topFrontiers: string[]
  items: Item[]
  totalItems: number
}): string {
  const lines: string[] = []
  lines.push('CLUSTER METADATA')
  lines.push(`  Item type: ${args.itemType}`)
  lines.push(`  Item count: ${args.itemCount}  (across ${args.frontierCount} distinct frontiers)`)
  if (args.itemType === 'action') {
    lines.push(`  Effort distribution: ${formatDistribution(args.effortDist) || '(none)'}`)
    lines.push(`  Category distribution: ${formatDistribution(args.categoryDist) || '(none)'}`)
  }
  lines.push(`  Top contributing frontiers:`)
  for (const t of args.topFrontiers) lines.push(`    - ${t}`)
  lines.push('')
  const headerSuffix = args.items.length < args.totalItems
    ? ` (showing ${args.items.length} of ${args.totalItems})`
    : ''
  lines.push(`ITEMS${headerSuffix}`)
  for (const it of args.items) lines.push(formatItem(it, args.itemType))
  lines.push('')
  lines.push('Return JSON with {"title": "...", "summary": "..."}.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Describe frontier planning clusters')
  console.log('===================================')
  console.log(`  model=${model}  min-items=${minItems}${itemTypeArg ? `  item-type=${itemTypeArg}` : ''}${limit ? `  limit=${limit}` : ''}${force ? '  (--force)' : ''}${dryRun ? '  (DRY RUN)' : ''}`)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing from .env')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Choose clusters to describe
  const whereParts: string[] = [`item_count >= ${minItems}`]
  if (itemTypeArg) whereParts.push(`item_type = '${itemTypeArg.replace(/'/g, "''")}'`)
  if (!force) whereParts.push(`title IS NULL`)
  const whereSql = `WHERE ${whereParts.join(' AND ')}`
  const limitSql = limit > 0 ? `LIMIT ${limit}` : ''

  const { rows: clusters } = await db.query(
    `SELECT id, item_type, item_count, frontier_count, type_distribution,
            category_distribution, effort_distribution
     FROM frontier_planning_clusters
     ${whereSql}
     ORDER BY item_count DESC
     ${limitSql}`,
  )

  console.log(`\n  ${clusters.length} clusters to describe`)
  if (clusters.length === 0) { await db.end(); return }

  let totalCost = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]
    process.stdout.write(`\n[${i + 1}/${clusters.length}] cluster ${c.id} (${c.item_type}, ${c.item_count} items)... `)

    // Load items + parent frontier title
    const { rows: itemRows } = await db.query(
      `SELECT i.id, i.text, i.effort, i.category, f.title AS frontier_title
       FROM frontier_planning_items i
       JOIN frontiers f ON f.id = i.frontier_id
       WHERE i.cluster_id = $1
       ORDER BY i.id`,
      [c.id],
    )
    const items: Item[] = itemRows.map((r: any) => ({
      id: r.id, text: r.text, effort: r.effort, category: r.category, frontier_title: r.frontier_title,
    }))

    // Top contributing frontiers by item-count within this cluster
    const frontierCounts = new Map<string, number>()
    for (const it of items) frontierCounts.set(it.frontier_title, (frontierCounts.get(it.frontier_title) || 0) + 1)
    const topFrontiers = [...frontierCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_FRONTIERS)
      .map(([t]) => t)

    // Sample
    const sampled = c.item_type === 'action'
      ? sampleStratifiedByEffort(items, SAMPLE_CAP)
      : sampleRandom(items, SAMPLE_CAP)

    // Build prompt
    const userContent = buildPrompt({
      itemType: c.item_type,
      itemCount: c.item_count,
      frontierCount: c.frontier_count,
      effortDist: c.effort_distribution || {},
      categoryDist: c.category_distribution || {},
      topFrontiers,
      items: sampled,
      totalItems: items.length,
    })

    const fullPrompt = `${SYSTEM_PRELUDE}\n\n${FEW_SHOT_EXAMPLE}\n\nNOW DO THE SAME FOR THIS CLUSTER:`

    if (dryRun) {
      console.log('(dry run — prompt assembled, skipping API call)')
      if (i === 0) {
        console.log('\n=== sample assembled prompt (first cluster) ===')
        console.log(fullPrompt.slice(0, 500) + '...[truncated]')
        console.log('\n=== sample content ===')
        console.log(userContent)
      }
      continue
    }

    try {
      const { data, response } = await callClaudeJson<{ title: string; summary: string; key_items: string[] }>({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model,
        prompt: fullPrompt,
        content: userContent,
        maxTokens: 2000,
      })
      totalCost += response.cost
      if (!data || !data.title || !data.summary || !Array.isArray(data.key_items)) {
        console.log(`FAILED (missing title/summary/key_items)`)
        failed++
        continue
      }
      // Defensive: drop empties, cap at 10
      const keyItems = data.key_items
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, 10)
      await db.query(
        `UPDATE frontier_planning_clusters SET title = $1, summary = $2, key_items = $3::jsonb WHERE id = $4`,
        [data.title.trim(), data.summary.trim(), JSON.stringify(keyItems), c.id],
      )
      succeeded++
      process.stdout.write(`OK ($${response.cost.toFixed(4)}, ${keyItems.length} items)  "${data.title.slice(0, 72)}${data.title.length > 72 ? '…' : ''}"`)
    } catch (err: any) {
      console.log(`FAILED: ${err.message?.slice(0, 100)}`)
      failed++
    }
  }

  console.log(`\n\nDone: ${succeeded} described, ${failed} failed, total cost $${totalCost.toFixed(2)}`)
  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
