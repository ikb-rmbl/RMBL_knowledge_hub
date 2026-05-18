-- Per-publication extracted protocol steps from VLM extraction.
--
-- The VLM extraction step (experiment-extraction.ts) captures, for each
-- publication, an array of protocolSteps each with action / details /
-- quantities / duration / conditions / equipment. These have been sitting
-- in scripts/output/extraction-full/results.json but not in the database.
--
-- entity_mentions.metadata.protocolStepIndices already references step
-- indices into this array, so loading the steps unlocks "show me the
-- canonical method as described in the introducing paper" on the protocol
-- detail page.
--
-- Run with:
--   psql rmbl_knowledge_hub -f scripts/sql/add-publication-protocol-steps.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS publication_protocol_steps (
  id SERIAL PRIMARY KEY,
  publication_id INT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  step_index INT NOT NULL,                -- 1-based, matches protocolSteps array order
  action TEXT,                            -- short imperative ("Deploy core instrumentation at BCK and KPS")
  details TEXT,                           -- prose elaboration
  quantities TEXT,                        -- "2 sites with full instrument suites"
  duration TEXT,                          -- "Continuous September 2021 - September 2023"
  conditions TEXT,                        -- "Year-round through all weather"
  equipment TEXT[] DEFAULT '{}'::text[],  -- ["snow-level radar", "precipitation gauges", ...]
  UNIQUE (publication_id, step_index)
);

CREATE INDEX IF NOT EXISTS pps_pub_idx ON publication_protocol_steps(publication_id);

COMMIT;

\echo 'publication_protocol_steps schema applied.'
