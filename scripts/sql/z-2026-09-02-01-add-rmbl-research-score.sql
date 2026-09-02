-- RMBL-Research auto-assignment score (prototype → pipeline).
-- Written by score-rmbl-research.ts --apply for publications still awaiting
-- an rmbl_research determination; lets the admin triage queue be sorted
-- most-likely-first. Pipeline-owned; cleared determinations keep their score
-- for audit.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS rmbl_research_score real;
CREATE INDEX IF NOT EXISTS publications_rmbl_score_idx ON publications(rmbl_research_score);
