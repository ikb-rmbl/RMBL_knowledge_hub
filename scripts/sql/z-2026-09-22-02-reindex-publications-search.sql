-- DATA MIGRATION (one-shot). Split off from z-2026-09-22-01 so a schema-only
-- re-run doesn't rewrite every publications row.
--
-- Rebuilds search_vector for all publications so existing rows pick up the
-- author names and keywords the new builder includes. ~5.3K rows, seconds.
--
-- Run with:
--   psql rmbl_knowledge_hub < scripts/sql/z-2026-09-22-02-reindex-publications-search.sql
-- On Neon, run the same file against NEON_DIRECT_URL.

UPDATE publications SET search_vector = publications_build_search_vector(id);
