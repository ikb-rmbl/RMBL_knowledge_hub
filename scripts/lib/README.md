# `scripts/lib/` — shared utilities for the pipeline + scripts

This directory holds modules used by multiple pipeline scripts. Keep modules
small, single-purpose, and dependency-light.

## Author deduplication policy

Module: `author-dedup.ts`

Authors are deduplicated in two phases:

1. **ORCID-based merge.** Strict. Two `authors` rows with the same ORCID
   collapse to one. This is the reliable signal — if we have it, we trust
   it.

2. **Name-based merge.** Fallback for authors without ORCID. Groups by
   family name, then tries to match given names via `initialsMatch` plus a
   prefix-or-equality check on long-form names.

The fallback is necessarily liberal — without ORCID, we can't be certain
two records refer to the same person. Two cases where it can over-merge:

- **Common surname + shared first initial, different middle.** Caught by
  `initialsMatch` requiring all overlapping initial positions to match
  (e.g. "R. J. Smith" and "R. A. Smith" do *not* merge).
- **Shared first initial, one has middle, other doesn't.** *Not* caught.
  "R. Smith" merges with "R. J. Smith" today even though they could be
  different people who happen to share a surname and a first initial.

The conservative direction is to require additional evidence (shared
coauthors, decade overlap, same venue) before merging in this last case
when neither author has ORCID. Implementing it cleanly requires the
caller to pass coauthor/venue/year context into the dedup step, which
isn't there today — so the change is staged:

1. **Audit (shipped, issue #46).** `scripts/audit-author-conflations.ts`
   scans existing authors for likely over-merges using time-span,
   publication-gap, and bimodal-active-period signals. Output:
   `scripts/output/author-conflation-audit.csv`. Read-only.
2. **Tighten the heuristic (planned).** Decline to auto-merge name pairs
   where the initial *count* differs and neither has ORCID; surface as a
   "needs review" pair instead.
3. **Curator merge/split UI (planned).** Admin-facing tools to merge two
   authors known to be the same person and split a single author known to
   aggregate multiple people. The Payload curation pattern (see project
   CLAUDE.md → *Curation & Deletion*) is the right home.

## Other modules

See file headers — each is documented at the top.
