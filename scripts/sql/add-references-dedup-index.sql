-- Deduplication index for references_cited table
-- Run on BOTH local and Neon databases.
-- This script:
--   1. Removes existing duplicate rows (keeps oldest of each unique reference)
--   2. Creates a unique index that prevents future duplicates
--
-- Safe to run multiple times — both operations are idempotent.
--
-- Usage:
--   psql rmbl_knowledge_hub < scripts/sql/add-references-dedup-index.sql
--   psql "$NEON_DIRECT_URL" < scripts/sql/add-references-dedup-index.sql

-- Step 1: Remove duplicates (if any)
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY source_publication_id, target_publication_id, target_dataset_id,
                   COALESCE(LOWER(cited_doi), ''), COALESCE(LOWER(cited_title), '')
      ORDER BY id
    ) as rn
  FROM references_cited
)
DELETE FROM references_cited WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: Create unique index (no-op if already exists)
CREATE UNIQUE INDEX IF NOT EXISTS references_cited_dedup_uidx
ON references_cited (
  source_publication_id,
  COALESCE(target_publication_id, 0),
  COALESCE(target_dataset_id, 0),
  COALESCE(LOWER(cited_doi), ''),
  COALESCE(LOWER(cited_title), '')
);
