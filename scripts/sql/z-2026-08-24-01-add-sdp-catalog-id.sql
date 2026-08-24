-- SDP STAC sync: stable product key for datasets sourced from the RMBL
-- Spatial Data Platform STAC catalog (rmbl:catalog_id, e.g. R6D004).
-- Titles and file URLs both change across catalog releases; this is the
-- only identifier that survives, so sync-sdp-stac.ts upserts on it.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS sdp_catalog_id varchar;
CREATE UNIQUE INDEX IF NOT EXISTS datasets_sdp_catalog_id_idx
  ON datasets (sdp_catalog_id) WHERE sdp_catalog_id IS NOT NULL;
