-- Era primers: synthesized period portraits of basin science per era.
--
-- Adds the columns that scripts/generate-era-primers.ts writes into. The
-- primer itself lives on the eras row; key_themes and open_questions are
-- jsonb arrays of strings; primer_model records which Claude model produced
-- the text so we can re-generate selectively as models change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-era-primer.sql

ALTER TABLE eras ADD COLUMN IF NOT EXISTS primer text;
ALTER TABLE eras ADD COLUMN IF NOT EXISTS primer_generated_at timestamptz;
ALTER TABLE eras ADD COLUMN IF NOT EXISTS primer_model text;
ALTER TABLE eras ADD COLUMN IF NOT EXISTS primer_key_themes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE eras ADD COLUMN IF NOT EXISTS primer_open_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_eras_primer_generated_at ON eras(primer_generated_at DESC);
