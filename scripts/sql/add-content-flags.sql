-- Community content flags for curation.
-- Anonymous users can flag items for review by admins.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-content-flags.sql

CREATE TABLE IF NOT EXISTS content_flags (
  id serial PRIMARY KEY,
  -- What's being flagged (polymorphic)
  collection varchar(20) NOT NULL,
  item_id integer NOT NULL,
  item_title text,
  -- Flag details
  reason varchar(30) NOT NULL,
  description text,
  suggestion text,
  -- Reporter info
  reporter_email varchar(255),
  reporter_ip varchar(45),
  -- Status tracking
  status varchar(15) NOT NULL DEFAULT 'open',
  resolution_notes text,
  resolved_by integer,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_flags_status ON content_flags(status);
CREATE INDEX IF NOT EXISTS idx_content_flags_collection ON content_flags(collection, item_id);
CREATE INDEX IF NOT EXISTS idx_content_flags_created ON content_flags(created_at DESC);
