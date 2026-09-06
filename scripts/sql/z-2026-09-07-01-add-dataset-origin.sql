-- Dataset provenance flag: is this RMBL/Gunnison-Basin-produced data ('yes'),
-- an external reference dataset RMBL researchers use ('no'), or unreviewed
-- (NULL = triage queue). TEXT tri-state, same rationale as
-- publications.rmbl_research (checkbox saves must not drain the NULL queue).
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS rmbl_origin text;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS rmbl_origin_score real;
