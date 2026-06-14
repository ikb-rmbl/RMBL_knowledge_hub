-- AI-provenance columns for Tier 1 LLM-generated artifacts.
--
-- Standardizes the per-row provenance pattern eras already follows
-- (primer_generated_at + primer_model) across the other Tier 1 tables.
-- Each generating script populates these on write; the UI surfaces them
-- in a provenance sidebar.
--
-- Tier 1 user-facing artifacts:
--   neighborhoods.primer            (generate-primers.ts)
--   eras.primer                     (generate-era-primers.ts; already has both columns)
--   frontiers.frontier_description  (synthesize-frontiers.ts → load-frontiers.ts)
--
-- Tier 1 non-UI artifacts (provenance still recorded for methodology page):
--   frontier_planning_themes.summary             (describe-planning-themes.ts)
--   frontier_planning_clusters.summary           (describe-frontier-planning-clusters.ts)
--   frontier_long_reach_opportunities.description (synthesize-long-reach-opportunities.ts)
--
-- All ADD COLUMN IF NOT EXISTS — idempotent.

ALTER TABLE neighborhoods                 ADD COLUMN IF NOT EXISTS primer_model      TEXT;
ALTER TABLE frontiers                     ADD COLUMN IF NOT EXISTS synthesis_model   TEXT;
ALTER TABLE frontier_planning_themes      ADD COLUMN IF NOT EXISTS description_model TEXT;
ALTER TABLE frontier_planning_clusters    ADD COLUMN IF NOT EXISTS description_model TEXT;
ALTER TABLE frontier_long_reach_opportunities ADD COLUMN IF NOT EXISTS synthesis_model TEXT;
