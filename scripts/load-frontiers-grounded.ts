/**
 * Load grounded synthesized frontiers into the DB — Stage B step 4b.
 *
 * Reads the JSON pair produced by steps 3 (clusters) and 4 (synthesis),
 * then inserts grounded frontier rows tagged with `extraction_run_id`.
 * Assigns each candidate statement to its synthesized frontier by
 * updating `frontier_source_statements.frontier_id`.
 *
 * Plan A (spec §6): legacy frontiers (extraction_run_id IS NULL) stay
 * untouched. Re-running this script for the same extraction_run_id is
 * idempotent — it snapshots existing grounded rows for that run, then
 * deletes-and-re-inserts.
 *
 * Reads JSON, writes DB.
 *
 * Design + rationale: specification/grounded-frontiers-design.md §4.3 + §10.
 *
 * Usage:
 *   npx tsx scripts/load-frontiers-grounded.ts
 *   npx tsx scripts/load-frontiers-grounded.ts --synthesis-input=path/to/synth.json
 *   npx tsx scripts/load-frontiers-grounded.ts --cluster-input=path/to/clustered.json
 *   npx tsx scripts/load-frontiers-grounded.ts --dry-run
 *
 * Tracks: PR #63 (spec) → PR #64 (step 1) → PR #65 (step 2) →
 * PR #66 (step 3) → PR #67 (step 4) → this PR (step 4b).
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'
import { snapshotFrontier } from './lib/frontier-snapshots.js'

// ─── Config ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const SYNTH_INPUT = args.find(a => a.startsWith('--synthesis-input='))?.split('=')[1]
  || 'scripts/output/frontiers-synthesized-grounded.json'
const CLUSTER_INPUT = args.find(a => a.startsWith('--cluster-input='))?.split('=')[1]
  || 'scripts/output/frontiers-clustered-grounded.json'

// ─── Types ────────────────────────────────────────────────────────────

interface ClusterMember {
  statement_id: number
  text: string
  median_cite_year: number | null
}

interface ClusterDoc {
  pipeline_version: string
  extraction_run_id: number
  clusters: Array<{
    cluster_id: number
    size: number
    year_range: [number, number] | null
    year_median: number | null
    members: ClusterMember[]
    union_cite_pub_ids: number[]
    neighborhood_distribution: Array<{ id: number; title: string; count: number }>
  }>
}

interface SynthCite {
  pub_id: number
  snippet: string
  role: string
}

interface SynthQuestion {
  text: string
  cites: SynthCite[]
  year_range: [number, number] | null
}

interface SynthFrontier {
  cluster_id: number
  title: string
  context: string
  frontier_description: string
  barriers: string
  research_opportunities: string
  impacts: string
  cross_cutting_summary: string
  tractability: 'high' | 'medium' | 'low'
  framing_notes: string | null
  key_questions: SynthQuestion[]
  data_gaps: SynthQuestion[]
  pushing_the_frontier: any[]
  source_cluster_size: number
  source_neighborhoods: number
  source_paper_count: number
  source_year_median: number | null
  source_year_range: [number, number] | null
}

interface SynthDoc {
  pipeline_version: string
  extraction_run_id: number
  frontiers: SynthFrontier[]
}

// ─── Slug helper (mirrors existing load-frontiers.ts) ─────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
  const db = new pg.Pool({ connectionString: url })

  console.log(`Load grounded frontiers`)
  console.log(`  synthesis input: ${SYNTH_INPUT}`)
  console.log(`  cluster input:   ${CLUSTER_INPUT}`)
  console.log(`  dry-run:         ${dryRun}`)
  console.log('')

  const synth = JSON.parse(readFileSync(SYNTH_INPUT, 'utf-8')) as SynthDoc
  const clusters = JSON.parse(readFileSync(CLUSTER_INPUT, 'utf-8')) as ClusterDoc

  if (synth.extraction_run_id !== clusters.extraction_run_id) {
    console.error(`extraction_run_id mismatch: synthesis=${synth.extraction_run_id}, cluster=${clusters.extraction_run_id}`)
    process.exit(1)
  }
  const runId = synth.extraction_run_id

  // Build cluster_id → statement_ids map from the cluster input
  const clusterMembers = new Map<number, number[]>()
  const clusterNeighborhoods = new Map<number, Array<{ id: number; count: number }>>()
  for (const c of clusters.clusters) {
    clusterMembers.set(c.cluster_id, c.members.map(m => m.statement_id))
    clusterNeighborhoods.set(c.cluster_id, c.neighborhood_distribution.map(n => ({ id: n.id, count: n.count })))
  }

  console.log(`Loaded ${synth.frontiers.length} synthesized frontiers (extraction_run_id=${runId})`)

  // Check whether grounded frontiers already exist for this run — snapshot
  // them first, then UPDATE the row in place. We deliberately do NOT delete
  // existing rows, so the frontier id stays stable and the snapshot chain
  // continues to point at the same parent. Legacy frontiers
  // (extraction_run_id IS NULL) are untouched.
  const { rows: existingRows } = await db.query<{ id: number; cluster_id: number }>(
    `SELECT id, cluster_id FROM frontiers WHERE extraction_run_id = $1`,
    [runId],
  )
  const existingByCluster = new Map<number, number>()
  for (const r of existingRows) existingByCluster.set(r.cluster_id, r.id)
  if (existingRows.length > 0) {
    console.log(`  ${existingRows.length} existing grounded frontier(s) for run ${runId} will be snapshotted + updated in place`)
  }

  if (dryRun) {
    console.log('')
    console.log('(dry-run: no DB writes)')
    await db.end()
    return
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    // For UPDATE-in-place rows, take a snapshot first so the prior content
    // is preserved as historical record. Then clear the row's neighborhood /
    // entity / statement-pointer rels — we'll repopulate from the new cluster.
    for (const [, frontierId] of existingByCluster) {
      const snapId = await snapshotFrontier(client, frontierId, 'pipeline_rerun', runId)
      if (snapId == null) {
        throw new Error(`Failed to snapshot frontier #${frontierId} before replacement`)
      }
    }
    if (existingRows.length > 0) {
      const ids = existingRows.map(r => r.id)
      await client.query(
        `UPDATE frontier_source_statements
            SET frontier_id = NULL
          WHERE frontier_id = ANY($1::int[])`,
        [ids],
      )
      await client.query(
        `DELETE FROM frontier_neighborhoods WHERE frontier_id = ANY($1::int[])`,
        [ids],
      )
      await client.query(
        `DELETE FROM frontier_entities WHERE frontier_id = ANY($1::int[])`,
        [ids],
      )
      console.log(`  ✓ snapshotted + cleared rels for ${existingRows.length} existing row(s)`)
    }

    // Insert/update grounded frontier rows + link statements.
    let inserted = 0
    let updated = 0
    let linked = 0
    let frontierIdsThisRun: number[] = []
    for (const f of synth.frontiers) {
      const slug = slugify(f.title) + '-r' + runId
      const yearP10 = f.source_year_range ? f.source_year_range[0] : null
      const yearP90 = f.source_year_range ? f.source_year_range[1] : null
      const existingId = existingByCluster.get(f.cluster_id)
      let frontierId: number
      if (existingId != null) {
        const { rows: [row] } = await client.query<{ id: number }>(
          `UPDATE frontiers
              SET slug = $2, title = $3, context = $4, frontier_description = $5,
                  barriers = $6, research_opportunities = $7, impacts = $8,
                  cross_cutting_summary = $9, tractability = $10, framing_notes = $11,
                  key_questions = $12::jsonb, pushing_the_frontier = $13::jsonb,
                  data_gaps = $14::jsonb,
                  source_cluster_size = $15, source_neighborhoods = $16,
                  source_paper_count = $17, source_year_median = $18,
                  source_year_p10 = $19, source_year_p90 = $20,
                  updated_at = now()
            WHERE id = $1
        RETURNING id`,
          [
            existingId, slug, f.title,
            f.context || null, f.frontier_description || null, f.barriers || null,
            f.research_opportunities || null, f.impacts || null, f.cross_cutting_summary || null,
            f.tractability || null, f.framing_notes,
            JSON.stringify(f.key_questions || []),
            JSON.stringify(f.pushing_the_frontier || []),
            JSON.stringify(f.data_gaps || []),
            f.source_cluster_size, f.source_neighborhoods,
            f.source_paper_count, f.source_year_median, yearP10, yearP90,
          ],
        )
        frontierId = row.id
        updated++
      } else {
        const { rows: [row] } = await client.query<{ id: number }>(
          `INSERT INTO frontiers (
             cluster_id, slug, title, context, frontier_description, barriers,
             research_opportunities, impacts, cross_cutting_summary, tractability,
             framing_notes, key_questions, pushing_the_frontier, data_gaps,
             avg_management_relevance, source_cluster_size, source_neighborhoods,
             source_paper_count, source_year_median, source_year_p10, source_year_p90,
             extraction_run_id, generated_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb,
             $15, $16, $17, $18, $19, $20, $21, $22, now(), now()
           ) RETURNING id`,
          [
            f.cluster_id, slug, f.title,
            f.context || null, f.frontier_description || null, f.barriers || null,
            f.research_opportunities || null, f.impacts || null, f.cross_cutting_summary || null,
            f.tractability || null, f.framing_notes,
            JSON.stringify(f.key_questions || []),
            JSON.stringify(f.pushing_the_frontier || []),
            JSON.stringify(f.data_gaps || []),
            null,                            // avg_management_relevance — populated by old pipeline; leave NULL on grounded rows
            f.source_cluster_size, f.source_neighborhoods,
            f.source_paper_count, f.source_year_median, yearP10, yearP90,
            runId,
          ],
        )
        frontierId = row.id
        inserted++
      }
      frontierIdsThisRun.push(frontierId)

      // Link contributing statements to this frontier.
      const stmtIds = clusterMembers.get(f.cluster_id) || []
      if (stmtIds.length > 0) {
        const { rowCount } = await client.query(
          `UPDATE frontier_source_statements
              SET frontier_id = $1
            WHERE id = ANY($2::int[]) AND extraction_run_id = $3`,
          [frontierId, stmtIds, runId],
        )
        linked += rowCount ?? 0
      }

      // Link contributing neighborhoods (frontier_neighborhoods join).
      const nbrs = clusterNeighborhoods.get(f.cluster_id) || []
      for (const n of nbrs) {
        await client.query(
          `INSERT INTO frontier_neighborhoods (frontier_id, neighborhood_id, statement_count)
           VALUES ($1, $2, $3)`,
          [frontierId, n.id, n.count],
        )
      }
    }

    // Stale-cluster cleanup: if a previous run produced a cluster_id that's
    // no longer in the new synthesis (re-cluster shifted things), the existing
    // row is now an orphan. Snapshot was already taken above; delete the row
    // so it doesn't ghost-rank in the UI.
    const staleIds = existingRows
      .map(r => r.id)
      .filter(id => !frontierIdsThisRun.includes(id))
    if (staleIds.length > 0) {
      await client.query(
        `DELETE FROM frontiers WHERE id = ANY($1::int[])`,
        [staleIds],
      )
      console.log(`  ✓ deleted ${staleIds.length} stale row(s) from prior run (snapshots kept)`)
    }

    await client.query('COMMIT')
    console.log(`  ✓ inserted ${inserted} grounded frontier(s)`)
    if (updated > 0) console.log(`  ✓ updated ${updated} existing row(s) in place`)
    console.log(`  ✓ linked ${linked} source statement(s)`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`✗ load failed; transaction rolled back`)
    throw e
  } finally {
    client.release()
  }
  await db.end()

  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Done. extraction_run_id=${runId} is now live.`)
}

main().catch(e => { console.error(e); process.exit(1) })
