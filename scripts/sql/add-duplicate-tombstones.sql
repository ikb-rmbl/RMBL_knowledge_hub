-- Duplicate tombstones: a persistent record of "this identifier was
-- deliberately deleted" so pipeline reruns don't recreate the row.
--
-- Workflow:
--   1. Admin deletes a row in the Payload admin (any reason — typically a duplicate).
--   2. A beforeDelete hook on each curatable collection snapshots the row's
--      identifying keys into this table.
--   3. Pipeline loaders (`load-to-payload.ts`, `load-stories.ts`) consult this
--      table before creating new rows; matches are skipped.
--
-- Design notes (see ~/.claude/projects/-Users-ian-code-RMBL-knowledge-hub/memory/project_dedup_design.md):
--   - Pure delete, no merge. Cross-refs CASCADE/SET NULL per existing FKs.
--   - One-way. No "undo merge" path; restore from Neon PITR if needed.
--   - Frontend returns 404 for deleted ids; no redirect.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS duplicate_tombstones (
  id serial PRIMARY KEY,
  collection text NOT NULL,
  keys jsonb NOT NULL,
  deleted_by integer,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_duplicate_tombstones_collection
  ON duplicate_tombstones (collection);
CREATE INDEX IF NOT EXISTS idx_duplicate_tombstones_keys
  ON duplicate_tombstones USING gin (keys);
