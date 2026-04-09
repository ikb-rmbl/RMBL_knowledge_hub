#!/usr/bin/env bash
#
# PDF backup to S3
#
# Incrementally syncs scripts/output/pdf-staging/ to a private S3 bucket.
# Excludes extracted .txt files (they live in the database) and the
# manual/processed/ breadcrumb directory. Idempotent — only uploads new
# or changed files.
#
# Required environment variables:
#   PDFS_BUCKET      S3 bucket name (default: rmbl-hub-pdfs-private)
#   AWS credentials  Either AWS_PROFILE set to a valid profile, or
#                    AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars
#                    (locally use AWS_PROFILE=rmbl-backup)
#
# Usage:
#   AWS_PROFILE=rmbl-backup bash scripts/backup-pdfs.sh

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

PDFS_BUCKET="${PDFS_BUCKET:-rmbl-hub-pdfs-private}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PDF_DIR="$SCRIPT_DIR/output/pdf-staging"
MANIFEST_PATH="$SCRIPT_DIR/output/pdf-manifest.json"

if [ ! -d "$PDF_DIR" ]; then
  echo "ERROR: PDF staging directory not found: $PDF_DIR" >&2
  exit 1
fi

PDF_COUNT=$(find "$PDF_DIR" -name '*.pdf' -type f 2>/dev/null | wc -l | tr -d ' ')
PDF_SIZE_MB=$(du -sm "$PDF_DIR" 2>/dev/null | awk '{print $1}')

echo "RMBL Knowledge Hub — PDF Backup"
echo "==============================="
echo "Source: $PDF_DIR"
echo "Bucket: s3://$PDFS_BUCKET"
echo "Local: $PDF_COUNT PDFs (${PDF_SIZE_MB} MB total)"
echo

# ----------------------------------------------------------------------------
# Sync PDFs (excluding extracted text and processed breadcrumbs)
# ----------------------------------------------------------------------------

echo "Syncing PDFs..."
aws s3 sync "$PDF_DIR" "s3://${PDFS_BUCKET}/pdf-staging/" \
  --storage-class STANDARD_IA \
  --sse AES256 \
  --exclude "*.txt" \
  --exclude "manual/processed/*" \
  --no-follow-symlinks

# ----------------------------------------------------------------------------
# Back up the manifest separately (small file, frequent updates)
# ----------------------------------------------------------------------------

if [ -f "$MANIFEST_PATH" ]; then
  echo
  echo "Uploading manifest..."
  aws s3 cp "$MANIFEST_PATH" "s3://${PDFS_BUCKET}/pdf-manifest.json" \
    --sse AES256 \
    --only-show-errors
  MANIFEST_SIZE=$(wc -c < "$MANIFEST_PATH")
  echo "  Manifest: $MANIFEST_SIZE bytes"
fi

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------

REMOTE_COUNT=$(aws s3 ls "s3://${PDFS_BUCKET}/pdf-staging/" --recursive --summarize 2>/dev/null \
  | grep -c '\.pdf$' || true)

echo
echo "==============================="
echo "PDF backup complete"
echo "Remote PDFs: $REMOTE_COUNT"
echo "==============================="
