# Data Pipeline Scripts

Scripts for scraping, enriching, and loading data into the RMBL Knowledge Commons.

## Quick Start

```bash
# Full pipeline: check sources -> scrape -> discover -> enrich -> load -> topics -> authors -> citations -> embeddings
npm run pipeline

# Preview changes without writing
npm run pipeline:check

# Bidirectional sync with production (Neon)
npm run sync:pull        # download admin edits from Neon
npm run sync:push        # send local pipeline data to Neon
npm run sync:both        # pull then push
npm run sync:verify      # compare row counts
```

## Deployment Workflow

The Knowledge Commons runs on Vercel (hosting) + Neon (PostgreSQL). Code changes auto-deploy on push. Data changes require syncing to Neon.

### Interface changes (code only)
```bash
# Develop and test locally
npm run dev
npm run test
git push                 # Vercel auto-deploys
```

### Monthly data refresh
```bash
# 1. Pull any admin edits from Neon first
npm run sync:pull

# 2. Run pipeline locally (builds on curated data)
npm run pipeline

# 3. Run additional enrichments
npx tsx scripts/enrich-abstracts.ts --step=all
npx tsx scripts/discover-datasets.ts --source=all

# 4. Push new data to Neon
npm run sync:push
```

### After admin curation session
```bash
npm run sync:pull        # download curated edits to local
# Local DB now has admin fixes — future pipeline runs build on curated data
```

### Quick enrichment updates (run directly against Neon)
```bash
npm run sync:safe        # citation counts + embeddings for new items
```

### Full restore (destructive — replaces all Neon data)
```bash
npm run sync:verify      # compare local vs Neon row counts
npm run sync:full        # truncate + restore from local dump
```

### Schema changes (new columns/tables)
```bash
psql rmbl_knowledge_hub < scripts/sql/new-migration.sql   # local
npm run sync:schema                                        # Neon
git push                                                   # redeploy app
```

### Environment setup
All `sync:*` commands require `NEON_DIRECT_URL` in `.env` (the non-pooler Neon connection string). The `VOYAGE_API_KEY` is needed for embedding generation.

## Pipeline Phases

```
Phase 1: CHECK       update-sources.ts         Detect new/changed/removed records
Phase 2: INGEST      scrape-library.ts         Scrape + normalize all 3 sources
                     scrape-publications.ts
                     scrape-catalog.ts
Phase 3: DISCOVER    discover-publications.ts   Find new publications via OpenAlex + CrossRef
Phase 4: ENRICH      enrich.ts                  DOIs, ORCIDs, mentors
Phase 5: LOAD        load-to-payload.ts         Load collections into Payload CMS
Phase 6: TOPICS      manage-topics.ts           Organize taxonomy + assign topics
Phase 7: AUTHORS     build-authors.ts           Build + dedup author registry
Phase 8: CITATIONS   fetch-citation-counts.ts   External citation counts from OpenAlex/DataCite
Phase 9: EMBEDDINGS  generate-embeddings.ts     Vector embeddings for concept graph (requires VOYAGE_API_KEY)

Manual steps (long-running):
  download-pdfs.ts -> extract-text.ts -> load-fulltext.ts
  enrich-abstracts.ts (API + fulltext + Semantic Scholar + PDF extraction)
  extract-references.ts -> match-references.ts
  crosslink-datasets.ts
  discover-datasets.ts
```

## Script Reference

### Orchestrator

| Script | Purpose | Server? |
|---|---|---|
| `pipeline.ts` | Chains phases 1-9 automatically | Yes (phases 5-7) |

### Source Scrapers

| Script | Source | Output | Server? |
|---|---|---|---|
| `scrape-library.ts` | Sustainable Library AJAX + normalize | `sustainable-library*.json`, `topics-seed.json` | No |
| `scrape-publications.ts` | RMBL REST API + CrossRef + Unpaywall | `publications-*.json` | No |
| `scrape-catalog.ts` | RMBL Data Catalog + EML metadata | `data-catalog-*.json` | No |

### Discovery

| Script | Purpose | Server? |
|---|---|---|
| `discover-publications.ts` | OpenAlex + CrossRef geographic search | No |
| `discover-datasets.ts` | All 7 repository sources | No |

### Enrichment

| Script | Purpose | Server? |
|---|---|---|
| `enrich.ts` | DOIs (CrossRef), ORCIDs, student mentors | No (optional Payload) |
| `enrich-abstracts.ts` | Abstracts via API + fulltext regex + Semantic Scholar + PDF | No (optional Payload) |
| `fetch-citation-counts.ts` | External citation counts from OpenAlex/DataCite | DB |
| `generate-embeddings.ts` | Vector embeddings via Voyage AI | DB (requires VOYAGE_API_KEY) |

### Payload Loaders

| Script | Purpose | Server? |
|---|---|---|
| `load-to-payload.ts` | Load all collections into Payload (incremental dedup) | **Yes** |
| `manage-topics.ts` | Organize taxonomy + assign pub topics | **Yes** |
| `build-authors.ts` | Build + dedup author registry | **Yes** (optional) |

### PDF Pipeline

| Script | Purpose | Server? |
|---|---|---|
| `download-pdfs.ts` | Download PDFs to local staging | No |
| `extract-text.ts` | Extract text (digital + OCR) | No |
| `load-fulltext.ts` | Load extracted text into Payload | **Yes** |

### References & Linking

| Script | Purpose | Server? |
|---|---|---|
| `extract-references.ts` | CrossRef + GROBID + fulltext extraction | No |
| `match-references.ts` | Match references + load to PostgreSQL | DB |
| `crosslink-datasets.ts` | Link publications <-> datasets | **Yes** |

### Projects

| Script | Purpose | Server? |
|---|---|---|
| `seed-projects.ts` | Seed projects from research plan data | **Yes** |
| `assign-projects.ts` | Auto-discover and assign items to projects | **Yes** |

### Deployment & Sync

| Script | Purpose | Server? |
|---|---|---|
| `sync-to-neon.ts` | Full sync to Neon (truncate + restore), verify, safe enrichment, schema migration | No |
| `sync-databases.ts` | Bidirectional incremental sync (local <-> Neon) with "remote wins" conflict resolution | No |

**sync-to-neon.ts** modes: `--mode=verify` (compare counts), `--mode=full` (truncate + restore), `--mode=safe` (run enrichments against Neon), `--mode=schema` (apply SQL migrations)

**sync-databases.ts** directions: `--direction=pull` (Neon -> local), `--direction=push` (local -> Neon), `--direction=both` (pull then push). Supports `--dry-run`, `--collection=NAME`, `--since=TIMESTAMP`.

### Maintenance

| Script | Purpose | Server? |
|---|---|---|
| `update-sources.ts` | Check for new/changed/removed records | No |
| `backfill-pdf-sizes.ts` | Retry HEAD requests for PDF sizes | No |
| `download-institutional.ts` | Playwright-based institutional downloads | No |

### Experimental

| Script | Purpose | Server? |
|---|---|---|
| `experiment-extraction.ts` | Compare regex vs Voyage multimodal vs Claude VLM for extraction | No (requires API keys) |

## CLI Flags

### Pipeline orchestrator
```
npx tsx scripts/pipeline.ts [--phase=check|ingest|discover|enrich|load|topics|authors|citations|embeddings|all] [--dry-run]
```

### Neon sync (full restore)
```
npx tsx scripts/sync-to-neon.ts --mode=verify          # compare local vs Neon row counts
npx tsx scripts/sync-to-neon.ts --mode=full [--dry-run] # full data sync (truncate + restore)
npx tsx scripts/sync-to-neon.ts --mode=safe             # run safe enrichments against Neon
npx tsx scripts/sync-to-neon.ts --mode=schema           # apply SQL migrations to Neon
```

### Bidirectional sync (incremental)
```
npx tsx scripts/sync-databases.ts --direction=pull      # download admin edits from Neon
npx tsx scripts/sync-databases.ts --direction=push      # send local changes to Neon
npx tsx scripts/sync-databases.ts --direction=both      # pull then push
npx tsx scripts/sync-databases.ts --direction=both --dry-run
npx tsx scripts/sync-databases.ts --direction=pull --collection=publications
npx tsx scripts/sync-databases.ts --direction=push --since=2026-04-06
```

### Common flags (most scripts)
- `--dry-run` — Preview changes without writing
- `--limit=N` — Process only N records

### Script-specific flags
```
scrape-library.ts       --skip-details --skip-sizes --skip-normalize
scrape-publications.ts  --skip-crossref --skip-unpaywall
scrape-catalog.ts       --skip-metadata
enrich.ts               --step=dois|orcids|mentors|all --update-payload
manage-topics.ts        --organize-only --assign-only
build-authors.ts        --load-payload --dedup-only
extract-references.ts   --method=crossref|grobid|fulltext|all --source=documents|publications
                        --collection=student_paper|thesis|article|all
discover-datasets.ts    --source=dataone|zenodo|datacite|dois|ncei|sciencebase|paleo|all
                        --since=YYYY-MM-DD
update-sources.ts       --source=library|publications|catalog|all
discover-publications.ts --source=openalex|crossref|all
enrich-abstracts.ts     --step=api|fulltext|semantic-scholar|pdf|all
fetch-citation-counts.ts --step=publications|datasets|all --stale-days=30
generate-embeddings.ts  --collection=publications|datasets|documents|all --level=summary --force
assign-projects.ts      --project=NAME
load-to-payload.ts      --collection=topics|documents|publications|datasets|all
```

## Shared Libraries (`lib/`)

| Module | Purpose |
|---|---|
| `config.ts` | All API endpoints, paths, credentials, rate limits; auto-loads `.env` |
| `types.ts` | Shared TypeScript interfaces |
| `payload-client.ts` | Payload REST API auth + CRUD |
| `concurrency.ts` | `runConcurrent()`, `runBatch()`, `sleep()` |
| `record-matching.ts` | Tiered record matching (DOI, title, ORCID, name) + field merge logic |
| `crossref-client.ts` | CrossRef + Unpaywall API queries (strict/relaxed) |
| `topic-rules.ts` | Topic categorization patterns + matching |
| `dataset-discovery.ts` | Dataset dedup + normalization helpers |
| `publication-discovery.ts` | Publication dedup, OpenAlex/CrossRef normalization |
| `author-parsing.ts` | Author string parsing + creator name handling |
| `author-dedup.ts` | ORCID + name-based deduplication |
| `doi-utils.ts` | DOI extraction, title similarity |
| `sources.ts` | External data source fetchers |
| `pdf-extract.ts` | Digital + OCR text extraction |
| `pdf-manifest.ts` | PDF pipeline state tracker |
| `eml-parser.ts` | EML XML metadata parser |

## Output Directory

All scraped/processed data is stored in `scripts/output/` (gitignored):

```
output/
  sustainable-library.json              # Raw scraped docs
  sustainable-library-normalized.json   # Payload-ready docs
  publications-raw.json                 # Raw pub API data
  publications-normalized.json          # Enriched + normalized pubs
  publications-discovered-*.json        # Discovered publications (by source)
  data-catalog-raw.json                 # Raw catalog API data
  data-catalog-normalized.json          # Enriched + normalized datasets
  dataset-metadata-extracted.json       # Metadata from external repos
  datasets-discovered-*.json            # Discovered datasets (by source)
  topics-seed.json                      # Initial topic taxonomy
  author-registry.json                  # Unified author records
  orcids-harvested.json                 # ORCID registry from DataCite
  references-crossref.json              # CrossRef reference lists
  references-grobid.json                # GROBID-extracted references
  references-fulltext.json              # Regex-parsed references
  crosslinks-report.json                # Publication-dataset links
  pdf-manifest.json                     # PDF pipeline state
  pdf-staging/                          # Downloaded PDFs + extracted text
  reports/                              # Incremental update reports
```
