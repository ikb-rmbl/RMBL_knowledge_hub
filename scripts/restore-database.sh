#!/usr/bin/env bash
#
# Restore the database from an S3 backup.
#
# DANGEROUS: Restoring overwrites the target database. The script always
# requires explicit confirmation before destructive operations.
#
# Required environment variables:
#   BACKUP_BUCKET    S3 bucket name (default: rmbl-hub-backups)
#   AWS credentials  Either AWS_PROFILE or env vars
#
# For --target=neon also requires:
#   NEON_DIRECT_URL  Neon connection string
#
# Usage:
#   ./scripts/restore-database.sh --list                       # list available backups
#   ./scripts/restore-database.sh                              # restore latest to local
#   ./scripts/restore-database.sh --backup=<filename>          # specific backup to local
#   ./scripts/restore-database.sh --target=test                # restore latest to a fresh test DB
#   ./scripts/restore-database.sh --target=neon                # restore latest to Neon (DESTRUCTIVE)
#   ./scripts/restore-database.sh --backup=<filename> --target=neon
#
# Targets:
#   local  (default) restores to the local rmbl_knowledge_hub database (DROPS first)
#   test   creates a throwaway database `rmbl_restore_test_<ts>` and restores to it
#   neon   restores to Neon production (requires NEON_DIRECT_URL, double confirmation)

set -euo pipefail

# ----------------------------------------------------------------------------
# Argument parsing
# ----------------------------------------------------------------------------

TARGET="local"
BACKUP=""
LIST_MODE=false
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    --list) LIST_MODE=true ;;
    --backup=*) BACKUP="${arg#--backup=}" ;;
    --target=*) TARGET="${arg#--target=}" ;;
    -y|--yes) ASSUME_YES=true ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

BACKUP_BUCKET="${BACKUP_BUCKET:-rmbl-hub-backups}"

# ----------------------------------------------------------------------------
# List mode: just print what's available
# ----------------------------------------------------------------------------

if [ "$LIST_MODE" = true ]; then
  echo "Available backups in s3://${BACKUP_BUCKET}/database/"
  echo
  aws s3 ls "s3://${BACKUP_BUCKET}/database/" \
    | grep -E 'rmbl-hub-.*\.dump$' \
    | awk '{ printf "  %-50s  %10d bytes  %s %s\n", $4, $3, $1, $2 }'
  echo
  echo "Use:  ./scripts/restore-database.sh --backup=<filename>"
  exit 0
fi

# ----------------------------------------------------------------------------
# Determine which backup to restore
# ----------------------------------------------------------------------------

if [ -z "$BACKUP" ]; then
  BACKUP="latest.dump"
  echo "Backup: latest.dump (use --backup=<filename> to choose a specific one)"
else
  echo "Backup: $BACKUP"
fi

# ----------------------------------------------------------------------------
# Determine target database
# ----------------------------------------------------------------------------

case "$TARGET" in
  local)
    TARGET_URL="postgresql://localhost:5432/rmbl_knowledge_hub"
    TARGET_DB="rmbl_knowledge_hub"
    DROP_TARGET=true
    ;;
  test)
    TS=$(date +%s)
    TARGET_DB="rmbl_restore_test_${TS}"
    TARGET_URL="postgresql://localhost:5432/${TARGET_DB}"
    DROP_TARGET=false  # we create it fresh, don't drop
    ;;
  neon)
    if [ -z "${NEON_DIRECT_URL:-}" ]; then
      # Try to source from .env
      if [ -f "$(dirname "$0")/../.env" ]; then
        NEON_DIRECT_URL=$(grep -E '^NEON_DIRECT_URL=' "$(dirname "$0")/../.env" | cut -d= -f2- | head -1)
      fi
    fi
    if [ -z "${NEON_DIRECT_URL:-}" ]; then
      echo "ERROR: NEON_DIRECT_URL must be set for --target=neon" >&2
      exit 1
    fi
    TARGET_URL="$NEON_DIRECT_URL"
    TARGET_DB="(neon)"
    DROP_TARGET=true
    ;;
  *)
    echo "ERROR: Unknown target '$TARGET' (valid: local, test, neon)" >&2
    exit 1
    ;;
esac

echo "Target: $TARGET ($TARGET_DB)"
echo

# ----------------------------------------------------------------------------
# Confirmation
# ----------------------------------------------------------------------------

if [ "$ASSUME_YES" = false ]; then
  echo "THIS WILL OVERWRITE THE TARGET DATABASE."
  if [ "$TARGET" = "neon" ]; then
    echo
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "WARNING: Restoring to NEON PRODUCTION database"
    echo "All current production data will be replaced with the backup."
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo
    read -p "Type 'restore-neon' to confirm: " confirm
    if [ "$confirm" != "restore-neon" ]; then
      echo "Aborted."
      exit 1
    fi
  else
    read -p "Type 'yes' to continue: " confirm
    if [ "$confirm" != "yes" ]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

# ----------------------------------------------------------------------------
# Download backup from S3
# ----------------------------------------------------------------------------

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

DUMP_PATH="$TMPDIR/restore.dump"

echo
echo "Downloading s3://${BACKUP_BUCKET}/database/${BACKUP} ..."
aws s3 cp "s3://${BACKUP_BUCKET}/database/${BACKUP}" "$DUMP_PATH" --only-show-errors
DUMP_SIZE=$(wc -c < "$DUMP_PATH")
DUMP_MB=$(( DUMP_SIZE / 1024 / 1024 ))
echo "  Downloaded: $DUMP_MB MB"

# Try to fetch the SHA256 sidecar (only for timestamped backups, not 'latest.dump')
if [ "$BACKUP" != "latest.dump" ]; then
  if aws s3 cp "s3://${BACKUP_BUCKET}/database/${BACKUP}.sha256" "${DUMP_PATH}.sha256" --only-show-errors 2>/dev/null; then
    EXPECTED=$(cat "${DUMP_PATH}.sha256")
    if command -v sha256sum > /dev/null 2>&1; then
      ACTUAL=$(sha256sum "$DUMP_PATH" | awk '{print $1}')
    else
      ACTUAL=$(shasum -a 256 "$DUMP_PATH" | awk '{print $1}')
    fi
    if [ "$EXPECTED" = "$ACTUAL" ]; then
      echo "  Checksum verified"
    else
      echo "ERROR: SHA256 mismatch (expected $EXPECTED, got $ACTUAL)" >&2
      exit 1
    fi
  fi
fi

# ----------------------------------------------------------------------------
# Verify dump is readable before touching the target
# ----------------------------------------------------------------------------

TABLE_COUNT=$(pg_restore --list "$DUMP_PATH" | grep -c '^[0-9]*; [0-9]* [0-9]* TABLE ' || true)
echo "  Dump contains $TABLE_COUNT TABLE entries"

if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "ERROR: Dump has too few tables — refusing to restore" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# Prepare target database
# ----------------------------------------------------------------------------

echo
echo "Preparing target database..."

if [ "$TARGET" = "local" ]; then
  # Drop and recreate the local database
  dropdb --if-exists "$TARGET_DB"
  createdb "$TARGET_DB"
  psql "$TARGET_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" > /dev/null
elif [ "$TARGET" = "test" ]; then
  createdb "$TARGET_DB"
  psql "$TARGET_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" > /dev/null
elif [ "$TARGET" = "neon" ]; then
  # Cannot drop/create on Neon — instead drop all schemas + tables in place
  echo "  Dropping public schema on Neon..."
  psql "$TARGET_URL" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  psql "$TARGET_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
fi

# ----------------------------------------------------------------------------
# Restore
# ----------------------------------------------------------------------------

echo
echo "Restoring..."
pg_restore --no-owner --no-acl --exit-on-error -d "$TARGET_URL" "$DUMP_PATH"

# ----------------------------------------------------------------------------
# Verify row counts
# ----------------------------------------------------------------------------

echo
echo "Verifying restore..."
psql "$TARGET_URL" -c "
SELECT
  (SELECT count(*) FROM publications) as publications,
  (SELECT count(*) FROM datasets) as datasets,
  (SELECT count(*) FROM documents) as documents,
  (SELECT count(*) FROM authors) as authors,
  (SELECT count(*) FROM references_cited) as references,
  (SELECT count(*) FROM publications WHERE embedding IS NOT NULL) as embeddings
"

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------

echo
echo "========================================="
echo "Restore complete: $TARGET_DB"
if [ "$TARGET" = "test" ]; then
  echo
  echo "Test database: $TARGET_DB"
  echo "Drop with:  dropdb $TARGET_DB"
fi
echo "========================================="
