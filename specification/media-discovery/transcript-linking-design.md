# Linking scientist talks into the Knowledge Commons — transcription + extraction design

Background note for roadmap item 7 (2026-08-27). How a discovered talk (YouTube video) becomes a first-class, cross-linked Knowledge Commons item. Grounded in a probe of the volunteer ground-truth set (`youtube-ground-truth.json`, 91 videos).

## What we measured

Probe of 12 random ground-truth videos + 1 full transcript pull:

| Finding | Value | Implication |
|---|---|---|
| Auto-generated English captions available | 11/12 (~90%) | Free tier-1 transcript source, no audio download |
| Captions disabled | 1/12 | Need a tier-2 (ASR) fallback |
| Sample talk (Blumstein seminar, 63 min) | 9.7K words / 55K chars | Longform-scale — same ballpark as thesis chapters |
| Topical signal in auto-captions | "marmot" ×39, "alarm call" ×38 | Plenty for discovery scoring + search indexing |
| Domain-term fidelity | "RMBL" ×0 (certainly spoken); "marmot" garbled → "Marmont"/"Mormons"; no binomials; no punctuation | **Auto-captions alone are not extraction-grade** |

The fidelity problem is the "tricky to automate" part: entity extraction feeding ITIS-validated species and GNIS places will silently miss or mis-link on garbled ASR. Everything below is designed around that.

## Tiered transcription

1. **Tier 1 — YouTube auto-captions** (youtube-transcript-api or yt-dlp; note both are unofficial — the official captions API only serves videos you own). Covers ~90% at zero cost. Good enough for: discovery relevance scoring, full-text search indexing, embeddings.
2. **Tier 2 — Whisper ASR** for captions-disabled videos and any talk we promote to display quality. large-v3 handles jargon + punctuation far better. ~91 videos × ~50 min ≈ 75 h ≈ **$27 at API pricing** ($0.006/min), or free-but-slow locally (whisper.cpp). Requires audio download — fine for RMBL-owned/CC content; for third-party videos it's a YouTube-ToS gray area, so default to tier 1 there and treat tier 2 as case-by-case.
3. **Tier 1.5 — LLM transcript repair (the interesting middle):** feed auto-captions through Claude with a domain glossary assembled from our own tables — the author's species mentions (4,334 species w/ binomials), places (Gothic, East River…), "RMBL"/"Rocky Mountain Biological Laboratory", their co-author names and paper titles. Cheap (~14K tokens/talk ≈ cents) and it fixes exactly the terms we care about. **Pilot should A/B: extraction on raw captions vs repaired captions vs Whisper** — it's plausible extraction-time robustness (Claude inferring "Marmont"→marmot from context) closes most of the gap without a repair pass.

## Extraction pass (reuses existing machinery)

Talk transcripts are thesis-chapter-scale, so the **chapter-aware longform pattern** (`extract-longform-entities.ts` → `entity_candidates` → cluster/link scripts) transfers directly:

- **Entities:** species / places / protocols / concepts / stakeholders → `entity_candidates`, then the normal clustering + linking flow. `entity_mentions.collection` gains a `talks` value (varchar(15) — fits).
- **Paper links (the high-value one):** speakers narrate their own papers ("our 2019 PNAS paper on…"). Constrain matching to the *speaker's own publication list* (small search space, high precision) with fuzzy title/year/venue match, and require quoted transcript evidence per link — the verbatim-cite enforcement pattern from grounded frontiers already proved this works against hallucination. Links land in `references_cited` with a talk source type.
- **Talk metadata:** venue/series, talk type (seminar/TEDx/podcast/panel), year — one structured-output call.
- **Embeddings:** Voyage on the transcript → the existing 4-signal related-works panel and semantic search pick talks up with zero new code.

## Where talks live

Per roadmap items 6+7: **Stories collection, new `story_type` (e.g. `talk`)** rather than a new collection — Stories already has the store-full-text-don't-display pattern we need for third-party transcripts (same copyright posture as news text), entity chips, and related-publication linking. Display: external YouTube embed + entity chips + linked papers; transcript displayed **only** for RMBL-owned recordings (oral histories), searchable for everything.

## Honest automation risks

1. **ASR fidelity on domain terms** — measured above; the pilot's A/B answers how much repair is needed.
2. **Multi-speaker content** (panels, Q&A, interviews) — attribution noise; skip diarization initially, extract at talk level, revisit if panel content matters.
3. **Reference-linking hallucination** — mitigated by speaker-scoped candidate lists + verbatim evidence; measure precision manually on ~20 links before trusting.
4. **Unofficial caption APIs break** — youtube-transcript-api is scraping-adjacent; wrap in the usual cached-JSON-in-`scripts/output` pattern so a breakage stalls refresh, not the corpus.
5. **Which video is "about" which author** — discovery-side problem (item 7 pilot), but extraction inherits it: wrong-author attribution poisons paper linking. Only run extraction on curated/approved candidates (review queue first).

## Suggested pilot (fits in 2–3 days, alongside the discovery pilot)

1. `fetch-talk-transcripts.ts` — tier-1 pull for all 91 ground-truth videos, cache to `scripts/output/`.
2. A/B the extraction input (raw vs LLM-repaired vs Whisper on ~5 talks); score species/place recall against a hand-labeled sample.
3. Run winning variant across the 91; land entities in `entity_candidates` (don't link yet) + paper-link candidates with evidence quotes.
4. Manual review of paper-link precision → go/no-go for the review-queue productization.

Estimated pilot cost: < $10 LLM + optional ~$27 Whisper.
