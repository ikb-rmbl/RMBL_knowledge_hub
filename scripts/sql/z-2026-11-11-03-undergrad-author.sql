-- Publication-level undergraduate authorship (derive-undergrad-authorship.ts).
-- undergrad_author: 'yes' | 'no' | NULL — Payload select "Undergraduate author".
--   Pipeline sets 'yes' from student-author tags or legacy_student_flag; an admin
--   'yes'/'no' is curated (curated_fields 'undergradAuthor') and never overwritten.
--   Public (search filter); names no one.
-- reu_author: an NSF REU student is among the authors. Pipeline-only, admin-only
--   (field access) — per-person REU status derives from private rosters.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS undergrad_author TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS reu_author BOOLEAN;
CREATE INDEX IF NOT EXISTS publications_undergrad_author_idx ON publications(undergrad_author) WHERE undergrad_author IS NOT NULL;
