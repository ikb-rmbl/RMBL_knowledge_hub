-- One-shot merge of the fragmented yellow-bellied marmot species rows into
-- the canonical Marmota flaviventris (id 9236).
--
-- Background: entity extraction created six species rows for the same
-- yellow-bellied marmot taxon plus one separate Marmota monax (woodchuck —
-- a legitimate different species, NOT merged here). See
-- ~/.claude/projects/-Users-ian-code-RMBL-knowledge-hub/memory/ for context.
--
-- Idempotent: re-running is a no-op (the rows being merged FROM are gone).

BEGIN;

-- Step 1. Re-point entity_mentions. The unique constraint forbids duplicate
-- (entity_type, entity_id, collection, item_id, role) tuples, so first
-- delete any rows whose target tuple already exists on 9236, then UPDATE
-- the rest.
DELETE FROM entity_mentions src
WHERE src.entity_type = 'species'
  AND src.entity_id IN (9105, 9187, 11177, 11598)
  AND EXISTS (
    SELECT 1 FROM entity_mentions dst
    WHERE dst.entity_type = 'species' AND dst.entity_id = 9236
      AND dst.collection = src.collection
      AND dst.item_id = src.item_id
      AND dst.role IS NOT DISTINCT FROM src.role
  );

UPDATE entity_mentions
SET entity_id = 9236
WHERE entity_type = 'species' AND entity_id IN (9105, 9187, 11177, 11598);

-- Step 2. Fold the source rows' common_names + synonyms into 9236 so the
-- backfill step matches on every alias.
UPDATE species
SET common_names = (
  SELECT array_agg(DISTINCT cn) FROM (
    SELECT unnest(common_names) AS cn FROM species WHERE id IN (9236, 9105, 9187, 11177, 11598)
  ) merged
  WHERE cn IS NOT NULL AND cn <> ''
),
synonyms = (
  SELECT array_agg(DISTINCT s) FROM (
    SELECT unnest(synonyms) AS s FROM species WHERE id IN (9236, 9105, 9187, 11177, 11598) AND synonyms IS NOT NULL
    UNION
    SELECT canonical_name FROM species WHERE id IN (9105, 9187, 11177, 11598)
  ) merged
  WHERE s IS NOT NULL AND s <> ''
)
WHERE id = 9236;

-- Step 3. Delete the fragments. payload_locked_documents_rels CASCADEs,
-- species.parent_taxon_id SET NULLs.
DELETE FROM species WHERE id IN (9105, 9187, 11177, 11598);

-- Step 4. Recompute counts on the canonical row from the merged entity_mentions.
UPDATE species s SET
  mention_count = (SELECT count(*)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id),
  publication_count = (SELECT count(DISTINCT item_id)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id AND collection = 'publications')
WHERE s.id = 9236;

COMMIT;

-- Verification (run separately if you want to inspect):
-- SELECT id, canonical_name, mention_count, publication_count, common_names, synonyms FROM species WHERE id = 9236;
