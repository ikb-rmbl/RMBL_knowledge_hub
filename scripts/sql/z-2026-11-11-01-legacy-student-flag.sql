-- Legacy Publications Database student signal (import-legacy-student-signals.ts):
-- TRUE when the old database marked the publication as having a student
-- author (its "Student" tag or per-record student flag). Publication-level —
-- the old database did not say which author; asterisked authors become
-- publication_student_authors rows (detection_method = 'legacy_asterisk').
-- SQL-only column (not a Payload field).
ALTER TABLE publications ADD COLUMN IF NOT EXISTS legacy_student_flag BOOLEAN;
