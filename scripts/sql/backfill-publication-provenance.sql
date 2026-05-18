-- DATA MIGRATION (one-shot, completed). Split off from
-- add-publication-provenance.sql so future schema-only runs don't accidentally
-- reset hand-curated discovery_method values back to 'rmbl_api'.
--
-- This sets data_source='rmbl_database' and discovery_method='rmbl_api' for
-- every row that's already data_source='rmbl_database'. The data_source SET
-- is a no-op (self-targeted); the discovery_method SET resets it. That's
-- the foot-gun if anyone has hand-corrected discovery_method on legacy rows.
--
-- Safe to re-run only if you intend to reset all rmbl_database rows back to
-- discovery_method='rmbl_api'. Otherwise, leave alone.
--
-- Run with:
--   psql rmbl_knowledge_hub < scripts/sql/backfill-publication-provenance.sql

UPDATE publications
SET data_source = 'rmbl_database', discovery_method = 'rmbl_api'
WHERE data_source = 'rmbl_database';
