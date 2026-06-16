-- Fix: Payload admin detail pages for entity collections render blank because
-- the document-lock check queries payload_locked_documents_rels.eras_id, but
-- that column was never added when Eras was registered as a Payload collection
-- (commit d2f6b41 added the collection + schema for the eras table itself but
-- did not migrate Payload's own relational schema, because push: false).
--
-- Error from the dev log:
--   column bf5cfa95_..._4.eras_id does not exist
--   at findOperation → getIsLocked → renderDocument → DocumentView
--
-- This affects EVERY entity collection's detail page (species, places,
-- concepts, protocols, documents, publications, datasets, …) because the
-- failing OR-of-all-collection-ids query is generated regardless of which
-- collection's detail page is being rendered.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE payload_locked_documents_rels
  ADD COLUMN IF NOT EXISTS eras_id INTEGER;

CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_eras_id_idx
  ON payload_locked_documents_rels(eras_id);
