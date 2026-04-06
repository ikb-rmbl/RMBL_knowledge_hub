# CLAUDE.md — RMBL Knowledge Hub

## Project Overview

Unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado:
- **Documents** (1,381) — community/policy documents from the Sustainable Living Library
- **Publications** (5,213) — peer-reviewed articles, theses, student papers (3,934 RMBL + 1,279 discovered)
- **Datasets** (1,216) — research datasets from 8 discovery sources
- **Authors** (6,582) — deduplicated cross-collection author registry with ORCID enrichment
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
npm run test         # Run unit tests (Vitest, 158 tests)
npm run lint         # ESLint check
npm run build        # Production build
npm run pipeline     # Full data pipeline (9 phases)
```

## Key Architecture Decisions

- **Frontend pages use Payload Local API** (direct database access in server components)
- **Pipeline scripts use Payload REST API** (requires `npm run dev` running for load/topics/authors phases)
- **Scraping scripts do NOT need the dev server** — they write to JSON files in `scripts/output/`
- **PDF text extraction uses system tools** (`pdftotext` from poppler, `tesseract` for OCR) — NOT npm packages
- **All scraped data is cached** in `scripts/output/` (gitignored) and can be regenerated from source
- **`push: false`** in payload.config.ts — preserves custom tsvector columns, work_count, embeddings, and SQL tables
- **Custom SQL tables** (`references_cited`, `publications_mentors`, `content_chunks`) managed outside Payload schema
- **Provenance tracking** — `dataSource` + `discoveryMethod` fields distinguish RMBL-database publications from discovered ones

## Project Structure

```
src/
  payload.config.ts         — Payload CMS configuration (push: false)
  collections/              — 8 Payload collections (Documents, Publications, Datasets, Topics, Authors, Projects, Users, Media)
  app/(frontend)/           — Public-facing Next.js pages (search, browse, detail, projects)
  app/(frontend)/lib/       — Shared frontend utilities (badges, related-works)
  app/(frontend)/components/ — Client components (ExpandableRelatedWorks, ExpandableTopics)
  app/(payload)/            — Payload admin panel routes

scripts/
  pipeline.ts               — Orchestrator: 9 phases (check → ingest → discover → enrich → load → topics → authors → citations → embeddings)
  scrape-library.ts         — Sustainable Library scrape + normalize
  scrape-publications.ts    — RMBL Publications scrape + CrossRef/Unpaywall enrichment
  scrape-catalog.ts         — Data Catalog scrape + EML metadata fetch
  discover-publications.ts  — Publication discovery via OpenAlex + CrossRef
  discover-datasets.ts      — Dataset discovery (7 repository sources)
  enrich.ts                 — DOI, ORCID, and mentor enrichment
  enrich-abstracts.ts       — Abstract enrichment (API + regex + Semantic Scholar + PDF)
  load-to-payload.ts        — Loads all collections into Payload via REST API
  manage-topics.ts          — 40-topic thematic taxonomy organize + assignment
  build-authors.ts          — Author registry build + dedup
  fetch-citation-counts.ts  — External citation counts from OpenAlex/DataCite
  generate-embeddings.ts    — Vector embeddings via Voyage AI voyage-4
  seed-projects.ts          — Seed projects from research plan data
  assign-projects.ts        — Auto-discover and assign items to projects
  extract-references.ts     — Reference extraction (CrossRef + GROBID + fulltext)
  match-references.ts       — Reference matching + PostgreSQL loading
  crosslink-datasets.ts     — Publication↔dataset linking from full text
  update-sources.ts         — Incremental source change detection
  lib/                      — 14 shared utility modules

public/
  rmbl-logo.jpg             — RMBL logo for site header

specification/              — Project specs (functionality + implementation variants)
```

## Shared Libraries (`scripts/lib/`)

- `crossref-client.ts` — CrossRef + Unpaywall API queries (strict/relaxed modes)
- `topic-rules.ts` — 40 thematic topic categories + matching helpers
- `dataset-discovery.ts` — Dataset dedup, normalization, and license helpers
- `publication-discovery.ts` — Publication dedup, OpenAlex/CrossRef normalization, abstract reconstruction
- `author-parsing.ts` — Author string parsing, creator names, initials expansion
- `author-dedup.ts` — ORCID + name-based author deduplication
- `doi-utils.ts` — DOI extraction and Jaccard title similarity
- `config.ts` — All API endpoints, paths, credentials, rate limits (Voyage AI, OpenAlex, CrossRef, DataCite)
- `types.ts` — `NormalizedPublication`, `NormalizedDocument`, `NormalizedDataset`, etc.
- `payload-client.ts` — Payload REST API auth, CRUD, pagination
- `concurrency.ts` — `runConcurrent()`, `runBatch()`, `sleep()`
- `sources.ts` — Fetch logic for all 3 external data sources
- `eml-parser.ts` — EML XML metadata parser (DataONE, ESS-DIVE)
- `pdf-manifest.ts` — PDF pipeline state tracker (resumable)
- `pdf-extract.ts` — Digital + OCR text extraction with quality scoring

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

## Environment Variables

Required in `.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `PAYLOAD_SECRET` — 32+ character encryption key
- `VOYAGE_API_KEY` — Voyage AI API key (for embeddings)

Optional:
- `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, `OPENALEX_MAILTO` — polite API pool emails
- `PAYLOAD_ADMIN_EMAIL`, `PAYLOAD_ADMIN_PASSWORD` — admin credentials for pipeline scripts
- `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` — production file storage
