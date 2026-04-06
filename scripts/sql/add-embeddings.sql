-- Embedding infrastructure for concept graph and similarity search
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;
--
-- Usage: psql rmbl_knowledge_hub < scripts/sql/add-embeddings.sql

-- Tier A: Summary embeddings on collection tables (one per item)
ALTER TABLE publications ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS publications_embedding_idx ON publications USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS datasets_embedding_idx ON datasets USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS documents_embedding_idx ON documents USING hnsw (embedding vector_cosine_ops);

-- Tier B: Chunk-level embeddings table (future-ready for GraphRAG)
CREATE TABLE IF NOT EXISTS content_chunks (
  id serial PRIMARY KEY,
  collection varchar(20) NOT NULL,        -- 'publications', 'datasets', 'documents'
  item_id integer NOT NULL,               -- FK to the source item
  chunk_index integer NOT NULL DEFAULT 0, -- position within the document
  chunk_text text NOT NULL,               -- the text that was embedded
  embedding vector(1024),
  embedding_model varchar(50),            -- 'voyage-4', 'voyage-4-large', etc.
  chunk_method varchar(30),               -- 'summary', 'sliding_window', 'llm_extract'
  metadata jsonb,                         -- entities, key_findings, relationships (GraphRAG)
  created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_chunks_embedding_idx ON content_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS content_chunks_collection_item_idx ON content_chunks (collection, item_id);
