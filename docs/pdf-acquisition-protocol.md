# Protocol: Acquiring & Ingesting Paywalled Publication PDFs

*A step-by-step guide for adding full text from publications that automated discovery couldn't reach.*

---

## Why we do this

Many important publications sit behind paywalls or on platforms that block automated downloading. The Knowledge Commons can still make these papers **findable** — it indexes their full text for search — without ever **redistributing** the file. That distinction is the whole point of this workflow:

> We legitimately acquire a PDF, extract its text so the paper becomes searchable, and store the file locally only. The public site shows the paper's abstract, references, and search snippets, but **does not offer the PDF for download**.

This keeps us fully within copyright while making the basin's published record as complete as possible.

## Two golden rules

1. **Acquire legitimately.** Only use authorized sources — our institutional library and subscriptions, interlibrary loan (ILL), open-access versions, preprint servers, or a direct request to the author. **Do not** use pirate sites (e.g., Sci-Hub) or any method that violates a publisher's terms. When in doubt, ask before downloading.
2. **Name files exactly.** Every PDF must be named `pub_<id>.pdf`, where `<id>` is the number in the worklist's `id` column (e.g., `pub_2764.pdf`). The ingest tool finds the right record *only* by this filename. A misnamed file is silently skipped.

---

## The priority list (where it is and what's in it)

The worklist has been generated for you here:

```
scripts/output/pdf-worklist.csv
```

It contains **200 publications**, already sorted by priority — most-cited first, then most recent. Open it in Excel, Numbers, or Google Sheets. Each row is one paper. The columns:

| Column | What it's for |
|---|---|
| `id` | The paper's internal ID. **This determines the filename** (`pub_<id>.pdf`). |
| `publication_type`, `year`, `title`, `authors`, `journal`, `volume`, `issue`, `pages` | Bibliographic details to help you identify and find the paper. |
| `doi` | The Digital Object Identifier — your fastest path to the paper (see below). |
| `external_url` | A link we already have on file, if any. |
| `citation_count` | How often the paper has been cited — this drove the priority ranking. |
| `suggested_filename` | The exact filename to use, pre-filled (e.g., `pub_2764.pdf`). **Copy this.** |
| `source_description` | ← **You fill this in**: where you got the PDF (e.g., "via Gunnison County Library ILL"). |
| `status` | ← **You fill this in**: `found`, `not found`, `paywalled`, etc. |
| `notes` | ← **You fill this in**: anything useful for whoever follows up. |

Work top-to-bottom; the most valuable papers are first. You do **not** have to finish all 200 in one sitting — the workflow is resumable.

---

## Part A — Acquiring the PDFs (your main task)

Repeat this loop for each paper, working down the list:

### Step 1 — Find the paper
The fastest route is almost always the **DOI**. Paste it after `https://doi.org/` — for example, `https://doi.org/10.2307/2389612` — which redirects to the publisher's page. If there's no DOI, search the **title** (in quotes) in Google Scholar or the library catalog.

Try these sources, in roughly this order:

1. **Open-access version** — Google Scholar often shows a `[PDF]` link on the right; Unpaywall or the journal itself may host a free version. Always prefer a legitimate free copy.
2. **Our institutional library / subscriptions** — log in through the library portal and download directly.
3. **Interlibrary loan (ILL)** — for anything the library doesn't hold. This can take a few days; mark the row and move on while you wait.
4. **Preprint / repository version** — arXiv, bioRxiv, or the author's institutional repository sometimes host an accepted manuscript.
5. **Author request** — for older or hard-to-find papers, emailing the corresponding author is normal and often works.

### Step 2 — Download the PDF
Save the actual PDF file (not the HTML page). Confirm it's the right paper and that it's a real PDF, not a "you don't have access" placeholder page.

### Step 3 — Rename it exactly
Rename the file to match the `suggested_filename` column — e.g., `pub_2764.pdf`. This is the single most important step. The number must match the row's `id`.

### Step 4 — Drop it in the staging folder
Move the renamed file into the appropriate Google Drive folder:

```
BreckheimerLab2026/TeamMembers/SoleAgulla/pdfs_to_upload
```

All acquired PDFs for a batch go here together.

### Step 5 — Update the CSV row
- `source_description`: where you got it (e.g., "UC Davis library", "ILL", "author email", "OA via journal"). This gets recorded with the paper, so be specific.
- `status`: `found` once you've downloaded and staged it.
- For papers you **can't** get: set `status` to `not found` or `paywalled`, add a `notes` line if helpful, and move on. That's a perfectly normal outcome — don't spend forever on a single paper.

**Save the CSV** when you're done with a batch (keep it as a `.csv`, not `.xlsx`).

### Tips
- Batch in chunks of ~20–30 papers, then run the ingest (Part B) so you get feedback and can catch problems early.
- If a title in the list looks like a duplicate of another, don't acquire it twice — note it and flag it for review.
- ILL requests can run in parallel: fire off a batch of requests, then keep working down the list while they arrive.

---

## Part B — Ingesting the PDFs

Once you've staged a batch and updated the CSV, the PDFs get processed by the ingest tool. *(Depending on how your environment is set up, you may run this yourself, or hand the batch to whoever maintains the system. Confirm which with your supervisor — it needs the local database and the text-extraction tools installed.)*

### Step 1 — Dry run first (no changes made)
This validates filenames, confirms each paper exists, and checks the files are real PDFs — without writing anything:

```bash
npx tsx scripts/ingest-manual-pdfs.ts --worklist=scripts/output/pdf-worklist.csv --dry-run
```

Read the output. Fix anything it flags (usually a misnamed file or a non-PDF), then proceed.

### Step 2 — Real run
```bash
npx tsx scripts/ingest-manual-pdfs.ts --worklist=scripts/output/pdf-worklist.csv
```

For each PDF, the tool will:
- match it to the right publication by filename,
- extract the full text (using OCR if the PDF is scanned),
- save the text to the database and mark the record as having a **restricted** PDF (so the download button stays hidden),
- record your `source_description` and the acquisition date,
- move the original PDF out of `manual/` into a dated `processed/` archive, and
- append a line to an ingest log.

### Step 3 — Read the summary
At the end you'll see `Succeeded` / `Failed` counts and a list of any failures with reasons. Anything that failed stays put so you can fix and re-run — the tool is safe to run repeatedly.

---

## Part C — Publishing to the live site

The ingest writes to the **local** database. To make the new full text searchable on the public site, the local data is pushed to production:

```bash
npm run sync:push
```

This sends the extracted text and the "restricted" flag to the live database. **The PDF file itself never leaves the local machine** — only the searchable text and metadata are published. *(This step is typically run by the curator/maintainer; check with your supervisor.)*

---

## Verifying it worked

After ingest + sync, pick one paper you added and confirm on the live site (https://rmblknowledgecommons.org):
- Search for a distinctive phrase from inside the paper — it should appear in the results with a snippet.
- Open the paper's detail page — abstract, references, and related works should be there, and there should be **no** "Download PDF" button (that's correct — the file is restricted).

---

## Troubleshooting

| The tool says… | What it means | Fix |
|---|---|---|
| `filename does not match pub_<id>.pdf` | File is misnamed. | Rename to exactly `pub_<number>.pdf` (lowercase, underscore). |
| `id=<n> not found in database` | The number doesn't match any publication. | Double-check the `id` column in the CSV; you may have transposed digits. |
| `not a valid PDF` | The file isn't really a PDF (often a saved HTML "access denied" page). | Re-download the actual PDF; confirm it opens in a PDF reader. |
| `extracted text too short` | The PDF is likely image-only and OCR couldn't read it, or it's nearly blank. | Try a cleaner copy of the PDF; flag for review if none exists. |

---

## Quick reference

- **Worklist CSV:** `scripts/output/pdf-worklist.csv` (200 papers, highest priority first)
- **Where PDFs go:** `scripts/output/pdf-staging/manual/`
- **Naming:** `pub_<id>.pdf` — must match the `id` column
- **Dry run:** `npx tsx scripts/ingest-manual-pdfs.ts --worklist=scripts/output/pdf-worklist.csv --dry-run`
- **Ingest:** same command without `--dry-run`
- **Publish:** `npm run sync:push`
- **Never:** rename inconsistently, use pirate sources, or share the acquired PDFs externally.

When you finish this batch of 200, a fresh, longer worklist can be generated — just ask, and a new `pdf-worklist.csv` will be produced from the current priorities.
