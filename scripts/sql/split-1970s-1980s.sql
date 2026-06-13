-- Split the combined 1970s–80s era back into separate 1970s and 1980s eras.
--
-- The combined 20-year era (1970-1990) made the cohort and unique-author
-- counts look like a step-change because the bucket was twice as wide as
-- its neighbors — an artifact of the span, not a real shift in the data.
-- Splitting restores apples-to-apples comparison with the 1991–95 onward
-- buckets (10 years each vs 5 — still a factor of 2 wider, but explicit and
-- consistent with the explicit early-era widths).
--
-- New shape:
--   pre-1950   1900–1949
--   1950s–60s  1950–1969   (unchanged — these decades genuinely lack data
--                           individually so the combination still helps)
--   1970s      1970–1979   ← NEW (split)
--   1980s      1980–1990   ← NEW (extended through 1990 to absorb the
--                           year that the previous combined era held —
--                           keeps the gap closed before the 5-year buckets)
--   1991–95    1991–1995
--   ...        ...
--   2021–25    2021–2025
--
-- Idempotent: re-running has no effect after first application.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/split-1970s-1980s.sql

BEGIN;

-- 1. Drop the combined 1970s–80s era.
DELETE FROM eras WHERE slug = '1970s-80s';

-- 2. Insert the split eras.
INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1970s', '1970s', 1970, 1979, 'calendar',
       'The 1970s. Sample sizes are large enough individually here to stand alone, unlike the combined 1950s–60s bucket.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       3
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1970s');

INSERT INTO eras (name, slug, start_year, end_year, kind, description, parent_era_id, sort_order)
SELECT '1980s', '1980s', 1980, 1990, 'calendar',
       'The 1980s, extended through 1990 to absorb the year that fell between the 1989 boundary and the 1991-start of the 5-year buckets. Mild asymmetry (11 years instead of 10) but avoids losing any 1990 records.',
       (SELECT id FROM eras WHERE slug = '20th-century'),
       4
WHERE NOT EXISTS (SELECT 1 FROM eras WHERE slug = '1980s');

COMMIT;
