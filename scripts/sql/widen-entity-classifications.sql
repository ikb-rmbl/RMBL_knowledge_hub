-- Widen entity classification columns to text
-- These narrow varchar columns cause insert failures when LLM extraction produces
-- slightly longer variants (e.g. "physiological process" vs "process"). Classification
-- values aren't enforced by a DB-level vocabulary anyway, so varchar length adds no value.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/widen-entity-classifications.sql

ALTER TABLE concepts ALTER COLUMN concept_type TYPE text;
ALTER TABLE concepts ALTER COLUMN scope TYPE text;
ALTER TABLE protocols ALTER COLUMN category TYPE text;
ALTER TABLE places ALTER COLUMN place_type TYPE text;
ALTER TABLE places ALTER COLUMN scale TYPE text;
ALTER TABLE species ALTER COLUMN conservation_status TYPE text;
ALTER TABLE species ALTER COLUMN native_to_rmbl TYPE text;
ALTER TABLE species ALTER COLUMN rank TYPE text;
