/**
 * Paper-grounded frontier clustering — Stage B Step 3.
 *
 * Reads candidate statements written by `extract-frontiers-grounded.ts`
 * (tagged with an `extraction_run_id`), embeds them with voyage-4, and
 * clusters them with greedy-centroid clustering — but with the centroid
 * update weighted by *recency* of each member's cite years. The
 * threshold check stays unweighted, so older statements still group with
 * their semantic neighbors; the centroid just drifts toward modern
 * phrasings, which biases the synthesis step's representative selection.
 *
 * Citations propagate trivially: each cluster's `union_cites` is the
 * deduplicated set of cited `pub_id`s across its members.
 *
 * Reads from DB, writes to JSON (matches the existing pipeline's
 * extract→cluster→synthesize handoff pattern; synthesize-frontiers.ts
 * loads from JSON and writes the final frontier rows).
 *
 * Design + rationale: specification/grounded-frontiers-design.md §4.2.
 *
 * Usage:
 *   npx tsx scripts/cluster-frontiers-grounded.ts
 *   npx tsx scripts/cluster-frontiers-grounded.ts --run-id=3
 *   npx tsx scripts/cluster-frontiers-grounded.ts --threshold=0.74
 *   npx tsx scripts/cluster-frontiers-grounded.ts --output=scripts/output/frontiers-clustered-grounded.json
 *
 * Tracks: PR #63 (spec) → PR #64 (step 1 schema) → PR #65 (step 2
 * extractor) → this PR (step 3 clusterer).
 */

import pg from 'pg'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import './lib/config.js'
import { embedTexts, cosineSimilarity } from './lib/embedding-cluster.js'

// ─── Config ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const RUN_ID_ARG = args.find(a => a.startsWith('--run-id='))?.split('=')[1]
const THRESHOLD = parseFloat(args.find(a => a.startsWith('--threshold='))?.split('=')[1] || '0.74')
const RECENCY_HALFLIFE_YEARS = parseFloat(args.find(a => a.startsWith('--recency-halflife='))?.split('=')[1] || '8')
const RECENCY_FRESH_WINDOW = parseFloat(args.find(a => a.startsWith('--recency-fresh='))?.split('=')[1] || '5')
const CURRENT_YEAR = parseInt(args.find(a => a.startsWith('--current-year='))?.split('=')[1] || `${new Date().getUTCFullYear()}`)
const OUTPUT_PATH = args.find(a => a.startsWith('--output='))?.split('=')[1] || 'scripts/output/frontiers-clustered-grounded.json'
const EMBEDDING_CACHE = args.find(a => a.startsWith('--embedding-cache='))?.split('=')[1] || 'scripts/output/frontiers-grounded-embeddings.json'

// ─── Types ────────────────────────────────────────────────────────────

interface CandidateCite {
  pub_id: number
  snippet: string
  role: string
  position_in_paper: string | null
  match_confidence: number | null
  pub_year: number | null
}

interface CandidateStatement {
  statement_id: number
  neighborhood_id: number
  neighborhood_title: string
  text: string
  kind: string
  confidence: string
  cites: CandidateCite[]
  median_cite_year: number | null   // median of pub_year across cites
}

interface WeightedClusterMember extends CandidateStatement {
  embedding: number[]
  weight: number
}

interface WeightedCluster {
  cluster_id: number
  centroid: number[]
  total_weight: number
  members: WeightedClusterMember[]
}

interface ClusteredOutput {
  pipeline_version: string
  extraction_run_id: number
  generated_at: string
  threshold: number
  recency_halflife_years: number
  recency_fresh_window: number
  current_year: number
  total_candidates: number
  clusters: ClusterSummary[]
}

interface ClusterSummary {
  cluster_id: number
  size: number
  year_range: [number, number] | null
  year_median: number | null
  neighborhood_distribution: Array<{ id: number; title: string; count: number }>
  representative_text: string
  members: Array<{
    statement_id: number
    text: string
    kind: string
    confidence: string
    median_cite_year: number | null
    cites: CandidateCite[]
  }>
  union_cite_pub_ids: number[]    // every distinct pub_id cited by any member
  cite_count: number               // total cites across members (includes dupes across statements)
}

// ─── Recency weighting ────────────────────────────────────────────────

/**
 * Recency factor for a statement based on the median publication year of
 * its cites. Fresh window (default 5 years) stays at 1.0; older statements
 * decay exponentially with the configured half-life (default 8 years past
 * the fresh window).
 *
 * Statements with no year info (no cites with years) get a neutral 0.5
 * — they shouldn't dominate clustering either way.
 *
 * See specification/grounded-frontiers-design.md §4.2 for the rationale.
 */
function recencyFactor(year: number | null): number {
  if (year == null) return 0.5
  const age = CURRENT_YEAR - year
  if (age <= RECENCY_FRESH_WINDOW) return 1.0
  return Math.exp(-(age - RECENCY_FRESH_WINDOW) / RECENCY_HALFLIFE_YEARS)
}

// ─── DB reads ─────────────────────────────────────────────────────────

/** Pick the latest completed extraction_run_id if none was specified. */
async function pickRunId(db: pg.Pool): Promise<number> {
  if (RUN_ID_ARG) return parseInt(RUN_ID_ARG)
  const { rows: [r] } = await db.query<{ id: number }>(
    `SELECT id FROM frontier_extraction_runs
      WHERE finished_at IS NOT NULL AND statements_grounded > 0
      ORDER BY finished_at DESC LIMIT 1`,
  )
  if (!r) {
    throw new Error('no completed extraction_runs found; pass --run-id=N')
  }
  return r.id
}

async function fetchCandidates(db: pg.Pool, runId: number): Promise<CandidateStatement[]> {
  const { rows } = await db.query(
    `
    SELECT
      s.id              AS statement_id,
      s.neighborhood_id,
      n.title           AS neighborhood_title,
      s.statement_text  AS text,
      s.kind,
      s.confidence,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'pub_id', sp.pub_id,
            'snippet', sp.snippet,
            'role', sp.role,
            'position_in_paper', sp.position_in_paper,
            'match_confidence', sp.match_confidence,
            'pub_year', p.year
          )
          ORDER BY sp.id
        ) FILTER (WHERE sp.id IS NOT NULL),
        '[]'::jsonb
      )                 AS cites_json
    FROM frontier_source_statements s
    JOIN neighborhoods n              ON n.id  = s.neighborhood_id
    LEFT JOIN frontier_statement_papers sp ON sp.statement_id = s.id
    LEFT JOIN publications p          ON p.id  = sp.pub_id
    WHERE s.extraction_run_id = $1
    GROUP BY s.id, n.title
    ORDER BY s.id
    `,
    [runId],
  )
  return rows.map((r) => {
    const cites: CandidateCite[] = (r.cites_json ?? []) as CandidateCite[]
    // Median cite year (typical: 1-3 cites per statement; median is robust to a single old/new outlier)
    const years = cites.map(c => c.pub_year).filter((y): y is number => typeof y === 'number')
    const median_cite_year = years.length === 0 ? null
      : years.slice().sort((a, b) => a - b)[Math.floor(years.length / 2)]
    return {
      statement_id: r.statement_id,
      neighborhood_id: r.neighborhood_id,
      neighborhood_title: r.neighborhood_title,
      text: r.text,
      kind: r.kind,
      confidence: r.confidence,
      cites,
      median_cite_year,
    }
  })
}

// ─── Weighted greedy-centroid clustering ──────────────────────────────

/**
 * Greedy-centroid clustering, but the centroid is a weighted running
 * average rather than a simple mean. Each member contributes its
 * embedding scaled by `weight` (the recency factor). Threshold checks
 * use raw cosine similarity, so older statements still join their
 * semantic clusters — they just pull the centroid less.
 *
 * To maximize the centroid-drift effect, candidates are pre-sorted by
 * weight (newest first). That way the cluster seed is always a recent
 * statement, and older statements join an already-modern centroid
 * rather than founding their own clusters.
 */
function clusterRecencyWeighted(
  candidates: WeightedClusterMember[],
  threshold: number,
): WeightedCluster[] {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight)

  const clusters: WeightedCluster[] = []
  for (const cand of sorted) {
    let bestCluster: WeightedCluster | null = null
    let bestSim = -1

    for (const cluster of clusters) {
      const sim = cosineSimilarity(cand.embedding, cluster.centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestCluster = cluster
      }
    }

    if (bestCluster && bestSim >= threshold) {
      const newTotal = bestCluster.total_weight + cand.weight
      for (let i = 0; i < bestCluster.centroid.length; i++) {
        bestCluster.centroid[i] =
          (bestCluster.centroid[i] * bestCluster.total_weight + cand.embedding[i] * cand.weight) /
          newTotal
      }
      bestCluster.total_weight = newTotal
      bestCluster.members.push(cand)
    } else {
      clusters.push({
        cluster_id: clusters.length,
        centroid: [...cand.embedding],
        total_weight: cand.weight,
        members: [cand],
      })
    }
  }

  // Reassign cluster_ids in size-desc order so the most cross-cutting
  // clusters end up at the top of the output JSON.
  clusters.sort((a, b) => b.members.length - a.members.length)
  return clusters.map((c, i) => ({ ...c, cluster_id: i }))
}

// ─── Aggregation ──────────────────────────────────────────────────────

function summarizeCluster(cluster: WeightedCluster): ClusterSummary {
  const neighborhoodCounts = new Map<number, { title: string; count: number }>()
  const cites_pub_ids = new Set<number>()
  let cite_count = 0
  const years: number[] = []

  for (const m of cluster.members) {
    const cur = neighborhoodCounts.get(m.neighborhood_id) || { title: m.neighborhood_title, count: 0 }
    cur.count++
    neighborhoodCounts.set(m.neighborhood_id, cur)
    for (const cite of m.cites) {
      cites_pub_ids.add(cite.pub_id)
      cite_count++
      if (cite.pub_year != null) years.push(cite.pub_year)
    }
  }

  years.sort((a, b) => a - b)
  const year_range: [number, number] | null = years.length === 0 ? null : [years[0], years[years.length - 1]]
  const year_median: number | null = years.length === 0 ? null : years[Math.floor(years.length / 2)]

  // Representative text = member statement closest to the (recency-weighted)
  // centroid. Because the centroid is drifted toward recent embeddings,
  // this naturally surfaces the modern framing.
  const closest = cluster.members
    .map((m) => ({ m, sim: cosineSimilarity(m.embedding, cluster.centroid) }))
    .sort((a, b) => b.sim - a.sim)[0]

  return {
    cluster_id: cluster.cluster_id,
    size: cluster.members.length,
    year_range,
    year_median,
    neighborhood_distribution: [...neighborhoodCounts.entries()]
      .map(([id, { title, count }]) => ({ id, title, count }))
      .sort((a, b) => b.count - a.count),
    representative_text: closest.m.text,
    members: cluster.members.map((m) => ({
      statement_id: m.statement_id,
      text: m.text,
      kind: m.kind,
      confidence: m.confidence,
      median_cite_year: m.median_cite_year,
      cites: m.cites,
    })),
    union_cite_pub_ids: [...cites_pub_ids].sort((a, b) => a - b),
    cite_count,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
  const db = new pg.Pool({ connectionString: url })

  const runId = await pickRunId(db)
  console.log(`Grounded frontier clustering`)
  console.log(`  extraction_run_id:        ${runId}`)
  console.log(`  similarity threshold:     ${THRESHOLD}`)
  console.log(`  recency fresh window:     ${RECENCY_FRESH_WINDOW} yrs (full weight)`)
  console.log(`  recency half-life beyond: ${RECENCY_HALFLIFE_YEARS} yrs`)
  console.log(`  current year:             ${CURRENT_YEAR}`)
  console.log('')

  const candidates = await fetchCandidates(db, runId)
  await db.end()
  console.log(`Loaded ${candidates.length} candidate statements from run ${runId}`)
  if (candidates.length === 0) {
    console.error(`  ✗ no candidates found for run_id=${runId}; nothing to cluster`)
    process.exit(1)
  }

  // ── Embed (with cache, since we may sweep thresholds) ──
  // Cache key includes the run_id so re-running with a different run
  // doesn't reuse the wrong embeddings.
  const cacheKey = `run-${runId}`
  let embeddings: number[][] | null = null
  if (existsSync(EMBEDDING_CACHE)) {
    try {
      const cached = JSON.parse(readFileSync(EMBEDDING_CACHE, 'utf-8'))
      if (cached.key === cacheKey && cached.embeddings.length === candidates.length) {
        embeddings = cached.embeddings
        console.log(`Using cached embeddings (${cached.embeddings.length} vectors)`)
      }
    } catch { /* ignore cache parse errors */ }
  }
  if (!embeddings) {
    const texts = candidates.map(c => c.text)
    console.log(`Embedding ${texts.length} statements via voyage-4…`)
    embeddings = await embedTexts(texts)
    writeFileSync(EMBEDDING_CACHE, JSON.stringify({ key: cacheKey, embeddings }))
    console.log(`  cached to ${EMBEDDING_CACHE}`)
  }

  // ── Weight + cluster ──
  const weighted: WeightedClusterMember[] = candidates.map((c, i) => ({
    ...c,
    embedding: embeddings![i],
    weight: recencyFactor(c.median_cite_year),
  }))

  console.log(`Clustering (threshold=${THRESHOLD})…`)
  const clusters = clusterRecencyWeighted(weighted, THRESHOLD)
  console.log(`  produced ${clusters.length} clusters`)
  const sizes = clusters.map(c => c.members.length).sort((a, b) => b - a)
  const histo = { '≥10': 0, '5-9': 0, '2-4': 0, '1': 0 }
  for (const s of sizes) {
    if (s >= 10) histo['≥10']++
    else if (s >= 5) histo['5-9']++
    else if (s >= 2) histo['2-4']++
    else histo['1']++
  }
  console.log(`  size distribution: ≥10 papers: ${histo['≥10']}, 5-9: ${histo['5-9']}, 2-4: ${histo['2-4']}, 1 (singletons): ${histo['1']}`)

  // ── Aggregate per cluster ──
  const summaries: ClusterSummary[] = clusters.map(summarizeCluster)

  // ── Write JSON output ──
  const output: ClusteredOutput = {
    pipeline_version: 'grounded-v1',
    extraction_run_id: runId,
    generated_at: new Date().toISOString(),
    threshold: THRESHOLD,
    recency_halflife_years: RECENCY_HALFLIFE_YEARS,
    recency_fresh_window: RECENCY_FRESH_WINDOW,
    current_year: CURRENT_YEAR,
    total_candidates: candidates.length,
    clusters: summaries,
  }
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))

  // ── Summary ──
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const multimember = clusters.filter(c => c.members.length >= 2).length
  const totalCites = summaries.reduce((acc, s) => acc + s.cite_count, 0)
  const uniqueCites = new Set(summaries.flatMap(s => s.union_cite_pub_ids)).size
  console.log(`Done.`)
  console.log(`  clusters total:               ${clusters.length}`)
  console.log(`  multi-member clusters:        ${multimember}`)
  console.log(`  singletons:                   ${clusters.length - multimember}`)
  console.log(`  total cites carried through:  ${totalCites} (${uniqueCites} unique pub_ids)`)
  console.log(`  output:                       ${OUTPUT_PATH}`)
}

main().catch(e => { console.error(e); process.exit(1) })
