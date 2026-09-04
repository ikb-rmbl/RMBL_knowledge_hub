-- Real measured variables harvested from ESS-DIVE dd.csv data dictionaries
-- (Column_or_Row_Name). Distinct from datasets.keywords (EML keyword topics).
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS variables text[];
CREATE INDEX IF NOT EXISTS datasets_variables_idx ON datasets USING gin(variables);
