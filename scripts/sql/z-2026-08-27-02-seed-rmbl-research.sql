-- One-shot data migration: seed rmbl_research from provenance.
-- Everything from the legacy RMBL Publications Database is RMBL research by
-- definition; discovered papers stay NULL (= the admin triage queue).
-- Guards: only fills NULLs (idempotent) and never overrides an admin-curated
-- cell. Run before the legacy Pubs DB shuts down (~2026-09).
UPDATE publications SET rmbl_research = 'yes'
WHERE data_source = 'rmbl_database'
  AND rmbl_research IS NULL
  AND NOT (curated_fields @> '["rmblResearch"]'::jsonb);
