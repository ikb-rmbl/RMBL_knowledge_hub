-- GCMD Science Keywords paths for LLM-extracted dataset variables.
-- datasets.variables holds the canonical variable names (facet surface);
-- gcmd_variables holds the matching GCMD paths, aligned by position.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS gcmd_variables text[];
CREATE INDEX IF NOT EXISTS datasets_gcmd_variables_idx ON datasets USING gin(gcmd_variables);
