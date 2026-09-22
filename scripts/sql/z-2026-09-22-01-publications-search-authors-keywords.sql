-- Fold author names and keywords into publications.search_vector.
--
-- Before this, the vector was title(A) + abstract(B) + full_text(C) only, so
-- the quick search box could not find a paper by its authors — a regression
-- against the legacy RMBL Publications DB, whose single box explicitly
-- searched "authors, keywords, part of a title, or a year".
--
-- Authors and keywords live in Payload child tables (publications_authors,
-- publications_keywords), so the parent BEFORE-trigger alone can't keep the
-- vector fresh: on INSERT the children don't exist yet, and later child
-- writes never touch the parent row. Hence one shared builder function plus
-- AFTER triggers on both child tables.
--
-- Weighting: title A; abstract + author names + keywords B; full_text C.
-- Author names sit at B so an author search outranks a passing full-text
-- mention of the same surname.
--
-- Schema only — see z-2026-09-22-02 for the one-shot reindex of existing rows.

-- Single source of truth for the vector, called from both trigger paths.
CREATE OR REPLACE FUNCTION publications_build_search_vector(p_id integer)
RETURNS tsvector AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(p.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(p.abstract, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(a.given || ' ' || a.family, ' ')
       FROM publications_authors a WHERE a._parent_id = p.id), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(k.keyword, ' ')
       FROM publications_keywords k WHERE k._parent_id = p.id), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(p.full_text, '')), 'C')
  FROM publications p WHERE p.id = p_id;
$$ LANGUAGE sql STABLE;

-- Parent trigger: title/abstract/full_text come from NEW (they may be
-- mid-UPDATE and not yet visible to a SELECT); children are read by id.
CREATE OR REPLACE FUNCTION publications_search_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.abstract, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(a.given || ' ' || a.family, ' ')
       FROM publications_authors a WHERE a._parent_id = NEW.id), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(k.keyword, ' ')
       FROM publications_keywords k WHERE k._parent_id = NEW.id), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.full_text, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Child trigger: recompute the parent's vector after its authors/keywords
-- change. The UPDATE below does not re-fire publications_search_trigger,
-- which is scoped to UPDATE OF title, abstract, full_text.
CREATE OR REPLACE FUNCTION publications_child_search_refresh()
RETURNS trigger AS $$
DECLARE
  pub_id integer := coalesce(NEW._parent_id, OLD._parent_id);
BEGIN
  UPDATE publications
  SET search_vector = publications_build_search_vector(pub_id)
  WHERE id = pub_id;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS publications_authors_search_trigger ON publications_authors;
CREATE TRIGGER publications_authors_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON publications_authors
FOR EACH ROW EXECUTE FUNCTION publications_child_search_refresh();

DROP TRIGGER IF EXISTS publications_keywords_search_trigger ON publications_keywords;
CREATE TRIGGER publications_keywords_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON publications_keywords
FOR EACH ROW EXECUTE FUNCTION publications_child_search_refresh();

-- Advanced-search support indexes: the Author and Keyword fields match by
-- substring, which needs trigram indexes to stay off a sequential scan.
-- pg_trgm is already installed (ingest-curated-papers.ts depends on it).
CREATE INDEX IF NOT EXISTS publications_authors_family_trgm
  ON publications_authors USING gin (family gin_trgm_ops);
CREATE INDEX IF NOT EXISTS publications_authors_given_trgm
  ON publications_authors USING gin (given gin_trgm_ops);
CREATE INDEX IF NOT EXISTS publications_keywords_keyword_trgm
  ON publications_keywords USING gin (keyword gin_trgm_ops);
CREATE INDEX IF NOT EXISTS publications_title_trgm
  ON publications USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS publications_journal_trgm
  ON publications USING gin (journal gin_trgm_ops);
