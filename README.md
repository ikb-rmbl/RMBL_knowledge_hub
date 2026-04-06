# RMBL Knowledge Hub

A unified search platform for environmental knowledge from the Rocky Mountain Biological Laboratory (RMBL) and Gunnison Basin, Colorado. Brings together community documents, scientific publications, and research datasets into a single searchable interface with citation network navigation.

## What's Inside

- **1,381 documents** from the [Gunnison Sustainable Living Library](https://sustainablelibrary.org/) — community planning, mining history, water policy, and environmental impact documents
- **5,213 publications** from the RMBL Publications Database + OpenAlex/CrossRef discovery — journal articles, theses, student papers spanning decades of Gunnison Basin research
- **1,216 datasets** discovered from 8 repositories — DataONE, DataCite, Zenodo, NCEI, ScienceBase, and more
- **6,582 authors** — deduplicated cross-collection registry with ORCID enrichment
- **118 research projects** — active research plans and long-term programs with auto-discovered item assignments
- **106,209 references** — citation network with 10,045 internal links enabling "cited by" navigation
- **7,758 vector embeddings** — concept graph powering "Related Works" panels and similarity search
- **40 thematic topics** across 7 groups — from Flowering & Pollination to Archaeology & Cultural History

## Architecture

```
Next.js 16 + Payload CMS 3.x (single app)
    |
    ├── Public frontend (search, browse, detail, project pages)
    ├── Payload admin panel (/admin)
    └── REST + GraphQL APIs (auto-generated)
         |
    PostgreSQL 17 + pgvector (local / Neon)
    ├── Payload collections (8)
    ├── tsvector full-text search indexes
    ├── pgvector HNSW indexes (concept graph / similarity)
    ├── Custom tables (references_cited, content_chunks, publications_mentors)
         |
    AWS S3 (PDF + media storage)
    Voyage AI (vector embeddings)
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
  collections/                # Data model (8 collections including Projects)
  app/(frontend)/             # Public pages (search, browse, detail, projects)
  app/(frontend)/lib/         # Shared utilities (badges, related-works)
  app/(frontend)/components/  # Client components
  app/(payload)/              # Admin panel

scripts/
  pipeline.ts                 # Orchestrator (9 phases)
  scrape-*.ts                 # Source data scrapers (3)
  discover-publications.ts    # OpenAlex + CrossRef geographic discovery
  discover-datasets.ts        # 7-source dataset discovery
  enrich.ts                   # DOI/ORCID/mentor enrichment
  enrich-abstracts.ts         # Abstract enrichment (4 tiers)
  load-to-payload.ts          # Database loader
  manage-topics.ts            # 40-topic thematic taxonomy
  build-authors.ts            # Author registry + dedup
  fetch-citation-counts.ts    # External citation counts
  generate-embeddings.ts      # Voyage AI vector embeddings
  seed-projects.ts            # Research project seeding
  assign-projects.ts          # Auto-discover project items
  extract-references.ts       # CrossRef + GROBID + fulltext
  match-references.ts         # Reference matching
  crosslink-datasets.ts       # Publication↔dataset linking
  lib/                        # 14 shared utility modules
  sql/                        # Manual SQL migrations

public/
  rmbl-logo.jpg               # RMBL logo

specification/                # Technical specs
```

## Development

```bash
npm run dev           # Start dev server
npm run test          # Run tests (158 tests, Vitest)
npm run lint          # Lint check
npm run build         # Production build
npm run pipeline      # Full data pipeline
npm run pipeline:check  # Preview source changes
npm run generate:types  # Regenerate Payload TypeScript types
```

## Deployment

**Production stack:** Vercel (hosting) + Neon (PostgreSQL + pgvector) + Cloudflare R2 (file storage)

### Environment variables (set in Vercel dashboard)

- `DATABASE_URL` — Neon pooled connection string
- `PAYLOAD_SECRET` — 32+ character encryption key
- `PAYLOAD_ADMIN_EMAIL` — Admin login email
- `PAYLOAD_ADMIN_PASSWORD` — Admin login password
- `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_ENDPOINT` — File storage
- `VOYAGE_API_KEY` — Voyage AI for vector embeddings

### Updating production data

```bash
# Run pipeline locally, then sync to Neon
npm run pipeline                     # update local data
npm run sync:verify                  # compare local vs production
npm run sync:full                    # push to production

# Or run safe enrichments directly against production
npm run sync:safe                    # citation counts + embeddings
```

See `scripts/README.md` for detailed deployment workflow documentation.

## License

This project is developed for the Rocky Mountain Biological Laboratory under grant funding.
Support for the Knowledge Hub provided by the Clark Family Foundation.
