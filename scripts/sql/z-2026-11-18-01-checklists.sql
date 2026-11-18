-- Species checklists rescued from the legacy rmbl.org website (load-checklists.ts).
--
--   checklists          one per list (Lohr's bird checklist, Buck & Frase's plant list, …)
--   checklist_editions  one per edition; a list re-hosted on several site versions
--                       is one edition with several copies (source_ids)
--   checklist_entries   one per taxon line of an edition, as written, with the
--                       species it resolves to
--
-- Copies are recorded as documents.provenance->>'sourceId' values, not document
-- ids: ids differ between local and Neon. Checklist links deliberately do NOT
-- go into entity_mentions — a list naming 800 plants would make them all
-- co-occur in the knowledge graph.

CREATE TABLE IF NOT EXISTS checklists (
  id serial PRIMARY KEY,
  list_key text NOT NULL UNIQUE,          -- rescue list_id, e.g. 'birds-lohr'
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  taxon_group text NOT NULL,
  compiler text,
  area text,                              -- 'Gothic area', 'Northern Gunnison Basin'
  description text,
  legend jsonb NOT NULL DEFAULT '{}',    -- status/flag codes as the list defines them
  kind text NOT NULL DEFAULT 'checklist', -- checklist | identification_key
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_editions (
  id serial PRIMARY KEY,
  checklist_id int NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  label text NOT NULL,                    -- 'June 1996', '3rd edition (June 2007)'
  year int,
  taxonomy text,                          -- 'Harrington (1954)'
  source_ids text[] NOT NULL DEFAULT '{}',
  entries_source_id text,                 -- the copy the entries were parsed from
  notes text,
  UNIQUE (checklist_id, label)
);

CREATE TABLE IF NOT EXISTS checklist_entries (
  id serial PRIMARY KEY,
  edition_id int NOT NULL REFERENCES checklist_editions(id) ON DELETE CASCADE,
  position int NOT NULL,                  -- order within the edition
  line_no int NOT NULL,                   -- source line (a multi-column field card puts several taxa on one line)
  higher_group text,
  family text,
  group_heading text,
  verbatim_name text NOT NULL,            -- scientific name as written, else common name
  authority text,
  common_name text,
  status_codes text,
  remarks text,
  details jsonb NOT NULL DEFAULT '{}',    -- Taylor's records: regions, elevations, flags, synonymy
  species_id int REFERENCES species(id) ON DELETE SET NULL,
  match_method text,                      -- exact | gbif_accepted | gbif_synonym | gbif_common_name | manual | created | unresolved
  match_detail jsonb NOT NULL DEFAULT '{}',
  UNIQUE (edition_id, position)
);

CREATE INDEX IF NOT EXISTS checklist_entries_species_idx ON checklist_entries (species_id);
CREATE INDEX IF NOT EXISTS checklist_entries_edition_idx ON checklist_entries (edition_id);

-- For databases that applied the first draft of this file (no legend column).
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS legend jsonb NOT NULL DEFAULT '{}';
