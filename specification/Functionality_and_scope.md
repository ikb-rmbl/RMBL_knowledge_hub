# RMBL Knowledge Hub — Technical Specification

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

The **RMBL Knowledge Hub** unifies all three collections into a single searchable platform with:

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

The RMBL Knowledge Hub makes the environmental knowledge of the Gunnison Basin — scientific research, community documents, and ecological data — discoverable, connected, and accessible to everyone, from local residents to visiting researchers.

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

The Knowledge Hub serves two primary audiences with equal priority:

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
  - Uses "Ask the Knowledge Hub" → gets a synthesized answer with citations → follows citations to the source documents for details

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
  - Uses "Ask the Knowledge Hub" → asks about existing phenology research → gets a summary of what exists and what time periods/species are under-studied

### Persona C — Content Manager (1-3 staff)

**Profile:** Alex is an RMBL staff member responsible for keeping the Knowledge Hub current. They have moderate technical skills and access to the WordPress admin.

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
| `ingestion_date` | Date Picker | auto | — | When the record was added to the Knowledge Hub |

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
