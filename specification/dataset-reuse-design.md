# Dataset Re-use Assessment — quantifying the R in FAIR

*Design note, 2026-09-06. Goal: per-dataset evidence of re-use by research groups
other than the original creators — internal (within the Knowledge Commons corpus)
and external — rolled up to an "R-rate" for the archive as a whole.*

## Definition

A **re-use event** is a research output (paper, dataset, document) that *uses* a
dataset's data, produced by a team **independent** of the dataset's creators.
Three orthogonal classifications per event:

| Axis | Values | How determined |
|---|---|---|
| use class | `data_used` / `mention` / `unclear` | citation context (LLM where text available; DataCite relation type as prior) |
| independence | `same_group` / `collaborators` / `independent` | author overlap + co-authorship graph distance |
| provenance | `internal` (KC pub) / `external` (DataCite/OpenAlex work) | which channel found it |

The FAIR-R headline is: **fraction of datasets with ≥1 `data_used` × `independent` event**,
sliced by repository, dataset age, long-term vs one-time, and over time.

## The two hard problems

1. **Citation indirection.** Researchers who re-use data usually cite the
   *companion paper*, not the dataset DOI. Counting only formal data citations
   (DataCite) undercounts badly. Countermeasure: follow forward citations of
   companion papers and classify whether the citing work used the underlying data.
2. **Independence.** Raw citation counts include the creators citing their own
   dataset in the next paper (which is *continuation*, not re-use). Countermeasure:
   author-set comparison against the deduplicated author registry, refined by
   co-authorship graph distance.

## What we already have (grounded 2026-09-06)

- `external_citation_count` (DataCite, via fetch-citation-counts): **301/1,555
  datasets > 0**, max 385 — raw external signal already flowing.
- **1,143 datasets with DOIs** → externally trackable. 171 SDP products have no
  DOI → internal-only assessment (and an argument for minting SDP DOIs).
- **819 datasets with creator links** in `authors_rels` against the deduplicated
  7.5K-author registry → author-overlap computation is feasible today.
- `datasets_rels` pub↔dataset links (crosslink-datasets full-text direction +
  link-dataset-citations metadata direction), `references_cited` (10K+ internal
  pub→pub edges), full text for ~1,700 publications, co-authorship graph,
  OpenAlex + Semantic Scholar integrations, `cited_references` (dataset→companion
  paper with evidence, from the LLM extraction pass).

## Evidence channels

| # | Channel | Provenance | Coverage | Cost |
|---|---|---|---|---|
| 1 | `datasets_rels` links: KC papers linked to the dataset | internal | growing (~300+ datasets) | free (exists) |
| 2 | DataCite events / OpenAlex citing works for the dataset DOI | external | 1,143 DOI'd datasets | API calls, free |
| 3 | Forward citations of the **companion paper** (OpenAlex `cited_by`), classified for data use | both | any dataset with a companion paper | API + LLM on citation contexts |
| 4 | Full-text mention detection: dataset title/DOI/known series names in KC paper full text | internal | ~1,700 full texts | done for DOIs (crosslink); extendable |

Channel 3 is the one nobody else measures and where most true re-use hides.
Semantic Scholar's citation-context API returns the sentence(s) around each
citation — enough for an LLM to judge "used the marmot dataset" vs "cited for
background," even for external papers we don't have full text for.

## Independence classifier (cheap, deterministic)

For each (dataset, citing work) pair:

1. Creator set C = dataset's authors (registry ids; ORCID-enriched).
2. Citing set A = citing work's authors (registry ids for internal; OpenAlex
   author ids ↔ ORCID matched into the registry for external, name-match fallback).
3. `same_group` if |A ∩ C| / |C| ≥ threshold (any shared *first/lead* author, or
   ≥half the creators).
4. Else `collaborators` if min co-authorship-graph distance between A and C ≤ 1
   (someone in A has co-authored with someone in C on *other* work).
5. Else `independent`.

Gray zones (former students publishing solo, lab descendants) land in
`collaborators` — arguably correct for FAIR-R purposes: report `independent`
strictly and `independent + collaborators` as the loose bound.

## Data model

```sql
CREATE TABLE dataset_reuse_events (
  id serial PRIMARY KEY,
  dataset_id int NOT NULL,           -- datasets.id
  channel text NOT NULL,             -- internal_link | datacite | companion_forward | fulltext_mention
  citing_publication_id int,         -- internal KC pub, when matched
  citing_doi text,                   -- external work
  citing_title text,
  citing_year int,
  use_class text,                    -- data_used | mention | unclear
  independence text,                 -- same_group | collaborators | independent
  evidence text,                     -- citation context / relation type
  confidence real,
  extracted_at timestamptz DEFAULT now(),
  UNIQUE (dataset_id, channel, coalesce(citing_publication_id, -1), coalesce(citing_doi, ''))
);
```

Rollup columns on `datasets`: `reuse_internal_count`, `reuse_external_count`,
`reuse_independent boolean` (≥1 independent data_used event), refreshed by the
assessment script. Detail pages get a "Re-use" panel listing the events with
evidence; /datasets gets an "Independently re-used" chip; /metrics gets the
R-rate series (fraction of datasets ≥N years old with independent re-use — age
matters, a 2026 dataset hasn't had time).

## Phasing (MVP-first)

- **Phase 1 — deterministic, ~free:** build the events table from channels 1+2
  (existing links + OpenAlex citing works for dataset DOIs), run the independence
  classifier via the author registry. No LLM. Produces the first honest R-rate
  split into self/collaborator/independent. Biggest known bias: undercounts via
  indirection.
- **Phase 2 — companion indirection (the interesting one):** for each dataset
  with a companion paper, pull forward citations (OpenAlex), fetch S2 citation
  contexts, LLM-classify use_class (batchable; ~cents per citing paper; sample
  first to estimate the indirection multiplier before running the full corpus).
- **Phase 3 — polish:** fulltext_mention sweep for named long-term series without
  formal citations ("the Gothic phenology record"), time-to-first-reuse metrics,
  /metrics + detail-page surfaces, annual re-run in the pipeline.

## Honest caveats

- Absence of evidence ≠ retirement: field re-use, teaching use, and agency use
  leave no citation trace. Frame the R-rate as a *lower bound*.
- SDP products without DOIs are invisible externally — internal-only for them;
  consider DOI minting as a policy outcome of this work.
- DataCite relation types are noisy (IsSupplementTo ≠ re-use); treat as prior,
  not verdict.
- Name-based external author matching (no ORCID) will misclassify some
  independence calls; report confidence and keep evidence inspectable.
