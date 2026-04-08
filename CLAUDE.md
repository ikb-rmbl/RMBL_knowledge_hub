# CLAUDE.md — RMBL Knowledge Hub

## Project Overview

Unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado:
- **Documents** (1,381) — community/policy documents from the Sustainable Living Library
- **Publications** (5,267) — peer-reviewed articles, theses, student papers (3,988 RMBL + 1,279 discovered)
- **Datasets** (1,216) — research datasets from 8 discovery sources
- **Authors** (6,586) — deduplicated cross-collection author registry with ORCID enrichment
- **Projects** (118) — research plans and programs with auto-discovered item assignments
- **References** (106,209) — citation network with 10,045 internal links
- **Embeddings** (7,758) — vector embeddings for concept graph and similarity search

## Tech Stack

- **Framework:** Next.js 16 + Payload CMS 3.x (embedded in single Next.js app)
- **Database:** PostgreSQL 17 with pgvector (local via Homebrew; Neon for production)
- **Node.js:** v22 via fnm
- **Language:** TypeScript (strict mode)
- **Frontend:** React server components, plain CSS, RMBL brand styling
- **Search:** PostgreSQL tsvector + pgvector hybrid (keyword + semantic similarity)
- **Embeddings:** Voyage AI voyage-4 (1024 dimensions) via REST API
- **Scripts:** Run via `npx tsx scripts/<name>.ts`

## Development

```bash
# Prerequisites: fnm, PostgreSQL 17 with pgvector, database 'rmbl_knowledge_hub' created
fnm use 22
npm install
npm run dev          # Start dev server at http://localhost:3000
npm run test         # Run unit tests (Vitest, 214 tests across 12 files)
npm run lint         # ESLint check
npm run build        # Production build
npm run pipeline     # Full data pipeline (9 phases)
```

### Local Setup

```bash
scripts/setup-local.sh   # Automated local dev setup (PostgreSQL, extensions, schema)
```

### Database Sync (Local <-> Neon production)

```bash
npm run sync:pull        # Download admin edits from Neon to local
npm run sync:push        # Send local pipeline data to Neon
npm run sync:both        # Pull then push
npm run sync:verify      # Verify local/Neon record counts match
npm run sync:safe        # Run enrichments directly against Neon (citation counts, embeddings)
npm run sync:full        # Destructive full restore (truncates Neon, restores from local dump)
npm run sync:schema      # Apply SQL migrations to Neon
```

### Database Sharing

```bash
scripts/export-database.sh   # Export database dump for sharing (excludes sensitive tables)
```

## Key Architecture Decisions

- **Frontend pages use Payload Local API** (direct database access in server components)
- **Pipeline scripts use Payload REST API** (requires `npm run dev` running for load/topics/authors phases)
- **Scraping scripts do NOT need the dev server** — they write to JSON files in `scripts/output/`
- **PDF text extraction uses system tools** (`pdftotext` from poppler, `tesseract` for OCR) — NOT npm packages
- **All scraped data is cached** in `scripts/output/` (gitignored) and can be regenerated from source
- **`push: false`** in payload.config.ts — preserves custom tsvector columns, work_count, embeddings, and SQL tables
- **Custom SQL tables** (`references_cited`, `publications_mentors`, `content_chunks`, `sync_log`) managed outside Payload schema
- **Provenance tracking** — `dataSource` + `discoveryMethod` fields distinguish RMBL-database publications from discovered ones
- **Bidirectional sync** — "remote wins" for admin-curated fields, "local wins" for pipeline-enriched fields
- **Access control** — public read, authenticated write on all content collections (shared `publicReadAuthWrite`)

## Project Structure

```
src/
  payload.config.ts              — Payload CMS configuration (push: false, env validation, S3 conditional)
  collections/                   — 8 Payload collections (Documents, Publications, Datasets, Topics, Authors, Projects, Users, Media)
  collections/shared/access.ts   — Shared access control (publicReadAuthWrite)
  collections/shared/constants.ts — Shared field option constants
  app/(frontend)/                — Public-facing Next.js pages
    page.tsx                     — Home page
    layout.tsx                   — Site layout (RMBL header, footer)
    styles.css                   — RMBL brand styling
    search/page.tsx              — Unified search with faceted filtering
    publications/[id]/page.tsx   — Publication detail
    documents/[id]/page.tsx      — Document detail
    datasets/[id]/page.tsx       — Dataset detail
    authors/page.tsx             — Author browse
    authors/[id]/page.tsx        — Author detail with works
    projects/page.tsx            — Project browse
    projects/[id]/page.tsx       — Project detail with assigned items
    api/search/route.ts          — Search API endpoint (validated, parameterized)
    lib/badges.ts                — Collection type badge labels/classes
    lib/db.ts                    — Shared PostgreSQL pool for frontend (serverless tuning)
    lib/related-works.tsx        — Related works panel via pgvector similarity
    lib/url-validation.ts        — URL/DOI/ORCID format validation for safe rendering
    components/ExpandableRelatedWorks.tsx — Client-side expand/collapse for related works
    components/ExpandableTopics.tsx       — Client-side expand/collapse for topic lists
  app/(payload)/                 — Payload admin panel routes

scripts/
  pipeline.ts               — Orchestrator: 9 phases (check -> ingest -> discover -> enrich -> load -> topics -> authors -> citations -> embeddings)
  scrape-library.ts          — Sustainable Library scrape + normalize
  scrape-publications.ts     — RMBL Publications scrape + CrossRef/Unpaywall enrichment
  scrape-catalog.ts          — Data Catalog scrape + EML metadata fetch
  discover-publications.ts   — Publication discovery via OpenAlex + CrossRef
  discover-datasets.ts       — Dataset discovery (7 repository sources)
  enrich.ts                  — DOI, ORCID, and mentor enrichment
  enrich-abstracts.ts        — Abstract enrichment (API + regex + Semantic Scholar + PDF)
  download-pdfs.ts           — PDF download pipeline with manifest tracking
  download-institutional.ts  — Institutional repository PDF downloads
  extract-text.ts            — PDF text extraction (pdftotext + OCR fallback)
  backfill-pdf-sizes.ts      — Backfill PDF file sizes via HEAD requests
  load-to-payload.ts         — Load all collections into Payload via REST API (incremental dedup)
  load-fulltext.ts           — Load extracted text into database
  manage-topics.ts           — 40-topic thematic taxonomy organize + assignment
  build-authors.ts           — Author registry build + dedup
  fetch-citation-counts.ts   — External citation counts from OpenAlex/DataCite
  generate-embeddings.ts     — Vector embeddings via Voyage AI voyage-4
  seed-projects.ts           — Seed projects from research plan data
  assign-projects.ts         — Auto-discover and assign items to projects
  extract-references.ts      — Reference extraction (CrossRef + GROBID + fulltext)
  match-references.ts        — Reference matching + PostgreSQL loading
  crosslink-datasets.ts      — Publication<->dataset linking from full text
  update-sources.ts          — Incremental source change detection
  sync-to-neon.ts            — Production sync: full restore, verify, safe enrichment, schema migration
  sync-databases.ts          — Bidirectional incremental sync (local <-> Neon)
  experiment-extraction.ts   — VLM extraction experiment (regex vs Voyage multimodal vs Claude vision)
  setup-local.sh             — Automated local development environment setup
  export-database.sh         — Database export for sharing (excludes sensitive tables)
  lib/                       — 16 shared utility modules
  sql/                       — 5 SQL migration files (provenance, citations, embeddings, projects, sync_log)
  __tests__/                 — 12 test files (214 tests)

public/
  rmbl-logo.jpg              — RMBL logo for site header

specification/               — Project specs (functionality + implementation variants)
```

## Shared Libraries (`scripts/lib/`)

- `config.ts` — All API endpoints, paths, credentials, rate limits; auto-loads `.env` on import
- `types.ts` — `NormalizedPublication`, `NormalizedDocument`, `NormalizedDataset`, etc.
- `payload-client.ts` — Payload REST API auth, CRUD, pagination
- `concurrency.ts` — `runConcurrent()`, `runBatch()`, `sleep()`
- `record-matching.ts` — Tiered record matching (DOI, title similarity, ORCID, name) + field merge logic
- `crossref-client.ts` — CrossRef + Unpaywall API queries (strict/relaxed modes)
- `topic-rules.ts` — 40 thematic topic categories + matching helpers
- `dataset-discovery.ts` — Dataset dedup, normalization, and license helpers
- `publication-discovery.ts` — Publication dedup, OpenAlex/CrossRef normalization, abstract reconstruction
- `author-parsing.ts` — Author string parsing, creator names, initials expansion
- `author-dedup.ts` — ORCID + name-based author deduplication
- `doi-utils.ts` — DOI extraction and Jaccard title similarity
- `sources.ts` — Fetch logic for all 3 external data sources
- `eml-parser.ts` — EML XML metadata parser (DataONE, ESS-DIVE)
- `pdf-manifest.ts` — PDF pipeline state tracker (resumable)
- `pdf-extract.ts` — Digital + OCR text extraction with quality scoring

## Security

- **Access control**: All collections use `publicReadAuthWrite` (public read, authenticated create/update/delete)
- **SQL injection**: All queries use parameterized values (`$1`, `$2`); dynamic identifiers escaped
- **XSS prevention**: No `dangerouslySetInnerHTML`; search highlights rendered as safe React elements
- **URL validation**: All database-sourced URLs validated (`isHttpUrl`) before rendering in `href` attributes
- **DOI/ORCID validation**: Format-checked before constructing external links
- **Input validation**: Search API enforces query length limit (1000 chars), type filter allowlist, safe parseInt
- **Error handling**: Internal error details suppressed in API responses
- **Secrets**: `.env` gitignored; no hardcoded credentials; admin password required via env var
- **PAYLOAD_SECRET**: 32-char minimum enforced in production, 16 in development
- **S3 storage**: Only enabled when all three credentials (bucket, access key, secret key) are present

## Common Pitfalls

- Scripts that write to Payload (`load-to-payload.ts`, `manage-topics.ts`, `build-authors.ts`, `load-fulltext.ts`, `crosslink-datasets.ts`, `seed-projects.ts`, `assign-projects.ts`) require `npm run dev` running
- The `pdf-parse` npm package is NOT used — text extraction uses system `pdftotext` from poppler
- Topic IDs in Payload are numeric — pass numbers not strings to relationship fields
- The Payload REST API with very large OR queries (>50 clauses) may silently return 0 results
- `scripts/output/` is gitignored — regenerate by running the scraper scripts
- `match-references.ts` writes directly to PostgreSQL (`references_cited` table), not through Payload
- GROBID reference extraction requires Docker: `docker run --rm -d -p 8070:8070 lfoppiano/grobid:0.8.1`
- `generate-embeddings.ts` requires `VOYAGE_API_KEY` environment variable
- `build-authors.ts --load-payload` clears and rebuilds all authors — safe to re-run but destructive
- Projects table created manually via SQL (`scripts/sql/add-projects.sql`), not via Payload push
- `sync-databases.ts` requires `NEON_DIRECT_URL` environment variable
- `load-to-payload.ts` has incremental dedup (DOI + title+year for publications, DOI + title for datasets) — safe to re-run
- Pipeline scripts auto-load `.env` via `config.ts` import — no need for manual `source .env`

## Environment Variables

Required in `.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `PAYLOAD_SECRET` — encryption key (32+ chars in production)
- `PAYLOAD_ADMIN_PASSWORD` — admin password for pipeline scripts (no default; required)

Required for sync:
- `NEON_DATABASE_URL` — Neon pooled connection string (for sync-to-neon.ts)
- `NEON_DIRECT_URL` — Neon direct connection string (for sync-databases.ts)

Optional:
- `PAYLOAD_ADMIN_EMAIL` — admin email (default: ikb@rmbl.org)
- `VOYAGE_API_KEY` — Voyage AI API key (for embedding generation)
- `ANTHROPIC_API_KEY` — Anthropic API key (for VLM extraction experiment)
- `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, `OPENALEX_MAILTO` — polite API pool emails
- `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_ENDPOINT` — production file storage
