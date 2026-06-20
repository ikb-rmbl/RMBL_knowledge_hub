-- Allow `frontier_id` to be NULL on `frontier_source_statements`.
--
-- The grounded-frontiers pipeline (spec §4) writes candidate statements at
-- the extract step, BEFORE clustering + synthesis assign them to a
-- frontier. The existing schema requires `frontier_id` to be set at insert
-- time, which would force the extractor to either (a) write to JSON like
-- the old pipeline did, or (b) use a sentinel frontier_id. Both are
-- awkward; allowing NULL to mean "candidate, not yet clustered" is the
-- minimal natural fix.
--
-- Existing rows are unaffected (they all already have frontier_id set).
-- The old extract → cluster → synthesize pipeline still always sets
-- frontier_id, so this change is backward-compatible.
--
-- Idempotent. Safe to re-run.
--
-- See: scripts/extract-frontiers-grounded.ts, specification/grounded-frontiers-design.md.

ALTER TABLE frontier_source_statements
  ALTER COLUMN frontier_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='frontier_source_statements'
       AND column_name='frontier_id'
       AND is_nullable='YES'
  ) THEN
    RAISE NOTICE '  ✓ frontier_source_statements.frontier_id is now nullable';
  ELSE
    RAISE EXCEPTION '  ✗ frontier_id is still NOT NULL after migration';
  END IF;
END $$;
