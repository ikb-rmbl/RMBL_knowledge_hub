# CLAUDE.md — RMBL Knowledge Hub

## Project Overview

Unified search platform for 3 environmental knowledge resources from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado:
- **Documents** (1,383) — community/policy documents from the Sustainable Living Library
- **Publications** (3,972) — peer-reviewed articles, theses, student papers from RMBL
- **Datasets** (304) — research datasets from the RMBL Data Catalog and Spatial Data Platform

## Tech Stack

- **Framework:** Next.js 16 + Payload CMS 3.x (embedded in single Next.js app)
- **Database:** PostgreSQL 17 (local via Homebrew; Neon for production)
- **Node.js:** v22 via fnm
- **Language:** TypeScript (strict mode)
- **Frontend:** React server components, plain CSS
- **Scripts:** Run via `npx tsx scripts/<name>.ts`

## Development

```bash
# Prerequisites: fnm, PostgreSQL 17 running, database 'rmbl_knowledge_hub' created
fnm use 22
npm install
npm run dev          # Start dev server at http://localhost:3000
npm run test         # Run unit tests (Vitest)
npm run lint         # ESLint check
npm run build        # Production build
```

## Key Architecture Decisions

- **Frontend pages use Payload Local API** (direct database access in server components)
- **Pipeline scripts use Payload REST API** (requires `npm run dev` running for scripts that write to Payload: `load-to-payload.ts`, `organize-topics.ts`, `assign-publication-topics.ts`)
- **Scraping scripts do NOT need the dev server** — they write to JSON files in `scripts/output/`
- **PDF text extraction uses system tools** (`pdftotext` from poppler, `tesseract` for OCR) — NOT npm packages
- **All scraped data is cached** in `scripts/output/` (gitignored) and can be regenerated from source

## Project Structure

```
src/
  payload.config.ts         — Payload CMS configuration
  collections/              — 6 Payload collections (Documents, Publications, Datasets, Topics, Users, Media)
  app/(frontend)/           — Public-facing Next.js pages
  app/(payload)/            — Payload admin panel routes

scripts/
  lib/                      — Shared utilities (concurrency, config, types, API clients, PDF tools)
  scrape-*.ts               — Data source scrapers (write to scripts/output/*.json)
  normalize-*.ts            — Data normalization (maps scraped data to Payload schema)
  enrich-*.ts               — DOI/metadata enrichment
  load-to-payload.ts        — Loads normalized JSON into Payload via REST API
  download-pdfs.ts          — PDF download pipeline (stage 1)
  extract-text.ts           — Text extraction pipeline (stage 2)
  update-sources.ts         — Incremental source updater
  organize-topics.ts        — Topic taxonomy management
  assign-publication-topics.ts — Keyword-to-topic mapping

specification/              — Project specs (functionality + implementation variants)
```

## Shared Libraries (`scripts/lib/`)

- `concurrency.ts` — `runConcurrent()`, `runBatch()`, `sleep()`
- `config.ts` — All API endpoints, paths, credentials, defaults
- `types.ts` — `NormalizedPublication`, `NormalizedDocument`, `NormalizedDataset`, etc.
- `payload-client.ts` — Payload REST API auth, CRUD, pagination
- `author-parsing.ts` — Author string parsing (`"Smith JA"` → `{given, family}`)
- `doi-utils.ts` — DOI extraction and title similarity
- `sources.ts` — Fetch logic for all 3 external data sources
- `pdf-manifest.ts` — PDF pipeline state tracker (resumable)
- `pdf-extract.ts` — Digital + OCR text extraction

## Common Pitfalls

- Scripts that write to Payload (load-to-payload, organize-topics, assign-publication-topics) require `npm run dev` running
- The `pdf-parse` npm package is NOT used — text extraction uses system `pdftotext` from poppler
- Topic IDs in Payload are numeric — pass numbers not strings to relationship fields
- The Payload REST API with very large OR queries (>50 clauses) may silently return 0 results
- `scripts/output/` is gitignored — regenerate by running the scraper scripts
