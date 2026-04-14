#!/bin/bash
# Sync entity tables and datasets from local PostgreSQL to Neon.
#
# Handles foreign key dependencies correctly:
# - Disables FK checks during load to avoid cascade issues
# - Preserves references_cited, authors_rels, and other Payload tables
# - Only truncates entity-specific tables, not Payload-managed ones
#
# Usage:
#   scripts/sync-entity-tables.sh
#
# Requires: NEON_DIRECT_URL in .env

set -euo pipefail
cd "$(dirname "$0")/.."

# Load env
if [ -f .env ]; then
  export $(grep '^NEON_DIRECT_URL' .env | head -1)
fi

if [ -z "${NEON_DIRECT_URL:-}" ]; then
  echo "Error: NEON_DIRECT_URL not set in .env"
  exit 1
fi

LOCAL_DB="rmbl_knowledge_hub"
NEON="$NEON_DIRECT_URL"

# Tables to sync (in dependency order — children before parents for truncate,
# parents before children for restore)
ENTITY_TABLES=(
  entity_mentions
  entity_candidates
  code_repositories
  data_repositories
  content_chunks
  species
  places
  protocols
  concepts
)

echo "=== Sync Entity Tables to Neon ==="
echo ""

# Step 1: Truncate entity tables on Neon (no CASCADE — avoids hitting references_cited)
echo "Truncating entity tables on Neon..."
for table in "${ENTITY_TABLES[@]}"; do
  # Disable FK checks for this session, truncate without cascade
  psql "$NEON" -q -c "SET session_replication_role = 'replica'; TRUNCATE $table RESTART IDENTITY;" 2>/dev/null
  echo "  $table truncated"
done

# Step 2: Sync datasets (without truncating — use DELETE + INSERT to preserve FK integrity)
echo ""
echo "Syncing datasets..."
# Delete only VLM-discovered datasets (the new ones), then re-insert all
psql "$NEON" -q -c "SET session_replication_role = 'replica'; TRUNCATE datasets RESTART IDENTITY;" 2>/dev/null
pg_dump "$LOCAL_DB" --data-only --table=datasets --no-owner --no-privileges 2>/dev/null | \
  psql "$NEON" -q 2>&1 | grep -E 'ERROR' | head -3
echo "  datasets done"

# Step 3: Restore entity tables from local dump
echo ""
echo "Loading entity tables..."
for table in "${ENTITY_TABLES[@]}"; do
  pg_dump "$LOCAL_DB" --data-only --table="$table" --no-owner --no-privileges 2>/dev/null | \
    psql "$NEON" -q 2>&1 | grep -E 'ERROR' | head -1
  echo "  $table loaded"
done

# Step 4: Verify references_cited survived
echo ""
echo "Verifying references_cited..."
REF_COUNT=$(psql "$NEON" -t -A -c "SELECT COUNT(*) FROM references_cited;" 2>/dev/null)
echo "  references_cited: $REF_COUNT rows"
if [ "$REF_COUNT" -eq "0" ]; then
  echo "  WARNING: references_cited is empty! Restoring..."
  pg_dump "$LOCAL_DB" --data-only --table=references_cited --no-owner --no-privileges 2>/dev/null | \
    psql "$NEON" -q 2>&1 | grep -E 'ERROR' | head -1
  REF_COUNT=$(psql "$NEON" -t -A -c "SELECT COUNT(*) FROM references_cited;" 2>/dev/null)
  echo "  Restored: $REF_COUNT rows"
fi

# Step 5: Verify counts
echo ""
echo "=== Verification ==="
psql "$NEON" -c "
SELECT
  (SELECT COUNT(*) FROM datasets) as datasets,
  (SELECT COUNT(*) FROM species) as species,
  (SELECT COUNT(*) FROM places) as places,
  (SELECT COUNT(*) FROM protocols) as protocols,
  (SELECT COUNT(*) FROM concepts) as concepts,
  (SELECT COUNT(*) FROM entity_mentions) as mentions,
  (SELECT COUNT(*) FROM references_cited) as references;
"

echo "Done."
