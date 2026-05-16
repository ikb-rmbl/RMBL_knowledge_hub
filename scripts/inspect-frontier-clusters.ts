/**
 * Diagnostic: are the 229 singletons from cluster-frontiers.ts truly distinct,
 * or are they just below the similarity threshold?
 *
 * For each singleton, finds its nearest neighbor across all statements and
 * reports the similarity. Also runs a threshold sweep to show how cluster
 * shape changes.
 *
 * Reads cached embeddings from scripts/output/frontiers-embeddings.json
 * (created by cluster-frontiers.ts).
 *
 * Usage:
 *   npx tsx scripts/inspect-frontier-clusters.ts
 */

import { readFileSync } from 'fs'
import './lib/config.js'
import { cosineSimilarity, clusterCandidates } from './lib/embedding-cluster.js'

const args = process.argv.slice(2)
const baseThreshold = parseFloat(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || '0.78')
const sweepThresholds = (args.find((a) => a.startsWith('--sweep='))?.split('=')[1] || '0.70,0.74,0.76,0.78,0.80,0.82')
  .split(',').map((s) => parseFloat(s))

interface Stmt {
  id: number
  neighborhood_id: number
  neighborhood_title: string
  statement: string
  concepts: string[]
  embedding: number[]
}

function loadStatements(): Stmt[] {
  const data = JSON.parse(readFileSync('scripts/output/frontiers-extracted.json', 'utf-8'))
  const embeddings = JSON.parse(readFileSync('scripts/output/frontiers-embeddings.json', 'utf-8'))
  const stmts: Stmt[] = []
  for (const n of data.neighborhoods) {
    for (const s of (n.statements || [])) {
      stmts.push({
        id: stmts.length,
        neighborhood_id: n.neighborhood_id,
        neighborhood_title: n.title,
        statement: s.statement,
        concepts: s.concepts || [],
        embedding: embeddings[stmts.length],
      })
    }
  }
  return stmts
}

function main() {
  const stmts = loadStatements()
  console.log(`Loaded ${stmts.length} statements with embeddings`)
  console.log()

  // ===== Threshold sweep =====
  console.log('=== Threshold sweep ===')
  console.log('threshold | clusters | singletons | size≥3 nbrs | largest cluster')
  console.log('----------|----------|------------|-------------|----------------')
  for (const t of sweepThresholds) {
    const clusters = clusterCandidates(stmts, t)
    const singletons = clusters.filter((c) => c.members.length === 1).length
    const xcuts = clusters.filter((c) => {
      const nbrs = new Set(c.members.map((m) => m.neighborhood_id))
      return nbrs.size >= 3
    }).length
    const largest = Math.max(...clusters.map((c) => c.members.length))
    console.log(`  ${t.toFixed(2)}    |   ${String(clusters.length).padStart(3)}    |     ${String(singletons).padStart(3)}    |      ${String(xcuts).padStart(2)}     |       ${largest}`)
  }
  console.log()

  // ===== Singleton nearest-neighbor analysis at base threshold =====
  console.log(`=== Singleton near-miss analysis (clustered at threshold=${baseThreshold}) ===`)
  const clustered = clusterCandidates(stmts, baseThreshold)
  const singletons = clustered.filter((c) => c.members.length === 1).map((c) => c.members[0])
  console.log(`${singletons.length} singletons`)
  console.log()

  // For each singleton, find nearest neighbor across ALL statements (not just other singletons)
  type NN = { stmt: Stmt; bestSim: number; bestOther: Stmt }
  const nns: NN[] = []
  for (const s of singletons) {
    let bestSim = -1
    let bestOther: Stmt = s
    for (const other of stmts) {
      if (other.id === s.id) continue
      const sim = cosineSimilarity(s.embedding, other.embedding)
      if (sim > bestSim) { bestSim = sim; bestOther = other }
    }
    nns.push({ stmt: s, bestSim, bestOther })
  }

  // Distribution of nearest-neighbor similarities for singletons
  const buckets = [
    { range: '< 0.50', test: (s: number) => s < 0.50 },
    { range: '0.50-0.60', test: (s: number) => s >= 0.50 && s < 0.60 },
    { range: '0.60-0.65', test: (s: number) => s >= 0.60 && s < 0.65 },
    { range: '0.65-0.70', test: (s: number) => s >= 0.65 && s < 0.70 },
    { range: '0.70-0.74', test: (s: number) => s >= 0.70 && s < 0.74 },
    { range: '0.74-0.76', test: (s: number) => s >= 0.74 && s < 0.76 },
    { range: '0.76-0.78', test: (s: number) => s >= 0.76 && s < 0.78 },
  ]
  console.log('Nearest-neighbor similarity distribution for singletons:')
  for (const b of buckets) {
    const n = nns.filter((x) => b.test(x.bestSim)).length
    const pct = (n / nns.length * 100).toFixed(0)
    const bar = '█'.repeat(Math.round(n / 3))
    console.log(`  ${b.range.padEnd(10)} ${String(n).padStart(3)} (${pct}%)  ${bar}`)
  }
  console.log()

  // Show 5 examples of singletons with sim ≥ 0.76 (close to threshold — would catch with mild loosen)
  const nearMisses = nns.filter((n) => n.bestSim >= 0.76 && n.bestSim < 0.78).sort((a, b) => b.bestSim - a.bestSim)
  console.log(`Near-miss singletons (sim 0.76-0.78 — would join cluster at threshold=0.76): ${nearMisses.length}`)
  for (const nm of nearMisses.slice(0, 5)) {
    console.log()
    console.log(`  sim=${nm.bestSim.toFixed(3)}`)
    console.log(`  SINGLETON [${nm.stmt.neighborhood_title.slice(0, 40)}]: ${nm.stmt.statement.slice(0, 130)}…`)
    console.log(`  NN        [${nm.bestOther.neighborhood_title.slice(0, 40)}]: ${nm.bestOther.statement.slice(0, 130)}…`)
  }
  console.log()

  // Show 5 examples of genuinely isolated singletons (sim < 0.65 = clearly distinct theme)
  const isolated = nns.filter((n) => n.bestSim < 0.65).sort((a, b) => a.bestSim - b.bestSim)
  console.log(`Genuinely isolated singletons (sim < 0.65): ${isolated.length}`)
  for (const ix of isolated.slice(0, 4)) {
    console.log()
    console.log(`  sim=${ix.bestSim.toFixed(3)}`)
    console.log(`  ISOLATED  [${ix.stmt.neighborhood_title.slice(0, 40)}]: ${ix.stmt.statement.slice(0, 130)}…`)
    console.log(`  closest   [${ix.bestOther.neighborhood_title.slice(0, 40)}]: ${ix.bestOther.statement.slice(0, 130)}…`)
  }
}

main()
