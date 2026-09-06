-- LLM-extracted dataset discovery fields (extract-dataset-variables-llm.ts):
-- data_ongoing        — collection explicitly described as continuing
-- temporal_resolution — sampling frequency (sub-daily … one-time)
-- cited_references    — companion/source papers: [{doi, citation, evidence}]
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS data_ongoing boolean;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS temporal_resolution text;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS cited_references jsonb;
