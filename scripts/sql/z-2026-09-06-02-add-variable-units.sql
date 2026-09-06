-- Units for LLM-extracted variables, position-aligned with datasets.variables
-- (empty string where the metadata states no unit).
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS variable_units text[];
