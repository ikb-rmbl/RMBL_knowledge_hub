-- Schema for publication provenance tracking.
--
-- Adds data_source and discovery_method enum columns to publications, plus
-- the authors_id column on payload_locked_documents_rels (needed when the
-- Authors collection exists but push: false skipped the migration).
--
-- Idempotent: CREATE TYPE wrapped in DO/EXCEPTION blocks; ADD COLUMN IF NOT
-- EXISTS; CREATE INDEX IF NOT EXISTS.
--
-- This file is SCHEMA ONLY. A separate file —
--   backfill-publication-provenance.sql
-- — populates existing rows. The split prevents accidental data resets if
-- a future sync:schema run iterates all migrations.
--
-- Run with:
--   psql rmbl_knowledge_hub < scripts/sql/add-publication-provenance.sql

DO $$ BEGIN
  CREATE TYPE enum_publications_data_source AS ENUM ('rmbl_database', 'discovered', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum_publications_discovery_method AS ENUM ('rmbl_api', 'openalex_geo', 'crossref_citation', 'crossref_affiliation', 'manual_entry');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE publications ADD COLUMN IF NOT EXISTS data_source enum_publications_data_source DEFAULT 'rmbl_database' NOT NULL;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS discovery_method enum_publications_discovery_method DEFAULT 'rmbl_api' NOT NULL;

ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS authors_id integer;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_authors_id_idx ON payload_locked_documents_rels (authors_id);
