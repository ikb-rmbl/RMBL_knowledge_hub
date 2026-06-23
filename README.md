# RMBL Knowledge Commons

A unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado. Brings together community documents, scientific publications, and research datasets into a single searchable interface with citation network navigation.

## What's Inside

- **1,769 documents** — 1,381 from the [Gunnison Sustainable Living Library](https://sustainablelibrary.org/) (community planning, mining history, water policy) plus **388 Federal Register notices** (1995–2025) covering Interior/BLM, Forest Service, USFWS, EPA, and NPS rulemaking that touches the basin
- **4,852 publications** from the RMBL Publications Database + OpenAlex/CrossRef discovery — journal articles, theses, student papers spanning decades of Gunnison Basin research
- **1,426 datasets** discovered from 8 repositories — DataONE, DataCite, Zenodo, NCEI, ScienceBase, and more
- **841 stories** — local news articles (CB News, Gunnison Times, LexisNexis) with LLM type-classification; full text indexed for search, not displayed for copyright
- **7,512 authors** — deduplicated cross-collection registry with ORCID enrichment
- **118 research projects** — active research plans and long-term programs with auto-discovered item assignments
- **151,746 references** — citation network with internal links across publications and documents (10K+ pub→pub, 19K+ story→pub, 6K+ FR→external)
- **13,034 vector embeddings** — concept graph powering "Related Works" panels and similarity search
- **40 thematic topics** across 7 groups — from Flowering & Pollination to Archaeology & Cultural History

**Knowledge graph** (entities derived from LLM extraction over publications + documents):

- **4,334 species** with ITIS taxonomy, **8,225 places** with coordinates and hierarchy, **3,607 concepts**, **1,474 protocols**, **5,823 stakeholders** (agencies, NGOs, institutions)
- **151,728 entity mentions** linking these across publications + documents + datasets + stories

**Research frontiers + neighborhoods**:

- **146 knowledge neighborhoods** detected by Louvain community detection over the unified graph, with LLM-generated descriptions and research primers
- **68 grounded frontiers** + 98 legacy frontiers. Grounded frontiers cite primary papers verbatim (658 cites across 425 papers) and track currency — "still open?" validated against newer literature. Live at `/frontiers` with legacy hidden behind a `?legacy=show` toggle.

## Architecture

```
Next.js 16 + Payload CMS 3.x (single app)
    |
    +-- Public frontend (search, browse, detail, projects, frontiers, neighborhoods)
    +-- Payload admin panel (/admin)
    +-- REST API v1 (/api/v1/*) + MCP server (/api/mcp + mcp/) for AI agents
         |
    PostgreSQL 17 + pgvector (local / Neon)
    +-- 15 Payload collections (Documents, Publications, Datasets, Stories,
    +     Authors, Topics, Projects, Species, Places, Protocols, Concepts,
    +     Stakeholders, Eras, Flags, Users, Media)
    +-- tsvector full-text search indexes
    +-- pgvector HNSW indexes (similarity + RAG)
    +-- SQL-only tables (references_cited, content_chunks, entity_mentions,
          entity_candidates, neighborhoods, neighborhood_members, frontiers,
          frontier_source_statements, frontier_statement_papers, frontier_snapshots,
          frontier_extraction_runs, frontier_validation_runs, publications_mentors,
          sync_log, duplicate_tombstones)
         |
    AWS S3 / Cloudflare R2 (PDF + media storage)
    Voyage AI (voyage-4, 1024-dim vector embeddings)
    Claude (Anthropic) for entity extraction, summarization, primers, frontier synthesis
```

The data pipeline scrapes four external sources (Sustainable Library, RMBL Publications, RMBL Data Catalog, Federal Register), enriches with CrossRef DOIs and Unpaywall open-access links, extracts text from PDFs (digital + OCR), runs LLM entity extraction over the corpus, builds the knowledge graph, detects neighborhoods, and synthesizes paper-grounded research frontiers.

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
npm run test           # 272 tests
```

### Data Pipeline

```bash
npm run pipeline         # full pipeline (10 phases)
npm run pipeline:check   # preview what would change
```

Or run individual steps:

```bash
# 1. Scrape source data
npx tsx scripts/scrape-library.ts
npx tsx scripts/scrape-publications.ts
npx tsx scripts/scrape-catalog.ts
npx tsx scripts/discover-fr-notices.ts        # Federal Register policy docs

# 2. Discover additional publications and datasets
npx tsx scripts/discover-publications.ts --source=all
npx tsx scripts/discover-datasets.ts --source=all
npx tsx scripts/discover-pdfs.ts              # Semantic Scholar OA discovery

# 3. Enrich (DOIs, ORCIDs, mentors, abstracts)
npx tsx scripts/enrich.ts --step=all
npx tsx scripts/enrich-abstracts.ts --step=all

# 4. Load into Payload (requires npm run dev in another terminal)
npx tsx scripts/load-to-payload.ts
npx tsx scripts/manage-topics.ts
npx tsx scripts/build-authors.ts --load-payload

# 5. PDF processing
npx tsx scripts/download-pdfs.ts --collection=documents
npx tsx scripts/extract-text.ts --collection=documents
npx tsx scripts/load-fulltext.ts --collection=documents

# 6. References (citation network)
npx tsx scripts/extract-references.ts --method=all
npx tsx scripts/match-references.ts
npx tsx scripts/load-referenced-works.ts      # LLM-extracted referenced works
npx tsx scripts/match-document-citations.ts   # doc→pub/doc title-trigram matching

# 7. LLM entity extraction (concepts, places, species, protocols, stakeholders)
npx tsx scripts/extract-document-entities.ts
npx tsx scripts/extract-longform-entities.ts --collection=documents  # >120KB docs
npx tsx scripts/load-document-extractions.ts  # JSON → entity_candidates

# 8. Link/cluster entity candidates → canonical entities + mentions
npx tsx scripts/link-species-places.ts
npx tsx scripts/cluster-concepts.ts
npx tsx scripts/cluster-protocols.ts
npx tsx scripts/cluster-stakeholders.ts
npx tsx scripts/backfill-species-mentions.ts  # text-search-based widening

# 9. Knowledge graph + neighborhoods
npx tsx scripts/build-unified-graph.ts
npx tsx scripts/detect-communities.ts
npx tsx scripts/describe-communities.ts
npx tsx scripts/generate-primers.ts

# 10. Frontiers (paper-grounded research-gap synthesis)
npx tsx scripts/extract-frontiers-grounded.ts
npx tsx scripts/cluster-frontiers-grounded.ts
npx tsx scripts/synthesize-frontiers-grounded.ts --model=claude-opus-4-7
npx tsx scripts/load-frontiers-grounded.ts
npx tsx scripts/validate-frontier-currency.ts  # "still open?" check
```

See the project `CLAUDE.md` for detailed documentation of each script, CLI flags, and shared libraries.

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
  collections/                # Data model (15 Payload collections)
  collections/shared/         # Shared access control, curation hooks, tombstone hooks
  services/                   # 7 service modules (search, graph, neighborhoods, frontiers,
                              #   entities, items, related)
  admin/components/           # Custom Payload admin React components
                              #   (FlagsForItem, CuratedFields sidebar widgets)
  app/(frontend)/             # Public pages (search, browse, detail, projects,
                              #   frontiers, neighborhoods, /explore/*)
  app/(frontend)/api/v1/      # REST API v1 (13 endpoints, format=json|text, rate-limited)
  app/(frontend)/api/mcp/     # MCP server (Streamable HTTP, 10 tools)
  app/(frontend)/lib/         # Shared utilities (badges, db, related-works, url-validation,
                              #   graph-data, graph-colors, json-ld)
  app/(frontend)/components/  # Client components
  app/(payload)/              # Admin panel

scripts/                      # 60+ pipeline scripts (see CLAUDE.md for full inventory)
  pipeline.ts                 # Orchestrator (10 phases)
  scrape-*.ts                 # Source scrapers (Sustainable Library, RMBL Pubs,
                              #   Data Catalog, FR notices, CB News, Gunnison Times)
  discover-*.ts               # Publication / dataset / PDF / FR-notice discovery
  enrich*.ts                  # DOI / ORCID / mentor / abstract / FR-document enrichment
  download-pdfs.ts            # PDF download with manifest tracking
  extract-text.ts             # PDF → text (pdftotext + tesseract OCR fallback)
  load-to-payload.ts          # Bulk loader (incremental dedup + tombstone check)
  extract-{document,longform,dataset,story}-entities.ts  # LLM entity extraction
  link-species-places.ts      # Species + Places canonicalization (ITIS-aware)
  cluster-{concepts,protocols,stakeholders}.ts  # Embedding-based clustering
  backfill-species-mentions.ts  # Text-search widening
  build-{explore,collection,unified}-graph.ts   # Knowledge graph construction
  detect-communities.ts       # Louvain neighborhoods
  generate-primers.ts         # LLM neighborhood primers
  extract-frontiers-grounded.ts + cluster + synthesize + load + validate
                              # Paper-grounded frontiers pipeline (PRs #63–#73)
  sync-databases.ts           # Bidirectional incremental sync (local ↔ Neon)
  sync-bulk-to-neon.ts        # SQL-only tables (neighborhoods, frontiers, planning,
                              #   entity_mentions, references_cited)
  sync-replace-entities.ts    # Bulk replace for canonical entity tables
  mcp/                        # Local MCP server (stdio transport)
  lib/                        # 25+ shared utility modules
  sql/                        # SQL migration files (idempotent CREATE IF NOT EXISTS)
  __tests__/                  # ~15 test files (272 tests)

public/
  rmbl-logo.jpg               # RMBL logo
  llms.txt                    # LLM discovery index
  robots.txt                  # Crawler policy (allows GPTBot, ClaudeBot, PerplexityBot)

specification/                # Technical specs
```

## Development

```bash
npm run dev             # Start dev server
npm run test            # Run tests (272 tests, Vitest)
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
