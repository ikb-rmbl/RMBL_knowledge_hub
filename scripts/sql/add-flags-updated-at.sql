-- Add updated_at to content_flags so it can be managed by Payload as a
-- collection (Payload expects updated_at on all collection tables).
--
-- Idempotent.

ALTER TABLE content_flags
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Keep updated_at in sync with row mutations.
CREATE OR REPLACE FUNCTION content_flags_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_flags_updated_at_trigger ON content_flags;
CREATE TRIGGER content_flags_updated_at_trigger
  BEFORE UPDATE ON content_flags
  FOR EACH ROW EXECUTE FUNCTION content_flags_set_updated_at();

-- Align resolver-FK column name with Payload's relationship convention.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_flags' AND column_name = 'resolved_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_flags' AND column_name = 'resolved_by_id'
  ) THEN
    ALTER TABLE content_flags RENAME COLUMN resolved_by TO resolved_by_id;
  END IF;
END $$;

-- Payload tracks document locks across every collection via a polymorphic
-- join table. Registering content_flags as a Payload collection requires the
-- corresponding FK column on that table; see add-locked-documents-rels-columns.sql
-- for the same pattern applied to entity collections added previously.
ALTER TABLE payload_locked_documents_rels
  ADD COLUMN IF NOT EXISTS content_flags_id integer;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_content_flags_id_idx
  ON payload_locked_documents_rels (content_flags_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_content_flags_fk') THEN
    ALTER TABLE payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_content_flags_fk
      FOREIGN KEY (content_flags_id) REFERENCES content_flags(id) ON DELETE CASCADE;
  END IF;
END $$;
