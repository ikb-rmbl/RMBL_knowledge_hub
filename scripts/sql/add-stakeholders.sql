-- Stakeholders: agencies, organizations, companies, non-profits, and other groups
-- mentioned as actors in documents and publications. Extracted via LLM from document
-- text (not just government agencies — includes NGOs, companies, coalitions, etc).
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-stakeholders.sql

-- Widen entity_type columns to text so we can add 'stakeholder' as a type
-- (previously varchar(10), which couldn't fit 'stakeholder')
ALTER TABLE entity_candidates ALTER COLUMN entity_type TYPE text;
ALTER TABLE entity_mentions ALTER COLUMN entity_type TYPE text;

CREATE TABLE IF NOT EXISTS stakeholders (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,               -- canonical name (e.g., "U.S. Forest Service")
  stakeholder_type   TEXT,                        -- federal_agency, state_agency, local_gov, ngo, industry, academic, coalition, tribal, other
  aliases            TEXT[] DEFAULT '{}',         -- variant spellings merged into this record
  parent_id          INTEGER REFERENCES stakeholders(id) ON DELETE SET NULL,  -- sub-unit relationships
  description        TEXT,                        -- optional context
  mention_count      INTEGER DEFAULT 0,
  publication_count  INTEGER DEFAULT 0,
  document_count     INTEGER DEFAULT 0,
  embedding          VECTOR(1024),                -- Voyage AI embedding of canonical name
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stakeholders_name_idx ON stakeholders USING GIN (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS stakeholders_aliases_idx ON stakeholders USING GIN (aliases);
CREATE INDEX IF NOT EXISTS stakeholders_type_idx ON stakeholders(stakeholder_type);
CREATE INDEX IF NOT EXISTS stakeholders_publication_count_idx ON stakeholders(publication_count DESC);
CREATE INDEX IF NOT EXISTS stakeholders_document_count_idx ON stakeholders(document_count DESC);
CREATE INDEX IF NOT EXISTS stakeholders_embedding_idx ON stakeholders USING hnsw (embedding vector_cosine_ops);
