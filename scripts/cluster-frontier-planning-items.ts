/**
 * Louvain clustering over frontier planning items, scoped to one item_type
 * per run. Questions and data_gaps self-segregate from actions because of
 * syntactic shape (interrogative vs. noun-phrase vs. imperative), so each
 * type is clustered independently to surface its own thematic structure.
 *
 * Approach:
 *   1. Load items of the chosen type with embeddings.
 *   2. Build an undirected similarity graph: edge (a,b) iff cosine(a,b) ≥ threshold,
 *      with weight = (cosine - threshold) so edges that just barely qualify
 *      contribute less to modularity than tight matches.
 *   3. Run graphology-communities-louvain with the given resolution.
 *   4. Persist cluster_id back to items; insert one row per cluster into
 *      frontier_planning_clusters with type/category/effort distributions
 *      and the two leverage scores. Only that type's clusters are touched.
 *
 * Tactical weights (item-level) reflect what RMBL can realistically fund
 * directly vs. what needs external partnerships:
 *   action+near-term  = 1.0   (single-lab, immediate)
 *   action+ambitious  = 0.7   (focused multi-year program)
 *   action+major      = 0.3   (multi-institutional)
 *   action+consortium = 0.1   (agency-program scale)
 *   data_gap, question = 0.7  (concrete need, no explicit effort tier)
 *
 * Cluster scores:
 *   institutional_score = sum(tactical_weight)     × distinct_frontier_count
 *   partnership_score   = sum(1 - tactical_weight) × distinct_frontier_count
 *
 * For non-action types every item has tactical_weight=0.7, so the score
 * degenerates to 0.7 × item_count × frontier_count — effectively a size×breadth
 * ranking, which is still the right ordering for surfacing planning leverage.
 *
 * Cluster IDs are non-deterministic. Re-running for a given type deletes
 * just that type's clusters and nulls just that type's cluster_id values.
 *
 * Usage:
 *   npx tsx scripts/cluster-frontier-planning-items.ts --item-type=action
 *   npx tsx scripts/cluster-frontier-planning-items.ts --item-type=question --threshold=0.65 --resolution=3
 *   npx tsx scripts/cluster-frontier-planning-items.ts --item-type=data_gap --dry-run
 */

import pg from 'pg'
import { cosineSimilarity } from './lib/embedding-cluster.js'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const threshold = parseFloat(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || '0.68')
const resolution = parseFloat(args.find((a) => a.startsWith('--resolution='))?.split('=')[1] || '3.0')
const itemType = args.find((a) => a.startsWith('--item-type='))?.split('=')[1] || ''
const VALID_TYPES = new Set(['action', 'data_gap', 'question', 'barrier', 'impact'])
if (!VALID_TYPES.has(itemType)) {
  console.error(`--item-type is required and must be one of: ${[...VALID_TYPES].join(', ')}`)
  process.exit(1)
}

interface Item {
  id: number
  frontier_id: number
  item_type: string
  category: string | null
  effort: string | null
  embedding: number[]
}

function tacticalWeight(item: { item_type: string; effort: string | null }): number {
  if (item.item_type !== 'action') return 0.7
  switch (item.effort) {
    case 'near-term':  return 1.0
    case 'ambitious':  return 0.7
    case 'major':      return 0.3
    case 'consortium': return 0.1
    default:           return 0.7  // unrecognized → treat as ambitious-equivalent
  }
}

async function main() {
  console.log('Cluster frontier planning items')
  console.log('===============================')
  console.log(`  item-type=${itemType}  threshold=${threshold}  resolution=${resolution}${dryRun ? '  (DRY RUN)' : ''}`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // 1. Load items + embeddings, filtered to the chosen type
  console.log('\nLoading items + embeddings...')
  const { rows } = await db.query(
    `SELECT id, frontier_id, item_type, category, effort, embedding::text AS embedding_str
     FROM frontier_planning_items
     WHERE embedding IS NOT NULL AND item_type = $1
     ORDER BY id`,
    [itemType],
  )
  const items: Item[] = rows.map((r: any) => ({
    id: r.id,
    frontier_id: r.frontier_id,
    item_type: r.item_type,
    category: r.category,
    effort: r.effort,
    embedding: JSON.parse(r.embedding_str),
  }))
  console.log(`  ${items.length} items`)
  if (items.length === 0) { await db.end(); return }

  // 2. Build similarity graph
  console.log('\nBuilding similarity graph...')
  const Graph = (await import('graphology')).default
  const graph = new Graph({ type: 'undirected' })
  for (const it of items) graph.addNode(String(it.id))

  const t0 = Date.now()
  let edgeCount = 0
  // All-pairs since 2.2K items × 1024 dim ≈ 2.4M pairs — completes in a few seconds.
  // If this corpus grows past ~10K items, switch to HNSW-backed nearest-neighbor.
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]
      const sim = cosineSimilarity(a.embedding, b.embedding)
      if (sim >= threshold) {
        // weight = excess over threshold, so just-qualifying edges contribute less
        graph.addEdge(String(a.id), String(b.id), { weight: sim - threshold })
        edgeCount++
      }
    }
    if ((i + 1) % 200 === 0) process.stdout.write(`\r  Compared ${i + 1}/${items.length} items, ${edgeCount} edges so far`)
  }
  process.stdout.write(`\r  Compared ${items.length}/${items.length} items, ${edgeCount} edges (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`)

  // 3. Run Louvain
  console.log('\nRunning Louvain...')
  const louvain = (await import('graphology-communities-louvain')).default
  const communities: Record<string, number> = louvain(graph, { resolution })

  // Singleton handling: nodes with no edges get assigned to community -1
  // (treat as their own cluster — we'll skip these in the report since they're
  // by definition not "themes")
  const clusterIdByItem = new Map<number, number>()
  for (const it of items) {
    const c = communities[String(it.id)]
    clusterIdByItem.set(it.id, c ?? -1)
  }

  // 4. Compute per-cluster aggregates
  type Aggregate = {
    cluster_id: number
    items: Item[]
    distinct_frontiers: Set<number>
    type_dist: Record<string, number>
    category_dist: Record<string, number>
    effort_dist: Record<string, number>
    sum_tactical: number
  }
  const clusters = new Map<number, Aggregate>()
  for (const it of items) {
    const cid = clusterIdByItem.get(it.id)!
    if (cid === -1) continue
    if (!clusters.has(cid)) {
      clusters.set(cid, {
        cluster_id: cid,
        items: [],
        distinct_frontiers: new Set(),
        type_dist: {},
        category_dist: {},
        effort_dist: {},
        sum_tactical: 0,
      })
    }
    const c = clusters.get(cid)!
    c.items.push(it)
    c.distinct_frontiers.add(it.frontier_id)
    c.type_dist[it.item_type] = (c.type_dist[it.item_type] || 0) + 1
    if (it.category) c.category_dist[it.category] = (c.category_dist[it.category] || 0) + 1
    if (it.effort) c.effort_dist[it.effort] = (c.effort_dist[it.effort] || 0) + 1
    c.sum_tactical += tacticalWeight(it)
  }

  // Stats summary
  const sizes = [...clusters.values()].map((c) => c.items.length).sort((a, b) => b - a)
  const singletons = items.filter((it) => clusterIdByItem.get(it.id) === -1).length
  console.log(`\n  ${clusters.size} clusters formed`)
  console.log(`  Sizes: max=${sizes[0] || 0}, median=${sizes[Math.floor(sizes.length / 2)] || 0}, min=${sizes[sizes.length - 1] || 0}`)
  console.log(`  Top 10 sizes: ${sizes.slice(0, 10).join(', ')}`)
  console.log(`  Singletons (no edges): ${singletons}`)

  if (dryRun) {
    console.log('\nDRY RUN — no rows written')
    await db.end()
    return
  }

  // 5. Persist (only this type's clusters are touched)
  console.log('\nWriting clusters to DB...')
  await db.query(`DELETE FROM frontier_planning_clusters WHERE item_type = $1`, [itemType])
  await db.query(`UPDATE frontier_planning_items SET cluster_id = NULL WHERE item_type = $1`, [itemType])

  // Insert clusters ordered by item count desc (gives stable smaller IDs to bigger clusters)
  const ordered = [...clusters.values()].sort((a, b) => b.items.length - a.items.length)
  const oldToNewId = new Map<number, number>()

  for (const c of ordered) {
    const institutional = c.sum_tactical * c.distinct_frontiers.size
    const partnership = (c.items.length - c.sum_tactical) * c.distinct_frontiers.size  // (1 - w) summed = N - sum(w)
    const { rows: [{ id: newId }] } = await db.query(
      `INSERT INTO frontier_planning_clusters (
        item_type, item_count, frontier_count, type_distribution, category_distribution, effort_distribution,
        institutional_score, partnership_score
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
      RETURNING id`,
      [
        itemType,
        c.items.length,
        c.distinct_frontiers.size,
        JSON.stringify(c.type_dist),
        JSON.stringify(c.category_dist),
        JSON.stringify(c.effort_dist),
        institutional,
        partnership,
      ],
    )
    oldToNewId.set(c.cluster_id, newId)
  }

  // Assign cluster_id back to items
  console.log('Assigning cluster_id to items...')
  let assigned = 0
  for (const it of items) {
    const oldId = clusterIdByItem.get(it.id)!
    if (oldId === -1) continue
    const newId = oldToNewId.get(oldId)!
    await db.query('UPDATE frontier_planning_items SET cluster_id = $1 WHERE id = $2', [newId, it.id])
    assigned++
    if (assigned % 200 === 0) process.stdout.write(`\r  Assigned ${assigned}`)
  }
  process.stdout.write(`\r  Assigned ${assigned}\n`)

  // Summary of top clusters by each score (within this item_type only)
  console.log('\nTop 5 by institutional score:')
  const { rows: byInst } = await db.query(
    `SELECT id, item_count, frontier_count,
            round(institutional_score::numeric, 1) AS inst,
            round(partnership_score::numeric, 1) AS partner
     FROM frontier_planning_clusters WHERE item_type = $1
     ORDER BY institutional_score DESC LIMIT 5`,
    [itemType],
  )
  for (const r of byInst) console.log(`  [${r.id}] items=${r.item_count}  frontiers=${r.frontier_count}  inst=${r.inst}  partner=${r.partner}`)

  if (itemType === 'action') {
    console.log('\nTop 5 by partnership score:')
    const { rows: byPart } = await db.query(
      `SELECT id, item_count, frontier_count,
              round(institutional_score::numeric, 1) AS inst,
              round(partnership_score::numeric, 1) AS partner
       FROM frontier_planning_clusters WHERE item_type = $1
       ORDER BY partnership_score DESC LIMIT 5`,
      [itemType],
    )
    for (const r of byPart) console.log(`  [${r.id}] items=${r.item_count}  frontiers=${r.frontier_count}  inst=${r.inst}  partner=${r.partner}`)
  }

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
