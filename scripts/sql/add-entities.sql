-- Entity collections for GraphRAG knowledge graph
-- Creates 4 entity collection tables (Species/Places/Protocols/Concepts) plus
-- 2 supporting tables (entity_mentions for cross-entity linking, entity_candidates
-- for raw VLM extraction staging).
--
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;
--
-- These tables match the Payload collection schemas in src/collections/Species.ts,
-- Places.ts, Protocols.ts, Concepts.ts. They are created via direct SQL (rather
-- than Payload push:true) because:
--   1. They include pgvector columns that Payload doesn't generate cleanly
--   2. They include custom HNSW vector indexes
--   3. They include GIN indexes on text[] columns
--   4. The architecture pattern matches existing custom tables (references_cited,
--      content_chunks, sync_log)
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-entities.sql
--   psql "$NEON_DIRECT_URL" < scripts/sql/add-entities.sql  -- only after Phase 4a validates

-- ============================================================================
-- Species
-- ============================================================================

CREATE TABLE IF NOT EXISTS species (
  id serial PRIMARY KEY,
  canonical_name text NOT NULL,
  rank varchar(20) NOT NULL,                  -- kingdom/phylum/class/order/family/genus/species/subspecies
  scientific_name text,                       -- binomial (Genus species)
  authority text,                             -- e.g., "Audubon, 1841"
  common_names text[] DEFAULT '{}',           -- primary common name + variants
  synonyms text[] DEFAULT '{}',               -- abbreviations and historical names
  parent_taxon_id integer REFERENCES species(id) ON DELETE SET NULL,
  -- Denormalized taxonomic path for fast filtering (avoids recursive CTEs on listing)
  kingdom text,
  phylum text,
  class_name text,                            -- 'class' is a reserved word in some contexts
  order_name text,                            -- same for 'order'
  family text,
  conservation_status varchar(4),             -- IUCN code: LC/NT/VU/EN/CR/EW/EX/DD/NE
  native_to_rmbl varchar(12),                 -- native/introduced/invasive/unknown
  ecological_roles text[] DEFAULT '{}',       -- pollinator, predator, study_subject, etc.
  description text,
  external_ids jsonb,                         -- {gbif, itis, ncbi, eol, worms}
  image_url text,
  mention_count integer DEFAULT 0,
  publication_count integer DEFAULT 0,
  embedding vector(1024),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE (canonical_name, rank)
);

CREATE INDEX IF NOT EXISTS species_family_idx ON species (family);
CREATE INDEX IF NOT EXISTS species_kingdom_idx ON species (kingdom);
CREATE INDEX IF NOT EXISTS species_class_idx ON species (class_name);
CREATE INDEX IF NOT EXISTS species_publication_count_idx ON species (publication_count DESC);
CREATE INDEX IF NOT EXISTS species_mention_count_idx ON species (mention_count DESC);
CREATE INDEX IF NOT EXISTS species_embedding_idx ON species USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS species_common_names_gin ON species USING gin (common_names);
CREATE INDEX IF NOT EXISTS species_synonyms_gin ON species USING gin (synonyms);

-- ============================================================================
-- Places
-- ============================================================================

CREATE TABLE IF NOT EXISTS places (
  id serial PRIMARY KEY,
  name text NOT NULL,
  place_type varchar(30),                     -- study_site/peak/valley/watershed/stream/lake/meadow/town/county/state/country/region/trail/named_point/bioregion
  scale varchar(15),                          -- site/local/regional/state/national/continental
  parent_place_id integer REFERENCES places(id) ON DELETE SET NULL,
  ancestor_ids integer[] DEFAULT '{}',        -- denormalized full path for fast "all places in X" queries
  lat double precision,
  lon double precision,
  bounding_box jsonb,                         -- {north, south, east, west}
  elevation_m integer,
  elevation_min_m integer,
  elevation_max_m integer,
  area_km2 numeric,
  habitat_types text[] DEFAULT '{}',
  description text,
  aliases text[] DEFAULT '{}',                -- "RMBL" -> "Rocky Mountain Biological Laboratory"
  external_ids jsonb,                         -- {geonames, osm_relation, gnis, wikidata}
  mention_count integer DEFAULT 0,
  publication_count integer DEFAULT 0,
  embedding vector(1024),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS places_type_idx ON places (place_type);
CREATE INDEX IF NOT EXISTS places_scale_idx ON places (scale);
CREATE INDEX IF NOT EXISTS places_parent_idx ON places (parent_place_id);
CREATE INDEX IF NOT EXISTS places_ancestors_gin ON places USING gin (ancestor_ids);
CREATE INDEX IF NOT EXISTS places_habitat_gin ON places USING gin (habitat_types);
CREATE INDEX IF NOT EXISTS places_aliases_gin ON places USING gin (aliases);
CREATE INDEX IF NOT EXISTS places_publication_count_idx ON places (publication_count DESC);
CREATE INDEX IF NOT EXISTS places_embedding_idx ON places USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- Protocols
-- ============================================================================

CREATE TABLE IF NOT EXISTS protocols (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE,
  category varchar(20),                       -- sampling/measurement/analytical/experimental/observational/computational/laboratory
  subcategory text,
  description text,                           -- 2-3 paragraph synthesis from clusters
  typical_equipment text[] DEFAULT '{}',
  typical_duration text,
  typical_frequency text,
  prerequisites text[] DEFAULT '{}',
  output_measurements text[] DEFAULT '{}',
  standardized boolean DEFAULT false,
  standard_reference text,
  origin_paper_id integer REFERENCES publications(id) ON DELETE SET NULL,
  parent_protocol_id integer REFERENCES protocols(id) ON DELETE SET NULL,
  related_protocol_ids integer[] DEFAULT '{}',
  approved boolean DEFAULT false,             -- curator gate before public display
  mention_count integer DEFAULT 0,
  publication_count integer DEFAULT 0,
  embedding vector(1024),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS protocols_category_idx ON protocols (category);
CREATE INDEX IF NOT EXISTS protocols_approved_idx ON protocols (approved);
CREATE INDEX IF NOT EXISTS protocols_publication_count_idx ON protocols (publication_count DESC);
CREATE INDEX IF NOT EXISTS protocols_equipment_gin ON protocols USING gin (typical_equipment);
CREATE INDEX IF NOT EXISTS protocols_outputs_gin ON protocols USING gin (output_measurements);
CREATE INDEX IF NOT EXISTS protocols_embedding_idx ON protocols USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- Concepts
-- ============================================================================

CREATE TABLE IF NOT EXISTS concepts (
  id serial PRIMARY KEY,
  name text NOT NULL,
  concept_type varchar(20),                   -- theory/hypothesis/process/phenomenon/measurement/metric/framework/model_type
  definition text,
  scope varchar(30),                          -- general_ecology/climate/hydrology/population_ecology/community_ecology/evolution/biogeochemistry/landscape/molecular/methodological
  aliases text[] DEFAULT '{}',
  parent_concept_id integer REFERENCES concepts(id) ON DELETE SET NULL,
  related_concepts jsonb,                     -- [{concept_id, relationship: 'relates_to'|'contrasts_with'|'component_of'|'measured_by'}]
  canonical_reference text,                   -- foundational citation if applicable
  external_ids jsonb,                         -- {wikidata, wikipedia_url, mesh_id}
  mention_count integer DEFAULT 0,
  publication_count integer DEFAULT 0,
  embedding vector(1024),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS concepts_type_idx ON concepts (concept_type);
CREATE INDEX IF NOT EXISTS concepts_scope_idx ON concepts (scope);
CREATE INDEX IF NOT EXISTS concepts_publication_count_idx ON concepts (publication_count DESC);
CREATE INDEX IF NOT EXISTS concepts_aliases_gin ON concepts USING gin (aliases);
CREATE INDEX IF NOT EXISTS concepts_embedding_idx ON concepts USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- entity_mentions: polymorphic linking table
-- Single source of truth for entity -> publication/dataset/document relationships.
-- Used for "papers mentioning species X" queries and for cross-entity joins.
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_mentions (
  id serial PRIMARY KEY,
  entity_type varchar(10) NOT NULL,           -- 'species'|'place'|'protocol'|'concept'
  entity_id integer NOT NULL,
  collection varchar(15) NOT NULL,            -- 'publications'|'datasets'|'documents'
  item_id integer NOT NULL,
  role varchar(30),                           -- e.g., 'study_subject', 'introducing', 'central'
  confidence real NOT NULL DEFAULT 1.0,       -- 1.0=extracted, 0.7-0.9=inferred, 0.4-0.6=fuzzy, 0.1-0.3=ambiguous
  extraction_method varchar(20) NOT NULL,     -- 'vlm'|'text'|'regex'|'keyword'|'manual'
  context text,                               -- short text snippet for provenance
  page_number integer,
  metadata jsonb,                             -- type-specific extras (e.g., chapter for long-form)
  created_at timestamptz DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, collection, item_id, role)
);

CREATE INDEX IF NOT EXISTS entity_mentions_entity_idx ON entity_mentions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS entity_mentions_item_idx ON entity_mentions (collection, item_id);
CREATE INDEX IF NOT EXISTS entity_mentions_type_confidence_idx ON entity_mentions (entity_type, confidence DESC);

-- ============================================================================
-- entity_candidates: raw VLM extraction staging
-- Holds unprocessed VLM output before linking to canonical entities.
-- Each row represents one candidate entity from one source item.
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_candidates (
  id serial PRIMARY KEY,
  entity_type varchar(10) NOT NULL,           -- 'species'|'place'|'protocol'|'concept'
  raw_name text NOT NULL,
  raw_attributes jsonb NOT NULL,              -- full VLM output for this candidate
  source_collection varchar(15) NOT NULL,     -- 'publications'|'datasets'|'documents'
  source_item_id integer NOT NULL,
  resolved_entity_id integer,                 -- null until linker processes it
  confidence real DEFAULT 1.0,
  created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_candidates_unresolved_idx
  ON entity_candidates (entity_type) WHERE resolved_entity_id IS NULL;
CREATE INDEX IF NOT EXISTS entity_candidates_source_idx
  ON entity_candidates (source_collection, source_item_id);
CREATE INDEX IF NOT EXISTS entity_candidates_dedup_idx
  ON entity_candidates (entity_type, source_collection, source_item_id, lower(raw_name));

-- ============================================================================
-- code_repositories: code linked from publications
-- VLM extracts these per paper from "Code Availability" sections.
-- One row per (publication, url) so we can query "all papers with R code on GitHub".
-- ============================================================================

CREATE TABLE IF NOT EXISTS code_repositories (
  id serial PRIMARY KEY,
  publication_id integer NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  url text NOT NULL,
  platform varchar(30),                       -- GitHub/GitLab/Zenodo/CRAN/PyPI/Bitbucket/Figshare/other
  description text,                           -- what the code does
  language varchar(20),                       -- R/Python/MATLAB/Julia/etc
  license varchar(30),                        -- MIT/GPL-3/Apache-2.0/etc, if stated
  extraction_method varchar(20),              -- 'vlm'|'regex'|'manual'
  created_at timestamptz DEFAULT NOW(),
  UNIQUE (publication_id, url)
);

CREATE INDEX IF NOT EXISTS code_repositories_publication_idx ON code_repositories (publication_id);
CREATE INDEX IF NOT EXISTS code_repositories_platform_idx ON code_repositories (platform);
CREATE INDEX IF NOT EXISTS code_repositories_language_idx ON code_repositories (language);

-- ============================================================================
-- data_repositories: data archives linked from publications
-- VLM extracts these per paper from "Data Availability" sections.
-- The linker populates linked_dataset_id when external_doi matches a row in
-- the internal datasets collection, turning external references into internal links.
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_repositories (
  id serial PRIMARY KEY,
  publication_id integer NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  url text NOT NULL,
  platform varchar(30),                       -- Dryad/Zenodo/EDI/USGS/Pangaea/NCBI/Figshare/other
  description text,                           -- what data is available
  external_doi text,                          -- the dataset DOI as cited
  linked_dataset_id integer REFERENCES datasets(id) ON DELETE SET NULL,  -- populated when external_doi matches an internal dataset
  extraction_method varchar(20),              -- 'vlm'|'regex'|'manual'
  created_at timestamptz DEFAULT NOW(),
  UNIQUE (publication_id, url)
);

CREATE INDEX IF NOT EXISTS data_repositories_publication_idx ON data_repositories (publication_id);
CREATE INDEX IF NOT EXISTS data_repositories_platform_idx ON data_repositories (platform);
CREATE INDEX IF NOT EXISTS data_repositories_doi_idx ON data_repositories (external_doi);
CREATE INDEX IF NOT EXISTS data_repositories_linked_dataset_idx ON data_repositories (linked_dataset_id);
