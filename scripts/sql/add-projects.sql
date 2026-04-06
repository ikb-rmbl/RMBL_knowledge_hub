-- Projects collection table + relationships
-- Matches Payload's naming conventions for the Projects collection

-- Enum types
DO $$ BEGIN CREATE TYPE enum_projects_project_type AS ENUM ('research_plan', 'program', 'campaign', 'initiative'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE enum_projects_status AS ENUM ('active', 'completed', 'ongoing'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Main projects table
CREATE TABLE IF NOT EXISTS projects (
  id serial PRIMARY KEY,
  name varchar NOT NULL,
  description text,
  project_type enum_projects_project_type DEFAULT 'research_plan',
  status enum_projects_status DEFAULT 'active',
  pi varchar,
  pi_author_id integer REFERENCES authors(id) ON DELETE SET NULL,
  field_of_science varchar,
  research_areas text,
  start_year integer,
  end_year integer,
  discovery_keywords text,
  auto_discovery_enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT NOW() NOT NULL,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

-- Embedding column for project similarity
ALTER TABLE projects ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS projects_embedding_idx ON projects USING hnsw (embedding vector_cosine_ops);

-- Relationships table (Payload pattern for hasMany relationships)
CREATE TABLE IF NOT EXISTS projects_rels (
  id serial PRIMARY KEY,
  "order" integer,
  parent_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path varchar NOT NULL,
  publications_id integer REFERENCES publications(id) ON DELETE CASCADE,
  datasets_id integer REFERENCES datasets(id) ON DELETE CASCADE,
  documents_id integer REFERENCES documents(id) ON DELETE CASCADE,
  topics_id integer REFERENCES topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS projects_rels_order_idx ON projects_rels ("order");
CREATE INDEX IF NOT EXISTS projects_rels_parent_idx ON projects_rels (parent_id);
CREATE INDEX IF NOT EXISTS projects_rels_path_idx ON projects_rels (path);
CREATE INDEX IF NOT EXISTS projects_rels_publications_id_idx ON projects_rels (publications_id);
CREATE INDEX IF NOT EXISTS projects_rels_datasets_id_idx ON projects_rels (datasets_id);
CREATE INDEX IF NOT EXISTS projects_rels_documents_id_idx ON projects_rels (documents_id);
CREATE INDEX IF NOT EXISTS projects_rels_topics_id_idx ON projects_rels (topics_id);

-- Also add projects_id to payload_locked_documents_rels (needed for Payload admin)
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS projects_id integer;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_projects_id_idx ON payload_locked_documents_rels (projects_id);
