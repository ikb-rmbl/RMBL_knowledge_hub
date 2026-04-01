# RMBL Knowledge Hub

A unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado. Brings together community documents, scientific publications, and research datasets into a single searchable interface.

## What's Inside

- **1,383 documents** from the [Gunnison Sustainable Living Library](https://sustainablelibrary.org/) — community planning, mining history, water policy, and environmental impact documents
- **3,972 publications** from the [RMBL Publications Database](https://www.rmbl.org/scientists/resources/publications/) — journal articles, theses, student papers, and books spanning decades of research
- **304 datasets** from the [RMBL Data Catalog](https://www.rmbl.org/scientists/resources/data-catalog/) — GIS layers, weather data, ecological monitoring, and remote sensing products

## Architecture

```
Next.js 16 + Payload CMS 3.x (single app)
    |
    ├── Public frontend (search, browse, detail pages)
    ├── Payload admin panel (/admin)
    └── REST + GraphQL APIs (auto-generated)
         |
    PostgreSQL 17 (local / Neon)
         |
    AWS S3 (PDF + media storage)
```

The data pipeline scrapes three external sources, enriches with CrossRef DOIs and Unpaywall open-access links, extracts text from PDFs (digital + OCR), and loads everything into Payload CMS.

## Quick Start

### Prerequisites

- [fnm](https://github.com/Schniz/fnm) (Node version manager)
- PostgreSQL 17 (`brew install postgresql@17`)
- poppler + tesseract for PDF processing (`brew install poppler tesseract`)

### Setup

```bash
git clone https://github.com/ikb-rmbl/RMBL_knowledge_hub.git
cd RMBL_knowledge_hub
fnm use 22
npm install

# Create and configure the database
brew services start postgresql@17
createdb rmbl_knowledge_hub
cp .env.example .env  # Edit with your settings

# Start the dev server
npm run dev  # -> http://localhost:3000
```

### Data Pipeline

To populate the database from scratch, run the scripts in this order:

```bash
# 1. Scrape source data
npx tsx scripts/scrape-sustainable-library.ts
npx tsx scripts/normalize-sustainable-library.ts
npx tsx scripts/scrape-publications.ts
npx tsx scripts/scrape-data-catalog.ts
npx tsx scripts/scrape-dataset-metadata.ts

# 2. Enrich
npx tsx scripts/enrich-missing-dois.ts

# 3. Load into Payload (requires npm run dev in another terminal)
npx tsx scripts/load-to-payload.ts
npx tsx scripts/organize-topics.ts
npx tsx scripts/assign-publication-topics.ts

# 4. PDF processing (optional, long-running)
npx tsx scripts/download-pdfs.ts
npx tsx scripts/extract-text.ts
```

See `scripts/README.md` for detailed documentation of each script.

## Project Structure

```
src/
  payload.config.ts           # CMS configuration
  collections/                # Data model (Documents, Publications, Datasets, Topics)
  app/(frontend)/             # Public search interface
  app/(payload)/              # Admin panel

scripts/
  lib/                        # Shared utilities
  scrape-*.ts                 # Source data scrapers
  normalize-*.ts              # Data normalization
  enrich-*.ts                 # DOI/metadata enrichment
  load-to-payload.ts          # Database loader
  download-pdfs.ts            # PDF download pipeline
  extract-text.ts             # Text extraction (digital + OCR)
  update-sources.ts           # Incremental source updates

specification/                # Technical specs
```

## Development

```bash
npm run dev           # Start dev server
npm run test          # Run tests
npm run lint          # Lint check
npm run build         # Production build
npm run generate:types  # Regenerate Payload TypeScript types
```

## Deployment

Target stack: **Vercel** (hosting) + **Neon** (PostgreSQL) + **AWS S3** (file storage)

Required environment variables:
- `DATABASE_URL` — Neon connection string
- `PAYLOAD_SECRET` — 32+ character encryption key
- `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`

## License

This project is developed for the Rocky Mountain Biological Laboratory under grant funding.
