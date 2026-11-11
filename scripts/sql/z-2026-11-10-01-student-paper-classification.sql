-- Student-paper classification (classify-student-papers.ts).
-- level:   undergraduate | graduate | unknown
-- program: reu | urp | independent_research | course | rmbl_undergraduate |
--          external_undergraduate | graduate | unknown
-- info:    { students: [{name, reu}], mentors: [...], program_text, source, evidence }
-- SQL-only columns (not Payload fields), like pdf_rights_basis.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS student_paper_level TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS student_paper_program TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS student_paper_info JSONB;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS student_paper_classified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS publications_student_paper_level_idx ON publications(student_paper_level)
  WHERE publication_type = 'student_paper';
