-- Projects: source key + renewal lineage for the 2022-2026 research plan corpus.
--
-- plan_id is RMBL's own research-plan identifier (e.g. RS2024-913). It is the
-- durable key for re-ingests and for local<->Neon sync; the previous key was
-- the project name, which collides now that renewals of the same study are
-- loaded as separate rows (16 renewal pairs share an identical name).
--
-- renews_project_id points at the EARLIEST plan in a renewal chain (a star, not
-- a linked list, so the whole chain is one query). It is deliberately separate
-- from parent_project_id, which already means "belongs to this program/campaign"
-- and would otherwise have to carry two unrelated meanings.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_id varchar;
CREATE UNIQUE INDEX IF NOT EXISTS projects_plan_id_key ON projects (plan_id) WHERE plan_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS renews_project_id integer REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_renews_project_idx ON projects (renews_project_id);
