# Data Pipeline Scripts

Scripts for scraping, enriching, and loading data into the RMBL Knowledge Hub.

## Quick Start

```bash
# Full pipeline: check sources → scrape → enrich → load → topics → authors
npx tsx scripts/pipeline.ts --phase=all

# Preview changes without writing
npx tsx scripts/pipeline.ts --phase=check --dry-run
```

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
  download-pdfs.ts → extract-text.ts → load-fulltext.ts
  enrich-abstracts.ts (API + fulltext + Semantic Scholar + PDF extraction)
  extract-references.ts → match-references.ts
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
| `load-to-payload.ts` | Load all collections into Payload | **Yes** |
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
| `crosslink-datasets.ts` | Link publications ↔ datasets | **Yes** |

### Maintenance

| Script | Purpose | Server? |
|---|---|---|
| `update-sources.ts` | Check for new/changed/removed records | No |
| `backfill-pdf-sizes.ts` | Retry HEAD requests for PDF sizes | No |
| `download-institutional.ts` | Playwright-based institutional downloads | No |

## CLI Flags

### Pipeline orchestrator
```
npx tsx scripts/pipeline.ts [--phase=check|ingest|enrich|load|topics|authors|all] [--dry-run]
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
```

## Shared Libraries (`lib/`)

| Module | Purpose |
|---|---|
| `crossref-client.ts` | CrossRef + Unpaywall API queries (strict/relaxed) |
| `topic-rules.ts` | Topic categorization patterns + matching |
| `dataset-discovery.ts` | Dataset dedup + normalization helpers |
| `author-parsing.ts` | Author string parsing + creator name handling |
| `author-dedup.ts` | ORCID + name-based deduplication |
| `doi-utils.ts` | DOI extraction, title similarity |
| `config.ts` | All API endpoints, paths, credentials, rate limits |
| `types.ts` | Shared TypeScript interfaces |
| `payload-client.ts` | Payload REST API auth + CRUD |
| `concurrency.ts` | `runConcurrent()`, `runBatch()`, `sleep()` |
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
  data-catalog-raw.json                 # Raw catalog API data
  data-catalog-normalized.json          # Enriched + normalized datasets
  dataset-metadata-extracted.json       # Metadata from external repos
  topics-seed.json                      # Initial topic taxonomy
  author-registry.json                  # Unified author records
  orcids-harvested.json                 # ORCID registry from DataCite
  references-crossref.json             # CrossRef reference lists
  references-grobid.json               # GROBID-extracted references
  references-fulltext.json             # Regex-parsed references
  datasets-discovered*.json            # Discovered datasets (by source)
  crosslinks-report.json               # Publication-dataset links
  pdf-manifest.json                    # PDF pipeline state
  pdf-staging/                         # Downloaded PDFs + extracted text
  reports/                             # Incremental update reports
```
