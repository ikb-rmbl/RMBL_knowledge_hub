-- Track which extraction run produced each frontier row.
--
-- Spec §6 (Plan A — parallel namespace) says grounded-pipeline frontiers
-- are tagged with extraction_run_id; legacy rows have NULL. UI can then
-- conditionally render the new affordances (cite chips, currency badges)
-- only when this column is populated.
--
-- We added matching extraction_run_id columns to frontier_source_statements
-- in the step-1 schema migration, but missed this one on `frontiers` itself.
-- Small follow-on; same shape.
--
-- Idempotent + backward-compatible. Existing rows stay at NULL.

ALTER TABLE frontiers
  ADD COLUMN IF NOT EXISTS extraction_run_id INT
    REFERENCES frontier_extraction_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS frontiers_extraction_run_id_idx
  ON frontiers (extraction_run_id);

COMMENT ON COLUMN frontiers.extraction_run_id IS
  'Pipeline run that produced this frontier. NULL = legacy frontier from the primer-derived pipeline (pre-grounded). Non-NULL = grounded-pipeline frontier with verbatim cites on key_questions / data_gaps.';

-- Swap UNIQUE(cluster_id) → UNIQUE(extraction_run_id, cluster_id).
--
-- The legacy uniqueness assumed a single global cluster_id space. Grounded
-- runs reuse small ints (0, 1, 2, ...) per extraction, so they conflict
-- with legacy rows that already hold those ids. Per-run uniqueness is the
-- semantic we actually want — NULLs in extraction_run_id don't conflict
-- under default UNIQUE semantics, so legacy rows continue to coexist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'frontiers'::regclass
      AND conname = 'frontiers_cluster_id_key'
  ) THEN
    ALTER TABLE frontiers DROP CONSTRAINT frontiers_cluster_id_key;
    RAISE NOTICE '  ✓ dropped UNIQUE(cluster_id)';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'frontiers'::regclass
      AND conname = 'frontiers_extraction_run_cluster_uniq'
  ) THEN
    ALTER TABLE frontiers
      ADD CONSTRAINT frontiers_extraction_run_cluster_uniq
        UNIQUE (extraction_run_id, cluster_id);
    RAISE NOTICE '  ✓ added UNIQUE(extraction_run_id, cluster_id)';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='frontiers' AND column_name='extraction_run_id'
  ) THEN
    RAISE EXCEPTION '  ✗ frontiers.extraction_run_id missing after migration';
  END IF;
  RAISE NOTICE '  ✓ frontiers.extraction_run_id present';
END $$;
