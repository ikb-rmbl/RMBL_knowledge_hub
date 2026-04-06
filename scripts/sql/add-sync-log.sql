-- Sync state tracking table
-- Run on BOTH local and Neon databases
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-sync-log.sql
--   psql "$NEON_DIRECT_URL" < scripts/sql/add-sync-log.sql

CREATE TABLE IF NOT EXISTS sync_log (
  id serial PRIMARY KEY,
  sync_direction varchar(10) NOT NULL,   -- 'pull', 'push'
  collection varchar(30) NOT NULL,
  records_pulled integer DEFAULT 0,
  records_pushed integer DEFAULT 0,
  records_skipped integer DEFAULT 0,
  conflicts integer DEFAULT 0,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_sync_timestamp timestamptz        -- high-water mark for next sync
);

CREATE INDEX IF NOT EXISTS sync_log_collection_idx ON sync_log (collection);
CREATE INDEX IF NOT EXISTS sync_log_direction_idx ON sync_log (sync_direction);
