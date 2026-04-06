# CLAUDE.md — RMBL Knowledge Hub

## Project Overview

Unified search platform for 3 environmental knowledge resources from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado:
- **Documents** (1,381) — community/policy documents from the Sustainable Living Library
- **Publications** (3,934) — peer-reviewed articles, theses, student papers from RMBL
- **Datasets** (1,069) — research datasets from 8 discovery sources (RMBL Catalog, DataONE, DataCite, Zenodo, etc.)
- **Authors** (4,724) — deduplicated cross-collection author registry with ORCID enrichment
- **References** (126,752) — citation network with 11,626 internal links

## Tech Stack

- **Framework:** Next.js 16 + Payload CMS 3.x (embedded in single Next.js app)
- **Database:** PostgreSQL 17 (local via Homebrew; Neon for production)
- **Node.js:** v22 via fnm
- **Language:** TypeScript (strict mode)
- **Frontend:** React server components, plain CSS
- **Search:** PostgreSQL tsvector with weighted ranking (title=A, abstract=B, fullText=C)
- **Scripts:** Run via `npx tsx scripts/<name>.ts`

## Development

```bash
# Prerequisites: fnm, PostgreSQL 17 running, database 'rmbl_knowledge_hub' created
fnm use 22
npm install
npm run dev          # Start dev server at http://localhost:3000
npm run test         # Run unit tests (Vitest, 128 tests)
npm run lint         # ESLint check
npm run build        # Production build
npm run pipeline     # Full data pipeline (check → ingest → enrich → load → topics → authors)
```

## Key Architecture Decisions

- **Frontend pages use Payload Local API** (direct database access in server components)
- **Pipeline scripts use Payload REST API** (requires `npm run dev` running for load/topics/authors phases)
- **Scraping scripts do NOT need the dev server** — they write to JSON files in `scripts/output/`
- **PDF text extraction uses system tools** (`pdftotext` from poppler, `tesseract` for OCR) — NOT npm packages
- **All scraped data is cached** in `scripts/output/` (gitignored) and can be regenerated from source
- **`push: false`** in payload.config.ts — preserves custom tsvector columns, work_count, and SQL tables
- **Custom SQL tables** (`references_cited`, `publications_mentors`) managed outside Payload schema

## Project Structure

```
src/
  payload.config.ts         — Payload CMS configuration (push: false)
  collections/              — 7 Payload collections (Documents, Publications, Datasets, Topics, Authors, Users, Media)
  app/(frontend)/           — Public-facing Next.js pages (search, browse, detail pages)
  app/(payload)/            — Payload admin panel routes

scripts/
  pipeline.ts               — Orchestrator: chains check → ingest → enrich → load → topics → authors
  scrape-library.ts         — Sustainable Library scrape + normalize
  scrape-publications.ts    — RMBL Publications scrape + CrossRef/Unpaywall enrichment
  scrape-catalog.ts         — Data Catalog scrape + EML metadata fetch
  enrich.ts                 — DOI, ORCID, and mentor enrichment (--step=dois|orcids|mentors|all)
  load-to-payload.ts        — Loads all collections into Payload via REST API
  manage-topics.ts          — Topic taxonomy organize + publication assignment
  build-authors.ts          — Author registry build + dedup
  download-pdfs.ts          — PDF download pipeline
  extract-text.ts           — Text extraction (digital + OCR + mixed)
  load-fulltext.ts          — Load extracted text into Payload
  extract-references.ts     — Reference extraction (--method=crossref|grobid|fulltext|all)
  match-references.ts       — Reference matching + PostgreSQL loading
  discover-datasets.ts      — Dataset discovery (--source=dataone|zenodo|datacite|ncei|sciencebase|paleo|dois|all)
  crosslink-datasets.ts     — Publication↔dataset linking from full text
  update-sources.ts         — Incremental source change detection
  lib/                      — 14 shared utility modules

specification/              — Project specs (functionality + implementation variants)
```

## Shared Libraries (`scripts/lib/`)

- `crossref-client.ts` — CrossRef + Unpaywall API queries (strict/relaxed modes)
- `topic-rules.ts` — Topic categorization patterns + matching helpers
- `dataset-discovery.ts` — Dataset dedup, normalization, and license helpers
- `author-parsing.ts` — Author string parsing, creator names, initials expansion
- `author-dedup.ts` — ORCID + name-based author deduplication
- `doi-utils.ts` — DOI extraction and Jaccard title similarity
- `config.ts` — All API endpoints, paths, credentials, rate limits
- `types.ts` — `NormalizedPublication`, `NormalizedDocument`, `NormalizedDataset`, etc.
- `payload-client.ts` — Payload REST API auth, CRUD, pagination
- `concurrency.ts` — `runConcurrent()`, `runBatch()`, `sleep()`
- `sources.ts` — Fetch logic for all 3 external data sources
- `eml-parser.ts` — EML XML metadata parser (DataONE, ESS-DIVE)
- `pdf-manifest.ts` — PDF pipeline state tracker (resumable)
- `pdf-extract.ts` — Digital + OCR text extraction with quality scoring

## Common Pitfalls

- Scripts that write to Payload (`load-to-payload.ts`, `manage-topics.ts`, `build-authors.ts`, `load-fulltext.ts`, `crosslink-datasets.ts`) require `npm run dev` running
- The `pdf-parse` npm package is NOT used — text extraction uses system `pdftotext` from poppler
- Topic IDs in Payload are numeric — pass numbers not strings to relationship fields
- The Payload REST API with very large OR queries (>50 clauses) may silently return 0 results
- `scripts/output/` is gitignored — regenerate by running the scraper scripts
- `match-references.ts` writes directly to PostgreSQL (`references_cited` table), not through Payload
- GROBID reference extraction requires Docker: `docker run --rm -d -p 8070:8070 lfoppiano/grobid:0.8.1`
