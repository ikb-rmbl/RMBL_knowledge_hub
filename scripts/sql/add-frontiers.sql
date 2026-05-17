-- Schema for the frontiers entity collection.
--
-- Frontiers are synthesized from clusters of atomic frontier statements
-- pulled out of the neighborhood primers. Generated end-to-end by the
-- pipeline (extract-frontiers → cluster-frontiers → synthesize-frontiers
-- → link-frontier-entities → load-frontiers); not admin-editable for now.
--
-- Run with:
--   psql rmbl_knowledge_hub -f scripts/sql/add-frontiers.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS frontiers (
  id SERIAL PRIMARY KEY,
  cluster_id INT NOT NULL UNIQUE,        -- the source cluster from current run
  slug TEXT NOT NULL UNIQUE,             -- URL-safe slug derived from title
  title TEXT NOT NULL,
  context TEXT,
  frontier_description TEXT,
  barriers TEXT,
  research_opportunities TEXT,
  impacts TEXT,
  cross_cutting_summary TEXT,
  tractability TEXT,                     -- 'low' | 'medium' | 'high'
  framing_notes TEXT,
  key_questions JSONB DEFAULT '[]'::jsonb,            -- array of strings
  pushing_the_frontier JSONB DEFAULT '[]'::jsonb,     -- array of {category,effort,action}
  data_gaps JSONB DEFAULT '[]'::jsonb,                -- array of strings (free-text)
  avg_management_relevance NUMERIC,
  source_cluster_size INT,
  source_neighborhoods INT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS frontiers_mgmt_idx ON frontiers(avg_management_relevance DESC);
CREATE INDEX IF NOT EXISTS frontiers_size_idx ON frontiers(source_cluster_size DESC);
CREATE INDEX IF NOT EXISTS frontiers_nbrs_idx ON frontiers(source_neighborhoods DESC);

-- Contributing neighborhoods (audit trail, for "Sources" panel)
CREATE TABLE IF NOT EXISTS frontier_neighborhoods (
  frontier_id INT NOT NULL REFERENCES frontiers(id) ON DELETE CASCADE,
  neighborhood_id INT NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  statement_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (frontier_id, neighborhood_id)
);
CREATE INDEX IF NOT EXISTS frontier_nbrs_nid_idx ON frontier_neighborhoods(neighborhood_id);

-- Linked entities (polymorphic — concepts, protocols, species, places,
-- stakeholders, authors, publications, datasets, documents, projects)
CREATE TABLE IF NOT EXISTS frontier_entities (
  frontier_id INT NOT NULL REFERENCES frontiers(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INT NOT NULL,
  weight NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (frontier_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS frontier_entities_type_id_idx ON frontier_entities(entity_type, entity_id);

-- Source atomic statements (audit trail — proves where each frontier came from)
CREATE TABLE IF NOT EXISTS frontier_source_statements (
  id SERIAL PRIMARY KEY,
  frontier_id INT NOT NULL REFERENCES frontiers(id) ON DELETE CASCADE,
  neighborhood_id INT NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  statement_text TEXT NOT NULL,
  management_relevance INT,
  source_section TEXT,
  concepts JSONB DEFAULT '[]'::jsonb,
  protocols JSONB DEFAULT '[]'::jsonb,
  datasets_needed JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS frontier_src_stmts_fid_idx ON frontier_source_statements(frontier_id);
CREATE INDEX IF NOT EXISTS frontier_src_stmts_nbrid_idx ON frontier_source_statements(neighborhood_id);

COMMIT;

\echo 'Frontiers schema applied.'
