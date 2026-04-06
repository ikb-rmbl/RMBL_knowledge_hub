#!/bin/bash
#
# Local Development Setup for RMBL Knowledge Hub
#
# Prerequisites:
#   - fnm (Node version manager): brew install fnm
#   - PostgreSQL 17: brew install postgresql@17
#   - pgvector: brew install pgvector
#   - poppler (PDF text extraction): brew install poppler
#   - tesseract (OCR): brew install tesseract
#
# Usage:
#   chmod +x scripts/setup-local.sh
#   ./scripts/setup-local.sh
#

set -e

echo "RMBL Knowledge Hub — Local Setup"
echo "================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

check_command() {
  if command -v "$1" &> /dev/null; then
    echo "  ✓ $1"
  else
    echo "  ✗ $1 — install with: $2"
    MISSING=true
  fi
}

MISSING=false
check_command "fnm" "brew install fnm"
check_command "psql" "brew install postgresql@17"
check_command "pdftotext" "brew install poppler"
check_command "tesseract" "brew install tesseract"

if [ "$MISSING" = true ]; then
  echo ""
  echo "Please install missing prerequisites and re-run this script."
  exit 1
fi

# Node.js
echo ""
echo "Setting up Node.js..."
fnm use 22 || fnm install 22
npm install

# Environment file
echo ""
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "  ✓ .env created — edit it with your settings if needed"
else
  echo "  ✓ .env already exists"
fi

# Database
echo ""
echo "Setting up database..."
if psql -lqt | cut -d \| -f 1 | grep -qw rmbl_knowledge_hub; then
  echo "  ✓ Database 'rmbl_knowledge_hub' already exists"
else
  echo "  Creating database 'rmbl_knowledge_hub'..."
  createdb rmbl_knowledge_hub
  echo "  ✓ Database created"
fi

# Enable pgvector
echo "  Enabling pgvector extension..."
psql rmbl_knowledge_hub -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null
echo "  ✓ pgvector enabled"

# Run SQL migrations
echo ""
echo "Running SQL migrations..."
for sql_file in scripts/sql/*.sql; do
  echo "  Applying $(basename $sql_file)..."
  psql rmbl_knowledge_hub < "$sql_file" 2>/dev/null || true
done
echo "  ✓ Migrations complete"

# Initial schema via Payload (requires temporary push:true)
echo ""
echo "The database needs Payload's core tables. You have two options:"
echo ""
echo "  Option A (recommended): Get a database dump from another developer:"
echo "    pg_restore -d rmbl_knowledge_hub path/to/dump.dump"
echo ""
echo "  Option B: Start the dev server to let Payload create tables:"
echo "    1. Temporarily set push: true in src/payload.config.ts"
echo "    2. Run: npm run dev"
echo "    3. Set push: false back in src/payload.config.ts"
echo "    4. Run the pipeline to populate data: npm run pipeline"
echo ""

echo "================================="
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your settings (DATABASE_URL, PAYLOAD_SECRET, etc.)"
echo "  2. Get a database dump or run the pipeline to populate data"
echo "  3. Start the dev server: npm run dev"
echo "  4. Visit http://localhost:3000"
echo ""
