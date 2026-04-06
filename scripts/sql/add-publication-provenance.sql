-- Add provenance tracking fields to publications table
-- Run this manually since push: false prevents automatic schema changes
--
-- Usage: psql rmbl_knowledge_hub < scripts/sql/add-publication-provenance.sql

-- Create enum types (Payload uses enums for select fields, not varchar)
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

-- Backfill existing records (all came from RMBL API)
UPDATE publications SET data_source = 'rmbl_database', discovery_method = 'rmbl_api'
WHERE data_source = 'rmbl_database';

-- Also ensure payload_locked_documents_rels has the authors_id column
-- (needed when Authors collection exists but push: false skipped the migration)
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS authors_id integer;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_authors_id_idx ON payload_locked_documents_rels (authors_id);
