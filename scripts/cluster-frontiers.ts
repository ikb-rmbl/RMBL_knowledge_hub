/**
 * Stage 2 of the "frontiers" pipeline.
 *
 * Embeds the 581 atomic frontier statements with voyage-4 and clusters
 * them by cosine similarity using the existing greedy centroid approach.
 * Each cluster becomes a candidate frontier entity (cross-cutting
 * theme). Output goes to scripts/output/frontiers-clustered.json for
 * inspection before we commit to a DB schema or LLM synthesis.
 *
 * Priority score combines breadth (distinct neighborhoods spanned),
 * leverage (avg management relevance), and tractability (linked
 * protocols + datasets).
 *
 * Usage:
 *   npx tsx scripts/cluster-frontiers.ts
 *   npx tsx scripts/cluster-frontiers.ts --threshold=0.78
 *   npx tsx scripts/cluster-frontiers.ts --min-cluster=2
 */

import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'
import { embedTexts, clusterCandidates } from './lib/embedding-cluster.js'

const args = process.argv.slice(2)
// 0.74 was chosen via inspect-frontier-clusters.ts threshold sweep — it
// captures the most cross-cutting clusters (26 spanning ≥3 neighborhoods)
// without over-merging unrelated themes. See script header for details.
const threshold = parseFloat(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || '0.74')
const minCluster = parseInt(args.find((a) => a.startsWith('--min-cluster='))?.split('=')[1] || '1')
const inputPath = args.find((a) => a.startsWith('--input='))?.split('=')[1] || 'scripts/output/frontiers-extracted.json'
const outputPath = args.find((a) => a.startsWith('--output='))?.split('=')[1] || 'scripts/output/frontiers-clustered.json'

interface AtomicStatement {
  id: number                                // sequential, 0..580
  neighborhood_id: number
  neighborhood_title: string
  statement: string
  concepts: string[]
  protocols: string[]
  datasets_needed: string[]
  management_relevance: number
  source_section: string
}

interface CandidateWithEmbedding extends AtomicStatement {
  embedding: number[]
}

interface ClusterSummary {
  cluster_id: number
  size: number
  cross_cutting_score: number       // distinct neighborhoods / size, normalized 0-1
  avg_management_relevance: number
  priority_score: number             // composite, sorted-by metric
  neighborhoods: { id: number; title: string; statement_count: number }[]
  representative_statements: string[]   // top 3 closest to centroid
  union_concepts: { tag: string; count: number }[]   // top 10
  union_protocols: { tag: string; count: number }[]  // top 10
  union_datasets: { tag: string; count: number }[]   // top 10
  mgmt_distribution: number[]        // [n0, n1, n2, n3]
  member_statement_ids: number[]
}

async function main() {
  console.log('Cluster frontier statements')
  console.log('===========================')

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'))
  const statements: AtomicStatement[] = []
  for (const n of data.neighborhoods) {
    for (const s of (n.statements || [])) {
      statements.push({
        id: statements.length,
        neighborhood_id: n.neighborhood_id,
        neighborhood_title: n.title,
        statement: s.statement,
        concepts: s.concepts || [],
        protocols: s.protocols || [],
        datasets_needed: s.datasets_needed || [],
        management_relevance: s.management_relevance || 0,
        source_section: s.source_section || 'unknown',
      })
    }
  }
  console.log(`Loaded ${statements.length} statements from ${data.neighborhoods.length} neighborhoods`)
  console.log(`Threshold: ${threshold}  Min cluster size: ${minCluster}`)

  // Build embedding text: statement + key concepts give the strongest semantic signal.
  // We deliberately omit protocols/datasets which are method/data noun phrases that
  // could confound the theme-level clustering.
  const texts = statements.map((s) =>
    `${s.statement}\n\nKey concepts: ${s.concepts.join(', ')}`,
  )

  // Cache embeddings to avoid re-paying voyage-4 on threshold sweeps.
  const cachePath = 'scripts/output/frontiers-embeddings.json'
  let embeddings: number[][]
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    if (cached.length === texts.length) {
      embeddings = cached
      console.log(`\nUsing cached embeddings from ${cachePath}`)
    } else {
      throw new Error(`cache size ${cached.length} ≠ texts ${texts.length}`)
    }
  } catch {
    console.log(`\nEmbedding ${texts.length} statements via voyage-4...`)
    embeddings = await embedTexts(texts)
    writeFileSync(cachePath, JSON.stringify(embeddings))
    console.log(`  Cached to ${cachePath}`)
  }
  console.log(`  ${embeddings.length} embeddings of ${embeddings[0]?.length} dims`)

  const candidates: CandidateWithEmbedding[] = statements.map((s, i) => ({
    ...s,
    embedding: embeddings[i],
  }))

  console.log(`\nClustering...`)
  const clusters = clusterCandidates(candidates, threshold)
  console.log(`  Produced ${clusters.length} clusters`)

  // Aggregate per cluster
  const summaries: ClusterSummary[] = clusters.map((c, idx) => {
    const distinctNbrs = new Map<number, { title: string; count: number }>()
    const concepts = new Map<string, number>()
    const protocols = new Map<string, number>()
    const datasets = new Map<string, number>()
    const mgmtDist = [0, 0, 0, 0]
    let totalMgmt = 0
    for (const m of c.members) {
      const cur = distinctNbrs.get(m.neighborhood_id) || { title: m.neighborhood_title, count: 0 }
      cur.count++
      distinctNbrs.set(m.neighborhood_id, cur)
      for (const t of m.concepts) concepts.set(t.toLowerCase(), (concepts.get(t.toLowerCase()) || 0) + 1)
      for (const t of m.protocols) protocols.set(t.toLowerCase(), (protocols.get(t.toLowerCase()) || 0) + 1)
      for (const t of m.datasets_needed) datasets.set(t.toLowerCase(), (datasets.get(t.toLowerCase()) || 0) + 1)
      mgmtDist[Math.min(3, Math.max(0, m.management_relevance | 0))]++
      totalMgmt += m.management_relevance || 0
    }

    // Representative statements: top 3 closest to centroid
    const centroidSim = c.members.map((m) => {
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < m.embedding.length; i++) {
        dot += m.embedding[i] * c.centroid[i]
        na += m.embedding[i] * m.embedding[i]
        nb += c.centroid[i] * c.centroid[i]
      }
      return { stmt: m.statement, sim: dot / (Math.sqrt(na) * Math.sqrt(nb)) }
    }).sort((a, b) => b.sim - a.sim).slice(0, 3).map((r) => r.stmt)

    const size = c.members.length
    const nNbrs = distinctNbrs.size
    const avgMgmt = totalMgmt / size
    // Cross-cutting score: ratio of distinct neighborhoods to members. 1.0 = every
    // member is from a different neighborhood; lower = many members from one nbr.
    const crossCutting = nNbrs / size
    // Tractability: # of distinct protocols + datasets (capped log scale)
    const tractability = Math.log(1 + protocols.size + datasets.size)
    // Composite priority: breadth (log of distinct nbrs) × leverage × tractability
    const priority = Math.log(1 + nNbrs) * (1 + avgMgmt) * tractability

    return {
      cluster_id: idx,
      size,
      cross_cutting_score: Number(crossCutting.toFixed(3)),
      avg_management_relevance: Number(avgMgmt.toFixed(2)),
      priority_score: Number(priority.toFixed(2)),
      neighborhoods: [...distinctNbrs.entries()]
        .map(([id, { title, count }]) => ({ id, title, statement_count: count }))
        .sort((a, b) => b.statement_count - a.statement_count),
      representative_statements: centroidSim,
      union_concepts: [...concepts.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
      union_protocols: [...protocols.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
      union_datasets: [...datasets.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
      mgmt_distribution: mgmtDist,
      member_statement_ids: c.members.map((m) => m.id),
    }
  })

  // Sort clusters by priority score, descending
  summaries.sort((a, b) => b.priority_score - a.priority_score)
  // Re-id sequentially in priority order
  summaries.forEach((s, i) => { s.cluster_id = i })

  // Filter singletons if requested
  const filtered = summaries.filter((s) => s.size >= minCluster)

  // Summary stats
  console.log()
  console.log(`Cluster size distribution:`)
  const sizeHist = new Map<number, number>()
  for (const s of summaries) sizeHist.set(s.size, (sizeHist.get(s.size) || 0) + 1)
  for (const [size, count] of [...sizeHist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  size ${size}: ${count} clusters`)
  }
  console.log()
  console.log(`Cross-cutting clusters (spanning ≥3 neighborhoods):`)
  const xcuts = filtered.filter((s) => s.neighborhoods.length >= 3)
  console.log(`  ${xcuts.length} clusters span ≥3 neighborhoods`)
  console.log()
  console.log(`Top 8 clusters by priority:`)
  for (const c of filtered.slice(0, 8)) {
    const topNbrs = c.neighborhoods.slice(0, 3).map((n) => n.title.slice(0, 35)).join(' / ')
    const topConcept = c.union_concepts[0]?.tag || '?'
    console.log(`  [#${c.cluster_id}] size=${c.size} nbrs=${c.neighborhoods.length} mgmt=${c.avg_management_relevance.toFixed(1)} priority=${c.priority_score.toFixed(1)}`)
    console.log(`    top concept: ${topConcept}`)
    console.log(`    top nbrs: ${topNbrs}`)
    console.log(`    rep: ${c.representative_statements[0]?.slice(0, 140)}…`)
  }

  // Save
  writeFileSync(outputPath, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      source: inputPath,
      threshold,
      min_cluster: minCluster,
      total_statements: statements.length,
      total_clusters: summaries.length,
      clusters_after_filter: filtered.length,
      cross_cutting_clusters: xcuts.length,
    },
    clusters: filtered,
  }, null, 2))
  console.log(`\nWritten ${outputPath}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
