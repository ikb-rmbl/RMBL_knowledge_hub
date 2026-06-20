-- Add `validation_run_id` to `frontier_snapshots` so a snapshot taken during
-- a currency-validation pass (validate-frontier-currency.ts) can record
-- *which* validation pass triggered it. Mirrors the existing
-- `extraction_run_id` column, which records the *extraction* pass that
-- produced the snapshot's parent row.
--
-- Without this column, the snapshot helper has to overload its single
-- run_id slot, which fails the existing FK to frontier_extraction_runs
-- whenever a validation run id is passed.
--
-- Idempotent.

ALTER TABLE frontier_snapshots
  ADD COLUMN IF NOT EXISTS validation_run_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'frontier_snapshots'::regclass
      AND conname = 'frontier_snapshots_validation_run_id_fkey'
  ) THEN
    ALTER TABLE frontier_snapshots
      ADD CONSTRAINT frontier_snapshots_validation_run_id_fkey
        FOREIGN KEY (validation_run_id)
        REFERENCES frontier_validation_runs(id) ON DELETE SET NULL;
    RAISE NOTICE '  ✓ added FK frontier_snapshots.validation_run_id → frontier_validation_runs(id)';
  END IF;
END $$;

COMMENT ON COLUMN frontier_snapshots.validation_run_id IS
  'Validation pass that triggered this snapshot, if any. Mutually exclusive with extraction_run_id in practice — a snapshot is taken because of one or the other, not both.';
