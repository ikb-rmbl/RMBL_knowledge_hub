-- Schema for the planning-items extraction over Frontiers.
--
-- Each frontier has three JSONB fields that surface planning-relevant
-- items: pushing_the_frontier (actions), data_gaps (free-text needs),
-- key_questions (research priorities). This migration flattens them
-- into a polymorphic items table and reserves a clusters table for
-- LLM-described thematic groups (Louvain on cosine-similarity graph).
--
-- Both tables are entirely pipeline-generated; cluster IDs are
-- non-deterministic across reruns. TRUNCATE-then-INSERT pattern,
-- mirroring frontiers themselves.
--
-- Run with:
--   psql rmbl_knowledge_hub -f scripts/sql/add-frontier-planning-items.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS frontier_planning_items (
  id SERIAL PRIMARY KEY,
  frontier_id INT NOT NULL REFERENCES frontiers(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,        -- 'action' | 'data_gap' | 'question'
  category TEXT,                  -- actions only (data/experiment/model/...)
  effort TEXT,                    -- actions only (near-term/ambitious/major/consortium)
  text TEXT NOT NULL,
  embedding vector(1024),
  cluster_id INT,                 -- assigned post-clustering; FK added after cluster table fills
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fpi_frontier_idx     ON frontier_planning_items(frontier_id);
CREATE INDEX IF NOT EXISTS fpi_type_idx         ON frontier_planning_items(item_type);
CREATE INDEX IF NOT EXISTS fpi_cluster_idx      ON frontier_planning_items(cluster_id);
CREATE INDEX IF NOT EXISTS fpi_effort_idx       ON frontier_planning_items(effort) WHERE effort IS NOT NULL;
CREATE INDEX IF NOT EXISTS fpi_embedding_idx    ON frontier_planning_items USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS frontier_planning_clusters (
  id SERIAL PRIMARY KEY,
  item_type TEXT NOT NULL,                 -- which item type this cluster belongs to ('action' | 'data_gap' | 'question')
  title TEXT,                              -- filled by describe step: one synthesized representative item
  summary TEXT,                            -- filled by describe step: narrative theme/variation/frontier-connections
  key_items JSONB DEFAULT '[]'::jsonb,     -- filled by describe step: 5-10 synthesized representative items
  item_count INT NOT NULL,
  frontier_count INT NOT NULL,             -- distinct frontiers contributing
  type_distribution JSONB DEFAULT '{}'::jsonb,      -- {action: N} (mostly homogeneous now; kept for parity)
  category_distribution JSONB DEFAULT '{}'::jsonb,  -- per-action-category counts (actions only)
  effort_distribution JSONB DEFAULT '{}'::jsonb,    -- per-effort-tier counts (actions only)
  institutional_score NUMERIC,             -- tactical-weighted leverage (favors near-term, actions)
  partnership_score NUMERIC,               -- consortium-weighted leverage (actions)
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column adds for existing installs
ALTER TABLE frontier_planning_clusters ADD COLUMN IF NOT EXISTS item_type TEXT;
ALTER TABLE frontier_planning_clusters ADD COLUMN IF NOT EXISTS key_items JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS fpc_item_type_idx     ON frontier_planning_clusters(item_type);
CREATE INDEX IF NOT EXISTS fpc_institutional_idx ON frontier_planning_clusters(institutional_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS fpc_partnership_idx   ON frontier_planning_clusters(partnership_score DESC NULLS LAST);

COMMIT;

\echo 'Frontier planning-items schema applied.'
