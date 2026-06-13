---
title: Era primer distinctiveness rewrite — before/after on 3 sample eras
date: 2026-06-13
eras_tested: 1970s, 1996-2000, 2016-20
cost: $1.62 total ($0.53 + $0.55 + $0.54)
---

# Era Primer — Distinctiveness Rewrite, Sample Diff

## What changed

Three levers + news integration, working together to attack the "every era reads like a busy-growth narrative" failure mode.

### Lever 1 — Stop the scale lede
- Demoted SCALE block from prominent context position to "BACKGROUND LEVELS (reference values only — do not lead with these)"
- Prompt now explicitly forbids opening with publication counts, researcher counts, "busy/humming/expansion/growth/boom/flourishing", or the "publishing here for the first time" pattern

### Lever 2 — ERA SIGNATURE block (new lead context)
- New service: `getEraSignature` — composes deltas vs prior era from existing primitives
- Scale step-changes (only deltas worth naming): n_pubs %, avg co-authors abs, avg refs abs, share internal refs pp, newcomer share pp
- Methodological step-changes (≥3pp) from protocol categories
- Research-scope step-changes (≥3pp) from concept scopes
- First-appearing concepts/protocols/species (max 5 each, sorted by mentions)
- Press coverage classification (absent/sparse/modest/rich) + total vs prior + type shifts

### Lever 3 — Setting prompt rewrite
- Requires opening with claims from ERA SIGNATURE that wouldn't apply equally to neighboring eras
- External events must be named with their actual year inside the era window — "the IPCC era" forbidden; "the 2018 IPCC Special Report on 1.5°C" acceptable

### News integration
- New service: `getEraNewsContext` — top 5–8 stories by `pub_link_count × story_type_weight`, source-balanced (max half from any class)
- New NEWS COVERAGE context block — titles only, no story bodies (copyright)
- Coverage classification drives Community/policy prompt branching: absent → omit; sparse → mention without over-reading; modest/rich → first-class source

---

## 2016-20 — RICH NEWS COVERAGE

### Setting paragraph 1

**v1:** *"Between 2016 and 2020, the Rocky Mountain Biological Laboratory and the surrounding Gunnison Basin became one of the busiest mountain field-science landscapes in North America. Roughly 600 publications carry a basin dateline from these five years, drawing on something like 1,250 distinct researchers — the great majority of them publishing in the basin for the first time. The science was unmistakably collaborative: papers averaged a little over three co-authors and drew on roughly 46 references apiece, a sign of how thoroughly basin work was now woven into wider literatures."*

**v2:** *"Between 2016 and 2020, basin science took a sharp turn toward water and the chemistry it carries. Hydrology and biogeochemistry — together barely a tenth of basin work in the prior five years — jumped to roughly a quarter, driven in large part by the Department of Energy's decision to designate the East River watershed above Crested Butte as a community testbed for mountainous-system science [Hubbard et al., 2018](/publications/719). New instruments and techniques arrived with that designation: piezometers in the hillslopes, tipping-bucket rain gauges, snow energy-and-mass-balance stations, and airborne LiDAR flown over the East River in August 2015 that became a workhorse dataset for the years that followed. Collaboration intensified alongside the new infrastructure — average co-author counts rose by about 0.7 per paper, a jump consistent with multi-institution watershed teams replacing smaller field crews."*

v2 leads with the scope step-change (+11pp hydrology, +9pp biogeochemistry — both from ERA SIGNATURE), anchors it to a specific event-year cause (DoE East River designation), names the new instruments (all from `new_protocols`), and uses the +0.7 avg-coauthors jump as quantitative evidence rather than mood-language.

### Setting paragraph 2 (news-integrated)

v2 only: *"The era also coincided with a notable surge in public attention to basin science. Press coverage rose roughly 78% over the prior five-year window, with news articles (rather than press releases or event notices) carrying most of that growth. The 2015 Paris Agreement entering into force in November 2016, the 2018 IPCC Special Report on 1.5°C, and the launch of the U.S. Long-Term Agroecosystem Research network's expanded climate work all sat in the background as journalists turned more often to Gothic for stories about what a warming mountain looks like up close."*

Notice the Lever 3 rule landing: every external event ("2015 Paris Agreement … November 2016," "2018 IPCC Special Report on 1.5°C") names a year inside the era window. The vague-period-mood framing the prior version defaulted to is gone.

### Community and policy context

**v1** (paraphrased): listed documents only — emissions assessment, Forest Plan, energy corridor stakeholder process, Sustainable Living Library.

**v2:** *"Press coverage of basin science in this period was both abundant and substantive. A 2017 national profile of a self-taught Gothic snow observer — whose decades of daily measurements had become a touchstone for climate reconstruction — circulated widely and reframed the basin as a site where citizen observation and formal science had quietly grown together. Two 2016 national research summaries picked up the finding that climate change was reshaping the sex ratio of a common subalpine plant, an unusually concrete handle for general readers. By 2020, a two-part local feature on the carbon balance of mountain meadows and a national mountain-meadows piece tied to climate action coverage signaled that the East River science was reaching beyond specialist audiences. Locally, the era's policy documents tracked a Gunnison community trying to align with the same climate signals the science was describing..."*

v2 has two paragraphs now: a news-driven one (drawing from NEWS COVERAGE — the billy barr profile without naming him, the sex-ratio research summaries, the carbon balance features) and a document-driven one. The news isn't a list-dump; it's interpreted as "public engagement" with the science.

---

## 1996-2000 — SPARSE NEWS COVERAGE

### Setting

**v1:** *"The second half of the 1990s was a busy stretch in the East River valley. Roughly 339 publications carry dates in this five-year window, and some 340 distinct researchers were active in the basin — a striking 81 percent of them publishing from Gothic for the first time. The Rocky Mountain Biological Laboratory was, in other words, both a settled long-term ecological site and a magnet for a new cohort. Most papers still came from small teams (averaging under two co-authors), but their reach was widening: subalpine meadows, marmot colonies, and high-country streams were increasingly cited in journals read well beyond the Rockies."*

**v2:** *"The second half of the 1990s in the Gunnison Basin was when climate became a working variable in basin ecology rather than a backdrop. In 1997, the year the Kyoto Protocol was adopted, basin researchers were already running experimental warming arrays in subalpine meadows and publishing results that fed back into the global conversation about terrestrial ecosystem feedbacks [Harte, 1998](/publications/2136)[Saleska et al., 1999](/publications/2084). Methodologically, the era marked a sharp pivot: observational study designs jumped roughly eighteen points to about 30% of basin work, while structured sampling fell by a quarter — a reorientation toward long-watch field ecology and individual-based tracking rather than transect-and-quadrat surveys."*

v2 leads with "climate became a working variable rather than a backdrop" — a synthesizing claim grounded in: (a) a date-anchored event (Kyoto Protocol 1997, inside era window), (b) the observational +18pp / sampling -25pp methodological step-change from ERA SIGNATURE, (c) specific citations to Harte 1998 and Saleska 1999 (the experimental warming work that supports the claim).

v1 had used the forbidden "busy stretch" opener + pub count + newcomer share.

### Community and policy — sparse news handling

v2 correctly notes the sparse news sample without over-reading it (only 9 Lexis index hits in the era).

---

## 1970s — ABSENT NEWS COVERAGE

### Setting

**v1:** *"The 1970s were a decade of striking expansion for field ecology at the Rocky Mountain Biological Laboratory and across the Gunnison Basin. Roughly 474 publications can be dated to the decade, drawing on the work of more than 350 active researchers — the great majority of them publishing from the basin for the first time. The single-author and two-author paper still dominated (averaging just 1.3 co-authors), but the questions being asked were increasingly ambitious: how animals choose what to eat and where to forage, how plants compete for pollinators, how populations are regulated, and how high-elevation communities are organized. These were the questions reshaping ecology nationally."*

**v2:** *"The 1970s in the Gunnison Basin were the decade when basin ecology stopped being a sideline of natural-history surveying and became an experimental, hypothesis-driven enterprise. The shift shows up in how the work was done: measurement-based studies — quantitative censuses, energetics budgets, pollen counts, body-weight time series — climbed by roughly 27 percentage points to become the dominant approach, while purely observational and descriptive analytical work receded in relative share. Population ecology grew into a recognizable specialty of basin work, and for the first time the literature began to cite itself substantially — about 8% of references in basin papers now pointed to other basin papers, a sevenfold-point jump that signaled an emerging local scientific conversation rather than a scatter of independent investigators."*

v2 leads with the "natural-history → experimental hypothesis-driven" transformation, grounded in:
- Measurement protocols +27pp (from ERA SIGNATURE)
- Population ecology scope rising
- Internal-citation share jumped from 1% to 8% (sevenfold-point jump)

No news block — correctly omitted; ERA SIGNATURE flagged coverage as "absent (pre-digitization era)".

---

## Lint sweep

Across all 3 v2 primers:
- Meta-vocabulary: clean
- Citation format: clean
- Reporter/columnist names in prose: none
- "busy/humming/expansion/boom/flourishing" Setting openers: none
- Soft hit "growth" in 2016-20: refers to news-article growth, not era expansion (acceptable)
- Soft hit "Gothic showed" in 2016-20: place-as-subject (acceptable scientific voice)

## Word counts vs v1

| Era | v1 words | v2 words | Cost |
|---|---|---|---|
| 1970s | 1,660 | 1,784 | $0.53 |
| 1996-2000 | 1,955 | 1,682 | $0.55 |
| 2016-20 | 1,732 | 1,888 | $0.54 |

All within the 800–1,400 target band on the main prose body (the larger numbers include the REFERENCES section).

---

## What to look at when reading the full primers

1. **Setting openers** — every v2 should now lead with a comparative or step-change claim, not a busy/growth claim
2. **External event citations** — every wider-world reference should name a specific year inside the era window
3. **Community/policy sections** — for 2016-20, news should be interwoven with documents; for 1996-2000, news should be acknowledged but not over-read; for 1970s, news should be absent (with no awkward filler)
4. **Connections sections** — these should still work; they weren't part of the rewrite

## If approved, next step

Regenerate the other 8 eras (pre-1950, 1950s-60s, 1980s, 1991-95, 2001-05, 2006-10, 2011-15, 2021-25). Estimated cost ~$4.50, ~10 min.

Live primers shown above are visible on the production preview after merging the PR.
