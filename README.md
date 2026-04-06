# RMBL Knowledge Hub

A unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado. Brings together community documents, scientific publications, and research datasets into a single searchable interface with citation network navigation.

## What's Inside

- **1,381 documents** from the [Gunnison Sustainable Living Library](https://sustainablelibrary.org/) — community planning, mining history, water policy, and environmental impact documents
- **3,934 publications** from the [RMBL Publications Database](https://www.rmbl.org/scientists/resources/publications/) — journal articles, theses, student papers, and books spanning decades of research
- **1,069 datasets** discovered from 8 repositories — DataONE, DataCite, Zenodo, NCEI, ScienceBase, and more
- **4,724 authors** — deduplicated cross-collection registry with ORCID enrichment
- **126,752 references** — citation network with 11,626 internal links enabling "cited by" navigation

## Architecture

```
Next.js 16 + Payload CMS 3.x (single app)
    |
    ├── Public frontend (search, browse, detail pages)
    ├── Payload admin panel (/admin)
    └── REST + GraphQL APIs (auto-generated)
         |
    PostgreSQL 17 (local / Neon)
    ├── Payload collections (7)
    ├── tsvector full-text search indexes
    ├── Custom tables (references_cited, publications_mentors)
         |
    AWS S3 (PDF + media storage)
```

The data pipeline scrapes three external sources, enriches with CrossRef DOIs and Unpaywall open-access links, extracts text from PDFs (digital + OCR), builds citation networks, and loads everything into Payload CMS.

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

Run the full automated pipeline:

```bash
# Automated pipeline: check sources → scrape → enrich → load → topics → authors
npm run pipeline

# Or preview what would change first
npm run pipeline:check
```

Or run individual steps:

```bash
# 1. Scrape source data
npx tsx scripts/scrape-library.ts
npx tsx scripts/scrape-publications.ts
npx tsx scripts/scrape-catalog.ts

# 2. Enrich (DOIs, ORCIDs, mentors)
npx tsx scripts/enrich.ts --step=all

# 3. Load into Payload (requires npm run dev in another terminal)
npx tsx scripts/load-to-payload.ts
npx tsx scripts/manage-topics.ts
npx tsx scripts/build-authors.ts --load-payload

# 4. PDF processing (optional, long-running)
npx tsx scripts/download-pdfs.ts
npx tsx scripts/extract-text.ts
npx tsx scripts/load-fulltext.ts

# 5. References (optional)
npx tsx scripts/extract-references.ts --method=all
npx tsx scripts/match-references.ts

# 6. Dataset discovery (optional)
npx tsx scripts/discover-datasets.ts --source=all
npx tsx scripts/crosslink-datasets.ts
```

See `scripts/README.md` for detailed documentation of each script, CLI flags, and shared libraries.

## Project Structure

```
src/
  payload.config.ts           # CMS configuration
  collections/                # Data model (7 collections)
  app/(frontend)/             # Public search interface
  app/(payload)/              # Admin panel

scripts/
  pipeline.ts                 # Orchestrator (6 phases)
  scrape-*.ts                 # Source data scrapers (3)
  enrich.ts                   # DOI/ORCID/mentor enrichment
  load-to-payload.ts          # Database loader
  manage-topics.ts            # Topic taxonomy + assignment
  build-authors.ts            # Author registry + dedup
  extract-references.ts       # CrossRef + GROBID + fulltext
  match-references.ts         # Reference matching
  discover-datasets.ts        # 7-source dataset discovery
  crosslink-datasets.ts       # Publication↔dataset linking
  lib/                        # 14 shared utility modules

specification/                # Technical specs
```

## Development

```bash
npm run dev           # Start dev server
npm run test          # Run tests (128 tests, Vitest)
npm run lint          # Lint check
npm run build         # Production build
npm run pipeline      # Full data pipeline
npm run pipeline:check  # Preview source changes
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
