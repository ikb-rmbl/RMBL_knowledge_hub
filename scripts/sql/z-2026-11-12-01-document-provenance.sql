-- Provenance for documents that arrive with a machine-readable source trail.
--
-- First user: the RMBL legacy-website rescue (github.com/ikb-rmbl/RMBL_metadata_rescue),
-- whose staged records carry `_provenance`: original rmbl.org URL, Wayback capture URL
-- and timestamp, sha256 of the archived bytes, extraction method, date basis/precision,
-- redaction counts, and the rescue pipeline commit. load-to-payload.ts writes it with a
-- post-load UPDATE (like document_type). Payload doesn't manage the column.
--
-- Deploy: psql "$NEON_DIRECT_URL" < scripts/sql/z-2026-11-12-01-document-provenance.sql

ALTER TABLE documents ADD COLUMN IF NOT EXISTS provenance jsonb;

CREATE INDEX IF NOT EXISTS documents_provenance_discovery_method_idx
  ON documents ((provenance ->> 'discoveryMethod'));
