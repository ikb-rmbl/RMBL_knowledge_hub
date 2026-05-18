/**
 * Second-order Louvain clustering: group the 130 described planning
 * clusters into ~10-20 cross-lens THEMES. A theme is a set of clusters —
 * potentially from different item types (action, barrier, data_gap,
 * question, impact) — whose LLM-synthesized descriptions point at the
 * same substantive area.
 *
 * Pipeline per run:
 *   1. Load every described cluster's title + summary.
 *   2. Embed (title || summary) with voyage-4. Description-text rather
 *      than item-centroid because it captures the LLM's cross-lens
 *      synthesis and avoids the syntactic-shape bias that made item
 *      types self-segregate.
 *   3. Build undirected cosine-similarity graph (edge if sim >= τ),
 *      edge weight = excess over threshold.
 *   4. Louvain → community per cluster.
 *   5. Write theme rows; update clusters.theme_id; aggregate
 *      type_distribution, item_count, frontier_count, leverage_score.
 *
 * Theme IDs are non-deterministic across reruns. Re-running TRUNCATEs
 * frontier_planning_themes and nulls clusters.theme_id before
 * re-assigning. Theme descriptions (title/summary/etc.) come from
 * describe-planning-themes.ts.
 *
 * Usage:
 *   npx tsx scripts/cluster-planning-themes.ts
 *   npx tsx scripts/cluster-planning-themes.ts --threshold=0.55 --resolution=1.0
 *   npx tsx scripts/cluster-planning-themes.ts --dry-run
 */

import pg from 'pg'
import { embedTexts, cosineSimilarity } from './lib/embedding-cluster.js'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const threshold = parseFloat(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || '0.55')
const resolution = parseFloat(args.find((a) => a.startsWith('--resolution='))?.split('=')[1] || '1.0')

interface ClusterRow {
  id: number
  item_type: string
  title: string
  summary: string
  item_count: number
  frontier_count: number
  institutional_score: number
}

async function main() {
  console.log('Cluster planning clusters into cross-lens themes')
  console.log('================================================')
  console.log(`  threshold=${threshold}  resolution=${resolution}${dryRun ? '  (DRY RUN)' : ''}`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // 1. Load described clusters
  console.log('\nLoading described clusters...')
  const { rows: clusters } = await db.query<ClusterRow>(`
    SELECT id, item_type, title, summary, item_count, frontier_count,
           institutional_score::float AS institutional_score
    FROM frontier_planning_clusters
    WHERE title IS NOT NULL AND summary IS NOT NULL
    ORDER BY id
  `)
  console.log(`  ${clusters.length} clusters with descriptions`)
  if (clusters.length === 0) { await db.end(); return }

  // 2. Embed title + summary (description-based, not item-centroid)
  console.log('\nEmbedding cluster descriptions...')
  const texts = clusters.map((c) => `${c.title}\n\n${c.summary}`)
  const vectors = await embedTexts(texts)
  console.log(`  Got ${vectors.length} embeddings`)

  // 3. Build similarity graph
  console.log('\nBuilding similarity graph...')
  const Graph = (await import('graphology')).default
  const graph = new Graph({ type: 'undirected' })
  for (const c of clusters) graph.addNode(String(c.id))

  let edgeCount = 0
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const sim = cosineSimilarity(vectors[i], vectors[j])
      if (sim >= threshold) {
        graph.addEdge(String(clusters[i].id), String(clusters[j].id), { weight: sim - threshold })
        edgeCount++
      }
    }
  }
  console.log(`  ${edgeCount} edges (of ${clusters.length * (clusters.length - 1) / 2} possible pairs)`)

  // 4. Louvain
  console.log('\nRunning Louvain...')
  const louvain = (await import('graphology-communities-louvain')).default
  const communities: Record<string, number> = louvain(graph, { resolution })

  // 5. Aggregate per theme
  type Aggregate = {
    community_id: number
    clusters: ClusterRow[]
    type_dist: Record<string, number>
    item_count: number
    frontier_ids: Set<number>
    sum_inst: number
  }
  const themes = new Map<number, Aggregate>()
  for (const c of clusters) {
    const cid = communities[String(c.id)] ?? -1
    if (cid === -1) continue
    if (!themes.has(cid)) {
      themes.set(cid, {
        community_id: cid, clusters: [], type_dist: {},
        item_count: 0, frontier_ids: new Set<number>(), sum_inst: 0,
      })
    }
    const t = themes.get(cid)!
    t.clusters.push(c)
    t.type_dist[c.item_type] = (t.type_dist[c.item_type] || 0) + 1
    t.item_count += c.item_count
    t.sum_inst += c.institutional_score || 0
  }

  // Add distinct-frontier sets (one query per theme is cheap)
  for (const t of themes.values()) {
    const ids = t.clusters.map((c) => c.id)
    const { rows } = await db.query<{ frontier_id: number }>(
      `SELECT DISTINCT frontier_id FROM frontier_planning_items WHERE cluster_id = ANY($1)`,
      [ids],
    )
    for (const r of rows) t.frontier_ids.add(r.frontier_id)
  }

  const sizes = [...themes.values()].map((t) => t.clusters.length).sort((a, b) => b - a)
  const singletons = sizes.filter((s) => s === 1).length
  console.log(`\n  ${themes.size} themes formed`)
  console.log(`  Theme sizes (clusters): max=${sizes[0] || 0}, median=${sizes[Math.floor(sizes.length / 2)] || 0}, singletons=${singletons}`)
  console.log(`  Top 10 sizes: ${sizes.slice(0, 10).join(', ')}`)

  if (dryRun) {
    console.log('\nDRY RUN — no rows written. Sample top-3 themes:')
    const ordered = [...themes.values()].sort((a, b) => b.clusters.length - a.clusters.length).slice(0, 3)
    for (const t of ordered) {
      console.log(`\n  Theme (${t.clusters.length} clusters, types: ${Object.entries(t.type_dist).map(([k, v]) => `${k}=${v}`).join(', ')})`)
      for (const c of t.clusters) {
        console.log(`    [${c.item_type}] ${c.title.slice(0, 100)}`)
      }
    }
    await db.end()
    return
  }

  // 6. Persist
  console.log('\nWriting themes to DB...')
  await db.query(`TRUNCATE frontier_planning_themes RESTART IDENTITY`)
  await db.query(`UPDATE frontier_planning_clusters SET theme_id = NULL`)

  const ordered = [...themes.values()].sort((a, b) => b.clusters.length - a.clusters.length)
  for (const t of ordered) {
    const leverage = t.sum_inst  // raw aggregate; describe step can re-weight
    const { rows: [{ id: themeId }] } = await db.query(
      `INSERT INTO frontier_planning_themes (
        cluster_count, item_count, frontier_count, type_distribution, leverage_score
      ) VALUES ($1, $2, $3, $4::jsonb, $5)
      RETURNING id`,
      [t.clusters.length, t.item_count, t.frontier_ids.size, JSON.stringify(t.type_dist), leverage],
    )
    for (const c of t.clusters) {
      await db.query(`UPDATE frontier_planning_clusters SET theme_id = $1 WHERE id = $2`, [themeId, c.id])
    }
  }

  // 7. Summary
  console.log('\nTop 10 themes by aggregate leverage:')
  const { rows: top } = await db.query(`
    SELECT id, cluster_count, item_count, frontier_count, round(leverage_score::numeric, 0) AS lev,
           type_distribution
    FROM frontier_planning_themes
    ORDER BY leverage_score DESC LIMIT 10`)
  for (const r of top) {
    const typeStr = Object.entries(r.type_distribution).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')
    console.log(`  [${r.id}] ${r.cluster_count} clusters, ${r.item_count} items, ${r.frontier_count} frontiers, lev=${r.lev}  (${typeStr})`)
  }

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
