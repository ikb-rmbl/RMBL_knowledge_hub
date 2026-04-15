-- Knowledge Neighborhoods table
-- Stores community detection results from Louvain algorithm on the unified graph.
-- Each neighborhood is a cluster of densely connected entities, authors, publications, and datasets.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-neighborhoods.sql

CREATE TABLE IF NOT EXISTS neighborhoods (
  id              SERIAL PRIMARY KEY,
  community_id    INTEGER NOT NULL UNIQUE,    -- Louvain community ID from detect-communities.ts
  title           TEXT NOT NULL,              -- LLM-generated descriptive title
  summary         TEXT,                       -- LLM-generated one-sentence summary
  label           TEXT,                       -- Original auto-generated label (top entity names)
  themes          TEXT[] DEFAULT '{}',        -- LLM-generated theme keywords
  size            INTEGER NOT NULL DEFAULT 0, -- Number of nodes in the community
  type_counts     JSONB DEFAULT '{}',         -- Node counts per type: {"species": 12, "concept": 8, ...}
  top_members     JSONB DEFAULT '[]',         -- Top 8 members: [{id, type, name, degree, slug}, ...]
  top_by_type     JSONB DEFAULT '{}',         -- Top 3 per type: {"species": [...], "concept": [...]}
  resolution      FLOAT DEFAULT 1.0,         -- Louvain resolution parameter used
  generated_at    TIMESTAMPTZ DEFAULT NOW(),  -- When the community detection was run
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_neighborhoods_size ON neighborhoods(size DESC);
CREATE INDEX IF NOT EXISTS idx_neighborhoods_themes ON neighborhoods USING GIN(themes);

-- Junction table: all members of each neighborhood from the unified graph
CREATE TABLE IF NOT EXISTS neighborhood_members (
  id                SERIAL PRIMARY KEY,
  neighborhood_id   INTEGER NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  entity_type       TEXT NOT NULL,          -- species, concept, protocol, place, author, publication, dataset
  entity_id         INTEGER NOT NULL,       -- ID in the source entity/collection table
  node_id           TEXT NOT NULL,          -- Unified graph node ID (e.g. "species-42")
  label             TEXT,
  degree            INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_neighborhood_members_nbr ON neighborhood_members(neighborhood_id);
CREATE INDEX IF NOT EXISTS idx_neighborhood_members_type ON neighborhood_members(neighborhood_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_neighborhood_members_entity ON neighborhood_members(entity_type, entity_id);
