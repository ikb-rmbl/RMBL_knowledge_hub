-- Stories collection: news articles, interviews, press releases, memoirs, etc.
-- Creates the full table structure since Payload push is disabled.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-stories.sql
--   (or applied via sync-to-neon.ts --mode=schema)

-- Main stories table
CREATE TABLE IF NOT EXISTS stories (
  id serial PRIMARY KEY,
  title varchar NOT NULL,
  story_type varchar DEFAULT 'other',
  author varchar,
  date timestamp(3) with time zone,
  summary text,
  full_text text,
  media_url varchar,
  media_type varchar,
  source_url varchar,
  duration varchar,
  location varchar,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

-- Participants array (Payload inline array pattern)
CREATE TABLE IF NOT EXISTS stories_participants (
  id serial PRIMARY KEY,
  _parent_id integer NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  _order integer NOT NULL DEFAULT 1,
  name varchar NOT NULL,
  role varchar
);
CREATE INDEX IF NOT EXISTS idx_stories_participants_parent ON stories_participants(_parent_id);

-- Categories relationship (Payload rels pattern)
CREATE TABLE IF NOT EXISTS stories_rels (
  id serial PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  path varchar NOT NULL,
  topics_id integer REFERENCES topics(id) ON DELETE CASCADE,
  "order" integer
);
CREATE INDEX IF NOT EXISTS idx_stories_rels_parent ON stories_rels(parent_id);
CREATE INDEX IF NOT EXISTS idx_stories_rels_topics ON stories_rels(topics_id);

-- Full-text search vector
ALTER TABLE stories ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_stories_search ON stories USING gin(search_vector);

-- Vector embedding for semantic similarity
ALTER TABLE stories ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS idx_stories_embedding ON stories USING hnsw(embedding vector_cosine_ops);

-- Story→publication reference links
ALTER TABLE references_cited ADD COLUMN IF NOT EXISTS source_story_id integer REFERENCES stories(id);
CREATE INDEX IF NOT EXISTS idx_references_cited_story ON references_cited(source_story_id) WHERE source_story_id IS NOT NULL;

-- Populate search vector from existing data
UPDATE stories SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
WHERE search_vector IS NULL;
