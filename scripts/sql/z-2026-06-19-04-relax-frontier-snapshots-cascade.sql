-- Loosen frontier_snapshots.frontier_id FK from CASCADE → SET NULL.
--
-- The original schema migration (add-grounded-frontiers-schema.sql) declared
-- snapshots with ON DELETE CASCADE — which makes sense for ordinary lifecycle
-- coupling, but defeats the *point* of snapshots, which is to preserve
-- historical state across pipeline re-runs that may delete the parent.
--
-- The grounded loader (load-frontiers-grounded.ts) avoids deleting parents
-- by updating in place, so in practice this constraint won't fire under
-- normal operation. But if an admin ever does delete a frontier from the
-- UI, we want the snapshot history (title + content + currency rollup) to
-- survive as an orphaned record rather than vanish.
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'frontier_snapshots'::regclass
      AND conname = 'frontier_snapshots_frontier_id_fkey'
      AND confdeltype = 'c'  -- CASCADE
  ) THEN
    ALTER TABLE frontier_snapshots
      DROP CONSTRAINT frontier_snapshots_frontier_id_fkey;
    ALTER TABLE frontier_snapshots
      ADD CONSTRAINT frontier_snapshots_frontier_id_fkey
        FOREIGN KEY (frontier_id) REFERENCES frontiers(id) ON DELETE SET NULL;
    RAISE NOTICE '  ✓ snapshots FK swapped CASCADE → SET NULL';
  ELSE
    RAISE NOTICE '  ✓ snapshots FK already non-cascading (no-op)';
  END IF;
END $$;
