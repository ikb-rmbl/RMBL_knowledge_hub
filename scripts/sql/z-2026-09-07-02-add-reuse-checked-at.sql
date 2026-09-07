-- Staleness tracking for the re-use assessment (pipeline-integrated refresh)
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS reuse_checked_at timestamptz;
