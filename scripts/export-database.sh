#!/bin/bash
#
# Export local database for sharing with other developers.
# Creates a dump file that can be restored on another machine.
#
# The dump excludes:
#   - users table (contains hashed passwords)
#   - payload_preferences (personal admin settings)
#
# Usage:
#   ./scripts/export-database.sh                    # exports to scripts/output/
#   ./scripts/export-database.sh /path/to/output    # exports to custom path
#

set -e

OUTPUT_DIR="${1:-scripts/output}"
TIMESTAMP=$(date +%Y%m%d)
DUMP_FILE="$OUTPUT_DIR/rmbl_knowledge_hub_${TIMESTAMP}.dump"

echo "RMBL Knowledge Hub — Database Export"
echo "====================================="
echo ""

# Schema (everything)
echo "Exporting schema..."
pg_dump --schema-only --no-owner --no-acl rmbl_knowledge_hub > "$OUTPUT_DIR/schema.sql"
echo "  ✓ Schema saved to $OUTPUT_DIR/schema.sql"

# Data (excluding sensitive tables)
echo "Exporting data (this may take a few minutes)..."
pg_dump \
  --data-only \
  --format=custom \
  --no-owner \
  --no-acl \
  --exclude-table=users \
  --exclude-table=payload_preferences \
  --exclude-table=payload_preferences_rels \
  rmbl_knowledge_hub > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "  ✓ Data saved to $DUMP_FILE ($SIZE)"

echo ""
echo "To restore on another machine:"
echo "  createdb rmbl_knowledge_hub"
echo "  psql rmbl_knowledge_hub -c 'CREATE EXTENSION IF NOT EXISTS vector;'"
echo "  psql rmbl_knowledge_hub < $OUTPUT_DIR/schema.sql"
echo "  pg_restore -d rmbl_knowledge_hub --data-only --no-owner $DUMP_FILE"
echo "  # Then start the dev server to create the admin user"
echo ""
