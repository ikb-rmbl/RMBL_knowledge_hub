# Grounded Frontiers — Design Spec (Stage B)

_Status: design draft, awaiting maintainer sign-off on the four open calls in
§7 before any production code lands. Pilot data + script live on branch
`pilot/grounded-frontier-extraction` (script: `scripts/pilot-grounded-frontiers.ts`,
outputs bundled under `specification/grounded-frontiers-pilot/{*.json,*.md}`,
also written to `scripts/output/` on each script run)._

## 1. Goals + non-goals

**Goals**

1. Every public frontier statement (key question, data gap, methodological
   blocker, coordination gap) traces to ≥1 specific *paper* with a verbatim
   quote — not to a primer-as-intermediate.
2. Currency is computable: each statement carries the years of its source
   papers, so "still open?" and "freshly re-affirmed" become trivial
   downstream queries.
3. Quality control is structural: the pipeline drops ungrounded statements
   by construction. A frontier never asserts an unsupported claim.

**Non-goals**

- Replacing the primers themselves. They stay as reader-facing summaries
  on the neighborhood pages; they just stop being the evidence chain for
  Frontiers.
- Validating *truth* of cited papers — only that the cite snippet appears
  verbatim in the source and that the LLM's reading of it is plausible.
- Cross-neighborhood frontier merging (already handled by clustering).

## 2. Pilot evidence base

Sonnet-4.6 over 5 representative neighborhoods (Marmot, Pollinator,
Salamander, East River Hydrology, Snowpack) with the fuzzy-match verifier:

| | Result |
|---|---|
| Statements emitted by LLM | 44 |
| Statements with ≥1 verbatim cite kept | 41 (93%) |
| Cites verified verbatim against source text | 65 / 69 (94%) |
| Cost | $0.26 total Sonnet ($0.05/neighborhood) |
| Full-corpus projection (146 neighborhoods) | ≈ $7 Sonnet |

Opus tested in parallel — same statement count, lower verification rate
(86%), 6.5× cost, weaker citation choice. **Sonnet is the production
model for this extraction.**

## 3. Schema

### 3.1 Source-statement layer

Existing table:

```sql
-- already exists
CREATE TABLE frontier_source_statements (
  id                   SERIAL PRIMARY KEY,
  frontier_id          INT,
  neighborhood_id      INT,
  statement_text       TEXT,
  management_relevance INT,
  source_section       TEXT,
  concepts             JSONB,
  protocols            JSONB,
  datasets_needed      JSONB
);
```

Add three columns (additive, non-breaking):

```sql
ALTER TABLE frontier_source_statements
  ADD COLUMN IF NOT EXISTS kind       TEXT,   -- 'open_question' | 'data_gap' | 'methodological_blocker' | 'coordination_gap'
  ADD COLUMN IF NOT EXISTS confidence TEXT,   -- 'low' | 'moderate' | 'high'  (LLM-assigned)
  ADD COLUMN IF NOT EXISTS extraction_run_id INT;  -- nullable FK to a runs table; lets us trace which pipeline run produced a row
```

Add the per-statement citation join:

```sql
CREATE TABLE frontier_statement_papers (
  id                  SERIAL PRIMARY KEY,
  statement_id        INT  NOT NULL REFERENCES frontier_source_statements(id) ON DELETE CASCADE,
  pub_id              INT  NOT NULL REFERENCES publications(id),
  snippet             TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('articulates','reinforces','addresses','contradicts')),
  position_in_paper   TEXT,                  -- 'abstract' | 'key_finding' | 'supporting_evidence' | nullable
  match_confidence    REAL CHECK (match_confidence BETWEEN 0 AND 1),  -- 1.0 for exact verbatim, <1 for fuzzy-match fallback
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON frontier_statement_papers(statement_id);
CREATE INDEX ON frontier_statement_papers(pub_id);
```

### 3.2 Synthesized-frontier citation layer

The synthesized frontier already has `key_questions jsonb` and `data_gaps
jsonb` (as flat string arrays). Two reasonable ways to add citations:

**Option A — extend the jsonb** (in place):

```jsonc
// frontiers.key_questions
[
  {
    "text": "At what cumulative level of phenological asynchrony do plant-pollinator interactions translate into measurable declines in vital rates?",
    "cites": [{ "pub_id": 4912, "snippet": "...", "role": "articulates" }],
    "year_range": [2019, 2024],
    "currency": "open" | "partially_addressed" | "answered"
  }
]
```

**Option B — parallel join table**:

```sql
CREATE TABLE frontier_question_papers (
  id              SERIAL PRIMARY KEY,
  frontier_id     INT NOT NULL REFERENCES frontiers(id) ON DELETE CASCADE,
  question_index  INT NOT NULL,    -- index into frontiers.key_questions
  pub_id          INT NOT NULL REFERENCES publications(id),
  snippet         TEXT,
  role            TEXT,
  inherited_from_statement_id INT REFERENCES frontier_source_statements(id)
);
```

**Recommendation: Option A (jsonb)** — the data is read-mostly (frontier
pages render one frontier at a time; we never query "which questions cite
pub 4912" at scale). Keeps the rendering path single-query, single-join.
Faster to iterate the prompt + synthesis without a schema migration.

If we later need analytic queries (e.g. "which papers are cited across the
most frontiers"), we can materialize a `frontier_question_papers` view from
the jsonb.

### 3.3 Currency fields on the frontier itself

```sql
ALTER TABLE frontiers
  ADD COLUMN IF NOT EXISTS source_paper_count INT,             -- distinct cited pub_ids across all questions + data gaps
  ADD COLUMN IF NOT EXISTS source_year_median INT,             -- median year of cited papers (recency signal)
  ADD COLUMN IF NOT EXISTS source_year_p10    INT,             -- 10th-percentile year (how old does the foundation get?)
  ADD COLUMN IF NOT EXISTS source_year_p90    INT,             -- 90th-percentile (how recent is the edge?)
  ADD COLUMN IF NOT EXISTS last_validation_run_id INT;         -- nullable; set by the "still open?" validator pass
```

## 4. Pipeline rewrite

### 4.1 Stage 1 — `extract-frontiers-grounded.ts` replaces `extract-frontiers.ts`

**Input** (per neighborhood):

- Neighborhood title + summary
- Top N papers (default N=30, configurable) — mix of most-cited + most-recent
- For each paper: pub_id, year, title, abstract, keyFindings[]
  (`{finding, confidence, supportingEvidence}`)

**Prompt** (this is the pilot prompt, near-final):

```
You are an expert research synthesist reading {N} papers from the
"{neighborhood title}" research neighborhood at RMBL.

TASK
Identify atomic frontier statements the literature articulates. A frontier
statement is one specific open question, data gap, methodological blocker,
or coordination gap. NOT a finding — only the unanswered side.

GROUNDING REQUIREMENT — STRICT
Each statement MUST cite ≥1 paper from the input below with a VERBATIM
snippet drawn from that paper's Abstract / Key finding / Supporting quote.
If you cannot quote source text, do not emit the statement.

OUTPUT FORMAT (strict JSON):
{ "statements": [ {
    "text": "...",
    "kind": "open_question" | "data_gap" | "methodological_blocker" | "coordination_gap",
    "confidence": "low" | "moderate" | "high",
    "cites": [{ "pub_id": 123, "snippet": "VERBATIM...", "role": "articulates" | "reinforces" }]
  } ]
}
Emit between 3 and 10. Quality over quantity.
```

**Verification** (port from the pilot script):

1. Normalize whitespace, unicode, smart quotes, em-dashes
2. Strip trailing ellipses from the LLM snippet
3. Exact substring match against the input text for the cited pub_id
4. Fallback: longest-verbatim-prefix; accept if ≥40 chars AND ≥90% of snippet
5. Drop statements with zero surviving cites

**Output**: rows into `frontier_source_statements` + `frontier_statement_papers`.

**No primer dependency.** The primer is no longer in the evidence chain.

### 4.2 Stage 2 — `cluster-frontiers.ts` (mostly unchanged, with one tweak)

Today: Louvain on a graph where nodes are statements and edges are
embedding similarity above threshold.

**One change**: edge weights become `cosine_similarity × recency_factor`.

```ts
// recency_factor: papers from the last 5 years get full weight; older
// statements decay smoothly. Median year of the statement's cites is the
// vintage signal.
function recencyFactor(medianYear: number, currentYear: number = 2026): number {
  const age = currentYear - medianYear
  if (age <= 5) return 1.0
  return Math.exp(-(age - 5) / 8)   // ~0.5 at age 10, ~0.25 at age 15
}
```

That single multiplication biases clusters toward recent framings without
dropping foundational statements — a 1990s statement still groups with
its semantic neighbors, just at lower weight, so the cluster's
representative text tilts toward the modern phrasing.

Citations propagate through clustering trivially: every statement in a
cluster contributes its cite array to the cluster's union.

### 4.3 Stage 3 — `synthesize-frontiers.ts`

The synthesis LLM call receives, per cluster:

- The cluster's member statements (text + per-statement cite snippets)
- The union of cited papers' titles + years for context

**Prompt change** — the existing synthesis prompt asks for a title,
narrative, key_questions[], data_gaps[], etc. We add **mandatory citation
propagation**:

> For each `key_question` and each `data_gap` you emit, you MUST include
> a `cites` array drawn from the cite snippets of the member statements
> below. Each cite must be one of the snippets you see in the input — do
> NOT invent or paraphrase. Prefer cites whose source statement is most
> on-point for the question.

**Output schema** (new for synthesized layer):

```jsonc
{
  "title": "Phenological Mismatch and Demographic Fate of Alpine Communities",
  "key_questions": [
    {
      "text": "At what cumulative level of phenological asynchrony do plant-pollinator interactions translate into measurable declines in vital rates?",
      "cites": [{ "pub_id": 4912, "snippet": "..." }],
      "year_range": [2019, 2024]
    }
  ],
  "data_gaps": [ /* same shape */ ],
  ...
}
```

**Verification at synthesis time**: same substring-match logic as Stage 1
— every emitted cite snippet must exist verbatim in the cluster's input.

### 4.4 New Stage 3.5 — `validate-frontier-currency.ts` (post-ingestion)

For each frontier's `key_questions[i]`:

1. Use the question's embedding to find the 15 most semantically similar
   papers in the contributing neighborhoods, **filtered to papers published
   after the median year of the question's cites**.
2. If no such papers exist, mark `currency = "open"`. Done.
3. Otherwise, run a small LLM check: "Does this paper address question X?
   If yes, in what way? Answer: addressed | partially_addressed | not_addressed".
4. Update `currency` and add an `addressed_by` array on the question.

Cost: one Sonnet call per question per frontier. ~700 questions × $0.01 ≈
**$7 per validation pass**.

**Cadence: triggered on bulk paper ingestion (~2 batches/year per
maintainer).** The validation script runs as the final step of the
ingestion pipeline:

```
ingest papers → enrich → load → topics → authors → entities → citations
  → embeddings → [NEW] validate-frontier-currency
```

Plus a manual admin trigger for ad-hoc rechecks (e.g. after a single
high-impact paper lands). The frontier page shows "Currency last checked
YYYY-MM-DD" so readers can judge freshness.

Annual cost at 2 validation passes/year ≈ **$14**. Cheap enough to run
opportunistically between major ingestion events too.

This is the "currency" half of the original problem, riding on the
provenance refactor.

## 5. UI changes

### 5.1 Frontier detail page (`/frontiers/[id]`)

**Per-question** — inline cite chips, hover popover with verbatim quote:

```
At what cumulative level of phenological asynchrony do plant-pollinator
interactions translate into measurable declines?       [pub #4912 ↗]
                                                       [pub #5104 ↗]
                                                       ◯ Open (last
                                                       affirmed 2024)
```

On hover, `pub #4912` reveals the snippet:

```
┌────────────────────────────────────────────────────┐
│ Inouye, D. W. (2023). Climate, ecology and...      │
│                                                    │
│ "the cumulative impact of phenological shifts on   │
│  pollinator vital rates remains an open question." │
└────────────────────────────────────────────────────┘
```

Click on the chip → navigate to `/publications/4912`.

**Per-question currency badge** — from §4.4:

| Currency | Visual |
|---|---|
| `open` | ◯ Open (last affirmed YYYY) — muted |
| `partially_addressed` | ◐ Partially addressed (YYYY) — moss |
| `addressed` | ● Likely addressed: pub #N (YYYY) — sky |

### 5.2 Frontier index (`/frontiers`)

Add to each card:

- `N primary citations across M papers`
- `Currency: 70% open / 20% partially / 10% addressed`

Lets a reader scan for frontiers that are still meaty vs ones that have
shifted under the literature.

## 6. Migration & rollback

The schema migration is additive — no destructive changes. New columns
default to NULL. Old `extract-frontiers.ts` and the existing
`frontier_source_statements` rows stay in place.

**Plan A — parallel namespace**:

1. Ship schema migration.
2. Run `extract-frontiers-grounded.ts` writing to the same tables, but
   tagged with `extraction_run_id`. A frontier built from grounded
   statements has the new fields populated; old ones have NULL.
3. UI conditionally renders the new affordances (cite chips, currency)
   only when the new fields are populated.
4. Cut over to grounded by deleting the old run's statements once we're
   confident.

**Plan B — clean break**:

1. Ship schema migration.
2. Wipe `frontier_source_statements` + `frontiers` content.
3. Run the grounded pipeline end-to-end.
4. UI renders only the new way.

Recommend **Plan A** — small extra complexity in the rendering branches,
but lets us A/B compare before committing and rolls back gracefully if
the LLM regresses.

## 7. Design calls — resolved

**Q1. Snippet length: soft 80–250 chars, hard cap 400.** Enforced in
both the prompt (target range) and the verifier (reject longer). Matches
the natural shape pilot output landed at without guidance.

**Q2. Ungrounded statements: drop silently.** Cleanest by-construction
signal — nothing on a frontier page is unsupported. Pilot shows we still
get 7–9 grounded statements per neighborhood, so we're not starving the
output.

**Q3. Source coverage: keyFindings when present, abstracts when not, both
when both.** Pilot's Snowpack neighborhood (2 / 16 papers with
keyFindings) still ground at 94% off abstracts alone — the grounding
requirement is robust either way.

**Q4. Validation cadence: triggered on bulk paper ingestion.** Per the
maintainer, the corpus grows in ~2 batches/year rather than continuous
trickle. The validation pass runs as the last step of bulk ingestion, plus
a manually-triggerable rerun for ad-hoc checks. Two passes/year at ~$7
each ≈ **$14/year** — much cheaper than the weekly-cron alternative I
originally floated, and lines up with how new evidence actually arrives.

## 8. Recommended sequencing

(Q1–Q4 resolved — see §7. Step 0 dropped.)

| Step | What | Effort | Output |
|---|---|---|---|
| **1** | Schema migration SQL + types | ½ day | additive migration; safe to ship |
| **2** | `extract-frontiers-grounded.ts` (productionized pilot, writes to DB) | 1 day | new extraction pipeline |
| **3** | Modify `cluster-frontiers.ts` to add recency weighting + cite propagation | ½ day | clusters with attached cite arrays |
| **4** | Modify `synthesize-frontiers.ts` to require + propagate cites | 1 day | new synthesis output schema |
| **4b** | Add `frontier_snapshots` + `frontier_extraction_runs` tables + snapshot triggers in synthesize / validate scripts (see §10) | ½ day | progress-tracking history captured automatically |
| **5** | `validate-frontier-currency.ts` (new script) + wire into ingestion pipeline as final step | 1 day | the still-open? validator, fires on bulk ingestion |
| **6** | UI: inline cite chips + hover popover + currency badge | 1 day | new affordances on frontier detail |
| **7** | UI: frontier index card updates | ½ day | scannable currency info |
| **8** | Run end-to-end on full corpus, A/B compare against current | 1 day + ~$15 in LLM cost | grounded frontiers live in parallel namespace |
| **9** | Decide on cutover (Plan A or B) | maintainer | production switch |

**~6.5 days of focused work + ~$15 one-time LLM cost (re-validation ~$14/year
ongoing). Fully reversible until step 9.**

## 9. Risks

- **LLM citation drift** (mitigated by strict verifier, ~94% catch rate
  on pilot). Residual risk: the 6% that pass verification but are
  *misattributed* — the snippet is real but the LLM picked the wrong
  context. Detectable via spot-checks; not detectable automatically.
- **Coverage gaps** in low-PDF neighborhoods. Mitigation: still emit
  fewer-but-grounded statements rather than none.
- **Question-vs-finding drift**. The pilot saw the LLM occasionally
  emit a finding paraphrased as a question. Mitigation: tighten the
  prompt's kind definitions, post-filter via a kind-classifier check.
- **Re-run reproducibility**. LLMs are non-deterministic at temperature
  > 0. Pilot used default temperature; switching to 0 for production
  may help reproducibility at small quality cost. Worth A/B testing.
- **Existing frontier dependencies**. `frontier_planning` pipeline + UI
  builds on the current synthesized frontier shape. New cite arrays are
  additive — should be backward-compatible — but worth a smoke test.

## 10. Historical preservation / progress tracking

**Goal:** when a frontier evolves — questions get answered, new framings
emerge, currency states shift — retain the previous versions so we can
demonstrate research progress over time. The community-facing narrative
becomes "in 2024 this was open; by 2026 it was addressed by paper X" —
much stronger evidence of momentum than a single snapshot in time.

**Minimal design (one new table, plus a small runs table):**

```sql
-- Append-only history of frontier states. Inserted at regeneration /
-- validation moments; only the `superseded_at` chain pointer is ever
-- updated after insert.
CREATE TABLE frontier_snapshots (
  id                SERIAL PRIMARY KEY,
  frontier_id       INT NOT NULL REFERENCES frontiers(id),
  snapshot_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at     TIMESTAMPTZ,   -- set when the next snapshot replaces this one

  -- Frozen frontier state at snapshot time (parallel shape to `frontiers`)
  title             TEXT NOT NULL,
  cross_cutting_summary TEXT,
  context           TEXT,
  frontier_description TEXT,
  barriers          TEXT,
  research_opportunities TEXT,
  impacts           TEXT,
  tractability      TEXT,
  framing_notes     TEXT,
  key_questions     JSONB NOT NULL,
  pushing_the_frontier JSONB,
  data_gaps         JSONB,

  -- Currency rollup at snapshot time
  source_paper_count INT,
  source_year_median INT,
  question_currency_summary JSONB,    -- e.g. {"open": 7, "partially": 2, "addressed": 1}

  -- Provenance: why was this snapshot taken?
  snapshot_reason   TEXT NOT NULL CHECK (snapshot_reason IN (
    'pipeline_rerun',              -- extract → cluster → synthesize re-ran
    'validation_currency_shift',   -- ≥1 question's currency changed at validation
    'manual_admin'                 -- explicit "save snapshot" from admin UI
  )),
  extraction_run_id INT            -- nullable; points to the run that produced this state
);

CREATE INDEX ON frontier_snapshots(frontier_id, snapshot_at DESC);
CREATE INDEX ON frontier_snapshots(snapshot_reason);

-- Pipeline run log — implied already by `extraction_run_id` columns
-- elsewhere in this spec, but call it out explicitly here.
CREATE TABLE frontier_extraction_runs (
  id                      SERIAL PRIMARY KEY,
  started_at              TIMESTAMPTZ NOT NULL,
  finished_at             TIMESTAMPTZ,
  pipeline_version        TEXT,         -- e.g. 'grounded-v1', 'grounded-v1.1'
  model                   TEXT,         -- e.g. 'claude-sonnet-4-6'
  neighborhoods_processed INT,
  statements_emitted      INT,
  statements_grounded     INT,
  notes                   TEXT
);
```

**Why this shape**

- **Snapshot the synthesized layer only.** Source statements + per-statement
  cites are derived from immutable papers (and tagged with `extraction_run_id`),
  so they don't need separate snapshotting — they can always be recovered.
  Snapshotting *only* the synthesized frontier state keeps the table small
  and the writes cheap.
- **No FK from `frontier_question_papers` to snapshots.** Cite arrays live
  inside the `key_questions` jsonb on each snapshot, so a snapshot is
  self-contained. No fragile referential complexity.
- **Append-only.** No row gets edited after insert except `superseded_at`,
  which is a one-shot chain pointer. Easier to reason about than a
  versioned mutable table.

**Snapshot triggers (three sources only):**

1. **Pipeline regeneration** — `synthesize-frontiers.ts` opens a transaction,
   snapshots the current state of each frontier it's about to overwrite,
   then writes the new state. Reason: `pipeline_rerun`.
2. **Validation-pass currency shifts** — `validate-frontier-currency.ts`
   diffs each question's currency before/after; if ≥1 question's state
   changed, take a snapshot. Reason: `validation_currency_shift`.
3. **Manual admin save** — explicit "Save snapshot" button on the frontier
   admin edit page, e.g. before a curator edits a key question. Reason:
   `manual_admin`.

**UI affordances (new on frontier detail page):**

- **"What changed since last snapshot" panel** — small inline diff:

  ```
  Since 2025-12-04:
    ✓ 2 questions addressed by new papers
    + 1 new question emerged (from a 2026 paper)
    – 1 question removed in regeneration
  ```

- **History accordion** — collapsed by default; lists prior snapshots with
  date, reason, and 1-line summary. Click to expand a snapshot view that
  renders the same way as the current frontier but read-only and dated.
- **Currency sparkline** (optional, follow-up) — `question_currency_summary`
  rolled across the snapshot timeline shows "open → addressed" trajectory.

**Storage cost.** ~10 KB per snapshot × ~98 frontiers × ~3 snapshots/year
≈ **3 MB/year**. Negligible.

**What this gives**

- A concrete research-progress narrative: *"This question was articulated
  in 2019, validated as open through 2024, addressed by paper X in 2025."*
- Audit trail for community-facing transparency.
- Material for end-of-year retrospectives ("this year the community closed
  N questions; M new ones emerged").

The §8 sequencing absorbs this as a single extra step (~½ day, between
existing steps 4 and 5): ship the schema + snapshot triggers in the
existing pipeline scripts. No new long-running work, no new LLM calls.

## 11. What this design doesn't address

- Extending the VLM-style `keyFindings` extraction to capture
  limitation / future-work sections explicitly. The pilot shows we
  don't *need* it for viability, but a focused `openQuestions`
  extraction pass would lift coverage and quality further. Worth
  considering as a Stage C if Stage B's grounding rate slips below
  ~85% on full-corpus runs.
- Cross-frontier deduplication when the same primary source supports
  questions on multiple frontiers — currently each frontier's questions
  carry their own cites; we don't surface "this paper underwrites N
  frontiers" anywhere. Add as a follow-up if it becomes useful.
- Front-end author / community correction workflow. Curation
  infrastructure (flags, curated_fields) is in place from earlier work
  but no specific UI for editing a question's cites. Punt to a later
  curation-tooling PR.
