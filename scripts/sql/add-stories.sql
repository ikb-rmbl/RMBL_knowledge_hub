-- Add search and embedding support for the stories collection.
-- Run after Payload creates the stories table on first startup.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-stories.sql

-- Full-text search vector
ALTER TABLE stories ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_stories_search ON stories USING gin(search_vector);

-- Vector embedding for semantic similarity
ALTER TABLE stories ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS idx_stories_embedding ON stories USING hnsw(embedding vector_cosine_ops);

-- Populate search vector from existing data
UPDATE stories SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
WHERE search_vector IS NULL;
