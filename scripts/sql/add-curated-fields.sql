-- Per-row, per-cell curation tracking.
--
-- `curated_fields` is a JSON array of Payload field names whose current
-- values were last set by a human admin. Pipeline scripts must consult this
-- array and skip listed fields on UPDATE (wired in a follow-on change).
--
-- Phase 1: schema + Payload hook only. The existing static `curatedFields`
-- classification in scripts/sync-databases.ts remains in place as a baseline
-- protection until rows accumulate per-cell tracking from real admin edits.
--
-- Idempotent.

ALTER TABLE publications ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE datasets     ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents    ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE authors      ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE topics       ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE species      ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE places       ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE protocols    ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE concepts     ADD COLUMN IF NOT EXISTS curated_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
