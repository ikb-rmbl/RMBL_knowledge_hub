-- Long-reach analysis layer on top of cross-lens planning themes.
--
-- Adds per-theme "reach beyond the basin" analysis (LLM-extracted from
-- the theme's existing content) plus a top-of-report cross-theme synthesis
-- of distilled long-reach opportunities.
--
-- Run with:
--   psql rmbl_knowledge_hub -f scripts/sql/add-long-reach-analysis.sql

\set ON_ERROR_STOP on

BEGIN;

-- Per-theme reach analysis
ALTER TABLE frontier_planning_themes
  ADD COLUMN IF NOT EXISTS reach_summary TEXT,
  ADD COLUMN IF NOT EXISTS long_reach_anchors JSONB DEFAULT '[]'::jsonb;

-- Cross-theme strategic synthesis: distilled opportunities for the
-- top-of-report "if you had one slide on reach, what shows up" view.
CREATE TABLE IF NOT EXISTS frontier_long_reach_opportunities (
  id SERIAL PRIMARY KEY,
  rank INT NOT NULL,                                  -- 1-8 ordering in report
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reach_scope TEXT,                                   -- 'federal' | 'multi-state' | 'continental' | 'global' | 'mixed'
  contributing_themes JSONB DEFAULT '[]'::jsonb,      -- [{ theme_id, theme_title }] - which themes feed this opportunity
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flo_rank_idx ON frontier_long_reach_opportunities(rank);

COMMIT;

\echo 'Long-reach analysis schema applied.'
