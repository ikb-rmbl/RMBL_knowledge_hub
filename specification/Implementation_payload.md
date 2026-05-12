# RMBL Knowledge Fabric — Technical Specification (Payload CMS Variant)

**Version:** 1.0
**Date:** February 2026
**Author:** Ian (Solo Developer)
**Status:** Draft

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Overview & Goals](#2-project-overview--goals)
3. [User Stories & Personas](#3-user-stories--personas)
4. [Content Model & Metadata Standards](#4-content-model--metadata-standards)
5. [System Architecture](#5-system-architecture)
6. [Search Architecture](#6-search-architecture)
7. [Data Migration Strategy](#7-data-migration-strategy)
8. [UI/UX Design](#8-uiux-design)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [Security & Access Control](#10-security--access-control)
11. [Development Phases & Timeline](#11-development-phases--timeline)
12. [Future Considerations](#12-future-considerations-post-grant)

---

## 1. Executive Summary

### Problem

Three critical knowledge resources about Western Colorado's Gunnison Basin exist in isolation:

- The **Gunnison Sustainable Living Library** — hundreds of community and environmental policy documents
- **RMBL's Publication Database** — thousands of peer-reviewed research records spanning decades
- **RMBL's Data Catalog and Spatial Data Platform** — GIS layers, sensor data, and ecological datasets

Each lives on a separate WordPress site or data repository with its own search, its own metadata conventions, and no cross-referencing. A community planner searching for water quality information must check three different sites and has no way to discover that a policy document, a peer-reviewed study, and a monitoring dataset all address the same issue. Researchers face the same fragmentation — publications don't link to their underlying datasets, and historical community documents that provide crucial local context are invisible to scientific search.

### Solution

The **RMBL Knowledge Fabric** unifies all three collections into a single searchable platform with:

- **Faceted full-text search** across all resource types (Phase 1)
- **Semantic/hybrid search** using vector embeddings for natural-language queries (Phase 2)
- **AI-powered research assistant** that synthesizes answers from the full corpus with inline citations (Phase 3)

### Key Outcomes

- A single search box that finds documents, publications, and datasets simultaneously
- Standards-compliant metadata (DataCite, CSL-JSON, Dublin Core) enabling interoperability with the broader research ecosystem
- Cross-collection discovery — see the dataset behind a publication, the policy context around a research finding
- Equally useful for community members seeking plain-language information and researchers needing citation-quality metadata

### Success Metrics

| Metric | Target |
|---|---|
| Total records migrated and searchable | 95%+ of source content |
| Search relevance (user satisfaction) | >80% find what they need in first 5 results |
| Page load time (search results) | <2 seconds |
| Accessibility | WCAG 2.1 AA compliance |
| Monthly active users (6 months post-launch) | Baseline established; 2x source site traffic |

---

## 2. Project Overview & Goals

### Mission

The RMBL Knowledge Fabric makes the environmental knowledge of the Gunnison Basin — scientific research, community documents, and ecological data — discoverable, connected, and accessible to everyone, from local residents to visiting researchers.

### The Three Source Collections

#### Sustainable Living Library

- **Content:** Hundreds of PDFs covering community planning, mining history, water policy, energy, land use, and environmental impact documents for the Gunnison Basin
- **Current state:** WordPress site with SearchWP plugin; documents organized by category; full-text search limited to PDF metadata rather than content
- **Limitations:** No structured metadata beyond title and category; no connection to related scientific research or datasets; aging infrastructure

#### RMBL Publication Database

- **Content:** Thousands of bibliographic records — journal articles, theses, books, book chapters, and student papers — representing decades of research conducted at or associated with the Rocky Mountain Biological Laboratory
- **Current state:** WordPress site with a custom database; records include standard bibliographic fields (authors, year, journal, DOI); many recent publications have linked PDFs hosted on RMBL's site or accessible via publisher/open-access links
- **Limitations:** Search is basic (keyword matching on metadata); no full-text search of PDF contents; no connection to underlying datasets or community documents; citation export not available

#### RMBL Data Catalog + Spatial Data Platform (SDP)

- **Content:** GIS layers, weather station data, ecological monitoring datasets, remote sensing products — primarily hosted on S3 and ESS-DIVE
- **Current state:** Catalog site with browseable listings; SDP publishes a CSV manifest of all products with S3 download links
- **Limitations:** Minimal cross-referencing to the publications that produced or used the data; metadata varies in completeness; no unified search with other RMBL resources

### Core Value Proposition

A combined platform enables what separate sites cannot:

- **Cross-collection discovery:** Search for "molybdenum water quality" and find the 1982 mining EIS (document), a 2019 trace metals study (publication), and the East River water chemistry dataset — all in one result set
- **Research context:** Every publication can link to its underlying datasets; every dataset can link to publications that used it; community documents provide historical and policy context for scientific work
- **Full-text search at depth:** Extracted text from PDFs (both library documents and publications) enables searching within document content, not just titles and metadata
- **AI-augmented research:** A conversational interface that can synthesize information across all three collections and cite its sources

### Target Audiences

The Knowledge Fabric serves two primary audiences with equal priority:

1. **Community members, planners, and advocates** — people who need accessible information about their region's environment, history, and policy without needing a science degree to find it
2. **Scientists, researchers, and students** — people who need precise metadata, citation-quality records, dataset access, and the ability to discover connections between publications and data

Both audiences benefit from the same underlying infrastructure; the difference is in presentation (plain-language summaries vs. full bibliographic metadata) and in progressive disclosure (summary first, detail on demand).

---

## 3. User Stories & Personas

### Persona A — Community Member / Planner / Advocate

**Profile:** Sarah is a county planner working on water resource management in Gunnison County. She has a general science background but is not a specialist. She needs to find reliable information about water quality, mining impacts, and historical policy decisions.

**User Stories:**

- *"I want to search for all resources about water quality in the East River so I can prepare for a public meeting about watershed management."*
  - Searches "East River water quality" → sees policy documents, scientific studies, and monitoring data together → filters by date range to focus on recent resources

- *"I want to understand what research has been done on the molybdenum mine proposal so I can brief my board."*
  - Searches "Mt. Emmons molybdenum" → finds the original EIS, follow-up studies, and related water chemistry data → reads plain-language abstracts

- *"I want a summary of what scientists have found about drought impacts in this area without reading 20 papers."* (Phase 3)
  - Uses "Ask the Knowledge Fabric" → gets a synthesized answer with citations → follows citations to the source documents for details

### Persona B — Scientist / Researcher / Student

**Profile:** Dr. Chen is an ecologist planning a field season at RMBL. She needs to find existing datasets for her study area, discover what has already been published on her topic, and export citations for a grant proposal.

**User Stories:**

- *"I want to find all datasets related to snow water equivalent measurements near Gothic so I can plan my field methodology."*
  - Searches "snow water equivalent Gothic" → filters to Datasets → sees available data with temporal and spatial extent → downloads what she needs

- *"I want to see what publications have used this particular dataset so I can cite them and avoid duplicating work."*
  - Views a dataset detail page → sees "Related Publications" section → exports citations in BibTeX format for her reference manager

- *"I want to find all publications by a specific author to review their body of work at RMBL."*
  - Searches by author name → filters to Publications → sees a complete list → uses "Find Similar" to discover related work by other authors

- *"I want to identify gaps in research on alpine plant phenology at RMBL."* (Phase 3)
  - Uses "Ask the Knowledge Fabric" → asks about existing phenology research → gets a summary of what exists and what time periods/species are under-studied

### Persona C — Content Manager (1-3 staff)

**Profile:** Alex is an RMBL staff member responsible for keeping the Knowledge Fabric current. They have moderate technical skills and access to the admin panel.

**User Stories:**

- *"I want to add a newly published paper with its metadata so it appears in search results immediately."*
  - Opens Payload admin → creates new Publication → enters metadata (or pastes DOI for auto-fill via CrossRef) → uploads PDF if available → publishes

- *"I want to batch-import a set of historical documents that were just digitized."*
  - Uses the bulk import tool → uploads a CSV of metadata + a folder of PDFs → reviews auto-generated records → publishes after QA

- *"I want to tag and categorize newly ingested content so it appears in the right browse categories."*
  - Opens a record in the admin panel → adds topics/categories → saves → record immediately appears in relevant browse filters

---

## 4. Content Model & Metadata Standards

### Overview

Three primary Payload CMS collections, each mapped to a recognized metadata standard for interoperability. All collections share a set of common fields that enable unified search.

### Document Collection (Sustainable Library Content)

**Metadata standard:** Dublin Core (ISO 15836)

| Field | Type | Required | Dublin Core Mapping | Notes |
|---|---|---|---|---|
| `title` | text | yes | `dc:title` | Document title |
| `summary` | richtext | no | `dc:description` | Short description or abstract |
| `full_text` | textarea | no | — | Extracted from PDF; used for search indexing, not displayed in full |
| `categories` | relationship[] | yes | `dc:subject` | Taxonomy of topics (Water, Mining, Energy, Land Use, etc.) |
| `date_original` | date | no | `dc:date` | Date of the original document, if known |
| `date_range` | group | no | `dc:coverage.temporal` | Start/end dates for documents spanning a period |
| `source_file` | upload | no | `dc:format` | PDF stored on S3 |
| `geographic_scope` | select[] | no | `dc:coverage.spatial` | Predefined geographic areas (East River, Gothic, CB area, etc.) |
| `source_url` | text | no | `dc:source` | Original URL on Sustainable Library site |
| `ingestion_date` | date | auto | — | When the record was added to the Knowledge Fabric |

### Publication Collection (RMBL Publications)

**Metadata standard:** CSL-JSON (Citation Style Language) for storage and export

| Field | Type | Required | CSL-JSON Mapping | Notes |
|---|---|---|---|---|
| `title` | text | yes | `title` | Publication title |
| `authors` | array | yes | `author[]` | Each entry: `{given, family, orcid?}` |
| `year` | number | yes | `issued.date-parts` | Publication year |
| `publication_type` | select | yes | `type` | article \| thesis \| book \| chapter \| student_paper \| other |
| `journal` | text | no | `container-title` | Journal or book title |
| `volume` | text | no | `volume` | Volume number |
| `issue` | text | no | `issue` | Issue number |
| `pages` | text | no | `page` | Page range |
| `doi` | text | no | `DOI` | Digital Object Identifier |
| `publisher` | text | no | `publisher` | Publisher name |
| `abstract` | textarea | no | `abstract` | Publication abstract |
| `keywords` | text[] | no | — | Author keywords or indexed terms |
| `full_text` | textarea | no | — | Extracted from PDF where available; indexed for deep search and RAG |
| `source_file` | upload | no | — | PDF stored on S3 (where available) |
| `pdf_available` | checkbox | auto | — | Whether a PDF is available for this publication |
| `pdf_link` | text | no | — | Link to PDF on publisher or open-access repository |
| `external_url` | text | no | `URL` | Publisher page or alternative access URL |
| `editors` | array | no | `editor[]` | Book/chapter editors: `{given, family}` |
| `geographic_scope` | select[] | no | — | Predefined geographic areas |
| `research_topics` | relationship[] | no | — | Shared taxonomy with other collections |

**Citation export formats:** BibTeX, RIS, CSL-JSON — generated on-the-fly from stored CSL-JSON fields via `citation.js`.

**Import formats:** CSL-JSON preferred; BibTeX and RIS accepted with automatic conversion via `citation.js`.

### Dataset Collection (RMBL Data Catalog + SDP)

**Metadata standard:** DataCite Metadata Schema 4.5

| Field | Type | Required | DataCite Mapping | Notes |
|---|---|---|---|---|
| `title` | text | yes | `titles[0].title` (M) | Dataset title |
| `description` | richtext | no | `descriptions[0].description` | Dataset description |
| `creators` | array | yes | `creators[]` (M) | Each entry: `{name, orcid?, affiliation?}` |
| `date_published` | date | no | `dates[].date` (type: Issued) | Publication or release date |
| `publication_year` | number | yes | `publicationYear` (M) | Year of publication |
| `spatial_extent` | json | no | `geoLocations[].geoLocationBox` | GeoJSON bounding box |
| `temporal_extent` | group | no | `dates[].date` (type: Collected) | Start and end dates of data collection |
| `data_format` | select[] | no | `formats[]` | CSV, GeoTIFF, NetCDF, Shapefile, etc. |
| `download_url` | text | no | — | Direct download link (S3 or external) |
| `doi` | text | no | `identifier` (M if DOI exists) | DataCite DOI |
| `repository` | select | no | — | S3 \| ESS-DIVE \| other |
| `external_catalog_url` | text | no | — | Link to record on external catalog (e.g., ESS-DIVE landing page) |
| `spatial_description` | text | no | `geoLocations[].geoLocationPlace` | Human-readable place name (e.g., "East River watershed") |
| `tags` | relationship[] | no | `subjects[]` | Shared taxonomy |
| `related_publications` | relationship[] | no | `relatedIdentifiers[]` | Links to Publication collection |
| `license` | select | no | `rightsList[]` | CC-BY, CC0, etc. |
| `file_size` | text | no | `sizes[]` | Human-readable file size |
| `resource_type` | select | yes | `resourceType` (M) | Dataset \| Software \| Collection \| etc. |
| `publisher` | text | yes | `publisher` (M) | Always "RMBL" or the publishing institution |

**(M)** = Mandatory in DataCite schema. DCAT 3 compatibility is maintained for potential future integration with government data portals (DCAT `dcat:Dataset` maps cleanly to DataCite fields).

### Shared Taxonomy

A single taxonomy of topics is used across all three collections, enabling cross-collection faceted browsing:

- Water (water quality, hydrology, watersheds)
- Mining (mineral extraction, mine remediation, mining history)
- Climate (climate change, weather, snow, drought)
- Ecology (flora, fauna, biodiversity, phenology)
- Land Use (planning, development, conservation, recreation)
- Energy (solar, wind, fossil fuels, efficiency)
- Geology (geomorphology, soils, geochemistry)
- Community (governance, policy, education, public health)

### Unified Search Index

All three collections contribute to a unified search index with these common fields:

| Field | Source (Documents) | Source (Publications) | Source (Datasets) |
|---|---|---|---|
| `resource_type` | "document" | "publication" | "dataset" |
| `title` | title | title | title |
| `description_text` | summary | abstract | description |
| `date` | date_original | year | date_published |
| `topics` | categories | research_topics | tags |
| `geographic_scope` | geographic_scope | geographic_scope | spatial_extent (derived) |
| `full_text_tsvector` | full_text | full_text (if PDF available) + abstract | description |
| `embedding_vector` | (Phase 2) | (Phase 2) | (Phase 2) |

### Standards Justification

Alignment with DataCite, CSL-JSON, and Dublin Core enables:

- **Proper citation of datasets and publications** — researchers can export correctly formatted citations
- **DOI resolution and metadata harvesting** — records with DOIs link bidirectionally to the global research graph
- **Interoperability with CrossRef, DataCite Commons, and ORCID** — author disambiguation, citation tracking, and dataset discovery work out of the box
- **Compliance with NSF/NIH data sharing requirements** — datasets use DataCite's mandatory fields, meeting funder expectations for data discoverability
- **Future integration with institutional repositories** — metadata can be harvested via OAI-PMH or API without transformation

---

## 5. System Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Vercel                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               Next.js Application                      │  │
│  │  ┌──────────────┐  ┌───────────────────────────────┐   │  │
│  │  │ Public Site   │  │ Payload CMS Admin Panel       │   │  │
│  │  │ (SSR/SSG)     │  │ (content management)          │   │  │
│  │  │               │  │                               │   │  │
│  │  │ - Search UI   │  │ - Collection editors          │   │  │
│  │  │ - Browse      │  │ - Media management            │   │  │
│  │  │ - Detail pgs  │  │ - User/role management        │   │  │
│  │  │ - AI chat*    │  │ - Bulk import tools           │   │  │
│  │  └──────┬───────┘  └──────────┬────────────────────┘   │  │
│  │         │    Payload API Layer │                         │  │
│  └─────────┼─────────────────────┼────────────────────────┘  │
│            │                     │                            │
└────────────┼─────────────────────┼────────────────────────────┘
             │                     │
     ┌───────▼─────────────────────▼───────┐
     │     PostgreSQL (Neon / Supabase)     │
     │                                      │
     │  ┌──────────┐ ┌──────────┐ ┌──────┐ │
     │  │Documents │ │Pub'ns    │ │Data- │ │
     │  │Collection│ │Collection│ │sets  │ │
     │  └──────────┘ └──────────┘ └──────┘ │
     │  ┌──────────────────────────────────┐│
     │  │ tsvector full-text search index  ││
     │  └──────────────────────────────────┘│
     │  ┌──────────────────────────────────┐│
     │  │ pgvector embeddings (Phase 2+)   ││
     │  └──────────────────────────────────┘│
     └──────────────────────────────────────┘

     ┌──────────────────────────────────────┐
     │   S3-Compatible Storage (R2 / S3)    │
     │  - Sustainable Library PDFs          │
     │  - Publication PDFs (where available)│
     │  - Uploaded media / thumbnails       │
     └──────────────────────────────────────┘

     ┌──────────────────────────────────────┐
     │        External Services             │
     │  - Claude API (Phase 3+ RAG)         │
     │  - ESS-DIVE / external data repos    │
     │  - CrossRef API (DOI metadata)       │
     └──────────────────────────────────────┘
```

### Technology Choices & Justifications

#### Payload CMS 3.x

Payload CMS 3.x is the content management layer. It installs directly into a Next.js application as a plugin — the CMS admin panel, API layer, and public site are a single codebase deployed as a single application. Content types are defined in TypeScript code, version-controlled and testable, with an auto-generated admin UI.

**Built-in capabilities used by this project:**
- Authentication and role-based access control
- File uploads with S3 storage adapter
- Draft and versioning workflows
- Rich text editing (Lexical editor)
- REST and GraphQL APIs (auto-generated from collection schemas)
- Hooks (before/after create, update, delete) for triggering search index updates

**Why not alternatives:**
- **WordPress** (current platform for all sources): Lacks flexible content modeling for three distinct resource types with standards-compliant metadata. Custom field plugins (ACF, Pods) don't provide the type safety or API quality needed. WordPress's search capabilities are limited without expensive plugins.
- **Strapi / Directus**: Both are capable headless CMS options but add deployment complexity — they run as separate services from the frontend, requiring separate hosting, CORS configuration, and two deployment targets. Payload's embedded architecture eliminates this.
- **Custom Django / Rails build**: Would require building admin UI, auth, file management, and API layer from scratch — significantly more development time for a solo developer.

#### PostgreSQL + pgvector

A single PostgreSQL database handles relational data, full-text search, and vector similarity search.

**Why this matters:**
- **pgvector** (v0.8+) is mature and supported by all major managed PostgreSQL providers (Neon, Supabase, AWS RDS, Azure). No operational overhead of a separate vector database.
- At the expected scale (~10,000-50,000 records), PostgreSQL handles all three workloads with excellent performance and no special tuning.
- **Hybrid search** (tsvector + pgvector with Reciprocal Rank Fusion) achieves approximately 84% retrieval precision compared to ~62% for vector-only search, according to published benchmarks. This is critical for a knowledge base where both keyword precision (exact author names, DOIs, technical terms) and semantic understanding (natural-language questions) matter.

**Why not alternatives:**
- **Elasticsearch**: Powerful for search but adds significant operational overhead — a separate cluster to manage, monitor, and pay for. Overkill at this scale.
- **Dedicated vector databases** (Pinecone, Weaviate, Qdrant): Add another service to manage and pay for. pgvector eliminates this by colocating vectors with relational data.
- **SQLite / libSQL**: Simpler to operate but lacks native vector search support and full-text search is less capable than PostgreSQL's tsvector.

#### Vercel

Vercel is the hosting platform for the Next.js + Payload application.

**Why:**
- Payload 3.x is designed and tested for Vercel deployment (official one-click template available)
- Handles SSL, CDN, preview deployments, and automatic scaling with zero DevOps configuration
- Generous Pro tier ($20/month) is sufficient for this project's expected traffic
- Built-in analytics and monitoring

**Why not alternatives:**
- **Self-hosted VPS** (DigitalOcean, Hetzner): Lower cost but requires DevOps work — SSL certificates, reverse proxy, process management, updates, monitoring. Not the best use of a solo developer's time.
- **Railway / Render**: Viable alternatives if Vercel becomes limiting. Similar DX, slightly different pricing models. Could migrate without code changes.

---

## 6. Search Architecture

### Phase 1 — Faceted Full-Text Search (Launch)

The launch search experience uses PostgreSQL's built-in `tsvector` full-text search, which provides excellent keyword search with ranking, stemming, and phrase matching.

**Indexed fields:**
- `title` (weight A — highest priority)
- `abstract` / `summary` / `description` (weight B)
- `keywords` / `categories` / `tags` (weight B)
- `full_text` — extracted text from PDFs for documents and publications (weight C)
- `authors` / `creators` (weight B)

**Facet filters:**
- Resource type (Document, Publication, Dataset)
- Topics/categories (shared taxonomy)
- Date range (year slider or start/end inputs)
- Author (typeahead search)
- Geographic scope (predefined areas)
- Publication type (article, thesis, book, etc. — shown when Publication filter is active)

**Result ranking:**
- Default sort: relevance score (ts_rank_cd)
- Optional sort: date (newest/oldest), title (A-Z), author (A-Z)

**Search results display:**
- Title (linked to detail page)
- Snippet with highlighted matching terms (ts_headline)
- Resource type badge ([Doc], [Pub], [Data])
- Date, author(s), and primary topic tags
- Source link (DOI, download URL, or external link as appropriate)

**Autocomplete:** Suggestions drawn from indexed terms (titles, author names, keywords) using prefix matching with `tsvector`. Displayed as a dropdown below the search input.

### Phase 2 — Hybrid Semantic Search (Months 5-8)

Adds vector similarity search alongside full-text search for natural-language query understanding.

**Embedding pipeline:**
1. Select embedding model (candidates: Voyage AI voyage-3, OpenAI text-embedding-3-small, or Cohere embed-english-v3.0 — evaluated on retrieval quality for scientific/environmental text)
2. Chunk long documents for embedding (512-1024 token chunks with overlap)
3. Generate embeddings for all content in batch; store in a `pgvector` column (`vector(1024)` or `vector(1536)` depending on model)
4. Create an HNSW index on the vector column for fast approximate nearest-neighbor search
5. New content is embedded on save via a Payload `afterChange` hook

**Hybrid query pipeline:**
```
User query
    ├── Generate query embedding
    │       └── pgvector: cosine similarity → top 50 results (vector_rank)
    └── tsvector: full-text search → top 50 results (text_rank)
            │
            ▼
    Reciprocal Rank Fusion (RRF)
    score = Σ 1/(k + rank_i) for each result system
    (k = 60 is standard)
            │
            ▼
    Merged, re-ranked results → top 20 displayed
```

**New features enabled:**
- **"Find similar"** button on every resource detail page — uses the resource's embedding to find nearest neighbors across all collections
- **Natural-language queries** handled gracefully — "What data exists about butterfly populations near Gothic?" returns relevant results even without keyword overlap
- **Cross-collection discovery** improves — semantic similarity surfaces connections that keyword matching misses

### Phase 3 — RAG-Based Q&A (Months 8-11)

Adds a conversational research assistant powered by retrieval-augmented generation.

**RAG pipeline:**
```
User question
    │
    ▼
Generate query embedding
    │
    ▼
Retrieve top-K relevant chunks from pgvector (K=20)
    │
    ▼
Re-rank chunks for relevance to the specific question
(cross-encoder or LLM-based re-ranking → top 5-8 chunks)
    │
    ▼
Construct prompt:
  System: "You are a research assistant for the RMBL Knowledge Fabric.
           Answer based ONLY on the provided sources.
           Cite every claim with [Source N].
           If you cannot answer from the sources, say so."
  Context: [retrieved chunks with source metadata]
  User: [question]
    │
    ▼
Claude API → generated answer with inline citations
    │
    ▼
Post-process: link [Source N] citations to actual resource detail pages
    │
    ▼
Display answer with clickable source links
```

**UI:** "Ask the Knowledge Fabric" panel accessible from the navigation bar. Supports conversational follow-ups within a session. Every AI-generated statement links to its source document(s).

**Guardrails:**
- Answers are grounded only in retrieved content — the prompt explicitly instructs the model not to use prior knowledge
- When confidence is low or sources are insufficient, the response says: "I don't have enough information in the Knowledge Fabric to answer that question. Try searching for [suggested terms]."
- No hallucinated citations — every cited source is verified to exist in the retrieved context

**Cost controls:**
- Rate limiting: 10 questions per hour per IP (adjustable)
- Token budget: max ~4000 output tokens per response
- Caching: identical or near-identical questions return cached answers
- Usage dashboard in admin panel for monitoring costs

---

## 7. Data Migration Strategy

### Overview

Each source requires a different migration approach based on access level and data structure. All migrations produce records in the Payload collection schema, loaded via the Payload REST API or direct database seeding.

### Sustainable Library (Scrape + PDF Download)

**Access method:** Web scraping (no direct database access expected)

**Pipeline:**
1. **Crawl** sustainablelibrary.org category pages to build a document index (URL, title, categories, any visible dates)
2. **Download** all linked PDFs to an S3 staging bucket
3. **Extract text** from PDFs:
   - Primary: `unpdf` or `pdf-parse` (fast, works well for digitally-created PDFs)
   - Fallback: `Tesseract.js` OCR for scanned/image-based documents
4. **Parse metadata** from page context: title, categories, any date information
5. **Generate summaries:** For documents with extracted full text, generate a brief summary (first 2-3 sentences of extracted text, or a staff-authored description during QA). Documents without a summary are flagged for manual review.
6. **Map** to Document collection schema
7. **Flag** items needing manual review: poor OCR quality, missing dates, ambiguous categories, missing summaries

**Estimated effort:** 1-2 weeks for script development, 1 week for QA/cleanup

### RMBL Publications (Export or Scrape + PDF Harvesting)

**Access method:** Preferred: obtain WordPress database export or structured export (CSV/JSON/BibTeX). Fallback: web scraping of publication listing pages.

**Pipeline:**
1. **Obtain** structured data — negotiate DB export first; bibliographic data is parseable from HTML if scraping is needed
2. **Convert** to CSL-JSON canonical format using `citation.js`
3. **Enrich** via CrossRef API where DOIs exist — fetch abstracts, ORCID IDs, keywords, and open-access status
4. **Harvest PDFs:**
   - Follow PDF links from publication records
   - Download publicly accessible PDFs to S3 staging bucket
   - For paywalled publications: check Unpaywall API for open-access versions
   - For PDFs hosted on rmbl.org: download directly (no access restrictions)
   - For author-accepted manuscripts: check SHERPA/RoMEO for publisher self-archiving policies
5. **Extract full text** from downloaded PDFs using the same pipeline as Sustainable Library (`unpdf`/`pdf-parse` with Tesseract.js OCR fallback)
6. **Auto-tag research topics:** Apply keyword-based heuristics to assign `research_topics` from the shared taxonomy (matching on title, abstract, and keywords). Flag low-confidence assignments for manual review.
7. **Map** to Publication collection schema; set `pdf_available` flag based on whether a PDF was successfully obtained
8. **Flag** publications where PDF is unavailable — these are still indexed by metadata and abstract

**Copyright and access considerations:**
- Many RMBL publications are open-access or have author-deposited preprints
- For paywalled publications: index metadata + abstract only; link to publisher page
- Where DOIs exist, check for open-access versions via Unpaywall API (free, legal)
- PDFs hosted directly on rmbl.org can be re-hosted on S3 without concern
- Consider storing author-accepted manuscripts where publisher policies allow (SHERPA/RoMEO lookup)

**Estimated effort:** 2-3 weeks for script development (PDF harvesting adds complexity around link-following and access checking), 1 week for QA

### RMBL Data Catalog + Spatial Data Platform (Structured Harvest)

**Access method:** CSV manifest (SDP) + web scraping (data catalog)

**Pipeline:**
1. **Harvest SDP CSV** — already published with S3 download links, titles, and basic metadata (including creator/contributor names where available)
2. **Scrape** data catalog pages for additional metadata: descriptions, tags, creators/contributors, related publications, spatial/temporal extent, human-readable place names for `spatial_description`
3. **Map** to Dataset collection schema, aligning with DataCite 4.5 mandatory fields
4. **Cross-reference** with publications where relationships are known (manual mapping + DOI-based matching)

**Estimated effort:** 1 week for script development, 1 week for QA

### Ingestion Pipeline Architecture

```
Source → Scraper/Exporter → Raw JSON → Normalizer → Validation → Payload API → PostgreSQL
             │                             │
     PDF Link Discovery             PDF → Text Extractor → full_text field
     (Sust. Library: all PDFs)             │
     (Publications: where              S3 upload (PDFs/media)
      publicly accessible)
     (Datasets: metadata only)

Access Check (for publications):
  PDF link → Is it open-access? → Yes → Download + extract + store on S3
                                → No  → Check Unpaywall API for OA version
                                       → Found → Download OA version
                                       → Not found → Index metadata/abstract only
```

**Validation rules applied during ingestion:**
- Required fields present (title, at least one author/creator for publications and datasets)
- DOIs validate against CrossRef API
- Dates are parseable and within reasonable range
- PDF text extraction succeeds (or item is flagged for manual review)
- No duplicate records (deduplicated on DOI, title+year, or source URL)

---

## 8. UI/UX Design

### Information Architecture

```
Home
├── Search (unified, all collections)
├── Browse
│   ├── Documents (Sustainable Library)
│   ├── Publications (RMBL Research)
│   └── Datasets (Data Catalog)
├── About
│   ├── About the Knowledge Fabric
│   ├── About the Sources
│   └── How to Contribute
└── Ask (Phase 3 — AI Q&A)
```

### Home Page

```
┌──────────────────────────────────────────────────────────────┐
│  RMBL Knowledge Fabric                            [About] [Ask] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Explore Western Colorado's Environmental Knowledge         │
│                                                              │
│   ┌────────────────────────────────────────────────────┐     │
│   │  Search documents, publications, and datasets...   │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
│   [Documents]  [Publications]  [Datasets]  [All Resources]   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Browse by Topic                                            │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │  Water   │ │  Mining  │ │ Climate  │ │ Land Use │       │
│   │  127 >   │ │   84 >   │ │  203 >   │ │   61 >   │       │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │ Ecology  │ │  Energy  │ │ Geology  │ │  More... │       │
│   │  312 >   │ │   45 >   │ │   78 >   │ │          │       │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│   Recently Added                                             │
│   ┌────────────────────────────────────────────────────┐     │
│   │ [Doc]  East River Watershed Assessment (2024)      │     │
│   │ [Pub]  Snow persistence and streamflow... (2025)   │     │
│   │ [Data] Gothic Weather Station Data 2020-2025       │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│   About | Sources | Contact | Funded by [Grant Name]         │
└──────────────────────────────────────────────────────────────┘
```

**Key elements:**
- Prominent search bar as the primary action — the most important thing on the page
- Quick-filter chips below search to scope by resource type before searching
- Topic cards with counts give a sense of the collection's breadth and provide entry points for browsing
- Recently added resources show the site is actively maintained

### Search Results Page

```
┌──────────────────────────────────────────────────────────────┐
│  RMBL Knowledge Fabric                            [About] [Ask] │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐      │
│  │  molybdenum water quality                          │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌─────────────┐  Results (23)                    Sort: v    │
│  │  Filters     │                                            │
│  │             │  ┌────────────────────────────────────────┐ │
│  │ Type        │  │ [Doc] Mt. Emmons Molybdenum Mine EIS  │ │
│  │ [x] Docs    │  │ Environmental impact statement for the │ │
│  │ [x] Pubs    │  │ proposed molybdenum mine near...       │ │
│  │ [x] Datasets│  │ 1982 - Mining, Water                   │ │
│  │             │  └────────────────────────────────────────┘ │
│  │ Topics      │  ┌────────────────────────────────────────┐ │
│  │ [x] Water   │  │ [Pub] Trace metal concentrations in   │ │
│  │ [x] Mining  │  │ surface waters of the East River...    │ │
│  │ [ ] Climate │  │ Manning, A. et al. - 2019 - DOI >     │ │
│  │ [ ] Ecology │  │ Water, Mining                          │ │
│  │ ...         │  └────────────────────────────────────────┘ │
│  │             │  ┌────────────────────────────────────────┐ │
│  │ Date Range  │  │ [Data] East River Water Chemistry      │ │
│  │ [1980]-[2025]│ │ Monthly water quality measurements...  │ │
│  │             │  │ 2015-2024 - Download > - DOI >         │ │
│  │ Geography   │  │ Water                                  │ │
│  │ [x] East Rvr│  └────────────────────────────────────────┘ │
│  │ [ ] Gothic  │                                             │
│  │ [ ] CB area │  < 1  2  3 >                                │
│  └─────────────┘                                             │
└──────────────────────────────────────────────────────────────┘
```

**Key elements:**
- Persistent search bar at top with current query
- Sidebar filters update results in real-time (no separate "Apply" button)
- Each result shows resource type badge, title, snippet, metadata, and relevant links
- Pagination at bottom (20 results per page)
- Filter state is reflected in the URL for shareability

### Resource Detail Page (Publication Example)

```
┌──────────────────────────────────────────────────────────────┐
│  RMBL Knowledge Fabric                            [About] [Ask] │
├──────────────────────────────────────────────────────────────┤
│  < Back to results                                           │
│                                                              │
│  [Publication]                                               │
│  ────────────────────────────────────────────                │
│  Trace metal concentrations in surface waters                │
│  of the East River, Gunnison County, Colorado                │
│                                                              │
│  Manning, A.H. - Johnson, R.T. - 2019                        │
│  Environmental Science & Technology - Vol 53(4) - pp 1820-31 │
│  DOI: 10.xxxx/xxxxx >                                        │
│                                                              │
│  Abstract                                                    │
│  ────────                                                    │
│  Surface water samples collected from 15 sites along the     │
│  East River and its tributaries were analyzed for dissolved   │
│  trace metals including molybdenum, zinc, and copper...      │
│                                                              │
│  Keywords: water quality, trace metals, molybdenum, East     │
│  River, mining impacts                                       │
│                                                              │
│  [Download PDF]  [Export Citation v]  [Find Similar]          │
│                   BibTeX | RIS | CSL                          │
│                                                              │
│  ────────────────────────────────────────────                │
│  Related Resources                                           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [Data] East River Water Chemistry Dataset (2015-2024)│    │
│  │ [Doc]  Mt. Emmons Molybdenum Mine EIS (1982)         │    │
│  │ [Pub]  Geochemical controls on metal transport (2021)│    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Key elements:**
- Full metadata display with proper bibliographic formatting
- Action buttons: PDF download (when available), citation export (dropdown with format options), and "Find Similar" (Phase 2)
- Related resources section shows cross-collection connections
- Back navigation preserves search state

### Resource Detail Page (Document Example)

```
┌──────────────────────────────────────────────────────────────┐
│  RMBL Knowledge Fabric                            [About] [Ask] │
├──────────────────────────────────────────────────────────────┤
│  < Back to results                                           │
│                                                              │
│  [Document]                                                  │
│  ────────────────────────────────────────────                │
│  Mt. Emmons Molybdenum Mine                                  │
│  Environmental Impact Statement                              │
│                                                              │
│  1982 - Mining, Water                                        │
│  Source: Sustainable Living Library                           │
│                                                              │
│  Summary                                                     │
│  ───────                                                     │
│  Environmental impact statement for the proposed              │
│  molybdenum mine at Mt. Emmons, near Crested Butte,         │
│  Colorado. Covers water quality impacts, wildlife habitat,   │
│  and socioeconomic effects on the local community...         │
│                                                              │
│  Categories: Mining, Water, Land Use                          │
│  Geographic scope: Crested Butte area                         │
│                                                              │
│  [View PDF]  [Download PDF]  [Find Similar]                   │
│                                                              │
│  ────────────────────────────────────────────                │
│  Related Resources                                           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [Pub]  Trace metal concentrations in surface... (2019│    │
│  │ [Data] East River Water Chemistry Dataset (2015-2024)│    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Resource Detail Page (Dataset Example)

```
┌──────────────────────────────────────────────────────────────┐
│  RMBL Knowledge Fabric                            [About] [Ask] │
├──────────────────────────────────────────────────────────────┤
│  < Back to results                                           │
│                                                              │
│  [Dataset]                                                   │
│  ────────────────────────────────────────────                │
│  East River Water Chemistry                                  │
│  Monthly Monitoring Data                                     │
│                                                              │
│  Created by: USGS, RMBL - 2015-2024                          │
│  DOI: 10.xxxx/xxxxx >                                        │
│  License: CC-BY 4.0                                          │
│                                                              │
│  Description                                                 │
│  ───────────                                                 │
│  Monthly water quality measurements from 15 monitoring       │
│  sites along the East River and tributaries. Parameters      │
│  include dissolved metals, pH, conductivity, temperature,    │
│  and discharge...                                            │
│                                                              │
│  Format: CSV                                                  │
│  Size: 12.4 MB                                                │
│  Temporal extent: Jan 2015 - Dec 2024                         │
│  Location: East River watershed, Gunnison County              │
│  Repository: S3                                               │
│                                                              │
│  [Download Data]  [View in Catalog]  [Find Similar]           │
│                                                              │
│  ────────────────────────────────────────────                │
│  Related Publications                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [Pub] Trace metal concentrations in surface... (2019)│    │
│  │ [Pub] Geochemical controls on metal transport (2021) │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Ask Page (Phase 3)

```
┌──────────────────────────────────────────────────────────────┐
│  RMBL Knowledge Fabric                            [About] [Ask] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Ask the Knowledge Fabric                                       │
│  Get AI-powered answers from RMBL's research, documents,     │
│  and datasets. Every answer cites its sources.               │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  You: What do we know about the impact of the          │  │
│  │  molybdenum mine on East River water quality?          │  │
│  │                                                        │  │
│  │  ────────────────────────────────────────────          │  │
│  │                                                        │  │
│  │  Knowledge Fabric: Based on the available research and    │  │
│  │  documents, here's what we know:                       │  │
│  │                                                        │  │
│  │  The proposed Mt. Emmons molybdenum mine was subject   │  │
│  │  to an environmental impact assessment in 1982 [1]     │  │
│  │  that identified potential risks to water quality...   │  │
│  │                                                        │  │
│  │  Subsequent monitoring by Manning et al. (2019) [2]    │  │
│  │  found elevated trace metal concentrations...          │  │
│  │                                                        │  │
│  │  Long-term water chemistry data [3] shows...           │  │
│  │                                                        │  │
│  │  Sources:                                              │  │
│  │  [1] Mt. Emmons Molybdenum Mine EIS (1982) >          │  │
│  │  [2] Manning et al., Environ. Sci. Tech. (2019) >     │  │
│  │  [3] East River Water Chemistry Dataset (2015-2024) > │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │  Ask a follow-up question...                       │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  Note: Answers are generated by AI based on sources in the   │
│  Knowledge Fabric. Always verify important claims by checking   │
│  the cited sources directly.                                 │
└──────────────────────────────────────────────────────────────┘
```

### Design Principles

- **Dual-audience:** Clean and approachable for community members; information-dense enough for researchers. Progressive disclosure bridges the gap — summaries first, full metadata on demand.
- **Resource type badges** ([Doc], [Pub], [Data]) provide at-a-glance differentiation in every context (search results, related resources, browse lists).
- **Progressive disclosure:** Home → search results (summary) → detail page (full metadata) → source document/dataset (full content).
- **Mobile-responsive:** Search, browse, and detail pages work well on phones. Sidebar filters collapse to a top-bar on narrow viewports.
- **Accessibility:** WCAG 2.1 AA compliance — minimum 4.5:1 contrast ratio for text, full keyboard navigation, screen reader support with semantic HTML and ARIA labels, alt text for all images.

---

## 9. Infrastructure & Deployment

### Service Architecture

| Component | Service | Estimated Monthly Cost | Notes |
|---|---|---|---|
| Hosting + SSR | Vercel Pro | $20 | Next.js + Payload CMS as single deployment |
| PostgreSQL | Neon Pro or Supabase Pro | $25-50 | Managed, with pgvector extension available |
| S3 file storage | Cloudflare R2 or AWS S3 | $5-25 | Library PDFs + publication PDFs + media |
| Domain + DNS | Cloudflare (free tier) | $0 | DNS, DDoS protection, basic analytics |
| **Phase 1-2 Total** | | **$50-95/mo** | |
| Embedding model API | Voyage / OpenAI / Cohere | $10-30/mo | One-time batch + incremental for new content |
| Claude API | Anthropic | $50-300/mo | Depends on Q&A usage volume |
| **Phase 3+ Total** | | **$110-425/mo** | |

### Environment Configuration

```
# Database
DATABASE_URL=postgresql://user:pass@host:5432/knowledge_hub

# S3-Compatible Storage
S3_BUCKET=rmbl-knowledge-fabric
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=auto
S3_ENDPOINT=https://... # R2 endpoint or omit for AWS S3

# Payload CMS
PAYLOAD_SECRET=... # 32+ character random string for encryption

# Phase 2+
EMBEDDING_API_KEY=... # Embedding model provider API key
EMBEDDING_MODEL=... # Model identifier

# Phase 3+
ANTHROPIC_API_KEY=... # Claude API key
```

### Deployment Pipeline

- **Production:** `main` branch auto-deploys to Vercel on push
- **Preview:** every PR gets a unique preview URL on Vercel for stakeholder review
- **Database migrations:** managed by Payload's built-in migration system (generates SQL migrations from collection schema changes)
- **Environment variables:** managed in Vercel dashboard; secrets never committed to the repository

### Monitoring

- **Vercel Analytics:** page load times, web vitals, error rates
- **Database monitoring:** connection pool usage, query performance (via Neon/Supabase dashboard)
- **Application logging:** structured logs via Vercel's log drain, with error alerting
- **AI cost monitoring** (Phase 3): custom dashboard tracking API call volume and spend against budget

---

## 10. Security & Access Control

### Public Access

The Knowledge Fabric is a public resource. No login is required to:
- Search across all collections
- Browse resources by type or topic
- View resource detail pages with full metadata
- Download PDFs and datasets
- Use the AI Q&A feature (Phase 3, rate-limited)

### Admin Access

Content management requires authentication via Payload's built-in auth system:

| Role | Capabilities |
|---|---|
| **Admin** | Full access: create/edit/delete all content, manage users, system settings, bulk import |
| **Editor** | Create and edit content, upload files, manage taxonomy; cannot delete content or manage users |

Authentication is email/password with secure session tokens. Admin panel is accessible at `/admin` with Payload's built-in UI.

### API Security

- **Read endpoints** (search, browse, detail): public, no authentication required
- **Write endpoints** (create, update, delete): require authenticated session with appropriate role
- **Rate limiting:** applied to all API endpoints; stricter limits on AI Q&A endpoints (Phase 3)

### AI Endpoint Security (Phase 3)

- Rate limited to 10 questions per hour per IP address (configurable)
- Token budget cap per request to prevent abuse
- No user data is sent to the Claude API beyond the question and retrieved context chunks
- Optional API key for heavy/programmatic users

### File Storage Security

- S3 bucket configured with public read access for PDFs and media (these are already public documents)
- Write access restricted to server-side Payload operations only (no client-side uploads to S3)
- Pre-signed URLs used for admin file uploads

### Privacy

- **No PII collected** from public visitors
- **No user accounts** for the public site
- **No tracking** beyond basic, privacy-respecting analytics (Vercel Analytics or Plausible)
- Admin user emails stored in PostgreSQL for authentication only

---

## 11. Development Phases & Timeline

### Phase 1: Foundation (Months 1-5)

**Grant Milestone: Public Launch**

| Month | Deliverables |
|---|---|
| **1** | Project scaffolding: Payload CMS 3.x + Next.js + PostgreSQL deployed to Vercel. Content model finalized and implemented as Payload collections (Documents, Publications, Datasets, shared taxonomy). S3 storage configured with Payload's upload adapter. Basic admin panel functional — staff can create and edit records. |
| **2** | Migration scripts for all three sources. Begin Sustainable Library ingestion (largest, most complex — requires scraping + PDF text extraction). PDF text extraction pipeline operational (`unpdf`/`pdf-parse` + Tesseract.js OCR fallback). Begin publication data migration and PDF harvesting (access checking, download, text extraction). |
| **3** | Complete content migration for all three sources. QA pass on imported data (spot-check metadata accuracy, PDF text quality, deduplication). Build public search UI with PostgreSQL `tsvector` full-text search and faceted filtering. |
| **4** | Browse interfaces for each collection type. Resource detail pages with full metadata display and citation export (BibTeX, RIS, CSL-JSON). "Related resources" via shared topics/tags (rule-based, not AI). Cross-collection linking where relationships are known. |
| **5** | Polish: responsive design pass, accessibility audit (WCAG 2.1 AA), performance optimization (caching, image optimization, lazy loading). Soft launch to stakeholders and select users for feedback. Incorporate feedback. **Public launch.** |

### Phase 2: Semantic Search (Months 5-8)

**Grant Milestone: AI-Enhanced Search**

| Month | Deliverables |
|---|---|
| **5-6** | Evaluate and select embedding model (benchmark retrieval quality on a test set of real queries from both personas). Run batch embedding job over all content. Add pgvector column and HNSW index to PostgreSQL. |
| **7** | Implement hybrid search pipeline (tsvector + pgvector with Reciprocal Rank Fusion). A/B test against pure full-text search using a panel of test queries. Tune RRF parameters (k value, weight balance). |
| **8** | Ship "Find similar" feature on resource detail pages. Improve natural-language query handling. Update search UI to surface semantic matches alongside keyword matches. |

### Phase 3: Conversational Q&A (Months 8-11)

**Grant Milestone: AI Research Assistant**

| Month | Deliverables |
|---|---|
| **8-9** | Build RAG pipeline: retrieval → re-ranking → Claude API generation with inline citations. Prototype "Ask the Knowledge Fabric" interface. Internal testing and prompt engineering for answer quality. |
| **10** | User testing with both community members and researchers (5-10 users per group). Iterate on answer quality, citation accuracy, and UI based on feedback. Implement rate limiting and cost controls. |
| **11** | Polish conversational UI. Add cross-collection insight features ("publications that cite data from this dataset"). Deploy usage monitoring dashboard. Finalize cost projections for post-grant sustainability. |

### Phase 4: Grant Closeout (Month 12)

| Deliverables |
|---|
| Final QA and performance pass across all features. |
| Content manager documentation: how to add/edit resources, run bulk imports, manage taxonomy. |
| Technical documentation: architecture overview, deployment guide, environment setup. |
| Grant reporting and deliverable documentation. |
| Sustainability plan: estimated ongoing costs, maintenance requirements, and recommendations for post-grant funding. |

### Critical Path & Schedule Risks

The critical path runs through Phase 1 content migration (Months 2-3). The three migration scripts must handle varied data quality and access methods.

**Key risks:**
- **Source site access:** If database exports require extended negotiation, migration scripts cannot begin. *Mitigation:* Begin source site negotiations and exploratory scraping in Month 1, alongside scaffolding.
- **Month 2 density:** Migration script estimates (1-2 weeks for Documents, 2-3 weeks for Publications, 1 week for Datasets) total 4-6 weeks of development, which exceeds a calendar month. *Mitigation:* Begin Document migration script work in late Month 1; overlap script development for different sources; accept that full migration completion may extend into early Month 3.
- **PDF text quality:** Scanned historical documents may produce poor OCR results, requiring manual review. *Mitigation:* Flag low-confidence OCR results programmatically; batch manual review in Month 3 QA pass.

**Contingency:** If migration takes longer than planned, Phase 1 can launch with partial content (e.g., all Documents + Publications with Datasets following 2-4 weeks later) rather than delaying the entire launch. The search UI and detail pages can ship as soon as one collection is fully loaded.

---

## 12. Future Considerations (Post-Grant)

These features are out of scope for the grant period but are enabled by the architecture and worth noting for future planning:

- **Automated content sync:** If source sites continue to operate, build lightweight scrapers that detect new content and flag it for import into the Knowledge Fabric (avoiding full re-scraping).

- **Dataset previews:** Render interactive maps for GIS data, charts for time series, and table previews for tabular datasets — directly on detail pages, using libraries like Mapbox GL JS or Observable Plot.

- **Community contributions:** A public submission form for researchers to add their own publications or datasets, with editorial review by RMBL staff before publishing.

- **Public API:** Payload CMS auto-generates REST and GraphQL APIs from collection schemas. These could be documented and opened for programmatic access, enabling integration with other tools and platforms.

- **OAI-PMH harvesting endpoint:** Expose metadata in OAI-PMH format for integration with library catalog systems and institutional repositories.

- **Multi-site replication:** The architecture is generic enough to be replicated for other field stations or regional knowledge hubs — swap the content and taxonomy, keep the infrastructure.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **CSL-JSON** | Citation Style Language JSON — a standardized format for representing bibliographic data, used by Zotero, Mendeley, and citation processors |
| **DataCite** | A global DOI registration agency for research data; the DataCite Metadata Schema defines required fields for dataset citation |
| **DCAT** | Data Catalog Vocabulary — a W3C standard for describing datasets in data catalogs, used by data.gov and European data portals |
| **Dublin Core** | A simple, widely-used metadata standard (15 core elements) for describing digital resources |
| **ESS-DIVE** | Environmental System Science Data Infrastructure for a Virtual Ecosystem — a DOE-funded data repository |
| **HNSW** | Hierarchical Navigable Small World — an algorithm for approximate nearest-neighbor search, used by pgvector for fast vector queries |
| **OAI-PMH** | Open Archives Initiative Protocol for Metadata Harvesting — a protocol for sharing metadata between repositories |
| **ORCID** | Open Researcher and Contributor ID — a persistent digital identifier for researchers |
| **Payload CMS** | A TypeScript-first headless CMS that embeds directly into Next.js applications, providing auto-generated admin UI, REST/GraphQL APIs, and content modeling via code |
| **pgvector** | A PostgreSQL extension that adds vector similarity search capabilities |
| **RAG** | Retrieval-Augmented Generation — an AI technique that retrieves relevant documents before generating an answer, grounding responses in source material |
| **RMBL** | Rocky Mountain Biological Laboratory — a field station in Gothic, Colorado |
| **RRF** | Reciprocal Rank Fusion — a method for combining ranked results from multiple search systems |
| **SDP** | Spatial Data Platform — RMBL's platform for hosting and distributing geospatial data |
| **SSR/SSG** | Server-Side Rendering / Static Site Generation — Next.js rendering strategies |
| **tsvector** | PostgreSQL's built-in data type for full-text search, supporting stemming, ranking, and phrase matching |

## Appendix B: Metadata Standards Crosswalk

### Publication Fields → CSL-JSON

| Knowledge Fabric Field | CSL-JSON Key | Notes |
|---|---|---|
| title | `title` | |
| authors[].given | `author[].given` | |
| authors[].family | `author[].family` | |
| authors[].orcid | — | Stored in Knowledge Fabric; not part of CSL-JSON spec |
| year | `issued.date-parts[0][0]` | |
| publication_type | `type` | Mapped: article→article-journal, thesis→thesis, etc. |
| journal | `container-title` | |
| volume | `volume` | |
| issue | `issue` | |
| pages | `page` | |
| doi | `DOI` | |
| publisher | `publisher` | |
| abstract | `abstract` | |
| external_url | `URL` | |
| editors[].given | `editor[].given` | For book chapters |
| editors[].family | `editor[].family` | For book chapters |

### Dataset Fields → DataCite 4.5

| Knowledge Fabric Field | DataCite Property | Obligation |
|---|---|---|
| doi | `identifier` | Mandatory (if DOI exists) |
| creators | `creators` | Mandatory |
| title | `titles[0].title` | Mandatory |
| publisher | `publisher` | Mandatory |
| publication_year | `publicationYear` | Mandatory |
| resource_type | `resourceType` | Mandatory |
| description | `descriptions[0]` | Recommended |
| tags | `subjects` | Recommended |
| date_published | `dates[]` (type: Issued) | Recommended |
| temporal_extent | `dates[]` (type: Collected) | Recommended |
| spatial_extent | `geoLocations[].geoLocationBox` | Recommended |
| spatial_description | `geoLocations[].geoLocationPlace` | Recommended |
| license | `rightsList[]` | Recommended |
| related_publications | `relatedIdentifiers[]` | Recommended |
| data_format | `formats[]` | Optional |
| file_size | `sizes[]` | Optional |
| download_url | — | Knowledge Fabric internal |

### Document Fields → Dublin Core

| Knowledge Fabric Field | Dublin Core Element | Notes |
|---|---|---|
| title | `dc:title` | |
| summary | `dc:description` | |
| categories | `dc:subject` | |
| date_original | `dc:date` | |
| date_range | `dc:coverage` (temporal) | |
| geographic_scope | `dc:coverage` (spatial) | |
| source_file | `dc:format` | application/pdf |
| source_url | `dc:source` | Original URL |
