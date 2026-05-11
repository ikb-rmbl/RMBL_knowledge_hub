-- Add missing FK columns to payload_locked_documents_rels for collections
-- introduced after the initial Payload schema (Species, Places, Protocols,
-- Concepts, Stories).
--
-- Without these, Payload's "is this doc locked for editing?" check throws
-- on every collection detail page in the admin, leaving the form body blank.
--
-- Idempotent: safe to re-run.

ALTER TABLE payload_locked_documents_rels
  ADD COLUMN IF NOT EXISTS species_id   integer,
  ADD COLUMN IF NOT EXISTS places_id    integer,
  ADD COLUMN IF NOT EXISTS protocols_id integer,
  ADD COLUMN IF NOT EXISTS concepts_id  integer,
  ADD COLUMN IF NOT EXISTS stories_id   integer;

CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_species_id_idx
  ON payload_locked_documents_rels (species_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_places_id_idx
  ON payload_locked_documents_rels (places_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_protocols_id_idx
  ON payload_locked_documents_rels (protocols_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_concepts_id_idx
  ON payload_locked_documents_rels (concepts_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_stories_id_idx
  ON payload_locked_documents_rels (stories_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_species_fk') THEN
    ALTER TABLE payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_species_fk
      FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_places_fk') THEN
    ALTER TABLE payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_places_fk
      FOREIGN KEY (places_id) REFERENCES places(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_protocols_fk') THEN
    ALTER TABLE payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_protocols_fk
      FOREIGN KEY (protocols_id) REFERENCES protocols(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_concepts_fk') THEN
    ALTER TABLE payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_concepts_fk
      FOREIGN KEY (concepts_id) REFERENCES concepts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_stories_fk') THEN
    ALTER TABLE payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_stories_fk
      FOREIGN KEY (stories_id) REFERENCES stories(id) ON DELETE CASCADE;
  END IF;
END $$;
