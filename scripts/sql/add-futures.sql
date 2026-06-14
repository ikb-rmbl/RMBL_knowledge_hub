-- Future Scenarios + companion narratives.
--
-- Two custom SQL tables holding generated artifacts from the Future Scenarios
-- pipeline (specification/scenarios/ + specification/stories/). Source of
-- truth remains the .md files (regenerated from YAML + LLM); these tables
-- exist for fast browse/detail rendering and search.
--
-- Loaded by scripts/load-futures.ts (TRUNCATE+INSERT, idempotent).
--
-- Naming: `scenarios` is unused. The narrative table is named
-- `scenario_stories` to avoid colliding with the existing `stories` table
-- (which holds news articles per the Stories collection).

CREATE TABLE IF NOT EXISTS scenarios (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,             -- URL-safe slug, e.g. 'centennial-flourishing'
  set_id TEXT NOT NULL,                  -- 'centennial-2027' | 'centennial-2027-upside' | 'centennial-2027-downside'
  name TEXT NOT NULL,                    -- 'Centennial Flourishing'
  version TEXT NOT NULL,                 -- '1.0', '2.0', etc.

  -- Set tail flavor — derived from set_id at load time for fast filtering.
  --   'central' = centennial-2027
  --   'upside' = centennial-2027-upside
  --   'downside' = centennial-2027-downside
  set_tail TEXT NOT NULL CHECK (set_tail IN ('central', 'upside', 'downside')),

  -- Strategic identity (spec §2.7).
  distinguishing_thesis TEXT,
  mattering_in_2040 TEXT,

  -- Structured campaign parameters (spec §4.1).
  campaign_target_m_dollars NUMERIC,
  campaign_range_min_m NUMERIC,
  campaign_range_max_m NUMERIC,
  bracket_position TEXT,                 -- impressionistic, e.g. 'at the campaign floor'
  continuity_pct INTEGER,
  innovation_pct INTEGER,
  frontier_portfolio JSONB DEFAULT '[]'::jsonb,  -- ['F.cont.1', 'F.cont.2', ...]

  -- Companion-set conditions (when present in YAML).
  upside_conditions TEXT,
  downside_conditions TEXT,

  -- Parsed prose sections from the .md (for structured rendering).
  -- The full markdown is preserved too so future-section additions don't
  -- require schema migrations.
  synopsis TEXT,
  setting TEXT,
  phase_1 TEXT,
  phase_2 TEXT,
  phase_3 TEXT,
  lines_of_inquiry TEXT,
  moments_of_choice TEXT,
  audience_lens_research TEXT,
  audience_lens_institution TEXT,
  audience_lens_donor TEXT,
  overlay_robustness TEXT,
  plausibility_caveats TEXT,
  coda TEXT,

  full_markdown TEXT NOT NULL,           -- the unparsed .md file (minus frontmatter line)

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scenarios_set_idx ON scenarios (set_id);
CREATE INDEX IF NOT EXISTS scenarios_tail_idx ON scenarios (set_tail);
CREATE INDEX IF NOT EXISTS scenarios_bracket_idx ON scenarios (bracket_position);


CREATE TABLE IF NOT EXISTS scenario_stories (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,             -- e.g. 'stewardship-2039-snowmelt-shock'
  scenario_slug TEXT NOT NULL REFERENCES scenarios(slug) ON DELETE CASCADE,
  set_id TEXT NOT NULL,
  set_tail TEXT NOT NULL CHECK (set_tail IN ('central', 'upside', 'downside')),

  -- Inputs from the story YAML (spec §11).
  mode TEXT NOT NULL CHECK (mode IN ('inhabitation', 'inflection-point', 'stress-overlay')),
  year INTEGER NOT NULL,
  stress_overlay TEXT,                   -- nullable: only present for stress-overlay mode
  inflection_point TEXT,                 -- nullable: only present for inflection-point mode
  pov TEXT NOT NULL,
  protagonist_type TEXT,                 -- 'guest_scientist' | 'rmbl_staff' | 'partner' (nullable for v0.12 stories)
  primary_character_role TEXT NOT NULL,
  scene_anchor TEXT NOT NULL,
  frontier_slug TEXT,                    -- nullable; links to frontiers.slug when set

  -- Output from the LLM (parsed from the .md file).
  title TEXT,                            -- extracted from the '# Title' line
  body TEXT,                             -- prose without the metadata header
  word_count INTEGER,                    -- recorded in the .md's header line

  word_count_target INTEGER,
  published BOOLEAN DEFAULT FALSE,

  full_markdown TEXT NOT NULL,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scenario_stories_scenario_idx ON scenario_stories (scenario_slug);
CREATE INDEX IF NOT EXISTS scenario_stories_set_idx ON scenario_stories (set_id);
CREATE INDEX IF NOT EXISTS scenario_stories_tail_idx ON scenario_stories (set_tail);
CREATE INDEX IF NOT EXISTS scenario_stories_frontier_idx ON scenario_stories (frontier_slug);
