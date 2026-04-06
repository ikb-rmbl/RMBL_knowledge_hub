-- Add external citation count tracking to publications and datasets
-- Run this manually since push: false prevents automatic schema changes
--
-- Usage: psql rmbl_knowledge_hub < scripts/sql/add-citation-counts.sql

-- Publications: external citation count from OpenAlex
ALTER TABLE publications ADD COLUMN IF NOT EXISTS external_citation_count integer DEFAULT 0;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS citation_count_updated_at timestamptz;

-- Datasets: external citation count from DataCite
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS external_citation_count integer DEFAULT 0;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS citation_count_updated_at timestamptz;
