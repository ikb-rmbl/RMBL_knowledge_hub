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
 *   5. Update relatedPublications field on matched datasets in Payload
 *
 * Usage:
 *   npx tsx scripts/crosslink-datasets.ts [--dry-run] [--limit=N]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { ensureAuth, patchRecord, getAllPaginated, checkServer } from './lib/payload-client.js'
import { OUTPUT_DIR, STAGING_DIR } from './lib/config.js'
import type { NormalizedDataset } from './lib/types.js'

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

  // Load existing datasets for DOI matching
  const datasets: NormalizedDataset[] = existsSync(`${OUTPUT_DIR}/data-catalog-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
    : []
  const datasetsByDoi = new Map<string, NormalizedDataset>()
  for (const ds of datasets) {
    if (ds.doi) datasetsByDoi.set(ds.doi, ds)
  }
  console.log(`\n${datasets.length} datasets loaded (${datasetsByDoi.size} with DOI)`)

  // Load normalized publications for source ID → title mapping
  const pubs: any[] = existsSync(`${OUTPUT_DIR}/publications-normalized.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
    : []
  const pubById = new Map(pubs.map((p: any) => [p._sourceId, p]))

  // Scan publication text files
  const textDir = join(STAGING_DIR, 'publications')
  if (!existsSync(textDir)) {
    console.error('No publication text directory at', textDir)
    return
  }

  const txtFiles = readdirSync(textDir).filter((f) => f.endsWith('.txt'))
  console.log(`${txtFiles.length} publication text files to scan`)

  // Track all discovered links
  const links: { pubSourceId: string; pubTitle: string; datasetDoi: string; datasetTitle: string; matched: boolean }[] = []
  const unmatchedDois = new Map<string, number>() // DOI → count of publications referencing it
  let pubsWithRefs = 0

  const candidates = txtFiles.slice(0, limit)

  for (let i = 0; i < candidates.length; i++) {
    const filename = candidates[i]
    const sourceId = filename.replace('pub_', '').replace('.txt', '')
    const pub = pubById.get(sourceId)
    if (!pub) continue

    const textPath = join(textDir, filename)
    const text = readFileSync(textPath, 'utf-8')
    const refs = extractDatasetRefs(text)

    if (refs.length === 0) continue
    pubsWithRefs++

    for (const ref of refs) {
      if (ref.doi) {
        const matchedDataset = datasetsByDoi.get(ref.doi)
        if (matchedDataset) {
          links.push({
            pubSourceId: sourceId,
            pubTitle: pub.title,
            datasetDoi: ref.doi,
            datasetTitle: matchedDataset.title,
            matched: true,
          })
        } else {
          links.push({
            pubSourceId: sourceId,
            pubTitle: pub.title,
            datasetDoi: ref.doi,
            datasetTitle: '(unmatched)',
            matched: false,
          })
          unmatchedDois.set(ref.doi, (unmatchedDois.get(ref.doi) || 0) + 1)
        }
      }
    }

    if ((i + 1) % 200 === 0) {
      process.stdout.write(`\r  Scanned ${i + 1}/${candidates.length} (${links.length} refs found)`)
    }
  }
  console.log(`\r  Scanned ${candidates.length} publications`)

  // Summary
  const matchedLinks = links.filter((l) => l.matched)
  const unmatchedLinks = links.filter((l) => !l.matched)

  console.log('\n========== Results ==========')
  console.log(`Publications with dataset refs:  ${pubsWithRefs}`)
  console.log(`Total dataset references found:  ${links.length}`)
  console.log(`  Matched to existing datasets:  ${matchedLinks.length}`)
  console.log(`  Unmatched (new datasets?):      ${unmatchedLinks.length}`)
  console.log(`  Unique unmatched DOIs:          ${unmatchedDois.size}`)

  // Show matched links
  if (matchedLinks.length > 0) {
    console.log('\nSample matched links:')
    const uniqueLinks = new Map<string, typeof matchedLinks[0]>()
    for (const l of matchedLinks) {
      uniqueLinks.set(`${l.pubSourceId}-${l.datasetDoi}`, l)
    }
    for (const l of [...uniqueLinks.values()].slice(0, 10)) {
      console.log(`  [Pub] ${l.pubTitle.slice(0, 45)}`)
      console.log(`    → [Data] ${l.datasetTitle.slice(0, 50)} (${l.datasetDoi})`)
    }
  }

  // Show unmatched DOIs (potential new datasets)
  if (unmatchedDois.size > 0) {
    console.log(`\nTop unmatched DOIs (potential new datasets):`)
    const sorted = [...unmatchedDois.entries()].sort((a, b) => b[1] - a[1])
    for (const [doi, count] of sorted.slice(0, 15)) {
      console.log(`  ${doi} (referenced by ${count} publication${count > 1 ? 's' : ''})`)
    }
  }

  // Save results
  const reportPath = `${OUTPUT_DIR}/crosslinks-report.json`
  const report = {
    timestamp: new Date().toISOString(),
    publicationsScanned: candidates.length,
    publicationsWithRefs: pubsWithRefs,
    totalRefs: links.length,
    matchedLinks: matchedLinks.length,
    unmatchedLinks: unmatchedLinks.length,
    uniqueUnmatchedDois: unmatchedDois.size,
    links: matchedLinks.map((l) => ({
      pubSourceId: l.pubSourceId,
      datasetDoi: l.datasetDoi,
    })),
    unmatchedDois: [...unmatchedDois.entries()].sort((a, b) => b[1] - a[1]),
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport: ${reportPath}`)

  // Update Payload if not dry run
  if (!dryRun && matchedLinks.length > 0) {
    const serverUp = await checkServer()
    if (!serverUp) {
      console.log('\nPayload server not running — skipping database updates.')
      console.log('Start the server and re-run to update relatedPublications.')
      return
    }

    await ensureAuth()

    // Build dataset DOI → list of publication Payload IDs
    console.log('\nLoading Payload IDs for linking...')
    const payloadPubs = await getAllPaginated('publications')
    const pubPayloadByTitle = new Map(payloadPubs.map((p: any) => [p.title, String(p.id)]))

    const payloadDatasets = await getAllPaginated('datasets')
    const datasetPayloadByTitle = new Map(payloadDatasets.map((d: any) => [d.title, { id: String(d.id), existing: (d.relatedPublications || []).map((p: any) => String(typeof p === 'object' ? p.id : p)) }]))

    // Group matched links by dataset
    const linksByDataset = new Map<string, string[]>() // dataset title → pub Payload IDs
    for (const link of matchedLinks) {
      const pub = pubById.get(link.pubSourceId)
      if (!pub) continue
      const pubPayloadId = pubPayloadByTitle.get(pub.title)
      if (!pubPayloadId) continue

      const ds = datasetsByDoi.get(link.datasetDoi)
      if (!ds) continue

      if (!linksByDataset.has(ds.title)) linksByDataset.set(ds.title, [])
      linksByDataset.get(ds.title)!.push(pubPayloadId)
    }

    let updated = 0
    for (const [dsTitle, pubIds] of linksByDataset) {
      const dsPayload = datasetPayloadByTitle.get(dsTitle)
      if (!dsPayload) continue

      // Merge with existing relatedPublications
      const allPubIds = [...new Set([...dsPayload.existing, ...pubIds])].map(Number)
      if (allPubIds.length === dsPayload.existing.length) continue // no new links

      const ok = await patchRecord('datasets', dsPayload.id, {
        relatedPublications: allPubIds,
      })
      if (ok) updated++
    }

    console.log(`\nUpdated ${updated} datasets with relatedPublications links`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
