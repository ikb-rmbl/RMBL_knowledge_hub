-- Student-author tagging (roadmap item 3).
-- Custom SQL table, NOT a column on authors_rels: build-authors.ts
-- --load-payload clears and rebuilds authors (and authors_rels), so per-link
-- metadata there would be destroyed. author_name is the durable key;
-- author_id is a convenience link re-resolvable by name after rebuilds.
-- Student status is per-publication (a 2005 REU student may be a PI by 2015).
CREATE TABLE IF NOT EXISTS publication_student_authors (
  id serial PRIMARY KEY,
  publication_id int NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  author_id int REFERENCES authors(id) ON DELETE SET NULL,
  author_name varchar NOT NULL,
  -- reu | thesis | student_paper | other; NULL = student, program unknown
  student_program varchar,
  -- publication_type | roster | manual
  detection_method varchar NOT NULL,
  -- manual assertions survive automated re-seeds
  curated boolean NOT NULL DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, author_name)
);
CREATE INDEX IF NOT EXISTS publication_student_authors_pub_idx ON publication_student_authors(publication_id);
CREATE INDEX IF NOT EXISTS publication_student_authors_author_idx ON publication_student_authors(author_id);
