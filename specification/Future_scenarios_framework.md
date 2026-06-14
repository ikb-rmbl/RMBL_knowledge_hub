# Future Scenarios Framework

*A specification for grounded, contingency-honest future-scenario artifacts in the RMBL Knowledge Commons. Initial application: the 2027–2029 Centennial Campaign, with extensibility to subsequent visioning cycles.*

**Status:** Working draft, v0.14
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

A frontier in scope means: (a) one or more entries from the Commons Frontiers collection, or (b) a frontier articulated in the framework's candidate-frontier list (§6) that the Commons has not yet ingested. Every frontier in a scenario's portfolio must be either (a) or (b), not invented out of band.

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

- **Magnitude bracket:** $3M (floor) to $8M (target ceiling); realistic outcomes span the range. (Earlier spec versions modeled a higher bracket; v0.3 revises downward based on current campaign-planning estimates — see §4 and the revision log.)
- **Continuity / innovation emphasis bracket:** 25%/75% to 75%/25%; pure-continuity (100/0) and pure-innovation (0/100) are not realistic and should not be modeled. The realistic innovation share scales somewhat with magnitude — see §5.3 for detail.

Scenarios live at representative points within the bracket, not at corners.

### 2.5 Nested horizons

Each scenario operates on two horizons:
- **Primary horizon (2026–2040, 15 years):** high-resolution, with moments-of-choice resolved at named years, audience-lens claims operating on credible career and lifecycle scales, and the campaign's first compounding cycle visible.
- **Coda horizon (2040–2050, 10 additional years):** low-resolution, explicitly marked as more speculative; honors the centennial framing without overcommitting.

All moments-of-choice must fall within the primary horizon. Coda content is descriptive, not decision-modeling.

### 2.6 Plural and comparable

A single scenario is incomplete. The framework requires that scenarios be designed to be read side-by-side. Comparable structured fields (frontier portfolio, support strategies, deliverables, forgone, overlay robustness) are designed for tabular comparison. Donor-facing materials use comparison as the load-bearing rhetorical move ("here are the futures you could be part of"), not single-scenario advocacy.

### 2.7 Strategic distinctness

Scenarios within a set must rest on **distinguishing theses** — central strategic claims that no other scenario in the set makes. Convergence on a shared playbook with different emphasis (same investment categories, same moments of choice, same audience-lens shape, just different mixes) is a framework failure mode that v0.7 explicitly rejects.

Two structured fields enforce distinctness operationally — both are per-scenario, both live in the set's YAML definitions, both are inputs to the generation prompt (not LLM outputs):

- **`distinguishing_thesis`** — 2–4 sentences naming the central strategic claim this scenario makes. The thesis is the organizing principle every prose section must trace back to. The synopsis articulates it. The phase arc enacts it. The audience lenses describe what living it feels like.

- **`mattering_in_2040`** — 2–4 sentence completion of *"In 2040, RMBL matters because..."* that is consistent with the distinguishing_thesis. This is the forward-looking statement of consequence — what the bet produces if the scenario plays out. It guides what the coda surfaces as the scenario's lasting contribution and what the audience lenses describe as the scenario's significance.

The two fields together commit each scenario to (a) a backward-looking claim about what RMBL is choosing to bet on, and (b) a forward-looking claim about what that bet makes possible.

The generation prompt operationally requires that each scenario:
- Has at least 1–2 `campaign_deliverables` entries that would not appear at the same magnitude in any other scenario in the set
- Has at least 2 `moments_of_choice` entries with `shared_inflection_id: null` (distinctive to this scenario rather than recurring across the set)
- Includes at least one failure mode in `plausibility_caveats` specific to *this* scenario's bet, not generic risk language

Without these enforcement points, scenarios converge on a shared playbook with different emphasis. With them, each scenario commits to a distinguishable strategic identity.

---

## 3. Institutional grounding

This section captures durable facts about RMBL's operating model and time-bound facts about the current moment. Both should inform scenario authoring; LLM prompts that generate or assist with scenarios should be fed §3.1 and §3.2 as preamble context so the generated material starts from where RMBL actually is, not from a generic field-station template.

The time-bound material in §3.2 should be reviewed and revised with each spec version.

### 3.1 Durable: RMBL's operating model

- **Organizational form.** RMBL is a nonprofit organization headquartered in Gothic, Colorado.
- **Research model.** The majority of basin research is driven by a community of guest scientists, most based at academic institutions elsewhere. RMBL does not generally run external-PI-led research portfolios (where the institution employs principal investigators who pursue their own independent research agendas). The crucial distinction is between (a) PI-led research portfolios, which RMBL does not typically operate, and (b) **in-house catalytic science capacity**, which RMBL does build and grow — technical staff, sensing and instrumentation development, cyberinfrastructure, data platforms, archival systems. Both categories are real; scenarios should be clear about which is meant. When a scenario describes "an endowed program in X" the default reading is catalytic infrastructure plus the in-house capacity that operates it, not external PIs pursuing independent research agendas.
- **The innovation-to-infrastructure flywheel.** Over recent years RMBL has cultivated a productive externally-funded innovation-to-infrastructure flywheel: external grants (NSF, DOE, foundations) fund the development of new in-house capacity — sensing and instrumentation capabilities, cyberinfrastructure, the Knowledge Commons itself — which catalyzes the broader guest-scientist community's work, which in turn supports the next round of external funding. This flywheel is the actual mechanism by which much of RMBL's catalytic capacity has been built. **Scenarios can and should include investments in in-house RMBL science capacity** — particularly the catalytic kinds that this flywheel has matured: data-science and geospatial capacity, sensing/instrumentation development, cyberinfrastructure platforms. The Centennial Campaign can directly fund these (capital + staffing) and can fund the institutional capacity to win and execute the external grants that feed the flywheel.
- **Staff.** RMBL operates with a relatively small staff. The technical core (approximately 4 people as of 2026) includes a geospatial data scientist, a GIS manager, and instrumentation-focused technicians. This is the staff that maintains the catalytic infrastructure on which guest-scientist research depends — and which the innovation-to-infrastructure flywheel has actively grown over recent years. Scenarios may legitimately include targeted growth of this in-house technical capacity (e.g., adding capacity in cyberinfrastructure, AI-assisted synthesis, instrumentation development) where it is catalytic for the broader research community. Scenarios that imply *external-PI-style* research-staff growth at scale (an endowed program of independent investigators with their own research agendas) should be checked against the operating model.
- **Investment philosophy.** Historically, RMBL focuses on catalytic investments that serve a broad scope of research — physical and data infrastructure, instrumentation, archival systems, facilities, **and in-house catalytic science capacity** — rather than promoting particular research projects pursued by external PIs. RMBL is responsive to guest scientists' needs rather than directive about what they should study. Campaign deliverables that fit this philosophy include both classical infrastructure ("facility," "instrumentation suite," "archive") and in-house capacity ("data-science position," "cyberinfrastructure platform," "instrumentation-development program"). Both are legitimately described as catalytic.
- **The RMBL365 facility.** In 2025 RMBL purchased a building in the adjacent community of Crested Butte that had been operated as a hostel and rebranded it RMBL365 — a year-round, in-town venue currently providing housing, workshop space, and community-engagement space. Unlike the seasonal Gothic site, RMBL365 enables year-round operations and a permanent RMBL presence in the surrounding community. Renovations could add laboratory space, staging space for guest scientists, or other functions as institutional priorities dictate. **Scenarios that describe year-round, community-facing, or in-town capabilities should reference RMBL365 as the existing platform for those functions rather than imagining new builds.** This is a real capital target the campaign could engage at renovation scales typical of nonprofit-scale projects.
- **Community priority.** RMBL is the oldest and one of the largest nonprofit organizations in its part of Colorado. Serving the community directly is an institutional priority that exists alongside (and sometimes shapes) its scientific mission. The RMBL365 acquisition is one recent institutional expression of this priority. Scenarios should treat community engagement as a real strategic dimension, not an optional add-on.
- **Campaign structure is the Development & Advancement team's prerogative.** The actual structure of a Capital Campaign — fund vehicles, named-gift opportunities, gift-tier framings, donor-recognition structures, the specific dollar allocations within deliverables, the split between endowment and capital — is tailored to RMBL's actual donor base and is the work of the Development & Advancement team. Strategic-planning scenarios inform that work but do not prescribe it. **Scenarios articulate strategic priorities and required capacities; the Development team translates those into campaign vehicles with planning-process guidance and donor-base intelligence the planning process cannot have.** Scenarios that name specific funds ("the Endowed X Fund"), pin per-deliverable dollar amounts ("$3.5M endowment, $175K/yr draw"), or specify endowment-vs-capital splits at the deliverable level encroach on Development-team territory and should be revised.
- **Identity.** The combination of these features — guest-scientist research model, small catalytic technical staff, broad responsive infrastructure investment, community-as-institutional-priority, and the boundary between strategic-planning scenarios and campaign-vehicle design — is RMBL's distinctive shape. Scenarios that imply RMBL becoming a directive research institution, a federal-style program-managing organization, or a generic field station miss what's actually being preserved or transformed.

### 3.2 Time-bound: the current moment (as of v0.11, 2026)

- **Federal funding disruption is the current baseline, not a hypothetical.** In the past year, federal funding disruptions have affected some RMBL-associated researchers directly. The contraction is no longer a contingency to model as a future possibility — it is the operating environment from which scenarios depart. The relevant overlay question is not "what if federal funding contracts?" but "how does the already-contracted state evolve from here — stabilize, intensify, partially recover?" Scenario authoring and the `overlay_robustness` field should reflect this.
- **Diversified funding base as institutional priority.** The disruption has driven RMBL-associated researchers (and RMBL itself) to seek broader funding bases — foundations, private donors, institutional partnerships — at greater urgency than in earlier years. The Centennial Campaign itself is partly motivated by this shift; scenario framing should acknowledge that the campaign exists in a fundraising environment where its scale is more strategically necessary than it would be under sustained federal investment.
- **Institutional independence as strategic asset.** Some partner institutions in the broader research landscape (NCAR is the canonical local example) face direct restrictions on inquiry under current political conditions — restrictions of a kind RMBL would never impose because of its nonprofit independent status. RMBL's independence is therefore a strategic asset in the current moment, not just an organizational feature. Scenarios may articulate this independence as part of the campaign's rationale — supporting the institutional and physical conditions under which independent inquiry can continue — but should do so without partisan framing.
- **Community salience.** The combination of federal contraction, institutional independence concerns, and rising community needs around climate and water makes RMBL's community-priority dimension more visible than in earlier periods. Scenarios that involve community engagement (e.g. via the F.innov.4 frontier in §6) operate in a moment where this work is more institutionally central than it would have been a decade earlier.

### 3.2a Factual anchors — long records

LLM generations have repeatedly conflated the *campaign's* centennial (RMBL was founded in 1928; the Centennial Campaign is named for the institution's 2028 anniversary) with the *records'* centennials. These are different. The campaign is RMBL's centennial vehicle; the long records are decades younger. Always check claims about year-of-record against the table below.

| Record | Started | Age by 2027 | Age by 2040 | Centennial |
|---|---|---|---|---|
| Yellow-bellied marmot demographic study (Barash → Armitage → Blumstein) | 1963 | 64 years | 77 years | 2063 |
| Meadow phenology series (Inouye and collaborators) | ~1974 | 53 years | 66 years | ~2074 |
| Snowmelt-driven plant work | various, ~1970s | ~50 years | ~63 years | ~2070s |
| RMBL itself | 1928 | 99 years | 112 years | 2028 |

Within any reasonable Centennial Campaign 2027 horizon (extending into the early 2040s), **the marmot study passes its 75-year mark in 2038**. Its centennial is 2063 — well beyond the horizon. The phenology series passes its half-century in the early 2020s and approaches 65 years by 2040. Scenarios and stories should reflect these actual milestones rather than borrowing the "centennial" framing from the campaign name.

### 3.3 Implications for scenario authoring and LLM prompts

LLM prompts that author or assist with scenarios should include §3.1 and §3.2 as system context (or equivalent), with explicit reminders that:

- "Endowed program" means catalytic infrastructure plus in-house catalytic science capacity (sensing, cyberinfrastructure, data-science staff, instrumentation, archival), **not** external-PI-led research portfolios. In-house RMBL science capacity is legitimate scenario content — the innovation-to-infrastructure flywheel is real precedent and this Knowledge Commons is one of its products.
- "Research staff" at RMBL refers primarily to the catalytic technical core (data scientists, GIS staff, instrumentation technicians) and to extensions of that core, not to a portfolio of externally-recruited PIs pursuing independent research agendas.
- "Translation function" or other dedicated staff functions are described in scales realistic to a small-staff nonprofit — typically a few FTE rather than an endowed program of many independent positions.
- "Federal contraction" is the baseline operating context, not a future risk to model.
- Community priorities are real strategic content, not boilerplate language.
- Institutional independence may be named as a campaign rationale, in non-partisan register.

Scenarios drafted without §3 grounding tend toward generic field-station templates — large research-program staffing of external PIs, hypothetical federal-contraction scenarios, light community treatment, abstract independence language, and absent recognition of in-house catalytic capacity as a real form of investment. Scenarios drafted with §3 grounding read as actually-RMBL.

---

## 4. Axes and parameter space

The framework distinguishes three classes of variables.

### 4.1 Primary (controllable) parameters

These are partly controlled by RMBL through campaign design and emphasis.

| Parameter | Realistic range | Notes |
|---|---|---|
| `campaign_magnitude` | $3M–$8M | Floor to target ceiling; both endpoints are plausible outcomes for a campaign at RMBL's scale. Earlier spec versions modeled a higher bracket ($5M–$15M); v0.3 revises downward based on current campaign-planning estimates. |
| `continuity_innovation_split` | 25/75 to 75/25 (continuity/innovation) | Bracketed; corners are strawmen. The realistic upper bound on innovation share scales somewhat with magnitude — at the $3M floor, pushing past ~30% innovation typically means under-protecting continuity to a degree that compromises the institution; at the $8M ceiling, the full 25–75 range is meaningfully available. |
| `frontier_portfolio` | 2–6 frontiers | Picked from the candidate list (§6) or current Commons Frontiers. The realistic upper bound on portfolio size also scales with magnitude — $3M typically supports 2–3 frontiers; $8M can support 4–6. |

### 4.2 Derived parameters

These are computed from primary parameters; they should not be set independently.

| Parameter | Derivation |
|---|---|
| `campaign_deliverables` | What the budget at this magnitude and split funds, given the frontier portfolio |
| `forgone` | Frontiers not in the portfolio that the campaign could plausibly have addressed |
| `risk_profile` | Higher magnitude × more innovation → higher execution risk and upside |

### 4.3 Context overlays (external, critical uncertainties)

These are not RMBL-controllable. Each scenario gets stress-tested against each overlay.

| Overlay | Variants |
|---|---|
| `federal_funding_trajectory` | sustained / gradual contraction / sharp contraction |
| `ai_economy_and_tools` | gradual evolution / boom (private wealth concentrates, philanthropy redirects) / disruption (field-station economics fundamentally change) |
| `climate_trajectory` | RCP4.5-like / RCP6.0-like / RCP8.5-like through 2040 |

Cross-product of overlays is 27 combinations per scenario, which is too many to articulate. Practice: each scenario's `overlay_robustness` field describes how the scenario plays out under (a) the central case (gradual contraction × gradual AI evolution × RCP6.0), and (b) 2–3 stress cases selected for distinctiveness. Surfacing every cell is unnecessary; surfacing where the scenario breaks under stress is essential.

---

## 5. Scenario set design

A complete scenario set spans the realistic parameter range without filling every cell. Four representative scenarios are recommended for the Centennial Campaign at the $3M–$8M bracket:

| Scenario | Magnitude | Split (continuity/innovation) | Frontier portfolio character |
|---|---|---|---|
| **Floor — minimum-viable continuity** | ~$3–4M | ~75/25 | Tight portfolio (2 frontiers): protects the most fragile core continuity + minimal innovation, typically in service of the same continuity programs. At this magnitude, broader continuity stays grant-dependent and significant new directions are not viable. |
| **Mid-range — focused balance** | ~$5–6M | ~55/45 | Moderate portfolio (3 frontiers): meaningful continuity for the classical strengths + one focused innovation direction. Forces a tight choice about which single new direction the campaign anchors. |
| **Target — continuity-leaning** | ~$7–8M | ~65/35 | Broad portfolio (4 frontiers): substantial continuity protection across the classical strengths + 1–2 innovation frontiers at meaningful but sub-comprehensive scale. The continuity-anchored target case. |
| **Target — innovation-leaning** | ~$7–8M | ~35/65 | Broad portfolio (4 frontiers): meaningful (but sub-comprehensive) continuity + 2–3 innovation frontiers with substantial catalytic-infrastructure support. The transformation-anchored target case. |

These four span the realistic 2D space of (magnitude × emphasis). The earlier $5M–$15M bracket from v0.1/v0.2 supported a five-scenario set with two distinct floor cases; the tighter $3M–$8M bracket of v0.3 fits four scenarios more cleanly because the absolute magnitude range is smaller. A scenario set with fewer than 3 cases under-represents the space; more than 5 produces analytic noise at this bracket.

Names are working labels. The actual scenarios should have names that travel — short, evocative, distinct in pitch register, and pairable for comparison (the prior drafts used "Foundation" and "Centennial Frontier"; under v0.3 those particular labels may need to scale down with the bracket).

### 5.1 Pure corners are not scenarios

A scenario at 100% continuity (no innovation investment whatsoever) or 100% innovation (no continuity protection whatsoever) does not occupy any meaningful point in the realistic decision space. Such scenarios should not be drafted. If a reader asks about a corner case, the answer is: "RMBL will fund some of both; the realistic question is the mix."

### 5.2 Floor scenarios are not failure scenarios

A $3–4M campaign outcome is a successful campaign within the bracket — not a campaign that fell short. Floor scenarios should describe what's possible at that magnitude with positive framing, not as compromised versions of higher-magnitude scenarios. At $3M with continuity emphasis, RMBL protects what's most fragile, sustains its catalytic-infrastructure capacity at a meaningful baseline, and reaches its second century with its core intact. That is a meaningful campaign outcome and a meaningful gift for donors at this scale.

### 5.3 Magnitude–innovation interaction

The realistic innovation share scales with magnitude. At $3M, pushing innovation above ~30% typically means under-protecting continuity to a degree that compromises institutional core operations — RMBL's catalytic-infrastructure capacity for the broader research community depends on a continuity baseline that cannot be sacrificed. At $8M, the full 25–75 emphasis range is available because the absolute dollars are sufficient to maintain core capacity even under heavy innovation tilting. Authoring should respect this interaction: a "$3M, 65% innovation" scenario should not be drafted because it does not describe a realistic decision space.

---

## 6. Candidate research frontiers

The frontier portfolio is selected from current Commons Frontiers entries (98 frontiers as of v0.1 of this spec) and from the candidate list below, which articulates frontier categories that the Commons may or may not currently express as discrete Frontier rows but that the campaign could organize around.

The list is provisional and should be reviewed against the Commons Frontiers collection during scenario authoring. Where a frontier in the list has a corresponding Commons Frontier entry, use the entry's ID; where it does not, articulate it as a new candidate frontier and note that it is not yet ingested.

### How to interpret these frontiers under RMBL's operating model

Every frontier below should be read through the §3.1 operating-model lens: RMBL supports each by investing in **catalytic capacity** — a category that includes both classical infrastructure (physical facilities, data systems, instrumentation, archival capacity, partnership coordination) and in-house catalytic science capacity (technical staff, sensing/instrumentation development, cyberinfrastructure platforms). The innovation-to-infrastructure flywheel (§3.1) has matured the in-house dimension over recent years — this Knowledge Commons is one of its products. Where an entry below describes "an endowed program," read this as "the catalytic infrastructure and in-house capacity that enable a community of guest scientists to advance the frontier" — which may include hiring in-house staff in catalytic technical roles — rather than "an endowed portfolio of external PIs pursuing independent research." This translation matters for scenario authoring and is enforced in the `frontier_support_strategies` field.

### Continuity-leaning frontiers (predominantly served by protecting existing infrastructure, records, and capacity)

- **F.cont.1 — Centennial-scale ecological observation as global infrastructure.** The basin's longest continuous datasets (marmot demographic record, meadow-warming experimental lineage, snowmelt-phenology series) as among the few long enough to distinguish climate-driven change from natural variability. Catalytic support: protocol stewardship, archival systems, observer-succession capacity (often realized through guest-scientist partnerships rather than RMBL-employed observers), data infrastructure.

- **F.cont.2 — Yellow-bellied marmot social ecology and climate vulnerability.** The marmot demographic record now in its eighth decade (started 1963 — Barash → Armitage → Blumstein), passing its seventy-fifth year in 2038, with its centennial in 2063 well beyond any campaign horizon. Catalytic support: instrumentation continuity, archival access, infrastructure that supports the guest scientists who carry the record.

- **F.cont.3 — Subalpine plant demography under climate stress.** The long-running meadow demography and snowmelt-driven decline work (Campbell, 2019; Panetta et al., 2018). Catalytic support: protocol stewardship, plot infrastructure, data systems.

- **F.cont.4 — Plant-pollinator network resilience across decades.** The CaraDonna 2017 rewiring tradition and the long-running pollinator censuses. Catalytic support: census continuity infrastructure, network data systems.

### Innovation-leaning frontiers (predominantly served by launching new catalytic capacity)

- **F.innov.1 — Atmosphere-to-bedrock mountain Earth-systems integration.** Extending the East River and SAIL work into permanent integrative capacity coupling atmospheric measurement, snowpack dynamics, hydrology, biogeochemistry, microbiology, and ecological response. Catalytic support: permanent instrumentation infrastructure, integrated data systems supported by RMBL's geospatial/GIS technical staff, facilities that host the guest-scientist collaborations doing the integration work.

- **F.innov.2 — Mountain water security translation.** Connecting basin science to Mountain West water management, agricultural adaptation, Forest Service planning, and tribal natural-resources offices in a sustained way. Catalytic support: partnership-coordination capacity, communication infrastructure, community-engagement spaces, modest dedicated staff capacity (at scales appropriate to a small nonprofit, not endowed-program scale). Distinguishes RMBL as an independent translator of science to community — connecting to F.innov.5 below.

- **F.innov.3 — AI-assisted retrospective synthesis of long basin records.** Using AI tools to extract findings from a century of accumulated basin records that prior generations could not analyze at the scale now possible. Catalytic support: archival digitization, growth of in-house data-science and geospatial capacity (building on RMBL's existing technical staff and on the innovation-to-infrastructure flywheel that produced the Knowledge Commons), tool development, methodological partnerships with guest scientists doing the analysis. This is a frontier where in-house RMBL capacity is genuinely load-bearing — the synthesis depends on data systems and AI capacity that the institution builds and operates, not only on external researchers using them. Depends on F.cont.1 for source material.

- **F.innov.4 — Community-science partnerships and stakeholder co-production.** Engaging local communities, tribal nations, water districts, and stakeholder organizations as active participants in basin research rather than recipients of findings. Catalytic support: community infrastructure, partnership-coordination capacity, governance work. Aligns directly with RMBL's institutional-priority commitment to community service (§3.1).

- **F.innov.5 — Institutional independence as platform for inquiry.** A frontier that the current moment (§3.2) has made newly visible: sustaining the institutional, physical, and economic conditions under which independent inquiry — free from the kinds of restrictions on research direction facing some federal-adjacent institutions — can continue. Catalytic support: diversified-funding-base capacity, governance and operating reserves that protect independence, infrastructure that makes RMBL attractive to guest scientists seeking unrestricted inquiry venues. This is as much a governance/institutional frontier as a research frontier, but it is a real one with which campaign investments can engage. Pairs naturally with F.innov.4 (community partnerships) and F.both.3 (cross-mountain collaboration).

### Frontiers that genuinely require both continuity and innovation

- **F.both.1 — Post-snowpack ecology of mountain ecosystems.** As snowpack thins and thresholds are crossed, classical basin systems change fundamentally. Requires continuity (baseline records to compare against) *and* innovation (new infrastructure to study transformed systems).

- **F.both.2 — Phenology mismatch resolution at mechanistic scale.** The Anderson et al. 2012 mechanistic phenology work matured. Requires continuity (long records of phenology) and innovation (infrastructure for common-garden experiments, retrospective AI analysis, mechanistic-method partnerships).

- **F.both.3 — Cross-mountain comparative ecology.** The basin as part of broader mountain-system science with peer institutions. Requires continuity (basin's distinctive long-record contribution) and innovation (partnership infrastructure for hosting and collaboration on basin grounds).

### Notes on frontier selection during authoring

A realistic scenario portfolio is 2–6 frontiers. Smaller (1) makes the scenario thin; larger (>6) dilutes campaign focus and exceeds reasonable execution capacity at any magnitude. The mix of continuity-leaning, innovation-leaning, and "both" frontiers determines the scenario's continuity/innovation split — not the other way around.

Under the v0.3 magnitude bracket, realistic portfolio size scales with magnitude: ~$3M typically supports 2 frontiers; ~$5M supports 3; ~$7–8M supports 4–5. Six frontiers at the $8M ceiling is at the upper edge of feasibility and only realistic if frontier portfolios overlap meaningfully (e.g. F.cont.1 + F.innov.3 share archival/data infrastructure).

---

## 7. Structured fields

Each scenario instance has the following fields. Required fields are marked **R**; optional are **O**.

| Field | R/O | Type | Notes |
|---|---|---|---|
| `name` | R | string | Working label; short, evocative, distinct in pitch |
| `slug` | R | string | URL-safe identifier |
| `version` | R | string | Semver-ish `MAJOR.MINOR` (e.g. `1.0`, `1.1`, `2.0`). See §10. |
| `superseded_by` | O | slug | Pointer to a newer scenario that replaces this one; null when current. See §10. |
| `set_id` | R | string | Identifier of the scenario set this scenario belongs to (e.g. `centennial-2027`). See §10. |
| `distinguishing_thesis` | R | string | 2–4 sentences naming the central strategic claim this scenario makes — the bet no other scenario in the set makes. Input to the generation prompt (set in the set's YAML definitions, not produced by the LLM). The thesis anchors every prose section. See §2.7. |
| `mattering_in_2040` | R | string | 2–4 sentence completion of "In 2040, RMBL matters because..." consistent with `distinguishing_thesis`. Forward-looking statement of consequence. Input to the generation prompt. See §2.7. |
| `synopsis` | R | string | A paragraph-length (~130–170 word) summary of the scenario's strategic essence — its central contingency, the priorities it advances, what it forgoes, and what it asks of donors and the institution. Designed to convey the scenario's distinctive shape on its own, without requiring readers to engage the full prose body. Used at the top of the detail page (§9.3), in the side-by-side comparison view (§9.6), and as the basis for donor-facing materials (§9.7). |
| `time_window` | R | object | `{ primary_start, primary_end, coda_end }` — defaults `{2026, 2040, 2050}` |
| `campaign_magnitude` | R | object | `{ target: $X, range: [floor, ceiling] }` at scenario-level only. Used for cross-scenario comparison and bracket positioning. **The prose body should describe magnitude impressionistically** ("near the upper end of the realistic bracket," "at the campaign floor") rather than pinning to a specific number, because per-scenario campaign-close magnitudes are subject to fundraising dynamics the Development team manages, not planning-process determinations. |
| `continuity_innovation_split` | R | object | `{ continuity_pct: N, innovation_pct: M }` — must sum to 100; bracketed within 25–75 |
| `frontier_portfolio` | R | array | List of frontier IDs (Commons) or candidate IDs (this spec §6). Length 2–6. |
| `frontier_support_strategies` | R | array | Per-frontier: how the campaign's investments serve this frontier. **Free text by design** (not a controlled vocabulary) — strategies vary enough by frontier and by scenario that constraining the vocabulary would obscure rather than clarify. Optional informal tags (`endowment`, `capital`, `staff`, `partnership`, `archival`, `methodological`) may be attached for faceted filtering without restricting authored content. |
| `campaign_deliverables` | R | array | Concrete **strategic priorities and required capacities** the campaign supports, derived from `frontier_support_strategies`. **Not** a fund structure, a per-deliverable dollar allocation, an endowment-vs-capital split, or a draw-rate calculation — those translations are the Development & Advancement team's prerogative (§3.1). Deliverables are described as priorities (e.g., "primary priority: endowed support for centennial records continuity at substantial scale") rather than as campaign vehicles ("Endowed Records Fund of $3.5M with $175K annual draw"). Impressionistic sizing — "primary share," "secondary share," "supporting investment," "modest," "substantial" — is used to convey relative weighting within the scenario's magnitude bracket; specific dollar allocations are deliberately omitted. |
| `forgone` | R | string | Explicit articulation of what this scenario does not fund or pursue. Required for scenario honesty. |
| `seeds_in_present` | R | array | Pointers to current Era entries, landmark papers, planning themes that the scenario takes as foundational |
| `frontiers_resolved_in_horizon` | O | array | Which Commons Frontiers (or candidate frontiers) the scenario assumes get partially or fully resolved within the primary horizon |
| `frontiers_emerging` | O | array | New frontiers the scenario assumes emerge during the horizon that don't currently exist in the Commons |
| `phase_arc` | R | array | 3 phases across the primary horizon. Each phase has `{ years, name, summary, key_developments }` |
| `moments_of_choice` | R | array | 4–7 inflection points within primary horizon. Each has `{ year, actors, choice_description, alternatives, scenario_assumption, shared_inflection_id }`. See §7.3 on shared inflection points. |
| `audience_lens_research` | R | string | What scientists working on these frontiers get to do during the horizon |
| `audience_lens_institution` | R | string | What RMBL becomes through this frontier portfolio |
| `audience_lens_donor` | R | string | Invitation register: what donors are part of building. *Invitation, not promise.* Must read coherently to a public audience (see §9.1). |
| `overlay_robustness` | R | object | How the scenario plays out under (a) central case, and (b) 2–3 stress cases of `federal_funding_trajectory × ai_economy_and_tools × climate_trajectory` |
| `plausibility_caveats` | R | string | What the scenario assumes; what could invalidate it; what surprises are not modeled |
| `coda` | O | string | Lower-resolution 2040–2050 context; explicitly marked as speculative |
| `prose_primer` | O | string | LLM-assisted or human-authored narrative weaving the structured fields into a 1500–2500 word scenario portrait |

### 7.1 Required field rules

- `forgone` cannot be empty. A scenario that "funds everything" is not a scenario.
- `moments_of_choice` must have at least 4 entries, all within primary horizon. Each must name actors (roles, not individuals) and articulate alternatives, not just the scenario's choice.
- `plausibility_caveats` must explicitly name external assumptions and at least one structural blind spot. A scenario whose caveats section reads as airtight is dishonest.
- `audience_lens_donor` must be written in invitation register. Forbidden constructions: "your gift produces X" or "this scenario will deliver Y." Required register: "your contribution joins / is part of / enables the conditions for X." Because scenarios are public-facing (§9.1), this language must also read coherently to a general reader, not only to a prospective donor.
- `version` and `set_id` are required from the first authored scenario; the framework does not support unversioned scenarios. See §10.
- `campaign_deliverables` describes strategic priorities and required capacities, not campaign vehicles. Impressionistic sizing ("primary share," "supporting investment," "modest," "substantial") is used to convey relative weighting within the magnitude bracket; specific fund names, dollar allocations, draw rates, and endowment-vs-capital splits at the deliverable level are omitted (see §3.1 — campaign structure is the Development & Advancement team's prerogative).
- Magnitude framing in the prose body is impressionistic ("near the upper end of the realistic bracket," "at the campaign floor") rather than dollar-precise; the `campaign_magnitude` structured field carries scenario-level positioning for cross-scenario comparison, but per-scenario campaign-close magnitudes are subject to fundraising dynamics the Development team manages.
- `synopsis` must be ~130–170 words and must convey the scenario's strategic essence — central contingency, the priorities it advances, what it forgoes, and what it asks of donors and the institution. It must read coherently as a standalone artifact (a reader who never engages the full prose body should still understand what the scenario is and isn't). Written in the public-facing register (§9.1). Required from v0.6 onward.
- `distinguishing_thesis` and `mattering_in_2040` are required from v0.7 onward. Both are inputs to the generation prompt (set in the YAML definitions, not LLM outputs). Each scenario's thesis must be distinguishable from every other scenario's thesis in the set. The synopsis must articulate the thesis in plain language. The coda and audience lenses must describe the mattering_in_2040 as the scenario's consequence. See §2.7.

### 7.2 Forbidden patterns

The framework explicitly forbids the patterns we've found to undermine scenario quality:

- Opening with "in 2040 basin science had..." or any future-perfect framing
- Naming individual researchers, donors, board members, or political figures in prose (roles only — "RMBL leadership," "federal program officers," "Mountain West water managers")
- Naming individual reporters in any news-derived content
- Vague period-mood framing ("the AI era," "the post-Paris era") without a specific event year inside the horizon
- Characterizing the scenario as "busy," "humming," "expansion," or growth-language without specific quantitative backing
- Passive constructions that hide agency
- Claims about 2045+ in the primary horizon prose (move to coda)
- Inventing named campaign fund vehicles ("the Endowed X Fund," "the Y Operating Reserves") and pinning per-deliverable dollar amounts, draw rates, or endowment-vs-capital splits — these are the Development & Advancement team's prerogative, not planning-process determinations (see §3.1)
- Dollar-precise campaign-close magnitudes in the prose body ("the campaign closes at approximately $7.5M") — use impressionistic framing tied to the bracket position instead ("the campaign closes near the upper end of the realistic bracket")

---

### 7.3 Shared inflection points

Some moments of choice recur across multiple scenarios — the same decision faced by RMBL, resolved differently depending on which scenario obtains. Examples from the prior Foundation / Centennial Frontier drafts include the 2028 endowment-vs-capital split (faced in every scenario at every magnitude), the 2032 succession planning for the long-running programs' founding observers (faced in every continuity-touching scenario), and the 2040 next-horizon framing decision (faced as a boundary moment in every scenario).

These recurrences are themselves strategically informative — they describe choices the institution will face regardless of which scenario plays out — and the framework encodes them as first-class artifacts.

**Mechanism:** Each `moment_of_choice` entry has an optional `shared_inflection_id` field. When the same shared_inflection_id appears across multiple scenarios, those moments are clustered as a single Shared Inflection Point.

**Identification:** Shared inflection points are identified during scenario authoring, not predetermined. When an author drafts a scenario and recognizes a moment that appeared in another scenario, they assign a shared_inflection_id (a slug like `endowment-capital-split-2028` or `founding-observer-succession-2032`). The first scenario to use a given id defines it; subsequent scenarios that share the inflection reuse the id.

**Cross-scenario rendering:** Shared inflection points get their own index in the Commons (§9.5). Each shared inflection point page shows the choice across all scenarios that include it, side-by-side, with each scenario's resolution. This view becomes load-bearing for organizational visioning — readers can see "this is a decision RMBL will face; here is how each scenario resolves it."

**Cardinality:** A scenario typically has 4–7 moments of choice; of these, expect 2–4 to be shared and 2–4 to be scenario-distinctive. A scenario whose moments are all shared has no distinctive character; a scenario whose moments are all distinctive misses the strategically informative recurrences.

## 8. Authoring model

The framework supports two authoring shapes; the second is recommended for the Centennial Campaign.

### 8.1 Fully LLM-generated (not recommended for Centennial)

LLM generates the scenario primer from a structured-fields template, given inputs of frontier portfolio, magnitude, and split. Cheap and fast but tends to smooth out exactly the agency-and-contingency features that matter, and to dilute the forgone tradeoffs.

### 8.2 LLM-assisted human authoring (recommended)

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

## 9. Presentation in the Commons

### 9.1 Public-facing scope and framing

Scenarios are **public artifacts** in the Commons, visible to general readers alongside Eras and Frontiers. This is a substantive choice with implications throughout the presentation:

- **The artifact's genre needs to be explained to readers who haven't encountered scenario planning before.** The `/futures` index page leads with a "What you're reading" framing block that explains: scenarios are not predictions, they describe plausible futures given specified contingencies, multiple coexisting scenarios is the point, and readers are invited to weigh them against their own judgments. Without this framing public readers will read scenarios as forecasts and either over-credit them or dismiss them.
- **Plausibility caveats are surfaced prominently, not collapsed.** A "What this scenario assumes / what could break it" panel sits near the top of each detail page, before the prose body. The anti-confidence stance is itself a UI feature.
- **Political references handled carefully.** Date-anchored events (e.g. "the 2015 Paris Agreement") are acceptable. Partisan framing or attribution to specific administrations is not. Funder names are not used; references to "federal program officers," "Mountain West water managers," "tribal natural-resources offices" stay at role level.
- **The donor-invitation register must read coherently to non-donors.** A general reader encountering `audience_lens_donor` should understand what donors are part of building without feeling pitched. This is more demanding than internal donor materials but produces text that travels better.
- **The forgone field is publicly legible.** A public reader can see what each scenario doesn't pursue and form their own view about the tradeoffs. Honesty about tradeoffs strengthens public trust; obscuring them undermines it.

### 9.2 A new collection at `/futures`

Future Scenarios live in their own collection, parallel to `/eras` and `/frontiers`. Each scenario has a detail page. The collection's index page shows the full scenario set with the comparison view as the default presentation, preceded by the genre-framing block described in §9.1.

### 9.3 Detail page layout

Per scenario, vertically stacked:

1. **Header**: name, slug, time window, version badge, distinctive visual treatment marking the artifact as speculative (e.g., distinct accent color, "scenario" badge)
2. **Synopsis**: paragraph-length summary of strategic essence (central contingency, priorities, what's forgone, what's asked) — sits immediately under the header so readers who want the scenario at a glance can stop here without reading the 4,000-word prose body
3. **Plausibility caveats panel**: "What this scenario assumes / what could break it" — prominent placement near top, not buried at end (§9.1)
4. **Structured fields panel**: frontier portfolio, magnitude, split, campaign deliverables, forgone — facet-rendered for quick scan
5. **The arc**: phase descriptions across primary horizon
6. **Moments of choice**: structured list with actors, year, alternatives; shared inflection points marked with link to cross-scenario view (§9.5)
7. **Audience lenses**: three tabs or stacked sections (research / institution / donor)
8. **Overlay robustness**: sensitivity panel showing how the scenario evolves under stress cases
9. **Coda**: 2040–2050 section visually distinguished as more speculative
10. **Grounded-to-present panel**: links to every Era entry, Frontier entry, and landmark paper the scenario references
11. **Compare with**: links to other scenarios in the set

### 9.4 Cross-linking

The frontier-first reframe makes cross-linking the framework's distinctive UI feature.

- Each Future Scenario detail page lists its frontier portfolio with links back to current Commons Frontier entries
- Each current Frontier detail page shows "Scenarios that turn on this frontier"
- Each Era detail page (especially 2021–25) shows "Scenarios extending from here"
- The scenario set's index page offers a frontier-axis view: "show me all scenarios that advance F.innov.1" or "all scenarios in which F.cont.2 is in the portfolio"

### 9.5 Shared inflection points view

A new index at `/futures/inflections` (or `/futures/choices`) lists every shared inflection point identified across the scenario set. Each shared inflection point has its own detail page that surfaces the choice across all scenarios containing it, side-by-side, with each scenario's resolution.

For example, a `/futures/inflections/endowment-capital-split-2028` page would show: this choice appears in every scenario at every magnitude; here's how Centennial Stewardship resolves it (65/35 endowment/capital, capital mostly to selective Gothic refurbishment and archival digitization); here's how Centennial Capacity resolves it (65/35 with capital split across the RMBL365 renovation, selective Gothic refurbishment, and sensing/instrumentation development); here's how each floor scenario resolves it, etc.

This view is load-bearing for organizational visioning purposes. It makes visible the decisions RMBL will face regardless of which scenario obtains — the "no matter which path we end up on, this is what we'll need to decide" surface. From a board or leadership perspective these are often the most strategically informative cuts.

Each scenario detail page links its shared moments to the corresponding inflection point page; the inflection point page links back to every scenario that includes it. Distinctive moments (no shared_inflection_id) render normally without the cross-link.

### 9.6 Side-by-side comparison view

The collection's index page default presentation (after the genre-framing block). Up to four scenarios shown in a horizontal table aligned on structured-fields rows. The **`synopsis` field** is the natural row content for the "what is this scenario about" entry — a paragraph per scenario in a comparison column lets readers grasp the full set at a glance without committing to the full prose body. Frontier portfolios shown as overlapping/distinct sets below the synopses. The `forgone` field is comparison-rendered prominently — readers can see which frontiers are funded in which scenarios and which are forgone where.

### 9.7 Donor-facing materials

Derived from scenarios, not produced as scenarios. **Translating strategic-planning scenarios into donor-facing campaign materials is the Development & Advancement team's prerogative** (§3.1) — fund vehicle structures, naming opportunities, gift-tier framings, donor-recognition structures, specific dollar allocations within deliverables, and the split between endowment and capital are all decisions the campaign team makes with donor-base intelligence the planning process cannot have. Scenarios inform that work; they do not prescribe it.

The donor-facing presentation may:
- Lift the `audience_lens_donor` field into invitation language
- Structure the strategic priorities described in `campaign_deliverables` into named campaign vehicles with specific dollar targets and gift-tier framings
- Tighten prose for the donor register
- Omit some plausibility caveats from primary materials while still linking to the full public scenario in the Commons

Donor materials answer to the campaign function. Public scenarios in the Commons answer to the visioning function. Both can be true; they should not be confused. Because the public scenarios are the source of truth for strategic priorities, the donor-facing materials cannot make strategic claims absent from or contradictory to the public scenario — but they can (and should) translate those priorities into the named campaign vehicles, dollar allocations, and gift framings that scenarios deliberately leave to Development.

---

## 10. Versioning

The framework supports minimal versioning to allow iteration across visioning cycles without losing the ability to reference prior artifacts.

### 10.1 Per-scenario versioning

Each scenario has a `version` field in semver-ish form: `MAJOR.MINOR`. The semantics are minimal:

- **MAJOR** increments when the scenario's identity changes substantially — different frontier portfolio, fundamentally different campaign parameters, or substantial revision in response to learning about external context. `1.0 → 2.0`.
- **MINOR** increments for revisions that preserve identity — prose tightening, caveat additions, structured field corrections, moments-of-choice refinement that doesn't shift the scenario's character. `1.0 → 1.1`.

A scenario is **current** when its `superseded_by` field is null. When a scenario is replaced, the old scenario's `superseded_by` field points to the new scenario's slug, and the old scenario remains accessible (for traceability) but is no longer surfaced by default in collection views.

### 10.2 Scenario set versioning

A scenario set is the coherent collection of scenarios spanning a visioning cycle. Each scenario carries a `set_id` linking it to its set (e.g. `centennial-2027` for the initial Centennial Campaign visioning).

When a new visioning cycle begins — likely after the Centennial Campaign closes and its actual outcomes can inform a second-decade set — a new set is created with a new `set_id` (e.g. `centennial-2042` or `second-decade-2040`). Scenarios in the new set may reference scenarios in the prior set as historical context.

### 10.3 Supersession workflow

When a scenario is revised:

1. The reviser decides MAJOR vs MINOR based on the criteria in §10.1.
2. A new scenario record is created with the incremented version.
3. The previous version's `superseded_by` field is set to the new version's slug.
4. The new version inherits the previous version's `set_id` (revisions stay in the same set).
5. The Commons surfaces the new version by default; the previous version is reachable through "Earlier version" links.

This is intentionally light. The framework does not require change-history tracking, diff views, or formal review processes. The supersession pointer is enough to navigate the version history without overengineering.

### 10.4 When to revise vs replace

A scenario should be **revised** (MINOR or MAJOR bump within the same set) when:
- The campaign's actual unfolding contradicts an assumption the scenario made
- Authoring discovers a structural issue (a frontier was misclassified, an overlay was missed)
- The plausibility caveats require strengthening based on new evidence

A scenario should be **replaced by a wholly new set** (new `set_id`) when:
- A visioning cycle concludes and a new horizon opens
- The institutional context shifts fundamentally — a new campaign begins, a major mission revision occurs
- Enough time has passed that the scenario set's central contingencies are no longer the relevant near-term decisions

---

## 11. Stories — narrative companions to scenarios

Stories are short literary fiction (target 1,200–1,800 words) grounded in specific scenarios, designed to help readers inhabit the futures the scenarios describe. They are companion artifacts, not replacements for scenarios — the scenarios remain the strategic-planning ground truth; stories provide vivid, concrete texture that scenarios deliberately do not.

The audience for stories is scientists and those who think science is important — a sophisticated reader who can spot inauthentic working-life details and recognizes hero-scientist tropes as condescending. Stories should read in the register of literary science fiction (Kim Stanley Robinson's *Antarctica* / *Ministry for the Future*; Becky Chambers; Ursula K. Le Guin's *Always Coming Home*; Annalee Newitz's *The Terraformers*), not science journalism, not hagiography, not didactic essay.

### 11.1 Modes

Three story modes, chosen per story in the YAML definition:

- **Inhabitation** — slice-of-life: what daily working life feels like in the basin in a given year under the scenario. Quiet, character-anchored. Useful for helping readers picture an institution day-to-day.
- **Inflection-point** — dramatizes one specific `moment_of_choice` from the scenario; the decision being made, alternatives present as real options, characters with conflicting views. Useful for making the agency-and-contingency principle felt rather than abstract.
- **Stress-overlay** — the scenario's commitments are tested by an external stress (federal contraction, severe climate, AI disruption); sometimes the scenario holds, sometimes it doesn't. Useful for making stress cases concrete rather than analytical.

### 11.2 Required structural elements

Every story must include:

- At least one scene set in a named basin location (Gothic, RMBL365, the East River, a specific meadow site, etc.)
- At least one moment where the stress overlay (or scenario condition) is felt concretely — someone notices, someone is affected, the texture of a familiar place is changed
- At least one way the scenario's specific investments shape what's possible or impossible — something the campaign funded should make a character's action, decision, or option possible, and something forgone should be felt as a constraint, an absence, or a road not taken. **The contrastive test:** if you could substitute a sibling scenario's slug at the top of the story without changing anything material in the plot or texture, the scenario's commitment is not yet on the page. The world, the character's options, or the outcome should be visibly different than they would be under a different campaign bet
- At least one moment that isn't about science — characters as people, not as functions
- An ending that doesn't resolve to triumph or despair. Things continue. Stakes remain.

### 11.2a Protagonist defaults

Stories in a centennial-style set work harder when the reader inhabits a *guest scientist* — someone visiting the basin to push a particular research or management/policy frontier. The guest scientist consumes the campaign's investments rather than producing them; sees RMBL staff as collaborators; carries a defined frontier-pushing identity into the basin from a home institution. This vantage makes the scenario's specific bets visible by use rather than by description.

Three protagonist types are allowed:

- **`guest_scientist`** (default) — visits RMBL from a university, peer field station, or research institute. Many career stages: PhD student, postdoc, mid-career researcher, senior fellow. Many fields: ecology, evolution, hydrology, biogeochemistry, conservation biology, restoration ecology, climate adaptation, animal physiology, plant-insect interactions, soils, atmospheric science. Many work modes: solo field campaign, established lab with grad-student cohort, multi-institutional NSF-funded project, foundation-funded restoration work, sabbatical residency, postdoc rotation, observational synthesis, modeling work, common-garden experiment, cross-station comparative.
- **`partner`** — staff scientist at a partner organization (Conservancy District, Forest Service, BLM, tribal natural-resources office, county or state agency). Not RMBL staff, not classic guest scientist. Used when the scene is about basin science crossing into management or policy practice.
- **`rmbl_staff`** — at RMBL year-round. Reserved for stories whose subject is an institutional decision only staff can plausibly carry — executive-director bridge calls, hiring choices, year-end planning that shapes the institution's posture. The fact that RMBL exists as an institution that can make such choices is itself the scenario's bet; the staff POV is constitutive there.

A set with twelve stories should land roughly two-thirds guest scientist, with partner and staff POVs reserved for scenes where those vantages are constitutive.

**Frontier as organizing question.** Each story is grounded in a specific *frontier* — one of the named knowledge boundaries from the Commons (see `/api/v1/frontiers`). The protagonist is pushing that frontier through a specific action drawn from the frontier's `pushing_the_frontier` actions. The prompt loads the frontier's title, description, two or three key questions, one or two specific actions, and at most one data gap. The frontier shapes what the protagonist is actually doing on the page; it is not announced. A reader who never reads the spec or the frontier record should still recognize the protagonist as someone with a defined intellectual stake.

The frontier is also a contrastive lever. A protagonist pushing *phenological-mismatch-and-demographic-fate-of-alpine-communities* in the **Stewardship** scenario can run a query across a century of digitized notebooks in seconds; the same protagonist in **Records-Only** would be opening three boxes of paper or waiting six months for someone with the time to digitize. The frontier's specific actions make the campaign-funded scaffolding either visible or visibly absent.

### 11.3 Forbidden patterns

- **"RMBL science saves the day" arc.** The scenario's commitments may shape what's possible, but the story must not resolve as triumph.
- **Exposition through dialogue.** Characters do not explain the scenario to each other. They live inside it; they reference it sideways at most.
- **Didactic endings.** No "lessons learned" voice. No final paragraph telling the reader what to take away.
- **Fatalism.** The future is not foregone; characters can act, even under stress, even when their actions don't save things.
- **Generic mountain-lab fiction.** If you could substitute "Niwot Ridge" or "H. J. Andrews" for "RMBL" without changing anything, you've written generic fiction. Specifics anchor the story.
- **Naming real living people.** Characters are roles, not real RMBL staff.
- **Heroic individuals.** No one in the story singlehandedly figures anything out. Work is collaborative, partial, often inconclusive.
- **Low-affect resolution.** Endings that resolve into quiet acceptance, contemplative melancholy, the "they would do this as long as they were able" register. Not every story closes on the same note of weary continuation. The "ending without triumph or despair" rule (§11.2) does not mean ending without energy. Allowed endings: forward-leaning, charged with possibility, charged with curiosity, charged with a small joy, genuinely uncertain in a way that opens rather than closes, or — sparingly — quietly accepting. A scenario set's stories should vary across these registers; if every story closes on contemplative melancholy, the set has narrowed to a single emotional note and the dynamism moves in §11.4 are not being honored.
- **Spec vocabulary.** No "distinguishing thesis," "frontier portfolio," "innovation-to-infrastructure flywheel," "in-house catalytic capacity," etc. — the story is not a planning document.

### 11.4 Voice

The v0.7–v0.9 spec accumulated specific tonal moves (texture moves, dynamism moves, candidate commitment moves) — 14 by v0.9, with 5 more proposed. The cumulative effect was drift toward checklist: every scene beat reads as fulfilling a requirement rather than emerging from the world. v0.10 collapses these into **four voice principles**, each meant to be honored in spirit rather than counted off. The examples under each principle are illustrative of what good looks like in the register; they are not requirements to satisfy individually.

The voice references in §11 — Kim Stanley Robinson at his best (*Antarctica*, *Ministry for the Future*), Becky Chambers, Ursula K. Le Guin, Annalee Newitz — carry these principles together. A story written in their register will inhabit the principles naturally without enumerating them.

#### Principle 1 — Inhabitation, not observation

Characters belong here. They know what years of being there teach you: the willows turning early like they did only in 2031; the colony of pikas that wasn't there in 2027; the way August light at 6am differs from at 7am at 9,500 feet; the meadow's smell in the first week of July; the year *Boechera* set seed two weeks late and what that meant for the rest of the system. Relationships have visible history — accreted inside jokes, learned rhythms, mutual patience with someone's quirks. The work has texture: archival queries returning more than expected; calibration drifts found; 1979 field notebooks read in handwriting aging toward illegibility.

Place is recognized, not described. Other people are known, not characterized.

#### Principle 2 — Pleasure and competence

Characters are good at their work and the goodness is felt, not stated. The query that lands in three seconds and reveals 1998 and 2034 as the only previously-uncombined years. The transect crew with a rhythm built across summers — trap-check, weigh, record, release — that an outsider would have to learn. The senior scientist whose decisions read as decisions because we watch her make them.

Characters also have strong opinions — about methods, instruments, institutions, received wisdom, individual roles. They voice them. KSR's scientists are opinionated. Stories in this register should be too. A character who doesn't have a take has not been drawn fully.

#### Principle 3 — Agency under stress

Characters act. They call collaborators, draft paragraphs, open queries, hire people, write memos, send drafts, make decisions in real time on the page. The stress shapes the response; it does not determine it. The closing 200 words must not collapse into contemplative acceptance, watching-the-light-fade, "they would do this as long as they were able" register (per §11.3 low-affect-resolution rule). Allowed closings: forward-leaning, charged with curiosity or possibility, animated by a small joy, opening rather than closing. A character writing the first sentence of something they will keep arguing with for the next week is a closing in this register. A character alone on a porch watching dusk fall is not.

#### Principle 4 — Why they're up at 4am

Characters do amazing or ridiculous things — drive up at 4am to be at the meadow before the crew starts; sleep in trucks so they're there at first light; carry batteries on snowshoes; rearrange family Christmas to be at Gothic for first snowmelt; walk five miles after dark to fix a sensor; bring breakfast for the trap crew because it's their tenth season together — because of their commitments to the work, the place, and the community. The excess only reads as excess if you don't know what they care about. A story in this register includes at least one such commitment moment, justified by attachment rather than explained. The "amazing and ridiculous" is what makes the commitment visible.

This principle is the one most distinctively RMBL: the institutional culture of intense attachment to the basin and to the small community of people who know it. The story should feel that attachment without naming it.

#### Principle 5 — A recognizably different 2039

Stories in the `centennial-2027` set are set in 2038–2039, fifteen years after the present moment. The world has shifted at the texture level in ways characters take for granted but a reader from 2024 would notice: environmental changes that have moved past adaptation into normal (species shifted up in elevation, phenology stacks reorganized, summer rituals retimed, fire seasons longer and at different times); technological changes that have rearranged daily work (AI integrated as collaborator and annotation layer; field instruments that self-report and self-diagnose; communication patterns shifted; small daily tools changed shape); social changes (different demographic and career patterns among scientists, evolved community partnerships, shifted academic and institutional norms, climate-driven migration visible at the edges).

These shifts should be felt sideways, not announced. Characters do not explain to each other that 2039 is different from 2024. They take their world as given. The 2024 reader notices the difference; the 2039 character does not.

**AI specifically.** By 2039 AI is integrated into research work in ways that go beyond today's tools. It reads entire archives overnight. It shows up to morning meetings with annotations. It has opinions characters argue with. It makes some field skills obsolete and creates new ones. Occasionally it does something a 2024 reader would find uncanny — and the character does not remark on the uncanny, because to them it isn't. **Lean into that strangeness.** Not as plot device, not as scary-AI trope, just as world. Some AI-textured moments in the story should be normal in a way that is normalized only in retrospect.

The test: if you could substitute "2024" for the story's year without changing anything material, you have not written the world the story is set in. The shift should be subtle and present, not absent and not announced. The point is not future-shock; the point is that fifteen years of compounding change is visible in how people move through their days, what tools they reach for, what they take for granted.

### 11.5 Storage and audience

Storage:
```
specification/stories/<set_id>/<story_slug>.md
```

Plus `_story_definitions.yaml` per set listing which stories exist. Each story's YAML entry includes `scenario_slug` (the scenario the story is grounded in), `mode`, `year`, the stress overlay or inflection-point or inhabitation parameters, POV, primary character role, scene anchor, word count target, and a `published` flag.

**Initial audience: internal.** Stories are easier to misread than planning artifacts and can age in ways scenarios cannot. Default `published: false` until reviewed. Stories cleared for Commons publication get `published: true` and surface at `/futures/<scenario>/stories/<story>` paired with the scenario they ground in.

### 11.6 Authoring model

LLM-assisted human authoring: humans choose the stress overlay, year, character role, and scene anchor in the YAML (the strategic and dramatic choices); the LLM produces the prose. Pipeline analogous to scenarios: `scripts/generate-stories.ts` + `src/services/stories.ts`. PROMPT_STORY inlines the full scenario as context and applies the §11.2–11.4 rules as enforcement.

The forbidden patterns (§11.3) are operationally enforced in the prompt; the lint sweep on generated stories checks for violations as a final gate.

---

## 12. Open questions

To resolve through discussion before the framework reaches v1.0:

- **Q1.** Should the LLM-assisted authoring path include explicit human approval at each structured field, or just at the prose primer? Affects scaling — five scenarios authored individually vs five scenarios authored as a set with shared framing decisions.
- **Q2.** Should the spec articulate explicit "stop conditions" — circumstances under which a scenario should be revised or retired (e.g., the campaign's actual fundraising outcome lands outside the scenario's bracket)? Related to but distinct from the §10 supersession workflow, which describes how to revise but not when to.

---

## 13. Revision log

- **v0.14** (this revision): adds **§3.2a Factual anchors — long records** to correct a systematic conflation. Scenarios v1.0 and stories v0.8–v0.13 repeatedly described the marmot demographic study as "reaching its hundredth year" within the campaign horizon — borrowing the "centennial" framing from the campaign's name. This is wrong: the marmot study started in 1963 (Barash → Armitage → Blumstein); it passes its 75-year mark in 2038; its centennial is 2063, outside any horizon the framework operates inside. The Centennial Campaign is named for *RMBL's* centennial (RMBL founded 1928; institutional centennial 2028), not the records'. §3.2a inlines a table of actual record start dates and milestones. `scripts/generate-scenarios.ts` and `scripts/generate-stories.ts` mirror the table in their prompts so future generations stay grounded. The v1.0 scenarios and v0.13 stories are corrected in-place: ~80 marmot-centennial mentions replaced with accurate framing (e.g., "marmot study reaches its hundredth year" → "marmot study now in its eighth decade"; "marmot study's centennial in the early 2040s" → "marmot study's seventy-fifth year in 2038"). Two stories get prose edits: balance-2038 (replacing "Ninety-ninth year wrapping up. The centennial event in July" with the seventy-fifth-year version) and records-and-independence-2039 (replacing "the centennial happens at the reduced scale" with the seventy-fifth-year milestone). §F.cont.2 in §6 updated.
- **v0.13**: adds **§11.2a Protagonist defaults**. The v0.12 stories landed the contrastive test but were heavy with RMBL staff protagonists (9 of 12). Shifting the default to *guest scientist* puts the scenario's infrastructure investments in better relief — the guest scientist is the consumer of what the campaign built, sees staff as collaborators, and carries a defined frontier-pushing identity into the basin from a home institution. Three protagonist types now: `guest_scientist` (default; many career stages, many fields, many work modes); `partner` (staff at Conservancy District, Forest Service, tribal NRO, etc. — used when the scene crosses into management or policy practice); `rmbl_staff` (reserved for stories about institutional decisions only staff can carry). Same revision introduces **frontier as organizing question**: each story is grounded in a specific frontier from the Commons (one of ~98 entries in the `frontiers` table). The protagonist is pushing the frontier through a specific action; the prompt loads the frontier's title, description, 2–3 key questions, 1–2 actions, 1 data gap. This makes the protagonist's intellectual stake legible at the texture level rather than announced. The frontier is also a contrastive lever — a frontier-specific action is either possible (campaign funded the scaffolding) or visibly absent (it didn't). Centennial-2027 second-cycle YAML: 7 stories regenerated with guest-scientist or partner POVs (stewardship, capacity, adaptation, community-mid, cross-mountain, phenology-deep, watershed-mid); 5 keep their v0.12 form (balance + records-and-independence + records-only because the institutional/partner decision is the scene; watershed-2038 and records-and-data because the POVs were already appropriate).
- **v0.12**: strengthens §11.2 structural element 3 with **the contrastive test**. The element previously said the scenario's commitments should "shape what's possible or impossible — something funded matters, something forgone is missed." That formulation was too permissive: a story could satisfy it with any reference to RMBL infrastructure. The strengthened version requires that the world, the character's options, or the outcome be *visibly different* than they would be under a sibling scenario's bet. The operational test: if you could substitute a sibling scenario's slug at the top of the story without changing anything material in the plot or texture, the scenario's commitment is not yet on the page. This is the same diagnostic Principle 5 introduced for 2024-portability, applied at the scenario level: the scenario's investments should be inconceivable to remove. Not a new principle — a sharpening of the existing structural element, so the principle count stays at five.
- **v0.11**: adds **Principle 5 — A recognizably different 2039** to §11.4. The v0.10 stories honored the four voice principles well but produced a world essentially indistinguishable from 2024 — the year on the page was 2039 but the texture wasn't. Principle 5 adds the world-building dimension: environmental shifts past adaptation into normal, technological change visible in how people work, social patterns evolved, and AI integrated in ways characters take for granted. Lean-into-strangeness permission for AI specifically: occasional uncanny moments treated as normal by the character. Test: if "2024" can be substituted for the year without changing anything material, the world isn't yet on the page.
- **v0.10**: restructures §11.4 from a checklist of 14 specific tonal moves (3 texture + 6 dynamism) into **4 voice principles**. The cumulative tonal-moves list had drifted into checklist territory — every scene beat reading as fulfilling a requirement rather than emerging from the world — and a KSR-influenced reading suggested the missing register was about commitment (to work, place, community), which is hard to enforce as discrete moves. The four principles are: **Inhabitation, not observation** (characters belong here; place is recognized, not described); **Pleasure and competence** (characters good at work, with strong opinions); **Agency under stress** (characters act; closings face forward); **Why they're up at 4am** (commitment to work + place + community makes amazing-or-ridiculous things justifiable). The §11.2 structural skeleton and §11.3 forbidden patterns remain unchanged — the §11.3 low-affect-resolution rule continues to enforce a floor on closings, preventing regression to the v0.8 elegy failure mode without keeping all six dynamism moves as required.
- **v0.9**: adjusts the Stories rules in §11 after first-batch generation revealed a craft problem — the §11.3 negative constraints (no triumph, no didacticism, no fatalism) created a vacuum that the LLM filled with uniform quiet melancholy. Every story closed on contemplative acceptance. The voice references the spec cites (Robinson at his best, Chambers, Le Guin, Newitz) have rich warmth, energy, and visible competence; the v0.8 prompt asked for "humor or warmth" and "physical specificity" but those got executed in the *quiet* register exclusively. §11.4 now distinguishes **texture moves** (sensory, material) from **dynamism moves** (active possibility opening, agency, visible competence, forward-leaning closing beat, warmth-with-energy not warmth-as-grief, unambiguous good). §11.3 adds a new forbidden pattern: **low-affect resolution** — endings that all resolve into quiet acceptance / "they would do this as long as they were able" register. The ending-without-triumph-or-despair rule (§11.2) does not mean ending without energy. The pipeline regenerates the first batch under v0.9 rules; YAML scene anchors for Capacity and Watershed shift toward dynamic situations (a morning of position-paper prep rather than after-action dinner; a working budget meeting at RMBL365 rather than a silent decommission walk). Story years shift to 2038–2039 where scenarios have most diverged.
- **v0.8**: introduces **Stories** as a new artifact type (new §11), companion to scenarios. Stories are short literary fiction (~1,200–1,800 words) grounded in a specific scenario, designed to help readers inhabit the futures the scenarios describe in a register scenarios deliberately can't reach. Three modes (inhabitation / inflection-point / stress-overlay) chosen per story; stress-overlay is the primary mode for the centennial-2027 set, making external stress cases concrete rather than analytical. §11 documents required structural elements (named basin location, stress felt concretely, scenario commitment shaping possibility, a moment that isn't about science, ending that doesn't resolve to triumph or despair), required tonal moves (physical specificity, texture of work, humor or warmth, campaign-funded element present in the world), and forbidden patterns (RMBL-saves-the-day arc, exposition through dialogue, didactic endings, fatalism, generic mountain-lab fiction, naming real living people, heroic individuals, spec vocabulary). Authoring model parallel to scenarios: YAML-driven inputs, LLM-generated prose, `scripts/generate-stories.ts` + `src/services/stories.ts`. Storage at `specification/stories/<set_id>/<story_slug>.md` with `published: false` by default; stories cleared for Commons publication surface at `/futures/<scenario>/stories/<story>`. The §11.2–11.4 rules are operationally enforced in PROMPT_STORY and lint-checked on output.
- **v0.7**: introduces **strategic distinctness** as a core principle (new §2.7) to address scenario convergence — the failure mode in which scenarios within a set share a playbook with different emphasis (same investment categories, same moments of choice, same audience-lens shape, just different mixes) rather than committing to distinguishably different strategic identities. Two new required structured fields enforce distinctness:

  **`distinguishing_thesis`** — 2–4 sentences naming the central strategic claim each scenario makes. The thesis is the organizing principle every prose section must trace back to. Input to the generation prompt (set in the YAML, not LLM output).

  **`mattering_in_2040`** — 2–4 sentence completion of "In 2040, RMBL matters because..." consistent with the distinguishing_thesis. Forward-looking statement of consequence. Input to the generation prompt.

  Both fields are required from v0.7 onward and required for every scenario in a set. The generation prompt operationally requires that each scenario also has (a) at least 1–2 deliverables that are distinctive to it at its magnitude, (b) at least 2 moments-of-choice with `shared_inflection_id: null`, and (c) at least one failure mode in `plausibility_caveats` specific to the scenario's bet. §7 field table and §7.1 required field rules updated correspondingly. The pipeline (`scripts/generate-scenarios.ts`) reads the new fields from the YAML and surfaces them prominently in PROMPT_SCENARIO as the scenario's organizing anchor.

  Companion work in the same release: the YAML schema in `src/services/scenarios.ts` extends to support the new fields, and a 12-scenario set (`centennial-2027`) gets drafted theses + mattering statements before any generation.

- **v0.6**: two changes that prepare for pipeline-driven scenario generation.

  **Dev-team campaign-structure agency.** Clarifies the boundary between strategic-planning scenarios and campaign-vehicle structure. The actual structure of a Capital Campaign — fund vehicles, named-gift opportunities, gift-tier framings, donor-recognition structures, per-deliverable dollar allocations, endowment-vs-capital splits — is tailored to RMBL's actual donor base and is the Development & Advancement team's prerogative; strategic-planning scenarios inform that work but do not prescribe it. A new §3.1 bullet ("Campaign structure is the Development & Advancement team's prerogative") makes this explicit. `campaign_deliverables` field description (§7) reframed to describe strategic priorities and required capacities (e.g., "primary priority: endowed support for centennial records continuity at substantial scale") rather than campaign vehicles ("Endowed Records Fund of \$3.5M with \$175K annual draw"); impressionistic sizing replaces dollar precision at the deliverable level. `campaign_magnitude` field notes that prose-body magnitude framing should be impressionistic ("near the upper end of the realistic bracket") rather than pinned to a specific number, while the structured field retains numeric values for cross-scenario comparison. New §7.1 required field rules and §7.2 forbidden patterns operationalize the boundary. §9.7 Donor-facing materials clarified.

  **Synopsis field (new required structured field).** Scenarios at ~4,000 words are detailed and grounded but too long for quick scanning. A new required `synopsis` field (~150–250 words) captures the scenario's strategic essence — central contingency, priorities, what's forgone, what's asked of donors and the institution — and is designed to read coherently on its own. §9.3 detail page layout places the synopsis immediately under the header (item 2) so readers who want the scenario at a glance can stop there. §9.6 comparison view identifies the synopsis as the natural row content for cross-scenario comparison.

  *Note on existing scenarios:* the Centennial Stewardship v1.1 and Centennial Capacity v1.1 drafts in `specification/scenarios/centennial-2027/` were authored before v0.6 and contain the patterns this revision forbids (specific named campaign funds with dollar allocations and draw rates; dollar-precise campaign-close magnitudes in prose) and lack the new required `synopsis` field. Rather than hand-revise them in-session — which would be non-reproducible and lose the prompt-engineering history — those scenarios are flagged as pre-pipeline drafts. They will be regenerated to v2.0 once the scenario-generation pipeline (analogous to `scripts/generate-era-primers.ts`) is built. The pipeline reads §3.1, §3.2, §3.3, §6, §7.1, §7.2 of this spec as prompt preamble plus relevant Commons grounding (current Era primers, Frontiers, planning themes), so future scenarios are spec-compliant by construction rather than by hand-editing.
- **v0.5**: adds the RMBL365 facility to §3.1 institutional grounding. RMBL purchased a Crested Butte building (operated previously as a hostel) in 2025 and rebranded it RMBL365 — a year-round, in-town venue for housing, workshop, and community-engagement functions. Renovations could add laboratory or staging space. Scenarios that imagine year-round, community-facing, or in-town capabilities should now reference RMBL365 as the existing platform rather than imagining new builds. The §3.1 Community priority bullet briefly cross-references RMBL365 as a recent institutional expression of the community-priority commitment.
- **v0.4**: corrects v0.3's over-restrictive framing of RMBL's research model. v0.3 stated "RMBL does not generally run principal-investigator-led research programs" and "Scenarios should not assume RMBL hires its own research scientists at scale" — language that inadvertently excluded the externally-funded innovation-to-infrastructure flywheel that has built RMBL's in-house catalytic capacity over recent years (sensing and instrumentation development, cyberinfrastructure, this Knowledge Commons). v0.4 distinguishes between (a) external-PI-led research portfolios, which RMBL does not typically run, and (b) in-house catalytic science capacity, which RMBL does build and grow. Scenarios can and should include investments in the latter category. The flywheel is added as a named §3.1 bullet ("The innovation-to-infrastructure flywheel"). §3.3 (LLM-prompt implications) updated correspondingly — "endowed program" now reads as catalytic infrastructure plus in-house catalytic capacity; in-house RMBL science capacity is legitimate scenario content. §6 interpretive note expanded to include in-house catalytic capacity within the "catalytic infrastructure" category; F.innov.3 (AI-assisted retrospective synthesis) reframed to note that in-house RMBL capacity is genuinely load-bearing for this frontier rather than only catalytic-of-external-work.
- **v0.3**: magnitude bracket revised from $5M–$15M to $3M–$8M based on current campaign-planning estimates. New §3 "Institutional grounding" added — §3.1 captures durable facts about RMBL's operating model (nonprofit, guest-scientist-driven research, ~4-person catalytic technical staff, catalytic-infrastructure investment philosophy, community-priority commitment); §3.2 captures time-bound facts about the current moment (federal funding disruption as baseline rather than hypothetical, diversified-funding-base urgency, institutional independence as strategic asset in light of restrictions facing peer institutions like NCAR, heightened community salience); §3.3 specifies that LLM prompts authoring scenarios should be fed §3.1 and §3.2 as preamble so generated material starts from where RMBL actually is. Scenario set design (§5) reworked: four scenarios instead of five to fit the smaller bracket cleanly; magnitudes shifted to $3M (floor) / $5M (mid) / $7–8M (target). A new §5.3 surfaces the magnitude–innovation interaction (innovation share scales with magnitude — pushing $3M past 30% innovation typically compromises core continuity). Candidate frontiers (§6) reframed under catalytic-infrastructure model — each frontier description now reads as "what RMBL invests in to enable guest-scientist work" rather than "what RMBL itself does." A new F.innov.5 (Institutional independence as platform for inquiry) frontier added, reflecting the current moment's elevation of RMBL's independence as a strategic asset.
- **v0.2**: four open questions resolved per RMBL leadership input — scenarios are public-facing with explicit genre framing and prominent plausibility caveats (§9.1); shared inflection points encoded as first-class artifacts with cross-scenario rendering (§7.3, §9.5); `frontier_support_strategies` remains intentionally free-text with optional informal tagging; minimal versioning infrastructure added (§10) supporting iteration across visioning cycles via per-scenario `version` and `superseded_by` fields and per-set `set_id`. Two open questions remain (LLM authoring granularity, stop conditions).
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
- **Frontiers collection** — 98 frontiers from the planning pipeline. Frontier portfolio selection draws primarily from this collection; the candidate list in §6 is a supplement, not a replacement.
- **Planning-pipeline themes** — the 12 cross-lens themes synthesized by the planning pipeline are natural sources for the `audience_lens_donor` framings, particularly for societal-impact translation language.
- **Stakeholders collection** — relevant for the `audience_lens_donor` and `frontier_support_strategies` fields, particularly for the F.innov.2 (translation) and F.innov.4 (community partnerships) frontiers.
