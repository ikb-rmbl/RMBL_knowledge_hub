#!/usr/bin/env bash
# Run Lighthouse accessibility audits against the local dev server for each
# of the main page types. Output: JSON + HTML reports per page, plus a
# headline summary in scripts/output/a11y-summary.txt.
#
# Prerequisites:
#   - `npm run dev` running in another terminal (default port 3000)
#   - `npx lighthouse` downloads on demand (Chromium / Chrome available locally)
#
# Usage:
#   ./scripts/audit-a11y.sh              # full run, default URLs
#   ./scripts/audit-a11y.sh --quick      # subset (home + search + 3 detail types)
#   BASE_URL=http://localhost:4000 ./scripts/audit-a11y.sh
#
# Tracks: https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues/47

set -eu

BASE_URL="${BASE_URL:-http://localhost:3000}"
OUT_DIR="scripts/output/a11y"
QUICK=false
[ "${1:-}" = "--quick" ] && QUICK=true

# Pages to audit. For detail pages, pick one representative ID — the
# template is what we're testing, not the data.
FULL_PAGES=(
  "home:/"
  "search:/search"
  "publications-list:/publications"
  "publication-detail:/publications/3940"
  "documents-list:/documents"
  "document-detail:/documents/2799"
  "datasets-list:/datasets"
  "stories-list:/stories"
  "authors-browse:/authors"
  "species-browse:/species"
  "places-browse:/places"
  "protocols-browse:/protocols"
  "concepts-browse:/concepts"
  "neighborhoods-browse:/neighborhoods"
  "neighborhood-detail:/neighborhoods/0"
  "frontiers-browse:/frontiers"
  "frontier-detail:/frontiers/2"
  "eras-browse:/eras"
  "about:/about"
  "explore-unified:/explore"
)
QUICK_PAGES=(
  "home:/"
  "search:/search"
  "publication-detail:/publications/3940"
  "neighborhood-detail:/neighborhoods/0"
  "frontier-detail:/frontiers/2"
)

PAGES=("${FULL_PAGES[@]}")
$QUICK && PAGES=("${QUICK_PAGES[@]}")

mkdir -p "$OUT_DIR"
SUMMARY="scripts/output/a11y-summary.txt"
{
  echo "RMBL Knowledge Commons — a11y audit"
  echo "Date:     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Base URL: $BASE_URL"
  echo "----------------------------------------------------------------"
} > "$SUMMARY"

# Sanity: make sure the dev server is up before we burn time on Lighthouse.
if ! curl -fs -o /dev/null "$BASE_URL"; then
  echo "✗ dev server not reachable at $BASE_URL"
  echo "  Start it with: npm run dev"
  exit 1
fi

for entry in "${PAGES[@]}"; do
  name="${entry%%:*}"
  path="${entry#*:}"
  url="${BASE_URL}${path}"
  printf '  %-26s  %s\n' "$name" "$url"
  npx --yes lighthouse "$url" \
    --quiet \
    --only-categories=accessibility \
    --output=json --output=html \
    --output-path="${OUT_DIR}/${name}" \
    --chrome-flags="--headless=new --no-sandbox" >/dev/null 2>&1 || {
      echo "    ✗ lighthouse failed on $url" >> "$SUMMARY"
      continue
    }
  score=$(node -e "console.log(Math.round((require('./${OUT_DIR}/${name}.report.json').categories.accessibility.score || 0) * 100))" 2>/dev/null || echo "?")
  printf '  %-26s  score: %s  →  %s.report.html\n' "$name" "$score" "${OUT_DIR}/${name}" | tee -a "$SUMMARY"
done

echo "----------------------------------------------------------------" | tee -a "$SUMMARY"
echo "Open the HTML reports in a browser for per-issue detail."         | tee -a "$SUMMARY"
echo "Summary written to $SUMMARY"
