# RMBL Knowledge Fabric — Technical Specification

**Version:** 1.1
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

**Profile:** Alex is an RMBL staff member responsible for keeping the Knowledge Fabric current. They have moderate technical skills and access to the WordPress admin.

**User Stories:**

- *"I want to add a newly published paper with its metadata so it appears in search results immediately."*
  - Opens WordPress admin → creates new Publication post → enters metadata via ACF fields (or pastes DOI for auto-fill via CrossRef) → uploads PDF if available → publishes

- *"I want to batch-import a set of historical documents that were just digitized."*
  - Uses the bulk import tool (WP-CLI script or admin import page) → uploads a CSV of metadata + a folder of PDFs → reviews auto-generated draft posts → publishes after QA

- *"I want to tag and categorize newly ingested content so it appears in the right browse categories."*
  - Opens a post in WordPress admin → adds topics via the taxonomy sidebar → saves → post immediately appears in relevant browse filters

---

## 4. Content Model & Metadata Standards

### Overview

Three WordPress Custom Post Types (CPTs), each with structured fields defined via Advanced Custom Fields (ACF) Pro and mapped to a recognized metadata standard for interoperability. A shared custom taxonomy enables cross-collection browsing. All CPTs contribute to a unified search index.

### Document Post Type (Sustainable Library Content)

**WordPress CPT slug:** `document`
**Metadata standard:** Dublin Core (ISO 15836)

| Field | ACF Field Type | Required | Dublin Core Mapping | Notes |
|---|---|---|---|---|
| `title` | (WP post title) | yes | `dc:title` | Document title |
| `summary` | WYSIWYG | no | `dc:description` | Short description or abstract |
| `full_text` | Textarea | no | — | Extracted from PDF; used for search indexing, not displayed in full |
| `categories` | Taxonomy (Topics) | yes | `dc:subject` | Shared taxonomy (Water, Mining, Energy, Land Use, etc.) |
| `date_original` | Date Picker | no | `dc:date` | Date of the original document, if known |
| `date_range_start` | Date Picker | no | `dc:coverage.temporal` | Start date for documents spanning a period |
| `date_range_end` | Date Picker | no | `dc:coverage.temporal` | End date for documents spanning a period |
| `source_file` | File | no | `dc:format` | PDF uploaded to Media Library (offloaded to S3) |
| `geographic_scope` | Checkbox | no | `dc:coverage.spatial` | Predefined geographic areas (East River, Gothic, CB area, etc.) |
| `source_url` | URL | no | `dc:source` | Original URL on Sustainable Library site |
| `ingestion_date` | Date Picker | auto | — | When the record was added to the Knowledge Fabric |

### Publication Post Type (RMBL Publications)

**WordPress CPT slug:** `publication`
**Metadata standard:** CSL-JSON (Citation Style Language) for storage and export

| Field | ACF Field Type | Required | CSL-JSON Mapping | Notes |
|---|---|---|---|---|
| `title` | (WP post title) | yes | `title` | Publication title |
| `authors` | Repeater | yes | `author[]` | Each row: `given_name` (Text), `family_name` (Text), `orcid` (Text) |
| `year` | Number | yes | `issued.date-parts` | Publication year |
| `publication_type` | Select | yes | `type` | article \| thesis \| book \| chapter \| student_paper \| other |
| `journal` | Text | no | `container-title` | Journal or book title |
| `volume` | Text | no | `volume` | Volume number |
| `issue` | Text | no | `issue` | Issue number |
| `pages` | Text | no | `page` | Page range |
| `doi` | Text | no | `DOI` | Digital Object Identifier |
| `publisher` | Text | no | `publisher` | Publisher name |
| `abstract` | Textarea | no | `abstract` | Publication abstract |
| `keywords` | Repeater | no | — | Author keywords or indexed terms (each row: single Text subfield) |
| `full_text` | Textarea | no | — | Extracted from PDF where available; indexed for deep search and RAG |
| `source_file` | File | no | — | PDF uploaded to Media Library (offloaded to S3) |
| `pdf_available` | True/False | auto | — | Whether a PDF is available for this publication |
| `pdf_link` | URL | no | — | Link to PDF on publisher or open-access repository |
| `external_url` | URL | no | `URL` | Publisher page or alternative access URL |
| `editors` | Repeater | no | `editor[]` | Book/chapter editors: each row has `given_name` (Text), `family_name` (Text) |
| `geographic_scope` | Checkbox | no | — | Predefined geographic areas |
| `research_topics` | Taxonomy (Topics) | no | — | Shared taxonomy with other collections |

**Citation export formats:** BibTeX, RIS, CSL-JSON — generated on-the-fly from stored ACF fields via a custom REST endpoint using `citation.js` (loaded via Node.js or a PHP citation library).

**Import formats:** CSL-JSON preferred; BibTeX and RIS accepted with automatic conversion.

### Dataset Post Type (RMBL Data Catalog + SDP)

**WordPress CPT slug:** `dataset`
**Metadata standard:** DataCite Metadata Schema 4.5

| Field | ACF Field Type | Required | DataCite Mapping | Notes |
|---|---|---|---|---|
| `title` | (WP post title) | yes | `titles[0].title` (M) | Dataset title |
| `description` | WYSIWYG | no | `descriptions[0].description` | Dataset description |
| `creators` | Repeater | yes | `creators[]` (M) | Each row: `name` (Text), `orcid` (Text), `affiliation` (Text) |
| `date_published` | Date Picker | no | `dates[].date` (type: Issued) | Publication or release date |
| `publication_year` | Number | yes | `publicationYear` (M) | Year of publication |
| `spatial_extent` | Textarea | no | `geoLocations[].geoLocationBox` | GeoJSON bounding box (stored as JSON string) |
| `temporal_extent_start` | Date Picker | no | `dates[].date` (type: Collected) | Data collection start date |
| `temporal_extent_end` | Date Picker | no | `dates[].date` (type: Collected) | Data collection end date |
| `data_format` | Checkbox | no | `formats[]` | CSV, GeoTIFF, NetCDF, Shapefile, etc. |
| `download_url` | URL | no | — | Direct download link (S3 or external) |
| `doi` | Text | no | `identifier` (M if DOI exists) | DataCite DOI |
| `repository` | Select | no | — | S3 \| ESS-DIVE \| other |
| `external_catalog_url` | URL | no | — | Link to record on external catalog (e.g., ESS-DIVE landing page) |
| `spatial_description` | Text | no | `geoLocations[].geoLocationPlace` | Human-readable place name (e.g., "East River watershed") |
| `tags` | Taxonomy (Topics) | no | `subjects[]` | Shared taxonomy |
| `related_publications` | Relationship | no | `relatedIdentifiers[]` | Links to Publication posts |
| `license` | Select | no | `rightsList[]` | CC-BY, CC0, etc. |
| `file_size` | Text | no | `sizes[]` | Human-readable file size |
| `resource_type` | Select | yes | `resourceType` (M) | Dataset \| Software \| Collection \| etc. |
| `publisher` | Text | yes | `publisher` (M) | Always "RMBL" or the publishing institution |

**(M)** = Mandatory in DataCite schema. DCAT 3 compatibility is maintained for potential future integration with government data portals (DCAT `dcat:Dataset` maps cleanly to DataCite fields).

### Shared Taxonomy

A single custom taxonomy (`topics`) registered for all three CPTs, enabling cross-collection faceted browsing:

- Water (water quality, hydrology, watersheds)
- Mining (mineral extraction, mine remediation, mining history)
- Climate (climate change, weather, snow, drought)
- Ecology (flora, fauna, biodiversity, phenology)
- Land Use (planning, development, conservation, recreation)
- Energy (solar, wind, fossil fuels, efficiency)
- Geology (geomorphology, soils, geochemistry)
- Community (governance, policy, education, public health)

Implemented as a hierarchical WordPress taxonomy so parent terms (e.g., "Water") can have child terms (e.g., "water quality", "hydrology") for more granular filtering.

### Unified Search Index

All three post types contribute to a unified search index with these common fields:

| Field | Source (Documents) | Source (Publications) | Source (Datasets) |
|---|---|---|---|
| `resource_type` | "document" | "publication" | "dataset" |
| `title` | post title | post title | post title |
| `description_text` | summary | abstract | description |
| `date` | date_original | year | date_published |
| `topics` | Topics taxonomy | Topics taxonomy | Topics taxonomy |
| `geographic_scope` | geographic_scope | geographic_scope | spatial_description |
| `full_text` | full_text (ACF) | full_text (ACF, if PDF) + abstract | description |
| `embedding_vector` | (Phase 2) | (Phase 2) | (Phase 2) |

In Phase 1, the search index is managed by Relevanssi Premium (see Section 6). In Phase 2+, an external PostgreSQL + pgvector database mirrors this index for vector search.

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
┌──────────────────────────────────────────────────────────────┐
│              Managed WordPress Hosting                         │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    WordPress                             │  │
│  │  ┌──────────────────┐  ┌─────────────────────────────┐  │  │
│  │  │ Custom Theme      │  │ WordPress Admin             │  │  │
│  │  │ (public site)     │  │ (content management)        │  │  │
│  │  │                   │  │                             │  │  │
│  │  │ - Search UI       │  │ - CPT editors (ACF forms)  │  │  │
│  │  │ - Browse pages    │  │ - Media management         │  │  │
│  │  │ - Detail pages    │  │ - User/role management     │  │  │
│  │  │ - AI chat*        │  │ - Taxonomy management      │  │  │
│  │  └──────┬───────────┘  └──────────┬──────────────────┘  │  │
│  │         │                         │                      │  │
│  │  ┌──────┴─────────────────────────┴──────────────────┐  │  │
│  │  │ Plugins: ACF Pro, Relevanssi Premium,              │  │  │
│  │  │ WP Offload Media, Custom Knowledge Fabric plugin      │  │  │
│  │  └───────────────────────┬───────────────────────────┘  │  │
│  │                          │ WP REST API                   │  │
│  └──────────────────────────┼──────────────────────────────┘  │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐  │
│  │                    MySQL / MariaDB                        │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐  │  │
│  │  │wp_posts│ │wp_post │ │wp_term │ │ Relevanssi index │  │  │
│  │  │(CPTs)  │ │meta    │ │taxonomy│ │ (wp_relevanssi)  │  │  │
│  │  │        │ │(ACF)   │ │(Topics)│ │                  │  │  │
│  │  └────────┘ └────────┘ └────────┘ └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│   S3-Compatible Storage (R2 / S3)    │
│  - Sustainable Library PDFs          │
│  - Publication PDFs (where available)│
│  - Uploaded media / thumbnails       │
│  (via WP Offload Media plugin)       │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐  ┌──────────────────────┐
│  Search Sidecar (Phase 2+)           │  │  External Services   │
│  Lightweight Node.js/Python service  │  │                      │
│  ┌────────────────────────────────┐  │  │ - Claude API (Ph 3+) │
│  │ PostgreSQL + pgvector          │  │  │ - CrossRef API       │
│  │ (Neon / Supabase — managed)    │  │  │ - ESS-DIVE          │
│  │                                │  │  │ - Unpaywall API      │
│  │ - embedding vectors            │  │  └──────────────────────┘
│  │ - hybrid search API            │  │
│  │ - RAG pipeline (Phase 3)       │  │
│  └────────────────────────────────┘  │
│  Synced from WordPress via REST API  │
│  hooks on post save/update/delete    │
└──────────────────────────────────────┘
```

### Technology Choices & Justifications

#### WordPress + ACF Pro

WordPress is the content management layer. Three Custom Post Types (Documents, Publications, Datasets) with structured metadata fields defined via Advanced Custom Fields Pro. The WordPress admin provides the editing interface; a custom theme provides the public-facing site.

**Why WordPress:**
- **Institutional familiarity:** All three source collections currently run on WordPress. RMBL staff already know the WordPress admin interface, reducing training overhead to near-zero.
- **Mature ecosystem:** Thousands of plugins for specific needs (search, S3 offload, SEO, caching, backups). Problems that would require custom code in other systems often have battle-tested plugin solutions.
- **Content management strength:** WordPress excels at what this project needs most — managing, editing, and organizing content with a friendly admin UI. Custom Post Types + ACF Pro provide structured content modeling that rivals purpose-built headless CMS options.
- **Low operational overhead for a solo developer:** Managed WordPress hosting handles updates, backups, SSL, and scaling. The developer focuses on the custom theme and plugin logic, not infrastructure.
- **Long-term maintainability:** WordPress skills are abundant. If the solo developer moves on, finding someone to maintain a WordPress site is far easier than finding someone to maintain a Payload CMS or custom framework project.

**ACF Pro specifically:**
- Provides typed field definitions (text, repeater, relationship, date picker, select, etc.) with a visual editor — the closest WordPress equivalent to code-defined schemas
- Field groups are exportable as JSON/PHP for version control
- The Repeater field type handles structured arrays (authors, creators, keywords) cleanly
- Relationship fields enable cross-post-type linking (e.g., Dataset → related Publications)

**Why not alternatives:**
- **Payload CMS / Strapi / Directus**: More flexible content modeling and better developer APIs, but the institution has no experience with them. Adds deployment complexity (separate services, different hosting). The marginal technical benefits don't outweigh the institutional alignment and operational simplicity of WordPress.
- **Custom Django / Rails build**: Would require building admin UI, auth, file management from scratch — significantly more development time.

#### MySQL / MariaDB (WordPress Default)

WordPress uses MySQL (or MariaDB) as its database. The Knowledge Fabric stores all content, metadata, and taxonomy relationships in WordPress's standard table structure (`wp_posts`, `wp_postmeta`, `wp_terms`, `wp_term_taxonomy`).

**Trade-offs vs. PostgreSQL:**
- MySQL lacks PostgreSQL's `tsvector` for full-text search — this is handled by Relevanssi Premium (see Section 6)
- MySQL lacks `pgvector` for vector search — this is handled by an external PostgreSQL sidecar database in Phase 2+ (see Section 6)
- At the expected scale (~10,000-50,000 records), MySQL handles the relational workload with excellent performance
- Using WordPress's native database avoids the complexity of running WordPress against a non-standard database engine

#### Search Sidecar Service (Phase 2+)

For Phase 2 (semantic search) and Phase 3 (RAG), a lightweight external service with PostgreSQL + pgvector handles vector search and AI capabilities. This service:

- Runs as a small Node.js or Python application on a managed platform (Railway, Render, or a VPS)
- Uses a managed PostgreSQL database with pgvector (Neon or Supabase)
- Syncs content from WordPress via webhook-style hooks: when a post is created, updated, or deleted in WordPress, a hook calls the sidecar API to update the vector index
- Exposes a search API that the WordPress theme calls for hybrid and semantic search queries
- Hosts the RAG pipeline (Phase 3) that calls the Claude API

**Why a sidecar instead of a WordPress plugin:**
- pgvector requires PostgreSQL — it cannot run in MySQL
- Embedding generation and LLM API calls are long-running operations better suited to a Node.js/Python runtime than PHP
- Clean separation of concerns: WordPress handles content management; the sidecar handles AI/search
- The sidecar can be developed, tested, and scaled independently

**Why not Elasticsearch:**
- Adds significant operational overhead — a separate cluster to manage, monitor, and pay for
- Overkill at this scale; Relevanssi handles Phase 1 search well, and pgvector handles Phase 2-3

#### Managed WordPress Hosting

**Why managed hosting:**
- Handles server maintenance, WordPress core updates, SSL certificates, backups, and CDN automatically
- Staging environments for testing changes before deploying to production
- Built-in caching (object cache, page cache, CDN) for performance
- Support team for server-level issues

**Recommended providers** (in order of preference for this project):
- **Cloudways** ($14-30/mo): Flexible, good performance, supports DigitalOcean/Vultr/AWS backends. Good balance of control and managed convenience.
- **SpinupWP + DigitalOcean** ($7/mo SpinupWP + $12-24/mo droplet): More control, excellent performance, lower cost. SpinupWP handles server provisioning and WordPress management.
- **WP Engine** ($20-30/mo): Premium managed hosting, excellent support, but more locked-down. Good if minimal server management is desired.

---

## 6. Search Architecture

### Phase 1 — Faceted Full-Text Search (Launch)

The launch search experience uses **Relevanssi Premium**, a WordPress search plugin that replaces WordPress's default search with a proper full-text index supporting relevance ranking, stemming, phrase matching, and custom field search.

**Why Relevanssi Premium ($129/year):**
- Creates its own search index in MySQL — independent of WordPress's limited default `LIKE`-based search
- Indexes ACF custom fields with configurable weights per field
- Indexes PDF content from media attachments (premium feature) — critical for searching within Sustainable Library documents and publication PDFs
- Supports fuzzy matching, partial words, and phrase matching
- Generates excerpts with highlighted matching terms
- Handles multiple post types in a single search
- Well-maintained, actively developed, 100k+ installations

**Indexed fields and weights:**
- `title` (weight: 10 — highest priority)
- `abstract` / `summary` / `description` (weight: 5)
- `keywords` / taxonomy terms (weight: 5)
- `full_text` — ACF field with extracted PDF text (weight: 2)
- `authors` / `creators` repeater subfields (weight: 5)
- Attached PDF content via Relevanssi's PDF indexing (weight: 1)

**Facet filters (implemented via custom query parameters in the theme):**
- Resource type (Document, Publication, Dataset) — filters on `post_type`
- Topics (shared taxonomy) — filters on `topics` taxonomy terms
- Date range (year slider or start/end inputs) — filters on `date_original` / `year` / `date_published` meta fields
- Author (typeahead search) — filters on `authors` repeater subfields
- Geographic scope (predefined areas) — filters on `geographic_scope` meta field
- Publication type (article, thesis, book, etc.) — shown when Publication filter is active; filters on `publication_type` meta

**Result ranking:**
- Default sort: Relevanssi relevance score
- Optional sort: date (newest/oldest), title (A-Z), author (A-Z)

**Search results display:**
- Title (linked to detail page)
- Snippet with highlighted matching terms (Relevanssi excerpt)
- Resource type badge ([Doc], [Pub], [Data])
- Date, author(s), and primary topic tags
- Source link (DOI, download URL, or external link as appropriate)

**Autocomplete:** Implemented via a custom REST endpoint that queries Relevanssi's index for title/author/keyword prefix matches. Displayed as a dropdown below the search input using a lightweight JS library (e.g., autoComplete.js).

**Alternative considered:** SearchWP ($99/year) offers similar capabilities. Relevanssi is preferred for its mature PDF indexing and larger user base, but SearchWP is a viable fallback.

### Phase 2 — Hybrid Semantic Search (Months 5-8)

Adds vector similarity search via the search sidecar service (see Section 5), running alongside Relevanssi for keyword search.

**Embedding pipeline:**
1. Select embedding model (candidates: Voyage AI voyage-3, OpenAI text-embedding-3-small, or Cohere embed-english-v3.0 — evaluated on retrieval quality for scientific/environmental text)
2. Chunk long documents for embedding (512-1024 token chunks with overlap)
3. Generate embeddings for all content in batch; store in pgvector column (`vector(1024)` or `vector(1536)` depending on model) in the sidecar PostgreSQL database
4. Create an HNSW index on the vector column for fast approximate nearest-neighbor search
5. New content is embedded automatically: a WordPress `save_post` hook calls the sidecar API, which generates and stores the embedding

**Content sync from WordPress to sidecar:**
```
WordPress save_post hook
    │
    ▼
POST /api/sync to sidecar service
    payload: { post_id, post_type, title, text_content, meta_fields }
    │
    ▼
Sidecar: generate embedding → store in pgvector
         store searchable text → update text index
```

**Hybrid query pipeline:**
```
User query (from WordPress theme)
    │
    ▼
POST /api/search to sidecar service
    │
    ├── Generate query embedding
    │       └── pgvector: cosine similarity → top 50 results (vector_rank)
    └── Relevanssi: keyword search → top 50 results (text_rank)
            │           (called from sidecar back to WP REST API,
            │            or sidecar maintains its own text index)
            ▼
    Reciprocal Rank Fusion (RRF)
    score = Σ 1/(k + rank_i) for each result system
    (k = 60 is standard)
            │
            ▼
    Merged, re-ranked results → top 20 returned to WordPress theme
```

**Implementation note:** In practice, the sidecar will maintain its own PostgreSQL text search index (using `tsvector`) alongside the vector index, so both keyword and semantic search can be executed in a single service without round-tripping to Relevanssi. Relevanssi remains the Phase 1 search backend and continues to power the WordPress admin search and any non-JS fallback search.

**New features enabled:**
- **"Find similar"** button on every resource detail page — calls sidecar API with the post's embedding to find nearest neighbors across all collections
- **Natural-language queries** handled gracefully — "What data exists about butterfly populations near Gothic?" returns relevant results even without keyword overlap
- **Cross-collection discovery** improves — semantic similarity surfaces connections that keyword matching misses

### Phase 3 — RAG-Based Q&A (Months 8-11)

Adds a conversational research assistant powered by retrieval-augmented generation, hosted in the search sidecar service.

**RAG pipeline:**
```
User question (from WordPress "Ask" page via JS)
    │
    ▼
POST /api/ask to sidecar service
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
Post-process: link [Source N] citations to WordPress post URLs
    │
    ▼
Return JSON response → WordPress theme renders answer with clickable source links
```

**UI:** "Ask the Knowledge Fabric" page in WordPress, using a custom page template with a JavaScript-driven chat interface that calls the sidecar API. Supports conversational follow-ups within a session. Every AI-generated statement links to its source document(s).

**Guardrails:**
- Answers are grounded only in retrieved content — the prompt explicitly instructs the model not to use prior knowledge
- When confidence is low or sources are insufficient, the response says: "I don't have enough information in the Knowledge Fabric to answer that question. Try searching for [suggested terms]."
- No hallucinated citations — every cited source is verified to exist in the retrieved context

**Cost controls:**
- Rate limiting: 10 questions per hour per IP (adjustable), enforced in the sidecar service
- Token budget: max ~4000 output tokens per response
- Caching: identical or near-identical questions return cached answers
- Usage dashboard in WordPress admin (custom admin page pulling stats from sidecar API)

---

## 7. Data Migration Strategy

### Overview

Each source requires a different migration approach based on access level and data structure. All migrations produce WordPress posts with ACF field data, loaded via the WordPress REST API, WP-CLI `wp post create`, or direct database insertion with `wp_insert_post()` in a migration script.

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
6. **Map** to Document CPT schema and create WordPress posts with ACF field values
7. **Flag** items needing manual review: poor OCR quality, missing dates, ambiguous categories, missing summaries (set as `draft` status for editor review)

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
6. **Auto-tag research topics:** Apply keyword-based heuristics to assign `topics` taxonomy terms from the shared taxonomy (matching on title, abstract, and keywords). Flag low-confidence assignments for manual review.
7. **Map** to Publication CPT schema and create WordPress posts with ACF field values; set `pdf_available` flag based on whether a PDF was successfully obtained
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
3. **Map** to Dataset CPT schema and create WordPress posts with ACF field values, aligning with DataCite 4.5 mandatory fields
4. **Cross-reference** with publications where relationships are known (manual mapping + DOI-based matching; set ACF Relationship field values to link Dataset posts to Publication posts)

**Estimated effort:** 1 week for script development, 1 week for QA

### Ingestion Pipeline Architecture

```
Source → Scraper/Exporter → Raw JSON → Normalizer → Validation
             │                             │
     PDF Link Discovery             PDF → Text Extractor → full_text field
     (Sust. Library: all PDFs)             │
     (Publications: where              S3 upload (PDFs/media)
      publicly accessible)
     (Datasets: metadata only)
                                           │
                                           ▼
                    WP REST API / WP-CLI / wp_insert_post()
                                           │
                                           ▼
                                    WordPress (MySQL)
                                    + Relevanssi re-index

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

**Post-migration:** Run `wp relevanssi index` (via WP-CLI) to rebuild the Relevanssi search index after bulk import. This ensures all imported content is immediately searchable.

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

### Implementation Approach

The public site is built as a **custom WordPress theme** with:
- Custom page templates for Home, Search Results, Browse (per-CPT archive), and Ask
- Single post templates for each CPT (Document detail, Publication detail, Dataset detail)
- A modern CSS framework (Tailwind CSS or similar) compiled via a build tool (Vite or webpack)
- Minimal JavaScript — server-rendered pages with progressive enhancement for search autocomplete, filter interactions, and the Phase 3 chat interface

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
- Topic cards with counts (using `wp_count_posts()` + taxonomy queries) give a sense of the collection's breadth and provide entry points for browsing
- Recently added resources (simple `WP_Query` ordered by `date`) show the site is actively maintained

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
- Sidebar filters update results via form submission or AJAX (progressive enhancement — works without JS)
- Each result shows resource type badge, title, snippet (Relevanssi excerpt), metadata, and relevant links
- Pagination at bottom (20 results per page)
- Filter state is reflected in URL query parameters for shareability

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
- Full metadata display with proper bibliographic formatting (rendered from ACF repeater/field data in the `single-publication.php` template)
- Action buttons: PDF download (when available), citation export (dropdown — calls a custom WP REST endpoint that generates BibTeX/RIS/CSL from ACF fields), and "Find Similar" (Phase 2, calls sidecar API)
- Related resources section shows cross-collection connections (ACF Relationship fields + shared taxonomy terms)
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

**Implementation:** Custom WordPress page template with a JavaScript chat interface. The JS calls the sidecar service's `/api/ask` endpoint. The sidecar returns JSON with the answer text and source metadata (post IDs, titles, URLs). The JS renders the answer with clickable links back to WordPress post permalinks.

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
| WordPress hosting | Cloudways or SpinupWP + DigitalOcean | $15-30 | Managed WP with staging, backups, SSL, CDN |
| MySQL | Included with hosting | $0 | Managed by host; WordPress default database |
| S3 file storage | Cloudflare R2 or AWS S3 | $5-25 | Library PDFs + publication PDFs + media (via WP Offload Media) |
| Domain + DNS | Cloudflare (free tier) | $0 | DNS, DDoS protection, basic analytics |
| Relevanssi Premium | License | ~$11/mo ($129/yr) | Full-text search with PDF indexing |
| ACF Pro | License | ~$8/mo ($99/yr) | Structured custom fields |
| **Phase 1 Total** | | **$39-74/mo** | |
| Search sidecar hosting | Railway / Render / VPS | $7-20/mo | Node.js/Python service |
| PostgreSQL (sidecar) | Neon Free or Supabase Free → Pro | $0-25/mo | pgvector for embeddings; free tier sufficient initially |
| Embedding model API | Voyage / OpenAI / Cohere | $10-30/mo | One-time batch + incremental for new content |
| **Phase 2 Total** | | **$56-149/mo** | |
| Claude API | Anthropic | $50-300/mo | Depends on Q&A usage volume |
| **Phase 3 Total** | | **$106-449/mo** | |

### WordPress Plugin Stack

| Plugin | Purpose | Cost |
|---|---|---|
| **ACF Pro** | Structured custom fields for all CPTs | $99/year |
| **Relevanssi Premium** | Full-text search with PDF indexing, custom field indexing | $129/year |
| **WP Offload Media** | Offload media uploads (PDFs, images) to S3/R2 | $99/year (Lite is free for basic use) |
| **Custom Knowledge Fabric plugin** | CPT registration, taxonomy registration, REST endpoints (citation export, search API proxy), migration utilities, sidecar sync hooks | Custom (developed as part of this project) |
| **WP Crontrol** (free) | Manage WordPress cron jobs (search index rebuilds, sidecar sync) | Free |
| **Wordfence** or **Solid Security** (free tier) | Security hardening, firewall, login protection | Free |

### Environment Configuration

```
# WordPress (wp-config.php or environment variables)
DB_NAME=knowledge_hub
DB_USER=...
DB_PASSWORD=...
DB_HOST=localhost

# S3-Compatible Storage (for WP Offload Media)
AS3CF_SETTINGS_BUCKET=rmbl-knowledge-fabric
AS3CF_SETTINGS_REGION=auto
AS3CF_SETTINGS_PROVIDER=aws  # or cloudflare-r2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Custom plugin settings (stored in wp_options or wp-config.php)
KNOWLEDGE_HUB_SIDECAR_URL=https://search.knowledgehub.rmbl.org
KNOWLEDGE_HUB_SIDECAR_API_KEY=...

# Search sidecar service (.env)
DATABASE_URL=postgresql://user:pass@host:5432/knowledge_hub_search
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=...
ANTHROPIC_API_KEY=...  # Phase 3+
WORDPRESS_REST_URL=https://knowledgehub.rmbl.org/wp-json
WORDPRESS_APP_PASSWORD=...  # For authenticated WP REST API calls
```

### Deployment Pipeline

- **WordPress:** Managed by hosting provider. Theme and plugin code deployed via Git (using a deployment plugin like WP Pusher, or rsync/SSH from a CI pipeline).
- **Theme/plugin development:** Version-controlled in Git. `main` branch deploys to production; `staging` branch deploys to the staging environment provided by the host.
- **Search sidecar** (Phase 2+): Deployed to Railway/Render with auto-deploy from Git, or to a VPS with a simple CI script.
- **Database migrations:** WordPress handles its own schema. ACF field definitions are exported as PHP/JSON and version-controlled. The sidecar database uses a migration tool (e.g., Prisma Migrate or raw SQL migrations).

### Monitoring

- **Hosting dashboard:** Uptime, PHP error logs, resource usage (provided by Cloudways/SpinupWP)
- **WordPress Site Health:** Built-in WordPress health check for configuration issues
- **Search performance:** Relevanssi's built-in logging (tracks search queries and click-through)
- **Sidecar monitoring** (Phase 2+): Application logs on Railway/Render; PostgreSQL monitoring via Neon/Supabase dashboard
- **AI cost monitoring** (Phase 3): Custom WordPress admin page pulling usage stats from the sidecar API

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

Content management requires authentication via WordPress's built-in user system:

| Role | Capabilities |
|---|---|
| **Administrator** | Full access: create/edit/delete all content, manage users, install plugins, system settings, bulk import |
| **Editor** | Create and edit all content (all CPTs), upload files, manage taxonomy; cannot manage users or change settings |
| **Author** | Create and edit own content only; useful for potential future community contribution workflows |

Authentication is username/password with WordPress's session-based auth. Admin panel is accessible at `/wp-admin/`. Two-factor authentication recommended via a plugin (e.g., WP 2FA or Wordfence 2FA).

### WordPress Hardening

- Disable XML-RPC (unless needed for specific integrations)
- Limit login attempts (via Wordfence or Solid Security)
- Keep WordPress core, themes, and plugins updated (managed hosting handles core updates)
- Use strong, unique passwords for all admin accounts
- Restrict `/wp-admin/` access to authorized users only (default WordPress behavior)
- Disable file editing in the admin panel (`DISALLOW_FILE_EDIT` in `wp-config.php`)

### API Security

- **WP REST API read endpoints** (search, browse, detail): public, no authentication required (WordPress default for published posts)
- **WP REST API write endpoints**: require authentication via Application Passwords or cookie-based auth
- **Sidecar API** (Phase 2+): secured with an API key shared between WordPress and the sidecar service; not directly exposed to the public
- **Rate limiting on AI endpoints** (Phase 3): enforced in the sidecar service (10 questions/hour/IP)

### File Storage Security

- S3 bucket configured with public read access for PDFs and media (these are already public documents)
- Write access restricted to the WP Offload Media plugin's configured credentials (server-side only)
- WordPress Media Library permissions control who can upload files

### Privacy

- **No PII collected** from public visitors
- **No user accounts** for the public site
- **No tracking** beyond basic, privacy-respecting analytics (Plausible, Fathom, or WordPress Stats)
- Admin user data stored in WordPress's `wp_users` table for authentication only

---

## 11. Development Phases & Timeline

### Phase 1: Foundation (Months 1-5)

**Grant Milestone: Public Launch**

| Month | Deliverables |
|---|---|
| **1** | WordPress installation and configuration on managed hosting. Custom plugin: register three CPTs (Document, Publication, Dataset) and shared Topics taxonomy. ACF Pro field groups defined and version-controlled for all three CPTs. S3 storage configured via WP Offload Media. Relevanssi Premium installed and configured with custom field indexing weights. Basic admin workflow functional — staff can create and edit records via ACF forms. |
| **2** | Migration scripts (Node.js or Python, running externally and importing via WP REST API / WP-CLI). Begin Sustainable Library ingestion (largest, most complex — requires scraping + PDF text extraction). PDF text extraction pipeline operational (`unpdf`/`pdf-parse` + Tesseract.js OCR fallback). Begin publication data migration and PDF harvesting (access checking, download, text extraction). |
| **3** | Complete content migration for all three sources. QA pass on imported data (spot-check metadata accuracy, PDF text quality, deduplication). Rebuild Relevanssi index. Build custom theme with public search UI — search results template with faceted filtering using Relevanssi. |
| **4** | Theme: browse archive templates for each CPT. Single post templates for each CPT with full metadata display and citation export (custom REST endpoint using `citation.js`). "Related resources" via shared taxonomy terms + ACF Relationship fields (rule-based, not AI). |
| **5** | Polish: responsive design pass, accessibility audit (WCAG 2.1 AA), performance optimization (page caching, image optimization, lazy loading). Soft launch to stakeholders and select users for feedback. Incorporate feedback. **Public launch.** |

### Phase 2: Semantic Search (Months 5-8)

**Grant Milestone: AI-Enhanced Search**

| Month | Deliverables |
|---|---|
| **5-6** | Build search sidecar service: Node.js or Python app with PostgreSQL + pgvector. Implement WordPress-to-sidecar sync (hook on `save_post` that pushes content to sidecar API). Evaluate and select embedding model. Run batch embedding job to populate sidecar DB from all WordPress content. |
| **7** | Implement hybrid search: sidecar API combines pgvector similarity + text search, returns merged results via RRF. Update WordPress theme to call sidecar search API (with Relevanssi as fallback). A/B test against pure Relevanssi search. |
| **8** | Ship "Find similar" feature on single post templates (calls sidecar API). Improve natural-language query handling. Update search UI to surface semantic matches alongside keyword matches. |

### Phase 3: Conversational Q&A (Months 8-11)

**Grant Milestone: AI Research Assistant**

| Month | Deliverables |
|---|---|
| **8-9** | Build RAG pipeline in sidecar: retrieval → re-ranking → Claude API generation with inline citations. Create "Ask" page template in WordPress theme with JavaScript chat interface calling sidecar `/api/ask` endpoint. Internal testing and prompt engineering for answer quality. |
| **10** | User testing with both community members and researchers (5-10 users per group). Iterate on answer quality, citation accuracy, and UI based on feedback. Implement rate limiting and cost controls in sidecar. |
| **11** | Polish conversational UI. Add cross-collection insight features ("publications that cite data from this dataset"). Build WordPress admin page for monitoring sidecar usage/costs. Finalize cost projections for post-grant sustainability. |

### Phase 4: Grant Closeout (Month 12)

| Deliverables |
|---|
| Final QA and performance pass across all features. |
| Content manager documentation: how to add/edit resources via WordPress admin, run bulk imports, manage taxonomy. |
| Technical documentation: architecture overview, deployment guide, environment setup for both WordPress and sidecar. |
| Grant reporting and deliverable documentation. |
| Sustainability plan: estimated ongoing costs, maintenance requirements, and recommendations for post-grant funding. |

### Critical Path & Schedule Risks

The critical path runs through Phase 1 content migration (Months 2-3). The three migration scripts must handle varied data quality and access methods.

**Key risks:**
- **Source site access:** If database exports require extended negotiation, migration scripts cannot begin. *Mitigation:* Begin source site negotiations and exploratory scraping in Month 1, alongside scaffolding.
- **Month 2 density:** Migration script estimates (1-2 weeks for Documents, 2-3 weeks for Publications, 1 week for Datasets) total 4-6 weeks of development, which exceeds a calendar month. *Mitigation:* Begin Document migration script work in late Month 1; overlap script development for different sources; accept that full migration completion may extend into early Month 3.
- **PDF text quality:** Scanned historical documents may produce poor OCR results, requiring manual review. *Mitigation:* Flag low-confidence OCR results programmatically; batch manual review in Month 3 QA pass.
- **Phase 2 sidecar complexity:** Adding a second service (search sidecar) introduces a sync boundary between WordPress and PostgreSQL. *Mitigation:* Design the sync as idempotent (re-sync is safe to retry); build a "full re-sync" WP-CLI command for recovery; keep the sidecar simple and well-tested before adding features.

**Contingency:** If migration takes longer than planned, Phase 1 can launch with partial content (e.g., all Documents + Publications with Datasets following 2-4 weeks later) rather than delaying the entire launch. The search UI and detail pages can ship as soon as one collection is fully loaded.

---

## 12. Future Considerations (Post-Grant)

These features are out of scope for the grant period but are enabled by the architecture and worth noting for future planning:

- **Automated content sync:** If source sites continue to operate, build lightweight scrapers that detect new content and flag it for import into the Knowledge Fabric (avoiding full re-scraping).

- **Dataset previews:** Render interactive maps for GIS data, charts for time series, and table previews for tabular datasets — directly on detail pages, using JavaScript libraries (Leaflet/Mapbox GL JS for maps, Chart.js or Observable Plot for charts).

- **Community contributions:** A public submission form (using Gravity Forms or a custom frontend form) for researchers to add their own publications or datasets, with editorial review by RMBL staff before publishing.

- **Public API:** WordPress REST API already provides read access to all CPTs. These endpoints could be documented and publicized for programmatic access, enabling integration with other tools and platforms.

- **OAI-PMH harvesting endpoint:** Expose metadata in OAI-PMH format for integration with library catalog systems and institutional repositories (via a custom WordPress plugin or a lightweight standalone service).

- **Multi-site replication:** The architecture (WordPress + ACF + custom plugin) is portable enough to be replicated for other field stations or regional knowledge hubs — swap the content and taxonomy, keep the infrastructure.

- **Headless frontend:** If the WordPress theme approach becomes limiting for frontend interactivity (e.g., complex map-based browsing, real-time filtering), the architecture supports a gradual transition to a decoupled frontend (Next.js or similar) consuming the WordPress REST API, without changing the content management layer.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **ACF** | Advanced Custom Fields — a WordPress plugin that adds structured custom field types (text, repeater, relationship, etc.) to post types |
| **CPT** | Custom Post Type — WordPress's mechanism for defining content types beyond the default Posts and Pages |
| **CSL-JSON** | Citation Style Language JSON — a standardized format for representing bibliographic data, used by Zotero, Mendeley, and citation processors |
| **DataCite** | A global DOI registration agency for research data; the DataCite Metadata Schema defines required fields for dataset citation |
| **DCAT** | Data Catalog Vocabulary — a W3C standard for describing datasets in data catalogs, used by data.gov and European data portals |
| **Dublin Core** | A simple, widely-used metadata standard (15 core elements) for describing digital resources |
| **ESS-DIVE** | Environmental System Science Data Infrastructure for a Virtual Ecosystem — a DOE-funded data repository |
| **HNSW** | Hierarchical Navigable Small World — an algorithm for approximate nearest-neighbor search, used by pgvector for fast vector queries |
| **OAI-PMH** | Open Archives Initiative Protocol for Metadata Harvesting — a protocol for sharing metadata between repositories |
| **ORCID** | Open Researcher and Contributor ID — a persistent digital identifier for researchers |
| **pgvector** | A PostgreSQL extension that adds vector similarity search capabilities |
| **RAG** | Retrieval-Augmented Generation — an AI technique that retrieves relevant documents before generating an answer, grounding responses in source material |
| **Relevanssi** | A WordPress search plugin that replaces the default search with a proper full-text index supporting relevance ranking, stemming, and custom field search |
| **RMBL** | Rocky Mountain Biological Laboratory — a field station in Gothic, Colorado |
| **RRF** | Reciprocal Rank Fusion — a method for combining ranked results from multiple search systems |
| **SDP** | Spatial Data Platform — RMBL's platform for hosting and distributing geospatial data |
| **WP-CLI** | WordPress Command Line Interface — a tool for managing WordPress from the terminal, used for bulk operations, imports, and automation |

## Appendix B: Metadata Standards Crosswalk

### Publication Fields → CSL-JSON

| Knowledge Fabric Field | CSL-JSON Key | Notes |
|---|---|---|
| title (post title) | `title` | |
| authors[].given_name | `author[].given` | ACF Repeater subfield |
| authors[].family_name | `author[].family` | ACF Repeater subfield |
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
| editors[].given_name | `editor[].given` | ACF Repeater subfield; for book chapters |
| editors[].family_name | `editor[].family` | ACF Repeater subfield; for book chapters |

### Dataset Fields → DataCite 4.5

| Knowledge Fabric Field | DataCite Property | Obligation |
|---|---|---|
| doi | `identifier` | Mandatory (if DOI exists) |
| creators | `creators` | Mandatory |
| title (post title) | `titles[0].title` | Mandatory |
| publisher | `publisher` | Mandatory |
| publication_year | `publicationYear` | Mandatory |
| resource_type | `resourceType` | Mandatory |
| description | `descriptions[0]` | Recommended |
| tags (Topics taxonomy) | `subjects` | Recommended |
| date_published | `dates[]` (type: Issued) | Recommended |
| temporal_extent_start/end | `dates[]` (type: Collected) | Recommended |
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
| title (post title) | `dc:title` | |
| summary | `dc:description` | |
| categories (Topics taxonomy) | `dc:subject` | |
| date_original | `dc:date` | |
| date_range_start/end | `dc:coverage` (temporal) | |
| geographic_scope | `dc:coverage` (spatial) | |
| source_file | `dc:format` | application/pdf |
| source_url | `dc:source` | Original URL |
