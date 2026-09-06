-- Dataset re-use assessment (FAIR R-rate) — see specification/dataset-reuse-design.md
CREATE TABLE IF NOT EXISTS dataset_reuse_events (
  id serial PRIMARY KEY,
  dataset_id int NOT NULL,
  channel text NOT NULL,              -- internal_link | openalex | datacite | companion_forward | fulltext_mention
  citing_publication_id int,          -- internal KC publication, when matched
  citing_doi text,
  citing_title text,
  citing_year int,
  use_class text,                     -- data_used | mention | unclear
  independence text,                  -- same_group | collaborators | independent | unknown
  evidence text,
  confidence real,
  extracted_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_reuse_events_uniq
  ON dataset_reuse_events (dataset_id, channel, coalesce(citing_publication_id, -1), coalesce(citing_doi, ''));
CREATE INDEX IF NOT EXISTS dataset_reuse_events_dataset_idx ON dataset_reuse_events (dataset_id);
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS reuse_internal_count int;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS reuse_external_count int;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS reuse_independent boolean;
