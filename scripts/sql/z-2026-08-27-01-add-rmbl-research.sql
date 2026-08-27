-- "RMBL Research" flag on publications (roadmap item 1).
-- Text, not boolean: Payload checkboxes collapse NULL to false on any admin
-- save, which would silently drain the review queue. A nullable select
-- ('yes' / 'no' / NULL = unreviewed) keeps the tri-state stable in the
-- admin UI. Same varchar-behind-a-Payload-select pattern as stories.story_type.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS rmbl_research TEXT;
CREATE INDEX IF NOT EXISTS publications_rmbl_research_idx ON publications(rmbl_research);
