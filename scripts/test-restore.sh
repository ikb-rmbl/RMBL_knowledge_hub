#!/usr/bin/env bash
#
# Monthly restore drill — verifies the latest backup actually works.
#
# Downloads the latest backup from S3, restores to a throwaway test database,
# runs sanity queries, and cleans up. Failure exits non-zero, suitable for
# wrapping in a calendar reminder or future cron job.
#
# Required environment variables:
#   BACKUP_BUCKET    S3 bucket name (default: rmbl-hub-backups)
#   AWS credentials  Either AWS_PROFILE or env vars
#
# Usage:
#   AWS_PROFILE=rmbl-backup bash scripts/test-restore.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "RMBL Knowledge Hub — Monthly Restore Drill"
echo "=========================================="
echo

# Run the restore in test mode with auto-confirm
bash "$SCRIPT_DIR/restore-database.sh" --target=test --yes

# Find the test database that was just created
TEST_DB=$(psql -lqt | awk '{print $1}' | grep '^rmbl_restore_test_' | sort | tail -1)

if [ -z "$TEST_DB" ]; then
  echo "ERROR: could not find the test database after restore" >&2
  exit 1
fi

echo
echo "Running additional sanity checks on $TEST_DB..."
echo

# Sample query that exercises pgvector similarity (proves the extension restored)
psql "postgresql://localhost:5432/${TEST_DB}" -c "
SELECT id, LEFT(title, 60) as title
FROM publications
WHERE embedding IS NOT NULL
ORDER BY embedding <=> (
  SELECT embedding FROM publications
  WHERE embedding IS NOT NULL
  ORDER BY id LIMIT 1
)
LIMIT 5;
"

# Sample reference network query
psql "postgresql://localhost:5432/${TEST_DB}" -c "
SELECT count(*) as internal_links
FROM references_cited
WHERE target_publication_id IS NOT NULL;
"

# Cleanup
echo
echo "Cleaning up test database $TEST_DB..."
dropdb "$TEST_DB"

echo
echo "=========================================="
echo "Restore drill PASSED"
echo "=========================================="
