-- Add document metadata fields from LLM extraction
-- Supports document_type classification and referenced works categorization.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-document-metadata.sql

-- Document type classification from LLM extraction
-- Values: technical_report, correspondence, news_article, environmental_assessment,
-- management_plan, legislation, county_plan, water_report, recreation_study, other
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_type TEXT;

CREATE INDEX IF NOT EXISTS documents_document_type_idx ON documents(document_type);

-- Category for references_cited entries (e.g. legislation, report, study, book, article)
-- Distinguishes document referenced-works from scientific publication citations
ALTER TABLE references_cited ADD COLUMN IF NOT EXISTS reference_category TEXT;
