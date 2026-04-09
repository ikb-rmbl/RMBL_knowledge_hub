-- PDF restriction fields for manually-acquired PDFs
-- Run on BOTH local and Neon databases.
--
-- These fields support a workflow where a technician manually downloads
-- PDFs that automated discovery can't reach, extracts text for indexing,
-- but we don't redistribute the PDF blob publicly.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-pdf-restriction.sql
--   psql "$NEON_DIRECT_URL" < scripts/sql/add-pdf-restriction.sql

ALTER TABLE publications ADD COLUMN IF NOT EXISTS pdf_restricted boolean DEFAULT false;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS pdf_source_description text;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS pdf_acquired_at date;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS pdf_restricted boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pdf_source_description text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pdf_acquired_at date;
