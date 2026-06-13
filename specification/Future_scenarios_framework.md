# Future Scenarios Framework

*A specification for grounded, contingency-honest future-scenario artifacts in the RMBL Knowledge Commons. Initial application: the 2027–2029 Centennial Campaign, with extensibility to subsequent visioning cycles.*

**Status:** Working draft, v0.1
**Audience:** RMBL leadership and board (primary), prospective Centennial Campaign donors (secondary), basin scientists and staff (tertiary), Commons developers (implementing the artifact)
**Companion artifacts:** the Eras collection (decade-or-bucket + century-scale period primers), the Frontiers collection (current knowledge boundaries), the planning-pipeline themes (cross-lens strategic synthesis)

---

## 1. Purpose

Future Scenarios are artifacts that describe coherent, plausible states of basin science 15 years into the future, given specified contingencies. They serve three purposes:

1. **Organizational visioning** — to help RMBL leadership, staff, scientists, board, and donors envision specific futures the Centennial Campaign could produce, with the choices required to reach each one made explicit.
2. **Donor engagement** — to give prospective campaign donors concrete, grounded representations of what their contributions enable, in a register that honors donor agency (invitation, not promise).
3. **Strategic planning** — to surface inflection points, tradeoffs, and dependencies that organizational decisions in the campaign window (2026–2030) will shape, and to make those visible enough to act on.

Scenarios are **not** forecasts. A forecast predicts; a scenario describes a coherent state given assumed contingencies. The framework assumes plurality (3–5 scenarios, not one) and explicit contingency-naming as central features, not optional embellishments.

Scenarios are **not** campaign marketing. Each scenario must articulate what it does not fund, what it cannot guarantee, what could invalidate it, and what other scenarios exist as alternatives. Donor-facing materials may be derived from scenarios, but the scenarios themselves answer to the visioning purpose, not the fundraising one.

---

## 2. Core principles

The framework rests on six principles. Each is operationalized in the spec sections that follow.

### 2.1 Frontiers-first

Scenarios are organized around which research frontiers they advance, not around how the campaign spends money. Continuity and innovation are means; frontiers are ends. The continuity/innovation mix is a *derived* consequence of which frontiers are in the scenario's portfolio and what each requires, not a primary design axis.

A frontier in scope means: (a) one or more entries from the Commons Frontiers collection, or (b) a frontier articulated in the framework's candidate-frontier list (§5) that the Commons has not yet ingested. Every frontier in a scenario's portfolio must be either (a) or (b), not invented out of band.

### 2.2 Contingency-and-agency

Scenarios open with their contingencies stated, not buried. Every scenario must articulate:
- What it assumes about external context (federal funding, AI economy, climate trajectory)
- What it assumes about RMBL's own institutional choices
- What it assumes about the campaign's actual fundraising outcome

Agency is operationalized through the structured field `moments_of_choice`: named decision points within the primary horizon, each identified with the actors responsible and the alternatives available. Forbidden constructions: passive voice that hides agency ("the program was launched"); abstract trends without decision modeling ("AI tools became dominant"); inevitabilities ("by 2040, X had happened").

### 2.3 Grounded to present evidence

Every forward-looking claim must trace to a current Era entry, a current Frontier entry, a planning-pipeline theme, or a specific landmark paper. The Commons makes this auditable — scenario pages should render each future claim with a grounding link back to its present-day evidence. This is the framework's most distinctive feature relative to generic foresight documents.

### 2.4 Bracketed realism on campaign parameters

The Centennial Campaign's actual parameters are uncertain within bounded ranges. The framework specifies realistic brackets rather than corner cases:

- **Magnitude bracket:** $5M (floor) to $15M (target ceiling); realistic outcomes span the range
- **Continuity / innovation emphasis bracket:** 25%/75% to 75%/25%; pure-continuity (100/0) and pure-innovation (0/100) are not realistic and should not be modeled

Scenarios live at representative points within the bracket, not at corners.

### 2.5 Nested horizons

Each scenario operates on two horizons:
- **Primary horizon (2026–2040, 15 years):** high-resolution, with moments-of-choice resolved at named years, audience-lens claims operating on credible career and lifecycle scales, and the campaign's first compounding cycle visible.
- **Coda horizon (2040–2050, 10 additional years):** low-resolution, explicitly marked as more speculative; honors the centennial framing without overcommitting.

All moments-of-choice must fall within the primary horizon. Coda content is descriptive, not decision-modeling.

### 2.6 Plural and comparable

A single scenario is incomplete. The framework requires that scenarios be designed to be read side-by-side. Comparable structured fields (frontier portfolio, support strategies, deliverables, forgone, overlay robustness) are designed for tabular comparison. Donor-facing materials use comparison as the load-bearing rhetorical move ("here are the futures you could be part of"), not single-scenario advocacy.

---

## 3. Axes and parameter space

The framework distinguishes three classes of variables.

### 3.1 Primary (controllable) parameters

These are partly controlled by RMBL through campaign design and emphasis.

| Parameter | Realistic range | Notes |
|---|---|---|
| `campaign_magnitude` | $5M–$15M | Floor to target ceiling; both endpoints are plausible outcomes |
| `continuity_innovation_split` | 25/75 to 75/25 (continuity/innovation) | Bracketed; corners are strawmen |
| `frontier_portfolio` | 2–6 frontiers | Picked from the candidate list (§5) or current Commons Frontiers |

### 3.2 Derived parameters

These are computed from primary parameters; they should not be set independently.

| Parameter | Derivation |
|---|---|
| `campaign_deliverables` | What the budget at this magnitude and split funds, given the frontier portfolio |
| `forgone` | Frontiers not in the portfolio that the campaign could plausibly have addressed |
| `risk_profile` | Higher magnitude × more innovation → higher execution risk and upside |

### 3.3 Context overlays (external, critical uncertainties)

These are not RMBL-controllable. Each scenario gets stress-tested against each overlay.

| Overlay | Variants |
|---|---|
| `federal_funding_trajectory` | sustained / gradual contraction / sharp contraction |
| `ai_economy_and_tools` | gradual evolution / boom (private wealth concentrates, philanthropy redirects) / disruption (field-station economics fundamentally change) |
| `climate_trajectory` | RCP4.5-like / RCP6.0-like / RCP8.5-like through 2040 |

Cross-product of overlays is 27 combinations per scenario, which is too many to articulate. Practice: each scenario's `overlay_robustness` field describes how the scenario plays out under (a) the central case (gradual contraction × gradual AI evolution × RCP6.0), and (b) 2–3 stress cases selected for distinctiveness. Surfacing every cell is unnecessary; surfacing where the scenario breaks under stress is essential.

---

## 4. Scenario set design

A complete scenario set spans the realistic parameter range without filling every cell. Five representative scenarios are recommended for the Centennial Campaign:

| Scenario | Magnitude | Split (continuity/innovation) | Frontier portfolio character |
|---|---|---|---|
| **Floor — focused continuity** | ~$5–7M | ~70/30 | Tight portfolio: long-records frontier + one classical-strength frontier; minimal innovation |
| **Floor — focused bet** | ~$5–7M | ~30/70 | Tight portfolio: long-records frontier (residual) + one strategic-innovation frontier resourced well |
| **Mid-range balanced** | ~$8–11M | ~50/50 | Moderate portfolio: long-records + one classical-strength + one innovation frontier; balanced support |
| **Target — continuity-leaning** | ~$13–15M | ~65/35 | Broad portfolio: comprehensive continuity for classical strengths + one or two innovation frontiers at meaningful but sub-Foundation scale |
| **Target — innovation-leaning** | ~$13–15M | ~35/65 | Broad portfolio: continuity at meaningful but sub-comprehensive scale + 2–3 innovation frontiers with substantial endowed support |

These five span the realistic 2D space of (magnitude × emphasis) with redundancy at the high-magnitude end (where the most consequential differences emerge) and lighter coverage at the low-magnitude end (where space is smaller). A scenario set with fewer than 4 cases under-represents the space; more than 6 produces analytic noise.

Names are working labels. The actual scenarios should have names that travel — short, evocative, distinct in pitch register, and pairable for comparison ("Foundation" / "Centennial Frontier" / etc.).

### 4.1 Pure corners are not scenarios

A scenario at 100% continuity (no innovation investment whatsoever) or 100% innovation (no continuity protection whatsoever) does not occupy any meaningful point in the realistic decision space. Such scenarios should not be drafted. If a reader asks about a corner case, the answer is: "RMBL will fund some of both; the realistic question is the mix."

### 4.2 Floor scenarios are not failure scenarios

A $5–7M campaign outcome is a successful campaign within the bracket — not a campaign that fell short. Floor scenarios should describe what's possible at that magnitude with positive framing, not as compromised versions of higher-magnitude scenarios. Donors at the floor scale are giving meaningful gifts to a meaningful future.

---

## 5. Candidate research frontiers

The frontier portfolio is selected from current Commons Frontiers entries (98 frontiers as of v0.1 of this spec) and from the candidate list below, which articulates frontier categories that the Commons may or may not currently express as discrete Frontier rows but that the campaign could organize around.

The list is provisional and should be reviewed against the Commons Frontiers collection during scenario authoring. Where a frontier in the list has a corresponding Commons Frontier entry, use the entry's ID; where it does not, articulate it as a new candidate frontier and note that it is not yet ingested.

### Continuity-leaning frontiers (predominantly served by protecting existing programs and records)

- **F.cont.1 — Centennial-scale ecological observation as global infrastructure.** The basin's longest continuous datasets (marmot demographic record, meadow-warming experimental lineage, snowmelt-phenology series) as among the few long enough to distinguish climate-driven change from natural variability. Continuity-required: protect the records, train succession, archive accessibly.

- **F.cont.2 — Yellow-bellied marmot social ecology and climate vulnerability.** The marmot demographic record approaching its centennial. Continuity-required: observer succession, instrumentation continuity, archival access.

- **F.cont.3 — Subalpine plant demography under climate stress.** The long-running meadow demography and snowmelt-driven decline work (Campbell, 2019; Panetta et al., 2018). Continuity-required: protocol continuity, plot continuity, succession.

- **F.cont.4 — Plant-pollinator network resilience across decades.** The CaraDonna 2017 rewiring tradition and the long-running pollinator censuses. Continuity-required: census continuity, expanding to network-resilience questions.

### Innovation-leaning frontiers (predominantly served by launching new programs or capacities)

- **F.innov.1 — Atmosphere-to-bedrock mountain Earth-systems integration.** Extending the East River and SAIL work into a permanent integrative program coupling atmospheric measurement, snowpack dynamics, hydrology, biogeochemistry, microbiology, and ecological response. Innovation-required: endowed research program, instrumentation expansion, methodological development.

- **F.innov.2 — Mountain water security translation.** Connecting basin science to Mountain West water management, agricultural adaptation, Forest Service planning, and tribal natural-resources offices in a sustained institutional way. Innovation-required: endowed translation function with dedicated staff, partnership infrastructure, communication capacity.

- **F.innov.3 — AI-assisted retrospective synthesis of long basin records.** Using AI tools to extract findings from a century of accumulated basin records that prior generations could not analyze at the scale now possible. Innovation-required: AI capacity, archival digitization, methodological partnerships; depends on F.cont.1 for source material.

- **F.innov.4 — Community-science partnerships and stakeholder co-production.** Engaging local communities, tribal nations, water districts, and stakeholder organizations as active participants in basin research rather than recipients of findings. Innovation-required: community infrastructure, partnership staff, governance work.

### Frontiers that genuinely require both continuity and innovation

- **F.both.1 — Post-snowpack ecology of mountain ecosystems.** As snowpack thins and thresholds are crossed, classical basin systems change fundamentally. Requires continuity (baseline records to compare against) *and* innovation (new methods to study transformed systems).

- **F.both.2 — Phenology mismatch resolution at mechanistic scale.** The Anderson et al. 2012 mechanistic phenology work matured. Requires continuity (long records of phenology) and innovation (mechanistic methods, common-garden experiments, retrospective AI analysis).

- **F.both.3 — Cross-mountain comparative ecology.** The basin as part of broader mountain-system science with peer institutions. Requires continuity (basin's distinctive long-record contribution) and innovation (partnership infrastructure for hosting and collaboration).

### Notes on frontier selection during authoring

A realistic scenario portfolio is 2–6 frontiers. Smaller (1) makes the scenario thin; larger (>6) dilutes campaign focus and exceeds reasonable execution capacity at any magnitude. The mix of continuity-leaning, innovation-leaning, and "both" frontiers determines the scenario's continuity/innovation split — not the other way around.

---

## 6. Structured fields

Each scenario instance has the following fields. Required fields are marked **R**; optional are **O**.

| Field | R/O | Type | Notes |
|---|---|---|---|
| `name` | R | string | Working label; short, evocative, distinct in pitch |
| `slug` | R | string | URL-safe identifier |
| `version` | R | string | Semver-ish `MAJOR.MINOR` (e.g. `1.0`, `1.1`, `2.0`). See §9. |
| `superseded_by` | O | slug | Pointer to a newer scenario that replaces this one; null when current. See §9. |
| `set_id` | R | string | Identifier of the scenario set this scenario belongs to (e.g. `centennial-2027`). See §9. |
| `time_window` | R | object | `{ primary_start, primary_end, coda_end }` — defaults `{2026, 2040, 2050}` |
| `campaign_magnitude` | R | object | `{ target: $X, range: [floor, ceiling] }` |
| `continuity_innovation_split` | R | object | `{ continuity_pct: N, innovation_pct: M }` — must sum to 100; bracketed within 25–75 |
| `frontier_portfolio` | R | array | List of frontier IDs (Commons) or candidate IDs (this spec §5). Length 2–6. |
| `frontier_support_strategies` | R | array | Per-frontier: how the campaign's investments serve this frontier. **Free text by design** (not a controlled vocabulary) — strategies vary enough by frontier and by scenario that constraining the vocabulary would obscure rather than clarify. Optional informal tags (`endowment`, `capital`, `staff`, `partnership`, `archival`, `methodological`) may be attached for faceted filtering without restricting authored content. |
| `campaign_deliverables` | R | array | Concrete list derived from support strategies — what the campaign produces |
| `forgone` | R | string | Explicit articulation of what this scenario does not fund or pursue. Required for scenario honesty. |
| `seeds_in_present` | R | array | Pointers to current Era entries, landmark papers, planning themes that the scenario takes as foundational |
| `frontiers_resolved_in_horizon` | O | array | Which Commons Frontiers (or candidate frontiers) the scenario assumes get partially or fully resolved within the primary horizon |
| `frontiers_emerging` | O | array | New frontiers the scenario assumes emerge during the horizon that don't currently exist in the Commons |
| `phase_arc` | R | array | 3 phases across the primary horizon. Each phase has `{ years, name, summary, key_developments }` |
| `moments_of_choice` | R | array | 4–7 inflection points within primary horizon. Each has `{ year, actors, choice_description, alternatives, scenario_assumption, shared_inflection_id }`. See §6.3 on shared inflection points. |
| `audience_lens_research` | R | string | What scientists working on these frontiers get to do during the horizon |
| `audience_lens_institution` | R | string | What RMBL becomes through this frontier portfolio |
| `audience_lens_donor` | R | string | Invitation register: what donors are part of building. *Invitation, not promise.* Must read coherently to a public audience (see §8.1). |
| `overlay_robustness` | R | object | How the scenario plays out under (a) central case, and (b) 2–3 stress cases of `federal_funding_trajectory × ai_economy_and_tools × climate_trajectory` |
| `plausibility_caveats` | R | string | What the scenario assumes; what could invalidate it; what surprises are not modeled |
| `coda` | O | string | Lower-resolution 2040–2050 context; explicitly marked as speculative |
| `prose_primer` | O | string | LLM-assisted or human-authored narrative weaving the structured fields into a 1500–2500 word scenario portrait |

### 6.1 Required field rules

- `forgone` cannot be empty. A scenario that "funds everything" is not a scenario.
- `moments_of_choice` must have at least 4 entries, all within primary horizon. Each must name actors (roles, not individuals) and articulate alternatives, not just the scenario's choice.
- `plausibility_caveats` must explicitly name external assumptions and at least one structural blind spot. A scenario whose caveats section reads as airtight is dishonest.
- `audience_lens_donor` must be written in invitation register. Forbidden constructions: "your gift produces X" or "this scenario will deliver Y." Required register: "your contribution joins / is part of / enables the conditions for X." Because scenarios are public-facing (§8.1), this language must also read coherently to a general reader, not only to a prospective donor.
- `version` and `set_id` are required from the first authored scenario; the framework does not support unversioned scenarios. See §9.

### 6.3 Shared inflection points

Some moments of choice recur across multiple scenarios — the same decision faced by RMBL, resolved differently depending on which scenario obtains. Examples from the prior Foundation / Centennial Frontier drafts include the 2028 endowment-vs-capital split (faced in every scenario at every magnitude), the 2032 succession planning for the long-running programs' founding observers (faced in every continuity-touching scenario), and the 2040 next-horizon framing decision (faced as a boundary moment in every scenario).

These recurrences are themselves strategically informative — they describe choices the institution will face regardless of which scenario plays out — and the framework encodes them as first-class artifacts.

**Mechanism:** Each `moment_of_choice` entry has an optional `shared_inflection_id` field. When the same shared_inflection_id appears across multiple scenarios, those moments are clustered as a single Shared Inflection Point.

**Identification:** Shared inflection points are identified during scenario authoring, not predetermined. When an author drafts a scenario and recognizes a moment that appeared in another scenario, they assign a shared_inflection_id (a slug like `endowment-capital-split-2028` or `founding-observer-succession-2032`). The first scenario to use a given id defines it; subsequent scenarios that share the inflection reuse the id.

**Cross-scenario rendering:** Shared inflection points get their own index in the Commons (§8.4). Each shared inflection point page shows the choice across all scenarios that include it, side-by-side, with each scenario's resolution. This view becomes load-bearing for organizational visioning — readers can see "this is a decision RMBL will face; here is how each scenario resolves it."

**Cardinality:** A scenario typically has 4–7 moments of choice; of these, expect 2–4 to be shared and 2–4 to be scenario-distinctive. A scenario whose moments are all shared has no distinctive character; a scenario whose moments are all distinctive misses the strategically informative recurrences.

### 6.2 Forbidden patterns

The framework explicitly forbids the patterns we've found to undermine scenario quality:

- Opening with "in 2040 basin science had..." or any future-perfect framing
- Naming individual researchers, donors, board members, or political figures in prose (roles only — "RMBL leadership," "federal program officers," "Mountain West water managers")
- Naming individual reporters in any news-derived content
- Vague period-mood framing ("the AI era," "the post-Paris era") without a specific event year inside the horizon
- Characterizing the scenario as "busy," "humming," "expansion," or growth-language without specific quantitative backing
- Passive constructions that hide agency
- Claims about 2045+ in the primary horizon prose (move to coda)

---

## 7. Authoring model

The framework supports two authoring shapes; the second is recommended for the Centennial Campaign.

### 7.1 Fully LLM-generated (not recommended for Centennial)

LLM generates the scenario primer from a structured-fields template, given inputs of frontier portfolio, magnitude, and split. Cheap and fast but tends to smooth out exactly the agency-and-contingency features that matter, and to dilute the forgone tradeoffs.

### 7.2 LLM-assisted human authoring (recommended)

- Humans (RMBL leadership, supported by board input) draft the strategic substance:
  - Frontier portfolio selection
  - Contingency framing
  - Moments-of-choice identification
  - Forgone articulation
- The Commons machinery does the grounding work:
  - Resolves frontier IDs to current Commons entries
  - Pulls seed papers and Era references
  - Generates the planning-impact mapping
  - Drafts the prose primer
- Humans edit the prose primer and finalize the structured fields.

This shape preserves human strategic judgment where it matters and delegates pattern-completion where it doesn't. The contingency framing, the moments-of-choice, the choice of axes — these are not LLM-delegable. The prose generation, the grounding lookups, the comparison-table assembly — these are.

---

## 8. Presentation in the Commons

### 8.1 Public-facing scope and framing

Scenarios are **public artifacts** in the Commons, visible to general readers alongside Eras and Frontiers. This is a substantive choice with implications throughout the presentation:

- **The artifact's genre needs to be explained to readers who haven't encountered scenario planning before.** The `/futures` index page leads with a "What you're reading" framing block that explains: scenarios are not predictions, they describe plausible futures given specified contingencies, multiple coexisting scenarios is the point, and readers are invited to weigh them against their own judgments. Without this framing public readers will read scenarios as forecasts and either over-credit them or dismiss them.
- **Plausibility caveats are surfaced prominently, not collapsed.** A "What this scenario assumes / what could break it" panel sits near the top of each detail page, before the prose body. The anti-confidence stance is itself a UI feature.
- **Political references handled carefully.** Date-anchored events (e.g. "the 2015 Paris Agreement") are acceptable. Partisan framing or attribution to specific administrations is not. Funder names are not used; references to "federal program officers," "Mountain West water managers," "tribal natural-resources offices" stay at role level.
- **The donor-invitation register must read coherently to non-donors.** A general reader encountering `audience_lens_donor` should understand what donors are part of building without feeling pitched. This is more demanding than internal donor materials but produces text that travels better.
- **The forgone field is publicly legible.** A public reader can see what each scenario doesn't pursue and form their own view about the tradeoffs. Honesty about tradeoffs strengthens public trust; obscuring them undermines it.

### 8.2 A new collection at `/futures`

Future Scenarios live in their own collection, parallel to `/eras` and `/frontiers`. Each scenario has a detail page. The collection's index page shows the full scenario set with the comparison view as the default presentation, preceded by the genre-framing block described in §8.1.

### 8.3 Detail page layout

Per scenario, vertically stacked:

1. **Header**: name, slug, time window, version badge, distinctive visual treatment marking the artifact as speculative (e.g., distinct accent color, "scenario" badge)
2. **Plausibility caveats panel**: "What this scenario assumes / what could break it" — prominent placement near top, not buried at end (§8.1)
3. **Structured fields panel**: frontier portfolio, magnitude, split, campaign deliverables, forgone — facet-rendered for quick scan
4. **The arc**: phase descriptions across primary horizon
5. **Moments of choice**: structured list with actors, year, alternatives; shared inflection points marked with link to cross-scenario view (§8.5)
6. **Audience lenses**: three tabs or stacked sections (research / institution / donor)
7. **Overlay robustness**: sensitivity panel showing how the scenario evolves under stress cases
8. **Coda**: 2040–2050 section visually distinguished as more speculative
9. **Grounded-to-present panel**: links to every Era entry, Frontier entry, and landmark paper the scenario references
10. **Compare with**: links to other scenarios in the set

### 8.4 Cross-linking

The frontier-first reframe makes cross-linking the framework's distinctive UI feature.

- Each Future Scenario detail page lists its frontier portfolio with links back to current Commons Frontier entries
- Each current Frontier detail page shows "Scenarios that turn on this frontier"
- Each Era detail page (especially 2021–25) shows "Scenarios extending from here"
- The scenario set's index page offers a frontier-axis view: "show me all scenarios that advance F.innov.1" or "all scenarios in which F.cont.2 is in the portfolio"

### 8.5 Shared inflection points view

A new index at `/futures/inflections` (or `/futures/choices`) lists every shared inflection point identified across the scenario set. Each shared inflection point has its own detail page that surfaces the choice across all scenarios containing it, side-by-side, with each scenario's resolution.

For example, a `/futures/inflections/endowment-capital-split-2028` page would show: this choice appears in every scenario at every magnitude; here's how Foundation resolves it (70/30 endowment/capital), here's how Centennial Frontier resolves it (67/33 with capital directed to Centennial Hall), here's how the floor scenarios resolve it, etc.

This view is load-bearing for organizational visioning purposes. It makes visible the decisions RMBL will face regardless of which scenario obtains — the "no matter which path we end up on, this is what we'll need to decide" surface. From a board or leadership perspective these are often the most strategically informative cuts.

Each scenario detail page links its shared moments to the corresponding inflection point page; the inflection point page links back to every scenario that includes it. Distinctive moments (no shared_inflection_id) render normally without the cross-link.

### 8.6 Side-by-side comparison view

The collection's index page default presentation (after the genre-framing block). Up to four scenarios shown in a horizontal table aligned on structured-fields rows. Frontier portfolios shown as overlapping/distinct sets. The forgone field is comparison-rendered prominently — readers can see which frontiers are funded in which scenarios and which are forgone where.

### 8.7 Donor-facing materials

Derived from scenarios, not produced as scenarios. The donor-facing presentation may:
- Lift the `audience_lens_donor` field into invitation language
- Add gift-tier framings ("at the $X level, your contribution supports...")
- Tighten prose for the donor register
- Omit some plausibility caveats from primary materials while still linking to the full public scenario in the Commons

Donor materials answer to the campaign function. Public scenarios in the Commons answer to the visioning function. Both can be true; they should not be confused. Because the public scenarios are the source of truth, the donor-facing materials cannot make claims absent from or contradictory to the public scenario.

---

## 9. Versioning

The framework supports minimal versioning to allow iteration across visioning cycles without losing the ability to reference prior artifacts.

### 9.1 Per-scenario versioning

Each scenario has a `version` field in semver-ish form: `MAJOR.MINOR`. The semantics are minimal:

- **MAJOR** increments when the scenario's identity changes substantially — different frontier portfolio, fundamentally different campaign parameters, or substantial revision in response to learning about external context. `1.0 → 2.0`.
- **MINOR** increments for revisions that preserve identity — prose tightening, caveat additions, structured field corrections, moments-of-choice refinement that doesn't shift the scenario's character. `1.0 → 1.1`.

A scenario is **current** when its `superseded_by` field is null. When a scenario is replaced, the old scenario's `superseded_by` field points to the new scenario's slug, and the old scenario remains accessible (for traceability) but is no longer surfaced by default in collection views.

### 9.2 Scenario set versioning

A scenario set is the coherent collection of scenarios spanning a visioning cycle. Each scenario carries a `set_id` linking it to its set (e.g. `centennial-2027` for the initial Centennial Campaign visioning).

When a new visioning cycle begins — likely after the Centennial Campaign closes and its actual outcomes can inform a second-decade set — a new set is created with a new `set_id` (e.g. `centennial-2042` or `second-decade-2040`). Scenarios in the new set may reference scenarios in the prior set as historical context.

### 9.3 Supersession workflow

When a scenario is revised:

1. The reviser decides MAJOR vs MINOR based on the criteria in §9.1.
2. A new scenario record is created with the incremented version.
3. The previous version's `superseded_by` field is set to the new version's slug.
4. The new version inherits the previous version's `set_id` (revisions stay in the same set).
5. The Commons surfaces the new version by default; the previous version is reachable through "Earlier version" links.

This is intentionally light. The framework does not require change-history tracking, diff views, or formal review processes. The supersession pointer is enough to navigate the version history without overengineering.

### 9.4 When to revise vs replace

A scenario should be **revised** (MINOR or MAJOR bump within the same set) when:
- The campaign's actual unfolding contradicts an assumption the scenario made
- Authoring discovers a structural issue (a frontier was misclassified, an overlay was missed)
- The plausibility caveats require strengthening based on new evidence

A scenario should be **replaced by a wholly new set** (new `set_id`) when:
- A visioning cycle concludes and a new horizon opens
- The institutional context shifts fundamentally — a new campaign begins, a major mission revision occurs
- Enough time has passed that the scenario set's central contingencies are no longer the relevant near-term decisions

---

## 10. Open questions

To resolve through discussion before the framework reaches v1.0:

- **Q1.** Should the LLM-assisted authoring path include explicit human approval at each structured field, or just at the prose primer? Affects scaling — five scenarios authored individually vs five scenarios authored as a set with shared framing decisions.
- **Q2.** Should the spec articulate explicit "stop conditions" — circumstances under which a scenario should be revised or retired (e.g., the campaign's actual fundraising outcome lands outside the scenario's bracket)? Related to but distinct from the §9 supersession workflow, which describes how to revise but not when to.

---

## 11. Revision log

- **v0.2** (this revision): four open questions resolved per RMBL leadership input — scenarios are public-facing with explicit genre framing and prominent plausibility caveats (§8.1); shared inflection points encoded as first-class artifacts with cross-scenario rendering (§6.3, §8.5); `frontier_support_strategies` remains intentionally free-text with optional informal tagging; minimal versioning infrastructure added (§9) supporting iteration across visioning cycles via per-scenario `version` and `superseded_by` fields and per-set `set_id`. Two open questions remain (LLM authoring granularity, stop conditions).
- **v0.1** (initial draft): frontier-first reframe; bracketed magnitude and emphasis; nested 15+10 year horizons; preserved external overlays; structured fields schema with required/optional marking; candidate frontier list (12 entries); LLM-assisted human authoring as recommended; Commons presentation sketch including frontier-axis cross-linking and side-by-side comparison view.

---

## Appendix A — Relationship to prior framework drafts

Two scenario drafts (Foundation, Centennial Frontier) were developed before this spec was formalized. Those drafts exposed the issues this spec resolves:

- Foundation and Centennial Frontier were drafted at 25-year and then 15-year horizons; this spec adopts the 15-year primary horizon with 10-year coda.
- Both prior drafts treated continuity/innovation as a binary corner; this spec brackets the emphasis at 25–75 and treats corners as unrealistic.
- Both prior drafts foregrounded campaign-emphasis as the primary axis; this spec foregrounds frontier portfolio, with emphasis derived.
- Both prior drafts treated overlays as backgrounded; this spec preserves overlays as required `overlay_robustness` content.

The prior drafts are useful as worked examples that informed this spec. Under the framework as specified, both should be redrafted with frontier portfolios articulated explicitly, the bracketed split made concrete, and the overlay robustness analyzed.

## Appendix B — Mapping to existing Commons infrastructure

The Future Scenarios collection draws on:

- **Eras collection** — particularly the 2021–25 era primer (the most recent decade) and the 21st-century primer (the longer arc). The "Threads still active" section of the 21st-century primer is the natural feeder for the `seeds_in_present` field. The current 2021–25 era primer is what scenarios extend from.
- **Frontiers collection** — 98 frontiers from the planning pipeline. Frontier portfolio selection draws primarily from this collection; the candidate list in §5 is a supplement, not a replacement.
- **Planning-pipeline themes** — the 12 cross-lens themes synthesized by the planning pipeline are natural sources for the `audience_lens_donor` framings, particularly for societal-impact translation language.
- **Stakeholders collection** — relevant for the `audience_lens_donor` and `frontier_support_strategies` fields, particularly for the F.innov.2 (translation) and F.innov.4 (community partnerships) frontiers.
