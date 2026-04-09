#!/usr/bin/env bash
#
# Verify that the latest database backup in S3 is recent and sane.
# Used by the GitHub Actions workflow as a post-backup smoke check.
# Exits non-zero if the latest backup is missing, too old, or too small.
#
# Required environment variables:
#   BACKUP_BUCKET    S3 bucket name (default: rmbl-hub-backups)
#   AWS credentials  Either AWS_PROFILE or env vars
#
# Usage:
#   AWS_PROFILE=rmbl-backup bash scripts/verify-backup-recency.sh

set -euo pipefail

BACKUP_BUCKET="${BACKUP_BUCKET:-rmbl-hub-backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"      # daily cron + 2h slack
MIN_SIZE_BYTES="${MIN_SIZE_BYTES:-52428800}"  # 50 MB

echo "Verifying latest backup in s3://${BACKUP_BUCKET}/database/"
echo

# ----------------------------------------------------------------------------
# Find the most recent timestamped dump (excludes the 'latest.dump' alias)
# ----------------------------------------------------------------------------

LATEST_LINE=$(aws s3 ls "s3://${BACKUP_BUCKET}/database/" \
  | grep -E 'rmbl-hub-.*\.dump$' \
  | sort \
  | tail -1 || true)

if [ -z "$LATEST_LINE" ]; then
  echo "ERROR: No dump files found in s3://${BACKUP_BUCKET}/database/" >&2
  exit 1
fi

LATEST_DATE=$(echo "$LATEST_LINE" | awk '{print $1}')
LATEST_TIME=$(echo "$LATEST_LINE" | awk '{print $2}')
LATEST_SIZE=$(echo "$LATEST_LINE" | awk '{print $3}')
LATEST_FILE=$(echo "$LATEST_LINE" | awk '{print $4}')

echo "Latest: $LATEST_FILE"
echo "Size:   $LATEST_SIZE bytes"

# ----------------------------------------------------------------------------
# Check size sanity
# ----------------------------------------------------------------------------

if [ "$LATEST_SIZE" -lt "$MIN_SIZE_BYTES" ]; then
  echo "ERROR: Latest backup is suspiciously small ($LATEST_SIZE < $MIN_SIZE_BYTES bytes)" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# Check age — parse the embedded UTC timestamp from the filename.
# Filenames look like: rmbl-hub-2026-04-09T21-18-51Z.dump
# We use the filename timestamp (not aws s3 ls output) to avoid timezone issues
# (aws s3 ls displays times in local timezone with no UTC marker).
# ----------------------------------------------------------------------------

NOW_EPOCH=$(date -u +%s)

# Extract YYYY-MM-DDTHH-MM-SSZ from the filename
TS_PART=$(echo "$LATEST_FILE" | sed -E 's/^rmbl-hub-([0-9T:Z-]+)\.dump$/\1/')
# Convert to a parseable format: 2026-04-09T21-18-51Z -> 2026-04-09 21:18:51
PARSEABLE=$(echo "$TS_PART" | sed -E 's/T([0-9]+)-([0-9]+)-([0-9]+)Z/ \1:\2:\3/')

# Cross-platform date parsing (GNU vs BSD)
if date -u -d "$PARSEABLE" +%s > /dev/null 2>&1; then
  LATEST_EPOCH=$(date -u -d "$PARSEABLE" +%s)
else
  LATEST_EPOCH=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$PARSEABLE" +%s)
fi

AGE_SEC=$(( NOW_EPOCH - LATEST_EPOCH ))
AGE_HOURS=$(( AGE_SEC / 3600 ))
AGE_MIN=$(( (AGE_SEC % 3600) / 60 ))

echo "Age:    ${AGE_HOURS}h ${AGE_MIN}m"

if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  echo "ERROR: Latest backup is $AGE_HOURS hours old (max allowed: $MAX_AGE_HOURS)" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# Check that the matching SHA256 sidecar exists
# ----------------------------------------------------------------------------

if ! aws s3 ls "s3://${BACKUP_BUCKET}/database/${LATEST_FILE}.sha256" > /dev/null 2>&1; then
  echo "WARNING: SHA256 sidecar missing for $LATEST_FILE" >&2
fi

# ----------------------------------------------------------------------------
# Check that the 'latest' alias also exists
# ----------------------------------------------------------------------------

if ! aws s3 ls "s3://${BACKUP_BUCKET}/database/latest.dump" > /dev/null 2>&1; then
  echo "WARNING: latest.dump alias missing" >&2
fi

echo
echo "OK: backup is fresh and large enough"
