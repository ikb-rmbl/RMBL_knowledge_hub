/**
 * Helper for taking append-only snapshots of frontier state.
 *
 * Used by:
 *   - load-frontiers-grounded.ts (before overwriting an existing frontier
 *     on re-run of the same extraction)
 *   - validate-frontier-currency.ts (when ≥1 question's currency changes)
 *   - manual admin "save snapshot" button (future)
 *
 * See specification/grounded-frontiers-design.md §10 for the design.
 *
 * Schema lives in scripts/sql/add-grounded-frontiers-schema.sql.
 */

import type { Pool, PoolClient } from 'pg'

export type SnapshotReason =
  | 'pipeline_rerun'
  | 'validation_currency_shift'
  | 'manual_admin'

/**
 * Context for a snapshot — which pipeline run triggered it. Exactly one
 * of these is set in practice (`pipeline_rerun` → extractionRunId,
 * `validation_currency_shift` → validationRunId), but the type lets
 * either be omitted so the helper stays generic.
 */
export interface SnapshotContext {
  extractionRunId?: number | null
  validationRunId?: number | null
}

/**
 * Append a snapshot of the current state of the given frontier. Marks
 * any previous open snapshot of the same frontier as superseded so the
 * snapshot timeline is a clean chain. Returns the new snapshot id, or
 * null when the frontier id isn't found.
 *
 * Accepts either a Pool or a PoolClient so callers can run this inside
 * an existing transaction (the loader and validator both do so).
 */
export async function snapshotFrontier(
  db: Pool | PoolClient,
  frontierId: number,
  reason: SnapshotReason,
  ctx: SnapshotContext = {},
): Promise<number | null> {
  const { rows: [f] } = await db.query<{
    title: string
    cross_cutting_summary: string | null
    context: string | null
    frontier_description: string | null
    barriers: string | null
    research_opportunities: string | null
    impacts: string | null
    tractability: string | null
    framing_notes: string | null
    key_questions: any
    pushing_the_frontier: any
    data_gaps: any
    source_paper_count: number | null
    source_year_median: number | null
  }>(
    `SELECT title, cross_cutting_summary, context, frontier_description,
            barriers, research_opportunities, impacts, tractability,
            framing_notes, key_questions, pushing_the_frontier, data_gaps,
            source_paper_count, source_year_median
       FROM frontiers WHERE id = $1`,
    [frontierId],
  )
  if (!f) return null

  // Compute a per-question currency rollup from the live row's
  // key_questions jsonb. New shape is [{text, cites, year_range, currency?}];
  // legacy shape is plain strings — count those as "open" by default since
  // the legacy pipeline has no currency tracking.
  const summary = { open: 0, partially: 0, addressed: 0 }
  for (const q of Array.isArray(f.key_questions) ? f.key_questions : []) {
    const c = typeof q === 'object' && q !== null && 'currency' in q ? q.currency : 'open'
    if      (c === 'addressed')           summary.addressed++
    else if (c === 'partially_addressed') summary.partially++
    else                                  summary.open++
  }

  // Mark any prior open snapshot for this frontier as superseded so we
  // have a clean chain.
  await db.query(
    `UPDATE frontier_snapshots
        SET superseded_at = now()
      WHERE frontier_id = $1 AND superseded_at IS NULL`,
    [frontierId],
  )

  const { rows: [r] } = await db.query<{ id: number }>(
    `INSERT INTO frontier_snapshots (
       frontier_id, snapshot_at, title, cross_cutting_summary, context,
       frontier_description, barriers, research_opportunities, impacts,
       tractability, framing_notes, key_questions, pushing_the_frontier,
       data_gaps, source_paper_count, source_year_median,
       question_currency_summary, snapshot_reason, extraction_run_id, validation_run_id
     ) VALUES (
       $1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
     ) RETURNING id`,
    [
      frontierId, f.title, f.cross_cutting_summary, f.context,
      f.frontier_description, f.barriers, f.research_opportunities, f.impacts,
      f.tractability, f.framing_notes,
      // node-pg returns jsonb columns as already-parsed JS values; re-stringify
      // explicitly so pg doesn't try to coerce arrays/objects through its
      // text-protocol encoder (which double-escapes them as JSON strings).
      JSON.stringify(f.key_questions ?? []),
      JSON.stringify(f.pushing_the_frontier ?? []),
      JSON.stringify(f.data_gaps ?? []),
      f.source_paper_count, f.source_year_median,
      JSON.stringify(summary), reason,
      ctx.extractionRunId ?? null,
      ctx.validationRunId ?? null,
    ],
  )
  return r.id
}
