/**
 * Publication↔Dataset Cross-Linking
 *
 * Scans extracted publication full text for dataset references (DOIs,
 * repository URLs) and creates links between publications and datasets
 * in the Knowledge Commons.
 *
 * For each publication with extracted text:
 *   1. Find dataset DOIs in the text
 *   2. Find repository URLs (ESS-DIVE, Dryad, Zenodo, EDI, etc.)
 *   3. Match against existing datasets by DOI
 *   4. Report unmatched DOIs (potential new datasets to ingest)
 *   5. Add datasets_rels relatedPublications rows (direct SQL, additive — no dev server)
 *
 * Usage:
 *   npx tsx scripts/crosslink-datasets.ts [--dry-run] [--limit=N]
 */

import { writeFileSync } from 'fs'
import pg from 'pg'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

// ---------------------------------------------------------------------------
// DOI and URL patterns for dataset references
// ---------------------------------------------------------------------------

// Dataset DOI prefixes from major repositories
const DATASET_DOI_RE = /\b(10\.(?:5061|6073|15485|5281|7280|21952|5066|25921|6084|5067|7910|7916|3334|17632)\/[^\s,;)"\u200B\u200C]+)/g

// General DOI pattern (catches any DOI in text)
const ANY_DOI_RE = /\b(10\.\d{4,}\/[^\s,;)"\u200B\u200C]+)/g

// Repository URL patterns
const REPO_URL_RE = /https?:\/\/(?:data\.ess-dive\.lbl\.gov|ess-dive\.lbl\.gov|datadryad\.org|zenodo\.org|portal\.edirepository\.org|www\.sciencebase\.gov|figshare\.com|doi\.org\/10\.(?:5061|6073|15485|5281|7280|21952|5066|25921|6084))[^\s,;)"'<>]*/gi

// ---------------------------------------------------------------------------
// Extract dataset references from text
// ---------------------------------------------------------------------------

interface DatasetRef {
  doi: string | null
  url: string | null
  source: string // 'doi' | 'url'
}

function extractDatasetRefs(text: string): DatasetRef[] {
  const refs = new Map<string, DatasetRef>() // dedupe by DOI

  // Find dataset-specific DOIs
  const doiMatches = text.matchAll(DATASET_DOI_RE)
  for (const match of doiMatches) {
    let doi = match[1].replace(/[.,;)\u200B\u200C\u200D]+$/, '').replace(/\u200B/g, '')
    // Clean common artifacts
    doi = doi.replace(/\.$/, '').replace(/\)$/, '')
    if (doi.length > 10) {
      refs.set(doi, { doi, url: `https://doi.org/${doi}`, source: 'doi' })
    }
  }

  // Find repository URLs and extract DOIs from them
  const urlMatches = text.matchAll(REPO_URL_RE)
  for (const match of urlMatches) {
    const url = match[0].replace(/[.,;)"']+$/, '')
    // Try to extract DOI from the URL
    const doiMatch = url.match(/10\.\d{4,}\/[^\s,;)"']+/)
    if (doiMatch) {
      const doi = doiMatch[0].replace(/[.,;)]+$/, '')
      if (!refs.has(doi)) {
        refs.set(doi, { doi, url, source: 'url' })
      }
    } else if (!refs.has(url)) {
      refs.set(url, { doi: null, url, source: 'url' })
    }
  }

  return [...refs.values()]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Publication↔Dataset Cross-Linking')
  console.log('=================================')
  if (dryRun) console.log('(DRY RUN)')

  // Everything comes from the database. The previous version read staged text
  // files named pub_<Payload id>.txt but looked those ids up as legacy source
  // ids (publications-normalized.json), attaching each DOI to an unrelated paper,
  // and matched against a stale datasets JSON (fixed 2026-09-28).
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  try {
    const { rows: datasets } = await db.query<{ id: number; title: string; doi: string }>(
      `SELECT id, title, lower(doi) AS doi FROM datasets WHERE doi IS NOT NULL AND doi <> ''`,
    )
    const datasetsByDoi = new Map(datasets.map((d) => [d.doi, d]))
    console.log(`\n${datasets.length} datasets with a DOI`)

    const { rows: pubs } = await db.query<{ id: number; title: string; full_text: string }>(
      `SELECT id, title, full_text FROM publications
        WHERE full_text ~ '10\\.\\d{4,}/' OR full_text ~* '(ess-dive|datadryad|zenodo|edirepository|sciencebase|figshare)'
        ORDER BY id ${Number.isFinite(limit) ? `LIMIT ${limit}` : ''}`,
    )
    console.log(`${pubs.length} publications with DOI/repository mentions in their full text`)

    const matched: { pubId: number; pubTitle: string; datasetId: number; datasetTitle: string; doi: string }[] = []
    const unmatchedDois = new Map<string, number>()
    let pubsWithRefs = 0
    for (const pub of pubs) {
      const refs = extractDatasetRefs(pub.full_text).filter((r) => r.doi)
      if (refs.length === 0) continue
      pubsWithRefs++
      for (const ref of refs) {
        const doi = ref.doi!.toLowerCase()
        const ds = datasetsByDoi.get(doi)
        if (ds) matched.push({ pubId: pub.id, pubTitle: pub.title, datasetId: ds.id, datasetTitle: ds.title, doi })
        else unmatchedDois.set(doi, (unmatchedDois.get(doi) || 0) + 1)
      }
    }

    let inserted = 0, already = 0
    for (const m of matched) {
      const { rows } = await db.query(
        `SELECT 1 FROM datasets_rels WHERE parent_id = $1 AND publications_id = $2 AND path = 'relatedPublications'`,
        [m.datasetId, m.pubId],
      )
      if (rows.length) { already++; continue }
      inserted++
      console.log(`  [Pub ${m.pubId}] ${m.pubTitle.slice(0, 50)}\n    → [Data ${m.datasetId}] ${m.datasetTitle.slice(0, 55)} (${m.doi})`)
      if (!dryRun) {
        await db.query(
          `INSERT INTO datasets_rels (parent_id, publications_id, path, "order")
           VALUES ($1, $2, 'relatedPublications',
                   coalesce((SELECT max("order") FROM datasets_rels WHERE parent_id = $1), 0) + 1)`,
          [m.datasetId, m.pubId],
        )
      }
    }

    console.log('\n========== Results ==========')
    console.log(`Publications with dataset DOIs:  ${pubsWithRefs}`)
    console.log(`Matched to existing datasets:    ${matched.length} (${inserted} new${dryRun ? ' — not written' : ''}, ${already} already linked)`)
    console.log(`Unique unmatched DOIs:           ${unmatchedDois.size}`)
    const top = [...unmatchedDois.entries()].sort((a, b) => b[1] - a[1])
    if (top.length) console.log(`Top unmatched (potential new datasets): ${top.slice(0, 10).map(([d, n]) => `${d} (${n})`).join(', ')}`)

    writeFileSync(`${OUTPUT_DIR}/crosslinks-report.json`, JSON.stringify({
      timestamp: new Date().toISOString(),
      publicationsScanned: pubs.length,
      publicationsWithRefs: pubsWithRefs,
      links: matched.map((m) => ({ publicationId: m.pubId, datasetId: m.datasetId, doi: m.doi })),
      unmatchedDois: top,
    }, null, 2))
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
