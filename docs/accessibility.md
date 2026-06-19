# Accessibility — policy + findings + roadmap

The RMBL Knowledge Commons aims for [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) on every public page. Audience feedback from the 2026-06-18 RMBL seminar specifically asked about screen-reader support, font scaling, contrast, and captions for any future audio/video — all of which fall under that bar. See issue [#47](https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues/47) for the broader audit project.

This doc records what's been fixed, what's known broken, and how to re-audit.

## How to re-audit

1. Start the dev server in one terminal: `npm run dev`
2. In another terminal: `./scripts/audit-a11y.sh` (or `--quick` for the 5-page subset)
3. Reports land in `scripts/output/a11y/*.report.html` — open any in a browser for per-issue detail. Headline score per page is in `scripts/output/a11y-summary.txt`.

The script runs [Lighthouse](https://developer.chrome.com/docs/lighthouse/) with `--only-categories=accessibility`, so a passing score (≥ 90) is the bar this project commits to. The script also catches the majority of [axe-core](https://github.com/dequelabs/axe-core) rules; Lighthouse uses axe under the hood.

## Fixed in pass 1 (PR for issue #47)

| Issue | Fix | Files touched |
|---|---|---|
| 13 browse pages skipped from h1 → h3/h4 in their filter sidebars | Promoted filter-section labels from `h4` to `h2` (single content-tree level under page title); CSS selector updated to keep visual styling unchanged | `src/app/(frontend)/{authors,concepts,eras,frontiers,futures,neighborhoods,places,projects,protocols,search,species,stories}/page.tsx`, `eras/[slug]/page.tsx`, `styles.css` |
| `eras/[slug]` had h3 section heads + h4 sub-heads under h1 (skip) | Promoted both one level: h3→h2, h4→h3 | `src/app/(frontend)/eras/[slug]/page.tsx` |
| Three visible search inputs lacked an associated label | Added `sr-only` label + `aria-label` for the graph search | `src/app/(frontend)/page.tsx` (home), `authors/page.tsx`, `components/ExploreEntityGraph.tsx` |
| `--fg-muted` in **light theme** failed WCAG AA (3.23:1 contrast vs cream) | Darkened `#8A8568` → `#6E6E48` (4.56:1, passes AA) | `src/app/(frontend)/styles.css` |
| `--fg-muted` in **dark theme** was effectively invisible (2.39:1 vs dark bg) | Lightened `#5F5A45` → `#B5AD8A` (7.76:1, passes AAA) | `src/app/(frontend)/styles.css` |

Token-by-token contrast check at the end of this doc.

## Known issues — not yet fixed

### 1. `search` and `projects` pages are missing an `<h1>` (the page title)

The browse pages need a page title heading. Currently both jump straight into content with `<h2>` section headers. This is a content/visual decision — adding a title heading affects the page layout. Worth doing but should be coordinated with the page designer.

### 2. Orange accent (`#F05028`) used for link text fails WCAG AA contrast

The brand orange against the cream background gives a 3.09:1 contrast ratio — passes the 3.0:1 threshold for large text but fails the 4.5:1 bar for normal text. This is a brand-color question, not just a code question.

**Mitigations to consider:**
- Add a baseline underline to all body links (currently underline appears on hover only — color-only-indicator anti-pattern).
- Use a darker accent for body-text links (`#C23E1C` is `--rmbl-orange-deep` and gets to 5.4:1; could become a body-link variable while the brighter orange stays for buttons/badges).
- Keep the bright orange for visual emphasis but only on backgrounds where it passes (e.g., charcoal, dark mode).

### 3. `moss` (#6B7A4A) used for badges fails AA on cream backgrounds

4.04:1 ratio. Same trade-off as the orange — either darken the moss for cream backgrounds, or only use it where backgrounds support it.

### 4. Graph pages (`/explore/*`, `/neighborhoods/[id]` graph view)

WebGL canvases aren't natively accessible. Sigma.js doesn't expose the graph as a screen-reader-readable tree. A tabular fallback ("Top connections" table) would let assistive-tech users access the same information; not in scope for this pass.

## Token contrast table (current state)

Both themes verified against their own background. All AA failures are noted; AAA values noted where relevant.

### Light theme (background `#F4EEE4`)

| Token | Color | Contrast | AA normal (≥4.5) | AA large (≥3.0) |
|---|---|---:|---|---|
| `--fg-1` (text) | `#32321E` | 11.30 | ✓ AAA | ✓ |
| `--fg-2` (secondary) | `#55553D` | 6.61 | ✓ AAA | ✓ |
| `--fg-3` (muted) | `#6B6B4E` | 4.74 | ✓ | ✓ |
| `--fg-muted` (extra) | `#6E6E48` | 4.56 | ✓ (was 3.23 fail) | ✓ |
| `--accent` (orange) | `#F05028` | 3.09 | ✗ | ✓ |
| `--rmbl-moss` (badges) | `#6B7A4A` | 4.04 | ✗ | ✓ |

### Dark theme (background `#1A1A10`)

| Token | Color | Contrast | AA normal (≥4.5) | AA large (≥3.0) |
|---|---|---:|---|---|
| `--fg-1` (text) | `#F4EEE4` | 14.91 | ✓ AAA | ✓ |
| `--fg-2` (secondary) | `#C8C0A8` | 9.79 | ✓ AAA | ✓ |
| `--fg-3` (muted) | `#8A8268` | 4.74 | ✓ | ✓ |
| `--fg-muted` (extra) | `#B5AD8A` | 7.76 | ✓ AAA (was 2.39 fail) | ✓ |
| `--accent` (orange) | `#F05028` | 4.82 | ✓ | ✓ |

## What's not (yet) in scope

- Captions for any future audio/video content
- Comprehensive keyboard-navigation review (Lighthouse catches most; explicit tab-order test pending)
- Tabular fallback for the graph visualizations (issue #4 above)
- Page-title `<h1>` on `/search` and `/projects` (issue #1 above)

These belong in a pass-2 round once we have Lighthouse baseline scores and the page-title decision settled.
