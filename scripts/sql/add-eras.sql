-- Eras collection: named time spans for temporal analysis.
--
-- Phase 1 ships calendar eras (pre-1950 + decades + century parents) whose
-- membership is *computed from the year on each content row* — there are
-- no rows in era_members for calendar eras. The era_members table is
-- provisioned now so that future curated or theme-specific eras (kind
-- 'curated' / 'theme') can record explicit membership without a schema
-- migration.
--
-- Idempotent: CREATE IF NOT EXISTS and seed via WHERE NOT EXISTS pattern.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-eras.sql

CREATE TABLE IF NOT EXISTS eras (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  start_year      integer NOT NULL,
  end_year        integer NOT NULL,
  -- 'calendar' for auto-decades/centuries; 'curated' / 'theme' for future
  -- explicit-membership eras (member rows live in era_members).
  kind            text NOT NULL DEFAULT 'calendar',
  description     text,
  parent_era_id   integer REFERENCES eras(id) ON DELETE SET NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  curated_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eras_year_range_chk CHECK (end_year >= start_year),
  CONSTRAINT eras_kind_chk CHECK (kind IN ('calendar','curated','theme'))
);

CREATE INDEX IF NOT EXISTS idx_eras_kind ON eras(kind);
CREATE INDEX IF NOT EXISTS idx_eras_year_range ON eras(start_year, end_year);
CREATE INDEX IF NOT EXISTS idx_eras_parent ON eras(parent_era_id);
CREATE INDEX IF NOT EXISTS idx_eras_sort ON eras(sort_order);

-- Explicit membership for non-calendar eras. Unused by Phase 1 (calendar
-- eras compute from year), but provisioned now so the future hookup is a
-- data write rather than a migration.
CREATE TABLE IF NOT EXISTS era_members (
  id          serial PRIMARY KEY,
  era_id      integer NOT NULL REFERENCES eras(id) ON DELETE CASCADE,
  collection  text NOT NULL,
  item_id     integer NOT NULL,
  added_by    integer,                 -- users.id; not FK'd to keep this independent of Payload users schema
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT era_members_collection_chk
    CHECK (collection IN ('publications','documents','datasets','stories')),
  CONSTRAINT era_members_unique UNIQUE (era_id, collection, item_id)
);

CREATE INDEX IF NOT EXISTS idx_era_members_era ON era_members(era_id);
CREATE INDEX IF NOT EXISTS idx_era_members_target ON era_members(collection, item_id);

-- --------------------------------------------------------------------------
-- Seed: calendar eras (idempotent via WHERE NOT EXISTS).
-- Centuries first so the decades can reference them as parents.
-- --------------------------------------------------------------------------

INSERT INTO eras (name, slug, start_year, end_year, kind, description, sort_order)
SELECT '20th Century', '20th-century', 1900, 1999, 'calendar',
       'Calendar parent containing the pre-1950 bucket and the 1950s through 1990s decades. Useful for coarse 20th- vs 21st-century comparisons.',
       100
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '20th-century');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, sort_order)
SELECT '21st Century', '21st-century', 2000, 2099, 'calendar',
       'Calendar parent containing the 2000s, 2010s, and 2020s decades.',
       200
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '21st-century');

-- Decade buckets, parented to the appropriate century.
INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT 'Pre-1950', 'pre-1950', 1900, 1949, 'calendar',
       'Early 20th-century activity in the Gunnison Basin. A single bucket because per-decade sample sizes before 1950 are too thin for stable comparison (~270 publications spread across five decades).',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       1
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = 'pre-1950');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1950s', '1950s', 1950, 1959, 'calendar',
       'Research and community activity in the 1950s.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       2
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1950s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1960s', '1960s', 1960, 1969, 'calendar',
       'Research and community activity in the 1960s.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       3
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1960s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1970s', '1970s', 1970, 1979, 'calendar',
       'Research and community activity in the 1970s.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       4
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1970s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1980s', '1980s', 1980, 1989, 'calendar',
       'Research and community activity in the 1980s.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       5
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1980s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1990s', '1990s', 1990, 1999, 'calendar',
       'Research and community activity in the 1990s.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       6
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1990s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2000s', '2000s', 2000, 2009, 'calendar',
       'Research and community activity in the 2000s.',
       (SELECT id FROM eras WHERE slug = '21st-century'),
       7
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2000s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2010s', '2010s', 2010, 2019, 'calendar',
       'Research and community activity in the 2010s.',
       (SELECT id FROM eras WHERE slug = '21st-century'),
       8
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2010s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2020s', '2020s', 2020, 2029, 'calendar',
       'Research and community activity in the 2020s.',
       (SELECT id FROM eras WHERE slug = '21st-century'),
       9
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2020s');
