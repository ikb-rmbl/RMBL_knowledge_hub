/**
 * Text Extraction Script — Stage 2 of the PDF pipeline.
 *
 * Extracts text from downloaded PDFs using digital extraction (pdf-parse)
 * with OCR fallback (system tesseract + pdftoppm). Stores extracted text
 * as .txt files alongside the PDFs.
 *
 * Usage:
 *   npx tsx scripts/extract-text.ts [--collection=documents|publications] [--limit=N] [--retry-failed] [--concurrency=N]
 */

import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import {
  loadManifest,
  saveManifest,
  printStats,
  type Manifest,
  type ManifestEntry,
} from './lib/pdf-manifest.js'
import { extractText, checkTools } from './lib/pdf-extract.js'

const args = process.argv.slice(2)
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || ''
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const retryFailed = args.includes('--retry-failed')
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))?.split('=')[1]
// OCR is CPU-heavy, so default to lower concurrency
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg) : 2

// ---------------------------------------------------------------------------
// Process one entry
// ---------------------------------------------------------------------------

async function processEntry(entry: ManifestEntry): Promise<void> {
  if (!entry.localPath || !existsSync(entry.localPath)) {
    entry.extractionStatus = 'failed'
    entry.extractionError = 'PDF not downloaded'
    entry.lastUpdated = new Date().toISOString()
    return
  }

  try {
    const result = await extractText(entry.localPath)

    // Save extracted text as .txt alongside the PDF
    const textPath = entry.localPath.replace(/\.pdf$/i, '.txt')
    writeFileSync(textPath, result.text)

    entry.extractionMethod = result.method
    entry.extractionStatus = 'extracted'
    entry.extractionError = null
    entry.qualityScore = result.qualityScore
    entry.needsReview = result.needsReview
    entry.reviewReason = result.reviewReason
    entry.textLength = result.text.length
    entry.lastUpdated = new Date().toISOString()
  } catch (err: any) {
    entry.extractionStatus = 'failed'
    entry.extractionError = err?.message || String(err)
    entry.lastUpdated = new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

async function runConcurrent(
  items: ManifestEntry[],
  concurrency: number,
  fn: (item: ManifestEntry) => Promise<void>,
  manifest: Manifest,
  label: string,
): Promise<{ extracted: number; failed: number; ocr: number; digital: number }> {
  let completed = 0
  let extracted = 0
  let failed = 0
  let ocr = 0
  let digital = 0
  const total = items.length

  async function worker(queue: ManifestEntry[]) {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
      if (item.extractionStatus === 'extracted') {
        extracted++
        if (item.extractionMethod === 'ocr') ocr++
        else digital++
      } else {
        failed++
      }
      completed++

      if (completed % 10 === 0 || completed === total) {
        process.stdout.write(
          `\r  ${label}: ${completed}/${total} (${digital} digital, ${ocr} OCR, ${failed} fail)`,
        )
      }

      // Save periodically
      if (completed % 25 === 0) {
        saveManifest(manifest)
      }
    }
  }

  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)),
  )
  console.log()
  return { extracted, failed, ocr, digital }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Text Extraction — Stage 2')
  console.log('=========================')

  const tools = checkTools()
  console.log(`\nSystem tools: tesseract=${tools.tesseract ? 'yes' : 'NO'}, pdftoppm=${tools.pdftoppm ? 'yes' : 'NO'}`)
  if (!tools.tesseract || !tools.pdftoppm) {
    console.log('  WARNING: OCR fallback unavailable. Install with: brew install tesseract poppler')
  }

  const manifest = loadManifest()
  if (manifest.size === 0) {
    console.log('Manifest is empty. Run download-pdfs.ts first.')
    return
  }

  // Select entries: downloaded but not yet extracted
  let candidates = [...manifest.values()].filter(
    (e) => e.downloadStatus === 'downloaded' && (e.extractionStatus === 'pending' || (retryFailed && e.extractionStatus === 'failed')),
  )

  if (retryFailed) {
    // Also include previously failed
    const retries = [...manifest.values()].filter(
      (e) => e.downloadStatus === 'downloaded' && e.extractionStatus === 'failed',
    )
    for (const e of retries) {
      e.extractionStatus = 'pending'
      e.extractionError = null
    }
    candidates = [...manifest.values()].filter(
      (e) => e.downloadStatus === 'downloaded' && e.extractionStatus === 'pending',
    )
  }

  if (collectionFilter) {
    candidates = candidates.filter((e) => e.collection === collectionFilter)
    console.log(`\nFiltered to ${collectionFilter}: ${candidates.length} entries`)
  }

  if (limit < candidates.length) {
    candidates = candidates.slice(0, limit)
    console.log(`Limited to ${limit} entries`)
  }

  if (candidates.length === 0) {
    console.log('\nNothing to extract.')
    printStats(manifest)
    return
  }

  console.log(`\nExtracting text from ${candidates.length} PDFs (concurrency: ${CONCURRENCY})...`)
  const stats = await runConcurrent(candidates, CONCURRENCY, processEntry, manifest, 'Extract')

  saveManifest(manifest)

  console.log(`\nComplete: ${stats.extracted} extracted (${stats.digital} digital, ${stats.ocr} OCR), ${stats.failed} failed`)

  // Quality summary
  const scores = candidates
    .filter((e) => e.qualityScore !== null)
    .map((e) => e.qualityScore!)
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    const good = scores.filter((s) => s >= 0.8).length
    const ok = scores.filter((s) => s >= 0.5 && s < 0.8).length
    const poor = scores.filter((s) => s < 0.5).length
    console.log(`\nQuality: avg=${avg.toFixed(2)}, good(>=0.8)=${good}, ok(0.5-0.8)=${ok}, poor(<0.5)=${poor}`)
  }

  const needsReview = candidates.filter((e) => e.needsReview)
  if (needsReview.length > 0) {
    console.log(`\n${needsReview.length} entries need review:`)
    for (const e of needsReview.slice(0, 10)) {
      console.log(`  ${e.id}: ${e.reviewReason} (score: ${e.qualityScore?.toFixed(2)})`)
    }
    if (needsReview.length > 10) console.log(`  ... and ${needsReview.length - 10} more`)
  }

  printStats(manifest)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
