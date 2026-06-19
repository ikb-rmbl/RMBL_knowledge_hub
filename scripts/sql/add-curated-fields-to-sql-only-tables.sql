-- Adds `curated_fields` to the SQL-only AI-artifact tables so the per-page
-- curation indicator can answer "has this LLM-generated content been
-- reviewed by a curator?" with a real signal rather than a placeholder.
--
-- Why these two tables: `neighborhoods` and `frontiers` host the bulk of the
-- site's LLM-authored prose (primers, syntheses) but were created outside
-- the Payload schema, so they missed the `curated_fields` column the
-- Payload-managed collections got via the curation hook setup. `eras`
-- already has `curated_fields` from its original migration.
--
-- The column is identical in shape to the Payload-collection version:
-- a JSONB array of camelCase field names that have been admin-edited.
-- The shared `curation` lib helpers (scripts/lib/curation.ts) treat NULL
-- and '[]' identically, so the default keeps existing pipeline writes safe.
--
-- Idempotent: re-runnable. Tracks issue #49.

ALTER TABLE neighborhoods
  ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE frontiers
  ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Indexes: not added here. Filtering by curated_fields presence is admin-
-- side only and at current scale (146 neighborhoods, 98 frontiers) a
-- sequential scan is faster than maintaining a GIN index.

-- Smoke check, prints which tables now have the column.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['neighborhoods', 'frontiers', 'eras']) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'curated_fields'
    ) THEN
      RAISE NOTICE '  ✓ % has curated_fields', t;
    ELSE
      RAISE NOTICE '  ✗ % MISSING curated_fields', t;
    END IF;
  END LOOP;
END $$;
