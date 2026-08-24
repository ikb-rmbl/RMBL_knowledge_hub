-- One-shot data migration: stamp sdp_catalog_id on legacy SDP dataset rows
-- whose old data-catalog URLs can't be matched automatically by
-- sync-sdp-stac.ts (the STAC collections' representative assets are yearly
-- per-date files, so exact file-stem matching fails; several products were
-- also retitled). Crosswalk verified file-by-file against STAC item assets
-- on 2026-08-24. Keyed on download_url (identical on local + Neon) and
-- guarded by sdp_catalog_id IS NULL, so re-runs are no-ops.
--
-- Deliberately unmapped: the 1m Upper Gunnison DEM (UG_dem_1m) — retired
-- from the SDP with no STAC successor (only the 3m R3D009 remains).

UPDATE datasets SET sdp_catalog_id = m.catalog_id
FROM (VALUES
  ('%/UG_snow_persistence_yearly_%',            'R6D007'),
  ('%/UG_snow_onset_yearly_%',                  'R6D008'),
  ('%/UG_snow_length_yearly_%',                 'R4D003'),
  ('%/UG_airtemp_2m_tmax_daily_%',              'R4D004'),
  ('%/UG_airtemp_2m_tmin_daily_%',              'R4D005'),
  ('%/UG_airtemp_2m_tavg_monthly_%',            'R4D006'),
  ('%/UG_airtemp_2m_tmax_monthly_%',            'R4D007'),
  ('%/UG_airtemp_2m_tmin_monthly_%',            'R4D008'),
  ('%/UG_airtemp_FDD_all_yearly_%',             'R4D009'),
  ('%/UG_airtemp_FDD_early_yearly_%',           'R4D010'),
  ('%/UG_airtemp_FDD_late_yearly_%',            'R4D011'),
  ('%/UG_airtemp_GDD_all_yearly_%',             'R4D012'),
  ('%/UG_airtemp_GDD_early_yearly_%',           'R4D013'),
  ('%/UG_airtemp_GDD_late_yearly_%',            'R4D014'),
  ('%/UG_airtemp_snowfree_FDD_all_yearly_%',    'R4D015'),
  ('%/UG_airtemp_snowfree_FDD_early_yearly_%',  'R4D016'),
  ('%/UG_airtemp_snowfree_FDD_late_yearly_%',   'R4D017'),
  ('%/UG_airtemp_snowfree_FDD_snow60_yearly_%', 'R4D018'),
  ('%/UG_airtemp_snowfree_GDD_all_yearly_%',    'R4D019'),
  ('%/UG_airtemp_snowfree_GDD_early_yearly_%',  'R4D020'),
  ('%/UG_airtemp_snowfree_GDD_late_yearly_%',   'R4D021'),
  ('%/UG_airtemp_snowfree_GDD_snow60_yearly_%', 'R4D022')
) AS m(url_pattern, catalog_id)
WHERE datasets.sdp_catalog_id IS NULL
  AND datasets.download_url ILIKE m.url_pattern;

-- The two styled snow-depth basemaps share a download_url in the legacy data
-- (the 2019 row erroneously points at the 2018 file), so key these on title.
-- sync-sdp-stac.ts corrects the 2019 row's URL on its next run.
UPDATE datasets SET sdp_catalog_id = m.catalog_id
FROM (VALUES
  ('Styled 2018 snow depth basemap of the Upper East River%', 'BM008'),
  ('Styled 2019 snow depth basemap of the Upper East River%', 'BM009')
) AS m(title_pattern, catalog_id)
WHERE datasets.sdp_catalog_id IS NULL
  AND datasets.title ILIKE m.title_pattern;
