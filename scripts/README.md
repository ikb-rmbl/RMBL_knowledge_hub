# Data Pipeline Scripts

Scripts for scraping, enriching, and loading data into the RMBL Knowledge Hub.

## Execution Order

```
Source Scraping          Enrichment              Loading (requires dev server)
─────────────          ──────────              ──────────────────────────────
scrape-sustainable  ──→ normalize-sustainable ─┐
scrape-publications ──→ enrich-missing-dois ───┼──→ load-to-payload
scrape-data-catalog ──→ scrape-dataset-metadata┘     │
                                                      ├──→ organize-topics
                                                      └──→ assign-publication-topics

PDF Processing (independent, long-running)
──────────────────────────────────────────
download-pdfs ──→ extract-text

Maintenance
───────────
update-sources (periodic check for new/changed records)
```

## Script Reference

### Source Scrapers

| Script | Source | Output | Server? | Runtime |
|---|---|---|---|---|
| `scrape-sustainable-library.ts` | Sustainable Library AJAX API | `sustainable-library.json` | No | ~10 min |
| `scrape-publications.ts` | RMBL REST API + CrossRef + Unpaywall | `publications-raw.json`, `publications-normalized.json` | No | ~15 min |
| `scrape-data-catalog.ts` | RMBL Data Catalog REST API | `data-catalog-raw.json`, `data-catalog-normalized.json` | No | ~1 min |

### Normalizers & Enrichment

| Script | Purpose | Input | Output | Server? | Runtime |
|---|---|---|---|---|---|
| `normalize-sustainable-library.ts` | Map to Payload schema | `sustainable-library.json` | `sustainable-library-normalized.json`, `topics-seed.json` | No | <1 min |
| `enrich-missing-dois.ts` | Relaxed CrossRef search for missing DOIs | `publications-normalized.json` | Updates in place | No | ~5 min |
| `scrape-dataset-metadata.ts` | Fetch metadata XML from repos | `data-catalog-raw.json` | `dataset-metadata-extracted.json` | No | ~3 min |

### Payload Loaders

| Script | Purpose | Server? | Runtime |
|---|---|---|---|
| `load-to-payload.ts` | Load all collections into Payload | **Yes** | ~5 min |
| `organize-topics.ts` | Assign topics to parent categories | **Yes** | ~3 min |
| `assign-publication-topics.ts` | Map keywords to topics | **Yes** | ~10 min |

### PDF Pipeline

| Script | Purpose | Server? | Runtime |
|---|---|---|---|
| `download-pdfs.ts` | Download PDFs to local staging | No | ~30 min |
| `extract-text.ts` | Extract text (digital + OCR) | No | 1-8 hours |
| `backfill-pdf-sizes.ts` | Retry HEAD requests for sizes | No | ~5 min |
| `download-institutional.ts` | Playwright-based institutional downloads | No | Varies |

### Maintenance

| Script | Purpose | Server? | Runtime |
|---|---|---|---|
| `update-sources.ts` | Check for new/changed/removed records | No | ~5 min |

## CLI Flags

Most scripts support:
- `--dry-run` — Preview changes without writing
- `--limit=N` — Process only N records
- `--collection=X` — Scope to a specific collection
- `--skip-crossref` / `--skip-unpaywall` — Skip enrichment steps
- `--retry-failed` — Retry previously failed items

## Shared Libraries (`lib/`)

| Module | Purpose |
|---|---|
| `concurrency.ts` | `runConcurrent()`, `runBatch()`, `sleep()` |
| `config.ts` | All API endpoints, paths, credentials |
| `types.ts` | Shared TypeScript interfaces |
| `payload-client.ts` | Payload REST API auth + CRUD |
| `author-parsing.ts` | Author string parsing |
| `doi-utils.ts` | DOI extraction, title similarity |
| `sources.ts` | External data source fetchers |
| `pdf-manifest.ts` | PDF pipeline state tracker |
| `pdf-extract.ts` | Digital + OCR text extraction |

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
  pdf-manifest.json                     # PDF pipeline state
  pdf-staging/                          # Downloaded PDFs
  reports/                              # Incremental update reports
```
