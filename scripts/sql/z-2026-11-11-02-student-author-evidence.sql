-- Why a student-author tag exists, for the /metrics curation exports.
-- participant:     {student_paper_id, student_name, basis}
-- legacy_asterisk: {legacy_id}
-- (REU roster/list and structural rows explain themselves via detection_method.)
ALTER TABLE publication_student_authors ADD COLUMN IF NOT EXISTS evidence JSONB;
