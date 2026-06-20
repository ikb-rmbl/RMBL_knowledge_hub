-- Schema for the grounded-frontiers refactor — Stage B Step 1.
--
-- All changes additive and idempotent: existing rows / columns / data
-- are preserved. Safe to re-run. This migration lands the schema only;
-- writes to the new structures come in follow-up PRs per spec §8.
--
-- See specification/grounded-frontiers-design.md for the design rationale.
--
-- Tables touched / created:
--   - NEW   frontier_extraction_runs       (pipeline run log)
--   - NEW   frontier_statement_papers      (per-statement citation join)
--   - NEW   frontier_snapshots             (append-only frontier history)
--   - ALTER frontier_source_statements     (kind, confidence, extraction_run_id)
--   - ALTER frontiers                      (currency rollup + run pointer)
--
-- Tracks: PR #63 (spec) → this PR (step 1 of 9 in spec §8).


-- =====================================================================
-- 1. frontier_extraction_runs — the run log everything else points at.
--    Must be created first so the FK columns below can reference it.
-- =====================================================================

CREATE TABLE IF NOT EXISTS frontier_extraction_runs (
  id                      SERIAL PRIMARY KEY,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at             TIMESTAMPTZ,
  pipeline_version        TEXT,         -- 'grounded-v1', 'grounded-v1.1', etc.
  model                   TEXT,         -- 'claude-sonnet-4-6', 'claude-opus-4-7', ...
  neighborhoods_processed INT,
  statements_emitted      INT,
  statements_grounded     INT,
  notes                   TEXT
);

COMMENT ON TABLE  frontier_extraction_runs IS
  'Log of frontier-pipeline runs. One row per extract → cluster → synthesize sweep, plus one per validation pass. Provides traceability for every grounded statement, snapshot, and frontier state.';
COMMENT ON COLUMN frontier_extraction_runs.pipeline_version IS
  'Free-form version tag for the pipeline as a whole, bumped when the prompt or schema changes meaningfully.';


-- =====================================================================
-- 2. ALTER frontier_source_statements — add kind / confidence / run pointer.
--    Existing rows from the old (primer-derived) pipeline keep these as
--    NULL until they''re re-extracted or backfilled.
-- =====================================================================

ALTER TABLE frontier_source_statements
  ADD COLUMN IF NOT EXISTS kind              TEXT,
  ADD COLUMN IF NOT EXISTS confidence        TEXT,
  ADD COLUMN IF NOT EXISTS extraction_run_id INT
    REFERENCES frontier_extraction_runs(id) ON DELETE SET NULL;

-- CHECK constraints added separately so re-runs don''t fail on existing
-- duplicate-named constraint errors (Postgres lacks IF NOT EXISTS for CHECKs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'frontier_source_statements_kind_check'
  ) THEN
    ALTER TABLE frontier_source_statements
      ADD CONSTRAINT frontier_source_statements_kind_check
      CHECK (kind IS NULL OR kind IN (
        'open_question', 'data_gap', 'methodological_blocker', 'coordination_gap'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'frontier_source_statements_confidence_check'
  ) THEN
    ALTER TABLE frontier_source_statements
      ADD CONSTRAINT frontier_source_statements_confidence_check
      CHECK (confidence IS NULL OR confidence IN ('low', 'moderate', 'high'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS frontier_source_statements_extraction_run_id_idx
  ON frontier_source_statements (extraction_run_id);


-- =====================================================================
-- 3. frontier_statement_papers — the join that grounds each statement
--    in 1+ primary-source papers with a verbatim quote.
-- =====================================================================

CREATE TABLE IF NOT EXISTS frontier_statement_papers (
  id                  SERIAL PRIMARY KEY,
  statement_id        INT  NOT NULL REFERENCES frontier_source_statements(id) ON DELETE CASCADE,
  pub_id              INT  NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  snippet             TEXT NOT NULL,
  role                TEXT NOT NULL,
  position_in_paper   TEXT,
  match_confidence    REAL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'frontier_statement_papers_role_check'
  ) THEN
    ALTER TABLE frontier_statement_papers
      ADD CONSTRAINT frontier_statement_papers_role_check
      CHECK (role IN ('articulates', 'reinforces', 'addresses', 'contradicts'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'frontier_statement_papers_match_confidence_check'
  ) THEN
    ALTER TABLE frontier_statement_papers
      ADD CONSTRAINT frontier_statement_papers_match_confidence_check
      CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS frontier_statement_papers_statement_id_idx
  ON frontier_statement_papers (statement_id);
CREATE INDEX IF NOT EXISTS frontier_statement_papers_pub_id_idx
  ON frontier_statement_papers (pub_id);

COMMENT ON TABLE  frontier_statement_papers IS
  'Per-statement citations. Each row grounds a frontier source statement in a specific paper with a verbatim quote — the architectural break from primer-as-evidence to paper-as-evidence.';
COMMENT ON COLUMN frontier_statement_papers.match_confidence IS
  '1.0 = exact-substring match; <1.0 = fuzzy-match fallback (longest-verbatim-prefix). NULL pre-backfill.';
COMMENT ON COLUMN frontier_statement_papers.position_in_paper IS
  '''abstract'' | ''key_finding'' | ''supporting_evidence'' — where in the input the snippet was found.';


-- =====================================================================
-- 4. ALTER frontiers — currency rollup + validation run pointer.
--    Populated by the cluster + validate steps; NULL until then.
-- =====================================================================

ALTER TABLE frontiers
  ADD COLUMN IF NOT EXISTS source_paper_count     INT,
  ADD COLUMN IF NOT EXISTS source_year_median     INT,
  ADD COLUMN IF NOT EXISTS source_year_p10        INT,
  ADD COLUMN IF NOT EXISTS source_year_p90        INT,
  ADD COLUMN IF NOT EXISTS last_validation_run_id INT
    REFERENCES frontier_extraction_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS frontiers_last_validation_run_id_idx
  ON frontiers (last_validation_run_id);

COMMENT ON COLUMN frontiers.source_paper_count IS
  'Distinct cited pub_ids across all key_questions + data_gaps. Updated by synthesize step.';
COMMENT ON COLUMN frontiers.source_year_median IS
  'Median publication year across cited papers. The recency signal for index-page currency display.';


-- =====================================================================
-- 5. frontier_snapshots — append-only history (spec §10).
--    Captures the synthesized layer; immutable evidence chain is
--    recoverable from extraction_run_id, so we don''t snapshot source
--    statements separately.
-- =====================================================================

CREATE TABLE IF NOT EXISTS frontier_snapshots (
  id                        SERIAL PRIMARY KEY,
  frontier_id               INT NOT NULL REFERENCES frontiers(id) ON DELETE CASCADE,
  snapshot_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at             TIMESTAMPTZ,

  -- Frozen frontier state (parallel shape to `frontiers`)
  title                     TEXT NOT NULL,
  cross_cutting_summary     TEXT,
  context                   TEXT,
  frontier_description      TEXT,
  barriers                  TEXT,
  research_opportunities    TEXT,
  impacts                   TEXT,
  tractability              TEXT,
  framing_notes             TEXT,
  key_questions             JSONB NOT NULL,
  pushing_the_frontier      JSONB,
  data_gaps                 JSONB,

  -- Currency rollup at snapshot time
  source_paper_count        INT,
  source_year_median        INT,
  question_currency_summary JSONB,    -- e.g. {"open": 7, "partially": 2, "addressed": 1}

  -- Provenance: why was this snapshot taken?
  snapshot_reason           TEXT NOT NULL,
  extraction_run_id         INT
    REFERENCES frontier_extraction_runs(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'frontier_snapshots_snapshot_reason_check'
  ) THEN
    ALTER TABLE frontier_snapshots
      ADD CONSTRAINT frontier_snapshots_snapshot_reason_check
      CHECK (snapshot_reason IN (
        'pipeline_rerun',
        'validation_currency_shift',
        'manual_admin'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS frontier_snapshots_frontier_id_snapshot_at_idx
  ON frontier_snapshots (frontier_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS frontier_snapshots_snapshot_reason_idx
  ON frontier_snapshots (snapshot_reason);

COMMENT ON TABLE  frontier_snapshots IS
  'Append-only history of synthesized frontier state. Inserted before regeneration / validation overwrites the live row. Lets the UI show how each frontier evolved over time — supports the progress-tracking narrative.';
COMMENT ON COLUMN frontier_snapshots.snapshot_reason IS
  '''pipeline_rerun'' = extract→cluster→synthesize re-ran; ''validation_currency_shift'' = ≥1 question''s currency changed at validation; ''manual_admin'' = explicit save from admin UI.';


-- =====================================================================
-- 6. Smoke check — confirm everything is in place.
-- =====================================================================

DO $$
DECLARE
  missing INT := 0;
  _t TEXT;
  _ct RECORD;
BEGIN
  -- Tables
  FOREACH _t IN ARRAY ARRAY[
    'frontier_extraction_runs',
    'frontier_statement_papers',
    'frontier_snapshots'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = _t) THEN
      RAISE NOTICE '  ✗ table % MISSING', _t;
      missing := missing + 1;
    ELSE
      RAISE NOTICE '  ✓ table % present', _t;
    END IF;
  END LOOP;

  -- Columns
  FOR _ct IN SELECT * FROM (VALUES
    ('frontier_source_statements', 'kind'),
    ('frontier_source_statements', 'confidence'),
    ('frontier_source_statements', 'extraction_run_id'),
    ('frontiers',                  'source_paper_count'),
    ('frontiers',                  'source_year_median'),
    ('frontiers',                  'source_year_p10'),
    ('frontiers',                  'source_year_p90'),
    ('frontiers',                  'last_validation_run_id')
  ) AS x(tbl, col) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = _ct.tbl AND column_name = _ct.col
    ) THEN
      RAISE NOTICE '  ✗ %.% MISSING', _ct.tbl, _ct.col;
      missing := missing + 1;
    ELSE
      RAISE NOTICE '  ✓ %.% present', _ct.tbl, _ct.col;
    END IF;
  END LOOP;

  IF missing > 0 THEN
    RAISE EXCEPTION '% schema element(s) missing — review the messages above', missing;
  ELSE
    RAISE NOTICE '  all expected tables + columns in place';
  END IF;
END $$;
