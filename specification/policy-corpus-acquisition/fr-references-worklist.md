# Policy-Corpus Acquisition Worklist — Federal Register References

_Generated 2026-06-20 from the 388 FR notices loaded in PR #74._

## Why this exists

Phase 4a entity extraction over the 388 FR notices pulled out 6,851
named external works the FR notices cite (resource management plans,
recovery plans, EISs, agency handbooks, etc.). Of those:

| | Count | Note |
|---|---:|---|
| Total FR-sourced references | 6,851 | LLM-extracted referencedWorks |
| Matched to a doc we already have | 99 | 1.4% — mostly other FR notices |
| Unique unmatched plans / reports / studies | 2,411 | The acquisition gap |
| Of those, ≥2 FR notices cite the same item | ~250 | The high-leverage worklist |

This worklist ranks the unmatched items by citation frequency and
groups them by acquisition source. Each entry is a candidate for
inclusion in the documents collection so the science-policy bridge has
a fuller picture of the regulatory context the basin operates under.

## Top 30 unmatched plans

| # | Title | Year | Cited by N FR notices | Acquisition source |
|---|---|---:|---:|---|
| 1 | San Juan/San Miguel Resource Management Plan | 1985 | 14 | BLM Tres Rios FO |
| 2 | Uncompahgre Basin Resource Management Plan | 1998 | 12 | BLM Uncompahgre FO |
| 3 | Forest Service Handbook 1909.15, Section 21 (NEPA) | — | 9 | USFS national |
| 4 | Canyons of the Ancients National Monument RMP | 2010 | 9 | BLM Tres Rios FO |
| 5 | Gunnison Sage-Grouse Rangewide Conservation Plan | 2005 | 8 | USFWS / CO Div Wildlife |
| 6 | Uncompahgre Field Office RMP | 2020 | 8 | BLM Uncompahgre FO |
| 7 | Gunnison Resource Area RMP | 1993 | 7 | BLM Gunnison FO |
| 8 | Gunnison Gorge National Conservation Area RMP | 2004 | 7 | BLM Uncompahgre FO |
| 9 | San Luis Resource Area RMP | 1991 | 7 | BLM Royal Gorge FO |
| 10 | Tres Rios Field Office RMP | 2015 | 7 | BLM Tres Rios FO |
| 11 | Grand Junction Field Office RMP | 2015 | 7 | BLM Grand Junction FO |
| 12 | Uncompahgre Resource Management Plan | 2020 | 7 | BLM Uncompahgre FO (= #6 alt name) |
| 13 | Little Snake RMP | 2011 | 5 | BLM Little Snake FO |
| 14 | Kremmling RMP | 2015 | 5 | BLM Kremmling FO |
| 15 | Gunnison Resource Management Plan | 1993 | 5 | BLM Gunnison FO (= #7 alt name) |
| 16 | Moab Field Office RMP | 2008 | 4 | BLM Moab FO (UT) |
| 17 | McInnis Canyons National Conservation Area RMP | 2004 | 4 | BLM Grand Junction FO |
| 18 | Colorado River Valley Field Office RMP | 2015 | 4 | BLM Colorado River Valley FO |
| 19 | White River Field Office RMP | 1997 | 4 | BLM White River FO |
| 20 | Monticello Field Office RMP | 2008 | 4 | BLM Monticello FO (UT) |
| 21 | **GMUG Forest Plan** | 2007 | 4 | **USFS R02 GMUG** ← user-flagged |
| 22 | Dominguez-Escalante National Conservation Area RMP | 2017 | 4 | BLM Uncompahgre FO |
| 23 | Grand Junction Resource Management Plan | 2015 | 4 | BLM Grand Junction FO (= #11 alt) |
| 24 | Roan Plateau Amendment | 2016 | 4 | BLM Colorado River Valley FO |
| 25 | BLM National Sage Grouse Conservation Strategy | — | 3 | BLM national |

## Distribution by acquisition source

Grouping the top ~30 by where each would be sourced from:

| Source | Plans to acquire | Likely URL |
|---|---:|---|
| **BLM eplanning.blm.gov** | ~18 | https://eplanning.blm.gov/eplanning-ui/home (search by FO) |
| **USFS R02 (incl. GMUG)** | ~3 | https://www.fs.usda.gov/r02/ (per-forest project pages) |
| **USFWS recovery plans** | ~2 | https://ecos.fws.gov/ecp/ |
| **State agencies (CPW, Div Wildlife)** | ~3 | https://cpw.state.co.us/ |
| **National (cross-agency)** | ~4 | various |

## Top 30 unmatched reports / studies

Studies tend to be peer-reviewed (Schroeder et al. 2004, Connelly
et al. 2000/2004 — both sage-grouse science) and are usually findable
on Semantic Scholar / Google Scholar. Lower priority than plans for
this acquisition pass — they belong in publications, not documents.

| Title | Type | Cited by | Year |
|---|---|---:|---|
| Protest Resolution Report | report | 6 | 2024 |
| Schroeder et al. 2004 | study | 6 | 2004 |
| McCord and Cardoza 1982 | study | 4 | 1982 |
| Young 1994 | study | 4 | 1994 |
| Connelly et al. 2000a | study | 4 | 2000 |
| Connelly et al. 2004 | report | 4 | 2004 |

## Recommended acquisition strategy

### Tier 3a — BLM ePlanning bulk acquisition (highest ROI)

The single biggest hole is BLM Resource Management Plans. Of the top 25
unmatched plans, ~18 are BLM RMPs across ~12 field offices.

**Approach:**

1. **BLM ePlanning** (https://eplanning.blm.gov/eplanning-ui/home) hosts
   active and recent RMPs in a structured search. Search by field
   office name → list of NEPA documents → each document has PDFs.
2. Build a simple scraper that walks the search-by-FO endpoint for the
   field offices we care about (Gunnison, Uncompahgre, Tres Rios, Grand
   Junction, Colorado River Valley, Kremmling, Little Snake, White
   River, San Luis, Royal Gorge, McInnis, Moab, Monticello).
3. Download PDFs into `pdf-staging/documents/` with `_sourcePostId`
   like `blm-eplanning-<doc_number>`.
4. Add normalized records to `discovered-blm-eplanning.json` (mirroring
   the FR-notice JSON shape).
5. Load via the same `load-to-payload.ts` path the FR notices used; set
   `documentType = 'resource_management_plan'` or similar.

Estimated count: ~50–100 RMP-family documents (most field offices have
the live RMP, the draft EIS, the ROD, and amendments).

Estimated cost: $0 download (BLM is open). ~$20-40 LLM for entity
extraction once they're loaded.

### Tier 3b — GMUG and USFS R02 (user-flagged)

`https://www.fs.usda.gov/r02/gmug/projects` is the entry point. Plain
curl returns 504/000 (likely Azure Front Door bot detection), so this
needs Playwright (we have `download-institutional.ts` as a pattern).

**Approach:**

1. Playwright walk of `fs.usda.gov/r02/gmug/projects` and the parent
   `/landmanagement` page.
2. Extract each project's NEPA doc list. USFS R02 uses the standard
   project archive format with `?cid=stelprdb...` URLs.
3. Download project PDFs. Many will be EAs/EISs, RODs.
4. Add to `discovered-usfs-r02-gmug.json`.
5. Same load path as above.

Estimated count: ~30–50 docs from GMUG; additional ~30 from the other
R02 forests (Rio Grande NF, Pike-San Isabel, San Juan NF, Arapaho-
Roosevelt NF) if we want full Region 2 coverage.

Estimated cost: ~$30-50 LLM extraction.

### Tier 3c — USFWS recovery plans

Gunnison Sage-Grouse Rangewide Conservation Plan (2005) is the obvious
priority. USFWS recovery plans are at
`https://ecos.fws.gov/ecp/species/...`.

Lower volume (~10 plans across the species we care about), easier
scrape (USFWS ECOS exposes a clean structure).

### Tier 3d — Federal statutes (skip)

Top of the citation list is foundational statutes: NEPA (1969), FLPMA
(1976), ESA (1973), etc. We don't need to ingest these as PDFs — they
should become first-class concept entries (or stakeholder/legislation
entities) that any policy doc can reference.

## Next concrete step

Tier 3a (BLM ePlanning) is the highest-leverage move because of the
~18 RMP gap. Building one scraper unlocks ~50-100 documents. Tier 3b
(GMUG/USFS R02) is the user-flagged second priority and can run on the
same infrastructure once Playwright is wired in for the FS site.

Before either: a quick spike on whether ePlanning's search API is
available (JSON endpoint) or only HTML — that affects whether we need
Playwright there too.
