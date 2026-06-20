-- Currency validation schema — step 5/9 of the grounded-frontiers refactor.
--
-- The step-1 migration added `frontiers.last_validation_run_id` as a nullable
-- INT but didn't create the table it should reference, and didn't add the
-- two columns we actually need to render the currency UI:
--   - question_currency_summary: rollup like {open: 6, partially_addressed: 0, addressed: 0}
--   - last_validated_at:         "currency last checked YYYY-MM-DD"
--
-- This migration adds the missing table + columns + FK, all idempotent.
-- See specification/grounded-frontiers-design.md §4.4 + §5.

CREATE TABLE IF NOT EXISTS frontier_validation_runs (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  frontiers_checked INT NOT NULL DEFAULT 0,
  questions_checked INT NOT NULL DEFAULT 0,
  currency_changes  INT NOT NULL DEFAULT 0,
  model_name        TEXT,
  cost_usd          NUMERIC(10, 4),
  notes             TEXT
);

COMMENT ON TABLE frontier_validation_runs IS
  'Audit log of currency-validation passes (validate-frontier-currency.ts). One row per pass; frontiers.last_validation_run_id points at the most recent pass that touched a given frontier.';

ALTER TABLE frontiers
  ADD COLUMN IF NOT EXISTS question_currency_summary JSONB,
  ADD COLUMN IF NOT EXISTS last_validated_at         TIMESTAMPTZ;

COMMENT ON COLUMN frontiers.question_currency_summary IS
  'Rollup of currency states across key_questions + data_gaps, e.g. {"open": 6, "partially_addressed": 0, "addressed": 0}. Updated by validate-frontier-currency.ts after each pass.';

COMMENT ON COLUMN frontiers.last_validated_at IS
  'Timestamp of the most recent currency-validation pass. Drives the "Currency last checked YYYY-MM-DD" affordance on the frontier detail page.';

-- Wire the FK now that frontier_validation_runs exists.
--
-- The step-1 schema migration created the column with a default FK that
-- mistakenly references frontier_extraction_runs (different concept — those
-- track *extraction* passes, not validation passes). Fix it here: drop the
-- wrong-target FK if present, then add the correct one.
DO $$
DECLARE
  cur_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO cur_def
    FROM pg_constraint
   WHERE conrelid = 'frontiers'::regclass
     AND conname = 'frontiers_last_validation_run_id_fkey';

  IF cur_def IS NOT NULL AND cur_def NOT LIKE '%frontier_validation_runs%' THEN
    ALTER TABLE frontiers DROP CONSTRAINT frontiers_last_validation_run_id_fkey;
    RAISE NOTICE '  ✓ dropped wrong-target FK (was: %)', cur_def;
    cur_def := NULL;
  END IF;

  IF cur_def IS NULL THEN
    ALTER TABLE frontiers
      ADD CONSTRAINT frontiers_last_validation_run_id_fkey
        FOREIGN KEY (last_validation_run_id)
        REFERENCES frontier_validation_runs(id) ON DELETE SET NULL;
    RAISE NOTICE '  ✓ added FK frontiers.last_validation_run_id → frontier_validation_runs(id)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS frontiers_last_validated_at_idx
  ON frontiers (last_validated_at) WHERE extraction_run_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'frontiers' AND column_name = 'question_currency_summary'
  ) THEN
    RAISE EXCEPTION '  ✗ frontiers.question_currency_summary missing after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'frontier_validation_runs'
  ) THEN
    RAISE EXCEPTION '  ✗ frontier_validation_runs missing after migration';
  END IF;
  RAISE NOTICE '  ✓ currency-validation schema present';
END $$;
