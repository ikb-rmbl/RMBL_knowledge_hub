# Roadmap — RMBL Knowledge Commons

Living document. Near-term priorities first (added 2026-08-26, internal-metrics + archival arc), then previously queued work. Each item notes what already exists in the codebase so implementation starts from the right place.

---

## Near-term priorities (2026-08)

### 1. "RMBL Research" flag on publications

**Why:** "RMBL paper" is currently only inferable from provenance (`data_source = 'rmbl_database'`, 3,988 rows vs 864 `discovered`). The legacy Pubs Database shuts down ~2026-09, after which provenance stops being a usable proxy — new RMBL papers will all arrive via discovery.

**Approach:**
- Add `rmbl_research boolean` to `publications` (z- migration + Payload checkbox field).
- One-shot seed: `TRUE` for all `data_source = 'rmbl_database'`; discovered papers default `NULL` (= unreviewed) so the admin queue is visible, with a triage pass over the 864.
- Add to `curatableFields` + sync `curatedFields` so admin decisions stick against pipeline runs.
- Discovery pipeline (`discover-publications.ts`) sets it heuristically where confident (e.g. RMBL affiliation string in OpenAlex authorship) and leaves it unset otherwise.
- Surface as a search facet and on detail pages.

**Effort:** ~1 day + triage time. **Blocks:** item 4 dashboard.

### 2. Publications ↔ Projects in the filtering interface

**Why:** Projects (118) already auto-assign items (`assign-projects.ts`; `projects_rels.publications_id` exists), but the association is invisible in the Publications browse/search flow and can't be hand-tagged from the publication side.

**Approach:**
- Add a `projects` relationship (or join field) on the Publications admin edit view so manual tagging happens where curators already work; keep `assign-projects.ts` as the bulk path with curation-aware writes (assignments an admin made must not be clobbered — extend `curated_fields` semantics or mark manual rows in `projects_rels`).
- Add a Projects facet to `/search` (type filter allowlist + parameterized join) and the publications browse page.
- Show project chips on publication detail pages (author pages already have project cards to crib from).

**Effort:** 1–2 days. Manual-vs-pipeline assignment provenance is the design decision to settle first.

### 3. Student-author tagging

**Why:** Needed for metrics (item 4) and to make RMBL's education mission visible. Student status is per-publication (a 2005 REU student may be a PI by 2015), so this belongs on the author–publication link, not the author record.

**Approach:**
- Add role metadata to `authors_rels` (e.g. `is_student boolean`, `student_program varchar` — REU/RA/thesis/other) via migration.
- **Auto-detection seeds:** `publication_type IN ('student_paper','thesis')` → author(s) are students (1,559 + 354 rows); `publications_mentors` implies mentored (student) work; thesis metadata. 
- **REU specifically:** no signal exists in the DB today — needs an external roster (RMBL admin records of REU cohorts by name + year) matched against the authors registry, or acknowledgment-text detection ("REU", "Research Experience for Undergraduates") where full text exists. Roster is the reliable path; flag which source we can get.
- **Manual curation:** admin UI on the publication edit page (author list with student checkboxes); curation-tracked.

**Effort:** 2–3 days + roster acquisition. **Blocks:** item 4 dashboard (REU metric).

### 4. Internal metrics dashboard

**Why:** RMBL needs longitudinal numbers for reporting: RMBL publications over time, REU-student publications, publications with student authors.

**Approach:**
- New page (e.g. `/metrics` or `/about/metrics`) — server component + simple SQL aggregates by year; no new infrastructure. Charts client-side (lightweight; no heavy charting dep — SVG bars or small lib).
- Metrics: count by year × {`rmbl_research`, has-student-author, REU-student-author}, plus type breakdown; CSV export for board decks.
- Decide public vs auth-gated (public seems fine — it's aggregate counts; flattering numbers are outreach).

**Effort:** 1–2 days once items 1 + 3 land. **Depends on:** 1, 3.

### 5. PDF redistribution rights audit

**Why:** We host/serve PDFs acquired through several pipelines (Unpaywall OA links, Semantic Scholar OA, institutional-repository downloads, technician-acquired worklist PDFs, legacy Pubs DB uploads). We need confidence that everything served is something we may redistribute.

**Approach:**
- Inventory pass: for every publication/document with a served file (vs external link), record rights basis — OA license from Unpaywall/OpenAlex (`license` field), publisher policy, RMBL-owned (theses/student papers), author-deposited, or **unknown**.
- Script: `audit-pdf-rights.ts` producing a CSV worklist of unknowns, mirroring the existing `export-pdf-worklist.ts` pattern; store outcome in a `pdf_rights_basis` column.
- Remediation: unknowns flip to metadata-only (external link, no served blob) — the `pdfRestricted` flow (indexed-but-not-served) already exists on documents for exactly this and can extend to publications.
- Note: stories full text is already stored-not-displayed for copyright; this closes the same loop for PDFs.

**Effort:** ~1 day scripting + review passes. High priority — do before the legacy DB shutdown removes upstream provenance answers.

### 6. Multimedia in Stories (oral histories + archival material)

**Why:** RMBL oral history recordings (audio/video) and potentially scanned archival photos need a durable public home; Stories is the natural surface.

**Approach (phased):**
- **Storage:** Payload Media collection + S3 upload adapter already exist (S3 currently conditional on env creds — enable in production). Video/audio via S3 + native HTML5 players first; only reach for a streaming service if file sizes demand it (keep costs small-org appropriate).
- **Schema:** extend Stories with a media relationship + new `story_type` (e.g. `oral_history`, `archival`); scanned photos may fit Stories or warrant a light "Archive items" collection — decide when we see the material.
- **Search:** transcripts are the searchable text — transcription pass (Whisper or similar) into `full_text`, displayed alongside the player (unlike news-story text, we own these, so transcripts are displayable).
- **Rights/consent:** oral histories need release forms tracked (ties into item 5's rights-basis pattern).

**Effort:** 3–5 days for audio-first MVP (storage + player + transcript search); photos/video after.

### Suggested sequencing

1 → 3 → 4 (metrics arc, in dependency order), with 5 early and independent (do before Pubs DB shutdown). 2 is independent, any time. 6 is its own arc — start with an audio pilot when content is in hand.

---

## Previously queued

- **FR-notice tier-3 acquisition** — BLM ePlanning scrape → USFS R02/GMUG → USFWS ECOS (`specification/policy-corpus-acquisition/`).
- **Entity extraction for 48 new SDP datasets** (`extract-dataset-entities.ts`, small LLM spend).
- **Scripts cleanup queue** (2026-05-18 audit): extract `lib/llm-batch-runner`, generalize `lib/extraction-runner`, extract `lib/batch-insert`, tests for `build-authors` + `load-to-payload`.
- **Templatization for peer institutions** — Layer 1 (config extraction) when ready.
- **Neon password rotation** + patch the `sync-to-neon.ts` log line that prints the connection string.
- **404 routes return 200** (#12) — defer to next Next.js bump.
- **eslint config crash** — `npm run lint` fails on main (eslintrc/plugin circular structure); fix or migrate to flat config.
