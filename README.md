# RMBL Knowledge Commons

A unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado. Brings together community documents, scientific publications, and research datasets into a single searchable interface with citation network navigation.

## What's Inside

- **1,381 documents** from the [Gunnison Sustainable Living Library](https://sustainablelibrary.org/) — community planning, mining history, water policy, and environmental impact documents
- **5,267 publications** from the RMBL Publications Database + OpenAlex/CrossRef discovery — journal articles, theses, student papers spanning decades of Gunnison Basin research
- **1,216 datasets** discovered from 8 repositories — DataONE, DataCite, Zenodo, NCEI, ScienceBase, and more
- **6,586 authors** — deduplicated cross-collection registry with ORCID enrichment
- **118 research projects** — active research plans and long-term programs with auto-discovered item assignments
- **106,209 references** — citation network with 10,045 internal links enabling "cited by" navigation
- **7,758 vector embeddings** — concept graph powering "Related Works" panels and similarity search
- **40 thematic topics** across 7 groups — from Flowering & Pollination to Archaeology & Cultural History

## Architecture

```
Next.js 16 + Payload CMS 3.x (single app)
    |
    +-- Public frontend (search, browse, detail, project pages)
    +-- Payload admin panel (/admin)
    +-- REST + GraphQL APIs (auto-generated)
         |
    PostgreSQL 17 + pgvector (local / Neon)
    +-- Payload collections (14)
    +-- tsvector full-text search indexes
    +-- pgvector HNSW indexes (concept graph / similarity)
    +-- Custom tables (references_cited, content_chunks, publications_mentors, sync_log, duplicate_tombstones)
         |
    AWS S3 (PDF + media storage)
    Voyage AI (vector embeddings)
```

The data pipeline scrapes three external sources, enriches with CrossRef DOIs and Unpaywall open-access links, extracts text from PDFs (digital + OCR), builds citation networks, and loads everything into Payload CMS.

## Quick Start

### Prerequisites

- [fnm](https://github.com/Schniz/fnm) (Node version manager): `brew install fnm`
- PostgreSQL 17: `brew install postgresql@17`
- pgvector: `brew install pgvector`
- poppler + tesseract for PDF processing: `brew install poppler tesseract`

### Automated Setup

```bash
git clone https://github.com/ikb-rmbl/RMBL_knowledge_hub.git
cd RMBL_knowledge_hub
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh
```

The setup script checks prerequisites, installs dependencies, creates the database, enables pgvector, and runs SQL migrations.

### Getting the Data

**Option A — Get a database dump from another developer (fastest):**
```bash
# The exporting developer runs:
./scripts/export-database.sh

# You restore the dump:
psql rmbl_knowledge_hub < scripts/output/schema.sql
pg_restore -d rmbl_knowledge_hub --data-only --no-owner scripts/output/rmbl_knowledge_hub_YYYYMMDD.dump
```

**Option B — Build from scratch using the pipeline:**
```bash
# Temporarily set push: true in src/payload.config.ts to create Payload tables
npm run dev    # start server, let Payload create tables, then stop
# Set push: false back in src/payload.config.ts

# Run the full data pipeline
npm run pipeline
```

### Start Developing

```bash
cp .env.example .env   # edit with your settings
npm run dev            # http://localhost:3000
npm run test           # 214 tests
```

### Data Pipeline

```bash
npm run pipeline         # full pipeline (9 phases)
npm run pipeline:check   # preview what would change
```

Or run individual steps:

```bash
# 1. Scrape source data
npx tsx scripts/scrape-library.ts
npx tsx scripts/scrape-publications.ts
npx tsx scripts/scrape-catalog.ts

# 2. Discover additional publications and datasets
npx tsx scripts/discover-publications.ts --source=all
npx tsx scripts/discover-datasets.ts --source=all

# 3. Enrich (DOIs, ORCIDs, mentors, abstracts)
npx tsx scripts/enrich.ts --step=all
npx tsx scripts/enrich-abstracts.ts --step=all

# 4. Load into Payload (requires npm run dev in another terminal)
npx tsx scripts/load-to-payload.ts
npx tsx scripts/manage-topics.ts
npx tsx scripts/build-authors.ts --load-payload

# 5. PDF processing (optional, long-running)
npx tsx scripts/download-pdfs.ts
npx tsx scripts/extract-text.ts
npx tsx scripts/load-fulltext.ts

# 6. References (optional)
npx tsx scripts/extract-references.ts --method=all
npx tsx scripts/match-references.ts

# 7. Dataset cross-linking (optional)
npx tsx scripts/crosslink-datasets.ts
```

See `scripts/README.md` for detailed documentation of each script, CLI flags, and shared libraries.

### Manual PDF Acquisition

For papers that automated discovery can't reach (paywalled journals, anti-bot
institutional repos), a technician can manually find and ingest PDFs. The PDFs
are text-extracted and indexed for search but never publicly redistributed.

```bash
# 1. Generate a worklist CSV of papers needing PDFs
npm run worklist:export -- --limit=200 --year-min=2015

# 2. Technician opens scripts/output/pdf-worklist.csv in a spreadsheet,
#    finds each PDF (DOI, library, ILL, etc.), and downloads to:
#    scripts/output/pdf-staging/manual/pub_<id>.pdf
#    Then fills in the source_description column for each downloaded PDF.

# 3. Ingest all PDFs in the manual/ directory
npm run pdf:ingest-manual -- --worklist=scripts/output/pdf-worklist.csv

#    This validates each PDF, extracts text, sets pdf_restricted=true on the
#    publication, moves the source PDF to manual/processed/<date>/, and logs
#    to scripts/output/manual-ingest-log.json.

# 4. Sync to production (the restriction flag and extracted text propagate;
#    the PDF blob stays local-only)
npm run sync:push
```

Restricted PDFs appear in search results with full-text snippets and on the
detail page with abstracts and references — the only thing hidden is the
"Download PDF" button.

### Backup & Restore

Daily automated backups to AWS S3, with full restore + monthly drill workflow.
See `docs/RESTORE_RUNBOOK.md` for the disaster recovery procedure.

```bash
# Run a database backup manually (also runs daily via GitHub Actions)
npm run backup:db

# Sync restricted PDFs to private S3 bucket (run weekly)
npm run backup:pdfs

# Verify the latest backup is recent and intact
npm run backup:verify

# Monthly restore drill — downloads latest, restores to throwaway DB, verifies
npm run backup:test-restore

# List available backups
npm run restore:list

# Restore the latest backup to local (DESTRUCTIVE — drops local DB)
npm run restore:db

# Restore a specific backup
npm run restore:db -- --backup=rmbl-hub-2026-04-09T21-18-51Z.dump

# Restore latest to Neon production (REQUIRES DOUBLE CONFIRMATION)
npm run restore:db -- --target=neon
```

The backup system uses an `rmbl-backup` AWS profile that must be configured
locally (`aws configure --profile rmbl-backup`). For CI, three secrets must
be set in the GitHub repo: `AWS_BACKUP_ACCESS_KEY_ID`, `AWS_BACKUP_SECRET_ACCESS_KEY`,
and `NEON_DIRECT_URL`.

## Project Structure

```
src/
  payload.config.ts           # CMS configuration (push: false, env validation)
  collections/                # Data model (8 collections)
  collections/shared/         # Shared access control + constants
  app/(frontend)/             # Public pages (search, browse, detail, projects)
  app/(frontend)/api/         # Search API endpoint
  app/(frontend)/lib/         # Shared utilities (badges, db, related-works, url-validation)
  app/(frontend)/components/  # Client components
  app/(payload)/              # Admin panel

scripts/
  pipeline.ts                 # Orchestrator (9 phases)
  scrape-*.ts                 # Source data scrapers (3)
  discover-publications.ts    # OpenAlex + CrossRef geographic discovery
  discover-datasets.ts        # 7-source dataset discovery
  enrich.ts                   # DOI/ORCID/mentor enrichment
  enrich-abstracts.ts         # Abstract enrichment (4 tiers)
  load-to-payload.ts          # Database loader (incremental dedup)
  manage-topics.ts            # 40-topic thematic taxonomy
  build-authors.ts            # Author registry + dedup
  fetch-citation-counts.ts    # External citation counts
  generate-embeddings.ts      # Voyage AI vector embeddings
  seed-projects.ts            # Research project seeding
  assign-projects.ts          # Auto-discover project items
  extract-references.ts       # CrossRef + GROBID + fulltext
  match-references.ts         # Reference matching
  crosslink-datasets.ts       # Publication<->dataset linking
  sync-to-neon.ts             # Production sync (full restore, verify, safe, schema)
  sync-databases.ts           # Bidirectional incremental sync (local <-> Neon)
  experiment-extraction.ts    # VLM extraction experiment
  setup-local.sh              # Automated local setup
  export-database.sh          # Database export for sharing
  lib/                        # 16 shared utility modules
  sql/                        # 5 SQL migration files
  __tests__/                  # 12 test files (214 tests)

public/
  rmbl-logo.jpg               # RMBL logo

specification/                # Technical specs
```

## Development

```bash
npm run dev             # Start dev server
npm run test            # Run tests (214 tests, Vitest)
npm run lint            # Lint check
npm run build           # Production build
npm run pipeline        # Full data pipeline
npm run pipeline:check  # Preview source changes
npm run generate:types  # Regenerate Payload TypeScript types
```

## Deployment

**Production stack:** Vercel (hosting) + Neon (PostgreSQL + pgvector) + Cloudflare R2 (file storage)

### Environment variables (set in Vercel dashboard)

- `DATABASE_URL` — Neon pooled connection string
- `PAYLOAD_SECRET` — 32+ character encryption key
- `PAYLOAD_ADMIN_EMAIL` — Admin login email
- `PAYLOAD_ADMIN_PASSWORD` — Admin login password
- `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_ENDPOINT` — File storage
- `VOYAGE_API_KEY` — Voyage AI for vector embeddings

### Syncing Data to Production

**Monthly pipeline refresh:**
```bash
npm run pipeline                     # run pipeline locally
npm run sync:pull                    # pull any admin edits from Neon first
npm run sync:push                    # push new pipeline data to Neon
```

**After admin curation on Neon:**
```bash
npm run sync:pull                    # download curated edits to local
# Local DB now has admin fixes; future pipeline runs build on curated data.
# Edits are protected per-cell: each row's `curated_fields` column tracks
# which fields an admin asserted, and both sync and pipeline writes skip
# those cells. Admins release a cell via the "Curated fields" sidebar
# widget on the item's edit page.
```

**Removing duplicates:** Use the Payload admin's Delete button on a flagged
duplicate. A `beforeDelete` hook snapshots the row's identifying keys
(DOI, title+year for publications; DOI/title for datasets; source_url/title
for documents and stories) into `duplicate_tombstones`. The next pipeline
run skips any incoming record that matches a tombstone, so the duplicate
won't be reintroduced. Deletes are one-way — restore from Neon PITR if
needed, or `DELETE FROM duplicate_tombstones WHERE id = <n>` to let the
pipeline reintroduce a previously-deleted record.

**Quick enrichment (no conflict risk):**
```bash
npm run sync:safe                    # citation counts + embeddings directly on Neon
```

**Full restore (destructive — replaces all Neon data):**
```bash
npm run sync:verify                  # compare local vs production
npm run sync:full                    # truncate + restore from local dump
```

See `scripts/README.md` for detailed deployment workflow documentation.

## License

This project is developed for the Rocky Mountain Biological Laboratory under grant funding.
Support for the Knowledge Commons provided by the Clark Family Foundation.
