-- Reshape eras to varied widths matching corpus density.
--
-- Original eras (from add-eras.sql) were evenly-spaced 10-year decades
-- 1950s–2020s. That left the 2020s as a half-finished decade and the
-- thin 1950s–1980s decades with unstable per-era diversity estimates.
--
-- New shape:
--   pre-1950   1900–1949   (unchanged)
--   1950s–60s  1950–1969   combined 20 years
--   1970s–80s  1970–1990   combined 21 years (absorbs 1990 so no gap
--                          before the 5-year buckets that start at 1991)
--   1991–95    1991–1995
--   1996–2000  1996–2000
--   2001–05    2001–2005
--   2006–10    2006–2010
--   2011–15    2011–2015
--   2016–20    2016–2020
--   2021–25    2021–2025
--
-- Idempotent: DELETE removes rows by slug, INSERT uses WHERE NOT EXISTS.
-- Runs after add-eras.sql when sync:schema applies migrations alphabetically;
-- if add-eras.sql re-inserts the old decade rows on a fresh apply,
-- reshape-eras.sql removes them again and the end state is the same.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/reshape-eras.sql

BEGIN;

-- 1. Drop the old decade eras (1950s–2020s).
DELETE FROM eras
 WHERE slug IN ('1950s', '1960s', '1970s', '1980s',
                '1990s', '2000s', '2010s', '2020s');

-- 2. Insert the new combined-decade buckets at the early end.
INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1950s–60s', '1950s-60s', 1950, 1969, 'calendar',
       'Combined 1950s and 1960s. Per-decade samples are too thin individually to support stable diversity estimates, so they are merged here.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       2
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1950s-60s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1970s–80s', '1970s-80s', 1970, 1990, 'calendar',
       'Combined 1970s and 1980s, extended through 1990 to avoid a single-year gap before the 5-year buckets that begin at 1991.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       4
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1970s-80s');

-- 3. Five-year buckets from 1991 through 2025.
INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1991–95', '1991-95', 1991, 1995, 'calendar', 'Five-year window: 1991–1995.',
       (SELECT id FROM eras WHERE slug = '20th-century'), 5
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1991-95');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1996–2000', '1996-2000', 1996, 2000, 'calendar', 'Five-year window: 1996–2000.',
       (SELECT id FROM eras WHERE slug = '20th-century'), 6
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1996-2000');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2001–05', '2001-05', 2001, 2005, 'calendar', 'Five-year window: 2001–2005.',
       (SELECT id FROM eras WHERE slug = '21st-century'), 7
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2001-05');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2006–10', '2006-10', 2006, 2010, 'calendar', 'Five-year window: 2006–2010.',
       (SELECT id FROM eras WHERE slug = '21st-century'), 8
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2006-10');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2011–15', '2011-15', 2011, 2015, 'calendar', 'Five-year window: 2011–2015.',
       (SELECT id FROM eras WHERE slug = '21st-century'), 9
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2011-15');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2016–20', '2016-20', 2016, 2020, 'calendar', 'Five-year window: 2016–2020.',
       (SELECT id FROM eras WHERE slug = '21st-century'), 10
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2016-20');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '2021–25', '2021-25', 2021, 2025, 'calendar', 'Five-year window: 2021–2025.',
       (SELECT id FROM eras WHERE slug = '21st-century'), 11
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '2021-25');

COMMIT;
