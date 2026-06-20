# Grounded Frontiers — Full-Corpus Run #2 Report

_Extraction run #2 · pipeline `grounded-v1` · 2026-06-19 · this run is the
production cutover candidate for the grounded pipeline (spec step 8)._

## TL;DR

The end-to-end grounded pipeline ran clean across the full corpus.
**68 grounded frontiers** now live alongside the 98 legacy frontiers
under Plan A (parallel namespace). Every public statement is
verifiably traceable to a primary paper. The pipeline picks up
spec-promised currency tracking — 76% of statements are open,
21% partially addressed, 3% addressed by newer literature.

Total LLM cost: **$25.16** (under the ~$15 spec budget for Sonnet-only,
over it for Opus-on-synthesis as authorized by the maintainer).

## Per-phase numbers

| Phase | Script | Cost | Output | Notes |
|---|---|---|---|---|
| Extract | `extract-frontiers-grounded.ts` (Sonnet) | **$2.68** | 533 grounded statements; 92% grounding rate; 692 verbatim cites across 425 papers | 146 nbrs processed, 59 skipped (no abstracts), 4 JSON parse failures |
| Cluster | `cluster-frontiers-grounded.ts` (local) | — | 154 clusters; 67 multi-member, 87 singletons dropped | voyage-4 embeddings, threshold 0.74, recency weighting on edges |
| Synthesize | `synthesize-frontiers-grounded.ts` (Opus) | **$20.52** | 67 frontiers; 303 questions kept (0 dropped); 202 data_gaps kept (0 dropped); 658 verbatim cites | First run hit a `maxTokens=4000` ceiling on large clusters — bumped to 8000, added checkpointing + resume support, re-ran clean |
| Load | `load-frontiers-grounded.ts` (local) | — | 67 inserted; 446 source statements linked; 87 singletons unassigned (expected) | Plan A — legacy 98 untouched |
| Validate | `validate-frontier-currency.ts` (Sonnet) | **$1.96** | 514 items judged across 68 frontiers; 121 currency shifts; 34 snapshots taken | Each frontier checks ≤15 candidate papers per item; per-item LLM call returns currency + addressed_by[] |
| **Total** | | **$25.16** | | |

Runtime: ~75 min total wall-clock (extract 30, synth 25, validate 20, the
local-only steps trivial).

## Grounded vs legacy at a glance

|  | Legacy | Grounded |
|---|---|---|
| Frontiers | 98 | 68 |
| Avg statements per frontier | 5.1 | 6.7 |
| Avg neighborhoods per frontier | 3.1 | 2.7 |
| Avg key_questions | 6.4 | 4.5 |
| Avg data_gaps | 6.5 | 3.0 |
| **Verbatim primary cite per question/gap?** | none | 100% (verifier-enforced) |
| **Per-item currency tracked?** | no | yes |
| Source year span on top-coverage frontier | n/a | 1966–2026; median 2016 |
| Citations on top-coverage frontier | n/a | 93 |

The grounded pipeline produces fewer total frontiers and fewer items per
frontier, because (a) clusters with no verbatim-supportable statements
are dropped at the verifier, and (b) clusters with no group of ≥2
similar statements get dropped at the singleton stage. Trade-off:
fewer frontiers, but every claim is anchored to a paper a reader can
open and argue with.

## Side-by-side question quality

A roughly comparable topic — climate-driven shifts in plant-pollinator
dynamics. Both pipelines surface the same intuition:

**Legacy frontier #2 — Phenological Mismatch and Demographic Fate of Alpine Communities**

> *Q1:* At what cumulative level of phenological asynchrony do
> plant-pollinator interactions translate into measurable declines in
> vital rates and population growth?

7 questions total. Phrasing is clean. There is no link to source.

**Grounded frontier #103 — Climate-Driven Disruption of Mountain Plant-Pollinator Systems**

> *Q1:* Is floral trait plasticity (scent, morphology, rewards) under
> climate change generally adaptive, and how do simultaneous climate
> stressors interact to shape selection?
>
> **Cites:**
> - pub #26 (2025): *"The complexity of the responses underscores the
>   need for more studies of how climate change will affect floral
>   volatiles and other floral traits."* [articulates]
> - pub #26: *"Floral trait plasticity was not generally adaptive."*
>   [reinforces]
> - pub #41: *"They also illustrate the need for more long-term field
>   warming studies..."* [reinforces]
>
> **Currency:** ◯ open · last checked 2026-06-20 · no addressing paper
> found in newer literature

8 questions total. Each backed by ≥1 verbatim source sentence the reader
can click and verify. 93 distinct cited papers across the frontier.

## Currency distribution

Across the 68 grounded frontiers' 505 statements (303 questions +
202 data_gaps):

| State | Count | % |
|---|---|---|
| Open | 386 | 76% |
| Partially addressed | 106 | 21% |
| Likely addressed | 13 | 3% |

The 3% "addressed" tail isn't a pipeline bug — it's the validator
catching cases where post-2020 literature has substantively answered an
older question. Examples flow through to the detail-page UI as
"Likely addressed: pub #N (YYYY)" affordances.

34 frontiers had ≥1 currency shift during this validation pass and
therefore have a snapshot in `frontier_snapshots` capturing the
pre-validation state. The remaining 34 had all items stay "open" — no
snapshot needed.

## Known issues + future work

- **Singleton handling**: 87 candidate statements (16% of grounded
  output) didn't cluster with any peer and were dropped. Some of those
  may be legitimate solo frontiers (a question that genuinely lives in
  one paper). A follow-up could promote singleton candidates from a
  high-confidence single statement into a one-member frontier, gated by
  the source paper's citation count or recency.
- **Validator pool limits**: the currency validator's candidate pool is
  bounded by `frontier_neighborhoods`. If a question genuinely cuts
  across multiple neighborhoods, papers in adjacent ones won't be
  evaluated. Step 9 might widen this.
- **No A/B at neighborhood level**: this report compares aggregate
  legacy vs grounded; we didn't pick the same conceptual cluster and
  run both pipelines on it. The Snowpack frontier #102 (run 1) is the
  one apples-to-apples case — the legacy "Snowpack" frontier and
  grounded #102 cover the same neighborhood, and the grounded version
  is strictly more useful (cites + currency).

## Cutover recommendation

The grounded pipeline produces verifiable, currency-tracked frontiers
across the corpus at a one-time cost of $25 and a recurring cost of
~$4 per validation pass. The UI now renders both representations side
by side via the dual-shape rendering shipped in steps 6 + 7 — legacy
cards stay byte-identical, grounded cards gain the new affordances.

Step 9's cutover decision space:

| Plan | Action | Cost |
|---|---|---|
| **A1 — Keep both visible** | Show legacy + grounded in `/frontiers` list, label grounded as "preview" | $0 |
| **A2 — Grounded primary, legacy hidden behind toggle** | Default-hide legacy from `/frontiers`, surface via "Show legacy frontiers" expand | $0 |
| **B — Clean break** | Delete legacy 98 (or hard-archive with snapshot), grounded becomes the only Frontiers | $0 + delete migration |

Recommendation: **A2** — grounded as primary surface, legacy behind a
toggle for 1-2 months while curators sanity-check the grounded set,
then **B** with confidence once any gaps are spotted and re-clustered.

## Reproduction

```bash
npx tsx scripts/extract-frontiers-grounded.ts --papers=30 --model=claude-sonnet-4-6
npx tsx scripts/cluster-frontiers-grounded.ts --extraction-run-id=<id>
npx tsx scripts/synthesize-frontiers-grounded.ts --model=claude-opus-4-7
npx tsx scripts/load-frontiers-grounded.ts
npx tsx scripts/validate-frontier-currency.ts
```

Each step is independently resumable from JSON checkpoints (synth/load) or
DB state (extract/validate). Re-running the loader with the same
`extraction_run_id` snapshots and updates in place rather than
duplicating rows.
