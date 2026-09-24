-- Annual reporting metrics (the numbers RMBL reports each year, formerly
-- tracked by hand alongside the legacy Publications Database).
--
-- sfa_program / sail_program: tri-state like rmbl_research — 'yes' / 'no' /
-- NULL (= not yet classified). Text, not boolean, so a Payload select save
-- can't collapse NULL to false. Set by scripts/classify-funding-programs.ts
-- from each paper's acknowledgments; admins override via the sidebar, and the
-- curation hook then protects the cell from re-classification.
--   SFA  = supported by the DOE Watershed Function Scientific Focus Area
--          (LBNL; formerly the Genomes-to-Watershed SFA)
--   SAIL = uses data from / is part of the ARM SAIL campaign (2021-2023)
ALTER TABLE publications ADD COLUMN IF NOT EXISTS sfa_program varchar;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS sail_program varchar;
-- {sfa: {method, quote}, sail: {method, quote}}; method = llm | no_cue | project_link
ALTER TABLE publications ADD COLUMN IF NOT EXISTS funding_program_evidence jsonb;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS funding_programs_checked_at timestamptz;

-- Figures as previously reported, kept for side-by-side comparison with the
-- computed values on /metrics. Reference data, not derived: seeded by
-- z-2026-09-24-02-seed-reported-metrics.sql.
CREATE TABLE IF NOT EXISTS reported_metrics (
  year int NOT NULL,
  -- journal_articles | sfa_articles | undergrad_authors | articles_with_undergrad
  metric varchar NOT NULL,
  value int NOT NULL,
  source varchar NOT NULL,
  notes text,
  PRIMARY KEY (year, metric, source)
);
