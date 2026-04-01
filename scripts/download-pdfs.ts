/**
 * PDF Download Script — Stage 1 of the PDF pipeline.
 *
 * Downloads PDFs to a local staging directory. Uses the manifest for
 * resumability — already-downloaded files are skipped.
 *
 * Usage:
 *   npx tsx scripts/download-pdfs.ts [--collection=documents|publications] [--limit=N] [--retry-failed] [--concurrency=N]
 */

import { mkdirSync, existsSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { Writable } from 'stream'
import { createWriteStream } from 'fs'
import {
  initManifest,
  saveManifest,
  getByStatus,
  getByCollection,
  printStats,
  STAGING_DIR,
  type Manifest,
  type ManifestEntry,
} from './lib/pdf-manifest.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || ''
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const retryFailed = args.includes('--retry-failed')
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))?.split('=')[1]
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg) : 5
const DELAY_MS = 100

// ---------------------------------------------------------------------------
// Download logic
// ---------------------------------------------------------------------------

async function downloadPdf(entry: ManifestEntry): Promise<void> {
  if (!entry.pdfUrl) {
    entry.downloadStatus = 'skipped'
    entry.lastUpdated = new Date().toISOString()
    return
  }

  // Determine local file path
  const ext = '.pdf'
  const idPart = entry.id.replace(':', '_') // "doc:1234" -> "doc_1234"
  const subdir = entry.collection === 'documents' ? 'documents' : 'publications'
  const dir = join(STAGING_DIR, subdir)
  mkdirSync(dir, { recursive: true })
  const localPath = join(dir, `${idPart}${ext}`)

  // Skip if already exists on disk
  if (existsSync(localPath)) {
    const stat = statSync(localPath)
    if (stat.size > 0) {
      entry.localPath = localPath
      entry.fileSizeBytes = stat.size
      entry.downloadStatus = 'downloaded'
      entry.lastUpdated = new Date().toISOString()
      return
    }
  }

  try {
    // HEAD check first
    const headRes = await fetch(entry.pdfUrl, { method: 'HEAD', redirect: 'follow' })
    if (!headRes.ok) {
      throw new Error(`HEAD ${headRes.status} ${headRes.statusText}`)
    }

    const contentType = headRes.headers.get('content-type') || ''
    if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      throw new Error(`Not a PDF: content-type=${contentType}`)
    }

    // Download
    const res = await fetch(entry.pdfUrl, { redirect: 'follow' })
    if (!res.ok) {
      throw new Error(`GET ${res.status} ${res.statusText}`)
    }

    if (!res.body) {
      throw new Error('No response body')
    }

    // Stream to file
    const fileStream = createWriteStream(localPath)
    const reader = res.body.getReader()

    let done = false
    while (!done) {
      const { value, done: readerDone } = await reader.read()
      done = readerDone
      if (value) {
        fileStream.write(Buffer.from(value))
      }
    }
    fileStream.end()

    // Wait for file to finish writing
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve)
      fileStream.on('error', reject)
    })

    // Validate magic bytes
    const { readFileSync: readSync } = await import('fs')
    const header = readSync(localPath, { encoding: null }).subarray(0, 5)
    if (header.toString('ascii') !== '%PDF-') {
      throw new Error('Invalid PDF: magic bytes mismatch')
    }

    const stat = statSync(localPath)
    entry.localPath = localPath
    entry.fileSizeBytes = stat.size
    entry.downloadStatus = 'downloaded'
    entry.downloadError = null
  } catch (err: any) {
    entry.downloadStatus = 'failed'
    entry.downloadError = err?.message || String(err)
    // Clean up partial file
    try {
      const { unlinkSync } = await import('fs')
      if (existsSync(localPath)) unlinkSync(localPath)
    } catch {}
  }

  entry.lastUpdated = new Date().toISOString()
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
): Promise<{ success: number; failed: number; skipped: number }> {
  let completed = 0
  let success = 0
  let failed = 0
  let skipped = 0
  const total = items.length

  async function worker(queue: ManifestEntry[]) {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
      if (item.downloadStatus === 'downloaded') success++
      else if (item.downloadStatus === 'failed') failed++
      else if (item.downloadStatus === 'skipped') skipped++
      completed++

      if (completed % 25 === 0 || completed === total) {
        process.stdout.write(
          `\r  ${label}: ${completed}/${total} (${success} ok, ${failed} fail, ${skipped} skip)`,
        )
      }

      // Save manifest periodically for crash safety
      if (completed % 100 === 0) {
        saveManifest(manifest)
      }

      await sleep(DELAY_MS)
    }
  }

  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)),
  )
  console.log()
  return { success, failed, skipped }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('PDF Download — Stage 1')
  console.log('======================')

  mkdirSync(STAGING_DIR, { recursive: true })

  // Initialize manifest from normalized data
  console.log('\nInitializing manifest...')
  const manifest = initManifest()
  printStats(manifest)

  // Select entries to download
  let candidates: ManifestEntry[]

  if (retryFailed) {
    candidates = getByStatus(manifest, 'download', 'failed')
    console.log(`\nRetrying ${candidates.length} failed downloads`)
    for (const e of candidates) {
      e.downloadStatus = 'pending'
      e.downloadError = null
    }
  } else {
    candidates = getByStatus(manifest, 'download', 'pending')
  }

  // Apply collection filter
  if (collectionFilter) {
    candidates = candidates.filter((e) => e.collection === collectionFilter)
    console.log(`\nFiltered to ${collectionFilter}: ${candidates.length} entries`)
  }

  // Apply limit
  if (limit < candidates.length) {
    candidates = candidates.slice(0, limit)
    console.log(`Limited to ${limit} entries`)
  }

  if (candidates.length === 0) {
    console.log('\nNothing to download.')
    printStats(manifest)
    return
  }

  console.log(`\nDownloading ${candidates.length} PDFs (concurrency: ${CONCURRENCY})...`)
  const { success, failed, skipped } = await runConcurrent(
    candidates,
    CONCURRENCY,
    downloadPdf,
    manifest,
    'Download',
  )

  // Final save
  saveManifest(manifest)

  console.log(`\nComplete: ${success} downloaded, ${failed} failed, ${skipped} skipped`)

  // Show failed entries
  if (failed > 0) {
    const failedEntries = candidates.filter((e) => e.downloadStatus === 'failed').slice(0, 10)
    console.log(`\nFirst ${Math.min(failed, 10)} failures:`)
    for (const e of failedEntries) {
      console.log(`  ${e.id}: ${e.downloadError}`)
    }
  }

  printStats(manifest)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
