#!/usr/bin/env bash
#
# Database backup to S3
#
# Dumps the Neon (or local) PostgreSQL database to a custom-format pg_dump
# file, computes a SHA256 checksum, and uploads to S3 with server-side
# encryption. Also uploads a schema-only dump for diff-based audit.
#
# Required environment variables:
#   NEON_DIRECT_URL  PostgreSQL connection string (used by pg_dump)
#                    Falls back to DATABASE_URL if not set.
#   BACKUP_BUCKET    S3 bucket name (default: rmbl-hub-backups)
#   AWS credentials  Either AWS_PROFILE set to a valid profile, or
#                    AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars
#                    (CI uses env vars; local should use AWS_PROFILE=rmbl-backup)
#
# Usage:
#   AWS_PROFILE=rmbl-backup bash scripts/backup-database.sh
#   (or set NEON_DIRECT_URL inline if you want to back up production)

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

# Source the database URL — prefer Neon direct URL, fall back to local
DB_URL="${NEON_DIRECT_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  # Try to source from .env in the repo
  if [ -f "$(dirname "$0")/../.env" ]; then
    DB_URL=$(grep -E '^NEON_DIRECT_URL=' "$(dirname "$0")/../.env" | cut -d= -f2- | head -1)
    if [ -z "$DB_URL" ]; then
      DB_URL=$(grep -E '^DATABASE_URL=' "$(dirname "$0")/../.env" | cut -d= -f2- | head -1)
    fi
  fi
fi

if [ -z "$DB_URL" ]; then
  echo "ERROR: NEON_DIRECT_URL or DATABASE_URL must be set" >&2
  exit 1
fi

BACKUP_BUCKET="${BACKUP_BUCKET:-rmbl-hub-backups}"

# ----------------------------------------------------------------------------
# Setup
# ----------------------------------------------------------------------------

DATE=$(date -u +%Y-%m-%dT%H-%M-%SZ)
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

DUMP_FILE="$TMPDIR/rmbl-hub-${DATE}.dump"
SCHEMA_FILE="$TMPDIR/rmbl-hub-${DATE}-schema.sql"
CHECKSUM_FILE="${DUMP_FILE}.sha256"

echo "RMBL Knowledge Hub — Database Backup"
echo "===================================="
echo "Timestamp: $DATE"
echo "Bucket: s3://$BACKUP_BUCKET"
echo

# ----------------------------------------------------------------------------
# 1. Schema-only dump (for diff-based audit)
# ----------------------------------------------------------------------------

echo "Step 1: Dumping schema..."
pg_dump --schema-only --no-owner --no-acl "$DB_URL" > "$SCHEMA_FILE"
SCHEMA_SIZE=$(wc -c < "$SCHEMA_FILE")
echo "  Schema dump: $SCHEMA_SIZE bytes"

# ----------------------------------------------------------------------------
# 2. Full custom-format dump (data + schema)
# ----------------------------------------------------------------------------

echo
echo "Step 2: Dumping full database (custom format)..."
pg_dump -Fc --no-owner --no-acl "$DB_URL" -f "$DUMP_FILE"
DUMP_SIZE=$(wc -c < "$DUMP_FILE")
DUMP_MB=$(( DUMP_SIZE / 1024 / 1024 ))
echo "  Dump size: $DUMP_SIZE bytes ($DUMP_MB MB)"

# Sanity check: a real dump should be at least a few MB
if [ "$DUMP_SIZE" -lt 1048576 ]; then
  echo "ERROR: Dump file is suspiciously small ($DUMP_SIZE bytes)" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# 3. Verify dump is readable
# ----------------------------------------------------------------------------

echo
echo "Step 3: Verifying dump..."
TABLE_COUNT=$(pg_restore --list "$DUMP_FILE" | grep -c '^[0-9]*; [0-9]* [0-9]* TABLE ' || true)
echo "  Dump contains $TABLE_COUNT TABLE entries"

if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "ERROR: Dump has too few tables ($TABLE_COUNT) — likely incomplete" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# 4. SHA256 checksum
# ----------------------------------------------------------------------------

echo
echo "Step 4: Computing checksum..."
if command -v sha256sum > /dev/null 2>&1; then
  sha256sum "$DUMP_FILE" | awk '{print $1}' > "$CHECKSUM_FILE"
else
  # macOS uses shasum
  shasum -a 256 "$DUMP_FILE" | awk '{print $1}' > "$CHECKSUM_FILE"
fi
echo "  SHA256: $(cat "$CHECKSUM_FILE")"

# ----------------------------------------------------------------------------
# 5. Upload to S3
# ----------------------------------------------------------------------------

echo
echo "Step 5: Uploading to S3..."

DUMP_BASENAME=$(basename "$DUMP_FILE")
SCHEMA_BASENAME=$(basename "$SCHEMA_FILE")

aws s3 cp "$DUMP_FILE" "s3://${BACKUP_BUCKET}/database/${DUMP_BASENAME}" \
  --storage-class STANDARD \
  --sse AES256 \
  --only-show-errors

aws s3 cp "$CHECKSUM_FILE" "s3://${BACKUP_BUCKET}/database/${DUMP_BASENAME}.sha256" \
  --storage-class STANDARD \
  --sse AES256 \
  --only-show-errors

aws s3 cp "$SCHEMA_FILE" "s3://${BACKUP_BUCKET}/schema/${SCHEMA_BASENAME}" \
  --storage-class STANDARD \
  --sse AES256 \
  --only-show-errors

# Also upload as 'latest' alias for easy retrieval by restore scripts
aws s3 cp "$DUMP_FILE" "s3://${BACKUP_BUCKET}/database/latest.dump" \
  --storage-class STANDARD \
  --sse AES256 \
  --metadata "actual-key=${DUMP_BASENAME},timestamp=${DATE},sha256=$(cat "$CHECKSUM_FILE")" \
  --only-show-errors

echo "  Uploaded:"
echo "    s3://${BACKUP_BUCKET}/database/${DUMP_BASENAME}"
echo "    s3://${BACKUP_BUCKET}/database/${DUMP_BASENAME}.sha256"
echo "    s3://${BACKUP_BUCKET}/schema/${SCHEMA_BASENAME}"
echo "    s3://${BACKUP_BUCKET}/database/latest.dump (alias)"

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------

echo
echo "========================================="
echo "Backup complete: $DUMP_BASENAME"
echo "Size: $DUMP_MB MB ($TABLE_COUNT tables)"
echo "========================================="
