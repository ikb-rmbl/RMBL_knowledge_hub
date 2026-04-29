# CLAUDE.md — RMBL Knowledge Hub

## Project Overview

Unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado:
- **Publications** (4,852) — peer-reviewed articles, theses, student papers (3,988 RMBL + 864 discovered)
- **Documents** (1,381) — community/policy documents from the Sustainable Living Library
- **Datasets** (1,426) — research datasets from 8 discovery sources
- **Stories** (841) — news articles from CB News, Gunnison Times, LexisNexis (13 LLM-classified types; full text stored for search, not displayed for copyright)
- **Authors** (6,696) — deduplicated cross-collection author registry with ORCID enrichment
- **Projects** (118) — research plans and programs with auto-discovered item assignments
- **Species** (1,206) — taxonomic entities with ITIS validation and external links
- **Places** (1,954) — geographic entities with coordinates and hierarchy
- **Protocols** (1,474) — research methods with embedding-based clustering
- **Concepts** (4,874) — scientific concepts with type/scope classification
- **Stakeholders** (5,023) — agencies, organizations, institutions with type classification
- **Neighborhoods** (151) — Louvain-detected research communities with LLM-generated descriptions and primers
- **Entity Mentions** (98,252) — cross-links between entities and all collections (publications, datasets, documents, stories)
- **References** (143,289) — citation network with 10,619 internal links + 19,827 story→publication links
- **Embeddings** (8,239) — Voyage AI voyage-4 vector embeddings for semantic similarity search

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
  collections/                   — 9 Payload collections (Documents, Publications, Datasets, Stories, Topics, Authors, Projects, Users, Media)
  services/                      — 6 service modules (search, graph, neighborhoods, entities, items, related)
  collections/shared/access.ts   — Shared access control (publicReadAuthWrite)
  collections/shared/constants.ts — Shared field option constants
  app/(frontend)/                — Public-facing Next.js pages
    page.tsx                     — Home page
    layout.tsx                   — Site layout (RMBL header, footer)
    styles.css                   — RMBL brand styling
    search/page.tsx              — Unified search with faceted filtering + entity knowledge cards
    publications/[id]/page.tsx   — Publication detail
    documents/[id]/page.tsx      — Document detail
    datasets/[id]/page.tsx       — Dataset detail
    authors/page.tsx             — Author browse
    authors/[id]/page.tsx        — Author detail with project cards, sortable/filterable works
    species/page.tsx             — Species browse with kingdom chips
    species/[id]/page.tsx        — Species detail with external links, co-occurring species
    places/page.tsx              — Places browse with Referenced/All chips
    places/[id]/page.tsx         — Place detail with OpenStreetMap embed, linked works
    protocols/page.tsx           — Protocols browse with Standardized chip
    protocols/[id]/page.tsx      — Protocol detail with co-occurring entities
    concepts/page.tsx            — Concepts browse with type chips
    concepts/[id]/page.tsx       — Concept detail with co-occurring entities
    stories/page.tsx             — Stories browse with type/date/focus filters and sidebar
    stories/[id]/page.tsx        — Story detail with entity chips, related stories/publications
    neighborhoods/page.tsx       — Neighborhoods browse with focus classification (research/policy/news/mixed)
    neighborhoods/[id]/page.tsx  — Neighborhood detail with expandable member lists, primers, local graph
    projects/page.tsx            — Project browse
    projects/[id]/page.tsx       — Project detail with assigned items
    about/page.tsx               — About page with FAQ, AI integration guide, technical deep-dive
    explore/neighborhoods/       — Neighborhood-colored unified graph visualization
    api/search/route.ts          — Search API endpoint (validated, parameterized)
    api/v1/                      — REST API v1 (11 endpoints, format=json|text, rate-limited)
    api/v1/search/               — Full-text search
    api/v1/publications/[id]/    — Publication detail with authors + entities + citations
    api/v1/datasets/[id]/        — Dataset detail with creators
    api/v1/documents/[id]/       — Document detail with entities + stakeholders
    api/v1/authors/[id]/         — Author profile with works + co-authors
    api/v1/entities/[type]/      — Entity browse + detail + mentions
    api/v1/related/              — 4-signal related works
    api/v1/neighborhoods/        — Neighborhood browse + detail with primers
    api/v1/export/               — Batch citation export (RIS, BibTeX)
    api/v1/export-search/        — Export all search results
    api/v1/lib/rate-limit.ts     — Per-IP rate limiting (60/min general, 10/min expensive)
    api/v1/lib/text-format.ts    — LLM-friendly plain text formatters
    api/v1/lib/citation-format.ts — RIS and BibTeX formatters
    lib/badges.ts                — Collection type badge labels/classes (publication, dataset, document, story)
    lib/db.ts                    — Shared PostgreSQL pool for frontend (serverless tuning)
    lib/related-works.tsx        — Related works panel (delegates to related service)
    lib/graph-data.ts            — Graph data fetching (delegates to graph service)
    lib/url-validation.ts        — URL/DOI/ORCID format validation for safe rendering
    lib/graph-colors.ts          — GRAPH_COLORS and ENTITY_TYPE_LABELS for graph/badge coloring
    lib/json-ld.tsx              — Schema.org/Bioschemas JSON-LD helpers
    components/ExpandableRelatedWorks.tsx — Client-side expand/collapse for related works
    components/ExpandableTopics.tsx       — Client-side expand/collapse for topic lists
    components/ExploreEntityGraph.tsx     — Sigma.js WebGL graph with dynamic color palettes
    components/ThemeToggle.tsx            — Light/dark mode toggle
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
  experiment-extraction.ts   — VLM entity extraction via Claude vision (resumable, incremental saves)
  select-experiment-papers.ts — Stratified paper sampling for VLM extraction
  load-extraction-results.ts — Load VLM results into entity_candidates tables
  cluster-protocols.ts       — Embedding-based protocol dedup and clustering
  cluster-concepts.ts        — Embedding-based concept dedup and clustering
  link-species-places.ts     — Species ITIS validation + places hierarchy linking
  seed-places-gnis.ts        — Seed places from GNIS authoritative data (668 locations)
  build-explore-graph.ts     — Pre-compute entity co-occurrence graphs (concepts, species, protocols, places)
  build-collection-graph.ts  — Pre-compute collection graphs (authors, publications, datasets)
  build-unified-graph.ts     — Combined graph across all entity and collection types
  detect-communities.ts      — Louvain community detection on unified graph (151 neighborhoods)
  describe-communities.ts    — LLM-generated titles, summaries, and themes for neighborhoods
  load-neighborhoods.ts      — Load community data + members into neighborhoods tables
  layout-neighborhoods.ts    — Pre-compute ForceAtlas2 subgraph layouts for detail pages
  generate-primers.ts        — LLM research primers for neighborhoods (Opus, --model=opus|sonnet)
  fix-author-order.ts        — Repair authors_rels ordering from publications_authors ground truth
  fix-author-splits.ts       — Split false author merges using middle-initial signatures
  scrape-news.ts             — Crested Butte News scraper (search results + article text)
  scrape-gunnison-times.ts   — Gunnison Country Times scraper (current + archive search)
  parse-lexis-pdf.ts         — LexisNexis index PDF parser (metadata + embedded links)
  parse-lexis-fulltext.ts    — LexisNexis full-text PDF parser (Page 1 anchoring + link extraction)
  load-stories.ts            — Load stories from all sources (CB News, Gunnison Times, Lexis)
  dedup-stories.ts           — Deduplicate stories (non-relevant, exact, syndication, RMBL relevance check)
  extract-story-entities.ts  — LLM entity extraction for stories (Opus 4.7, 8 entity types)
  load-story-extractions.ts  — Load story extractions into entity_mentions + update story_type
  link-stories-publications.ts — Build story↔publication links (title, researcher, entity matching)
  check-staleness.ts         — Check pipeline staleness + recommend rebuild actions
  sync-bulk-to-neon.ts       — Targeted sync for neighborhoods + story entity mentions
  setup-local.sh             — Automated local development environment setup
  export-database.sh         — Database export for sharing (excludes sensitive tables)
  lib/                       — 17 shared utility modules (includes itis-client.ts)
  sql/                       — SQL migration files (provenance, citations, embeddings, projects, entities, sync_log, neighborhoods, stories)
  __tests__/                 — 12 test files (214 tests)

public/
  robots.txt                 — Crawler policy (allows GPTBot, ClaudeBot, PerplexityBot)
  llms.txt                   — LLM discovery index with API docs and collection stats
  rmbl-logo.jpg              — RMBL logo for site header

mcp/                         — MCP server for AI assistant access (8 tools, stdio transport)
  src/index.ts               — Server setup with tool registration
  src/client.ts              — HTTP client for REST API v1

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
- **Rate limiting**: Per-IP sliding window on /api/v1/* (60/min general, 10/min expensive)
- **Security headers**: X-Content-Type-Options, X-Frame-Options, Cache-Control on /api/v1/*

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
- Stories collection created manually via SQL (`scripts/sql/add-stories.sql`), not via Payload push
- Stories full text is stored for search indexing but NOT displayed on detail pages (copyright)
- `load-stories.ts` loads from 4 JSON sources in `scripts/output/` — run scrapers/parsers first
- `dedup-stories.ts` should be run after every story load to remove syndication duplicates
- LexisNexis articles require institutional auth — links are Lexis API URLs, not publicly accessible
- Story ingestion pipeline: scrape/parse → load → dedup → extract entities
- Run `npx tsx scripts/check-staleness.ts` after data changes to see what needs rebuilding

## MCP Server Architecture

Two MCP server implementations:
- **Remote (Streamable HTTP)**: `POST /api/mcp` — stateless, runs on Vercel serverless, no install needed. Users add URL as a Custom Connector in Claude Desktop.
- **Local (stdio)**: `mcp/` package — for development or when users want to run locally.

Both share the same tool definitions via `src/app/(frontend)/api/mcp/server.ts`, which calls the REST API v1 internally.

**OpenAI/ChatGPT compatibility**: Not currently supported. OpenAI requires the old SSE transport (`/sse/` endpoint with long-lived GET connections), which is incompatible with Vercel serverless (function timeout limits). Will add support when OpenAI adopts the Streamable HTTP standard. ChatGPT users can use the REST API directly with `?format=text`.

**Tool naming**: Our tools use descriptive names (`search_rmbl`, `get_publication`, `explore_neighborhood`) optimized for Claude. OpenAI requires generic `search`/`fetch` tool names. If OpenAI support is added, a separate endpoint with adapted tool names would be needed (dual-endpoint approach, not renaming existing tools).

## Rebuild Strategy

When to do a **full rebuild** (graph + communities + primers):
- Adding a new collection type (e.g., stories) — changes graph structure fundamentally
- Major entity extraction run (>1K new entity mentions) — shifts co-occurrence patterns
- Changing edge weights or graph construction logic
- Community re-detection invalidates ALL existing primers (community IDs are non-deterministic)

When **incremental** is sufficient:
- Adding <100 new items to an existing collection
- Fixing metadata (authors, dates, summaries)
- UI/API changes, frontend-only work

Full rebuild order:
```bash
# 1. Entity graphs (species, concepts, protocols, places, authors, publications, datasets)
npx tsx scripts/build-explore-graph.ts
npx tsx scripts/build-collection-graph.ts

# 2. Unified graph + research-only variant
npx tsx scripts/build-unified-graph.ts
npx tsx scripts/build-unified-graph.ts --exclude-docs --output=unified-research.json

# 3. Community detection (invalidates all primers!)
npx tsx scripts/detect-communities.ts

# 4. Community descriptions + neighborhoods + layouts
npx tsx scripts/describe-communities.ts
npx tsx scripts/load-neighborhoods.ts
npx tsx scripts/layout-neighborhoods.ts

# 5. Primers (most expensive step — ~$4 with Opus for 75 neighborhoods)
npx tsx scripts/generate-primers.ts --limit=100 --model=opus
```

**IMPORTANT**: Community detection (step 3) assigns new community IDs each run. All existing primers become invalid because they're attached to neighborhood rows by ID. Always regenerate primers after re-detecting communities.

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
