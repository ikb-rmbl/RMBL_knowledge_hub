-- Schema for cross-lens theme synthesis over planning clusters.
--
-- A "theme" is a Louvain community over the 130 described planning
-- clusters. Each theme groups clusters from different lenses (action,
-- barrier, data_gap, question, impact) that point at the same
-- substantive area. The theme description is LLM-synthesized from
-- its constituent clusters with an invitational voice intended for
-- RMBL board / leadership / select-scientist planning discussions.
--
-- Run with:
--   psql rmbl_knowledge_hub -f scripts/sql/add-frontier-planning-themes.sql

\set ON_ERROR_STOP on

BEGIN;

-- Back-reference on clusters (idempotent for existing installs)
ALTER TABLE frontier_planning_clusters ADD COLUMN IF NOT EXISTS theme_id INT;
CREATE INDEX IF NOT EXISTS fpc_theme_idx ON frontier_planning_clusters(theme_id);

CREATE TABLE IF NOT EXISTS frontier_planning_themes (
  id SERIAL PRIMARY KEY,
  title TEXT,                                  -- noun phrase naming the substantive area
  opportunity TEXT,                            -- "RMBL has a unique opportunity to..." statement
  summary TEXT,                                -- 3-5 sentence framing paragraph
  planning_anchors JSONB DEFAULT '[]'::jsonb,  -- 5-8 concrete distilled items
  considerations TEXT,                         -- honest tradeoffs / limits paragraph
  cluster_count INT NOT NULL,
  item_count INT NOT NULL,
  frontier_count INT NOT NULL,
  type_distribution JSONB DEFAULT '{}'::jsonb, -- {action: 3, barrier: 2, ...}
  leverage_score NUMERIC,                      -- aggregate of constituent cluster scores
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fpt_leverage_idx ON frontier_planning_themes(leverage_score DESC NULLS LAST);

COMMIT;

\echo 'Frontier planning-themes schema applied.'
