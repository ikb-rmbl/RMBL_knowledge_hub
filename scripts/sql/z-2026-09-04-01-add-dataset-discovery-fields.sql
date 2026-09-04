-- Dataset discovery fields (datasets browse Tier 2 backfills).
-- gsd: ground sample distance in meters for gridded products (SDP STAC).
-- keywords: measurement/topic keywords harvested from EML <keyword> elements
-- (plus attributeList names where present — rare on ESS-DIVE). Custom SQL
-- columns outside the Payload schema, like documents.document_type.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS gsd real;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS keywords text[];
CREATE INDEX IF NOT EXISTS datasets_keywords_idx ON datasets USING gin(keywords);
