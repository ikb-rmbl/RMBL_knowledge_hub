/**
 * PDF Pipeline Manifest — central state tracker for all PDF processing stages.
 *
 * Each document/publication gets one entry keyed by a stable ID ("doc:{postId}"
 * or "pub:{sourceId}"). The manifest tracks progress through download, extraction,
 * cleaning, and loading stages, making the entire pipeline resumable.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = join(__dirname, '..', 'output')
const MANIFEST_PATH = join(OUTPUT_DIR, 'pdf-manifest.json')
const STAGING_DIR = join(OUTPUT_DIR, 'pdf-staging')

export { STAGING_DIR }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  id: string // "doc:1234" or "pub:5678"
  collection: 'documents' | 'publications'
  title: string
  pdfUrl: string | null // source PDF URL
  localPath: string | null // path in staging dir after download
  downloadStatus: 'pending' | 'downloaded' | 'failed' | 'skipped'
  downloadError: string | null
  fileSizeBytes: number | null
  extractionMethod: 'digital' | 'ocr' | 'mixed' | null
  extractionStatus: 'pending' | 'extracted' | 'failed'
  extractionError: string | null
  qualityScore: number | null // 0-1
  needsReview: boolean
  reviewReason: string | null
  textLength: number | null // chars of extracted text
  cleanedTextLength: number | null
  loadedToPayload: boolean
  lastUpdated: string // ISO timestamp
}

export type Manifest = Map<string, ManifestEntry>

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) return new Map()
  const data: Record<string, ManifestEntry> = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  return new Map(Object.entries(data))
}

export function saveManifest(manifest: Manifest): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const obj: Record<string, ManifestEntry> = Object.fromEntries(manifest)
  writeFileSync(MANIFEST_PATH, JSON.stringify(obj, null, 2))
}

// ---------------------------------------------------------------------------
// Initialization — build manifest from normalized data
// ---------------------------------------------------------------------------

export function initManifest(): Manifest {
  const manifest = loadManifest()
  let added = 0

  // Sustainable Library documents
  const docsPath = join(OUTPUT_DIR, 'sustainable-library-normalized.json')
  if (existsSync(docsPath)) {
    const docs: any[] = JSON.parse(readFileSync(docsPath, 'utf-8'))
    for (const doc of docs) {
      const id = `doc:${doc._sourcePostId}`
      if (!manifest.has(id)) {
        manifest.set(id, createEntry(id, 'documents', doc.title, doc.sourceFile))
        added++
      }
    }
  }

  // Publications
  const pubsPath = join(OUTPUT_DIR, 'publications-normalized.json')
  if (existsSync(pubsPath)) {
    const pubs: any[] = JSON.parse(readFileSync(pubsPath, 'utf-8'))
    for (const pub of pubs) {
      const id = `pub:${pub._sourceId}`
      if (!manifest.has(id)) {
        manifest.set(id, createEntry(id, 'publications', pub.title, pub.pdfLink))
        added++
      }
    }
  }

  if (added > 0) {
    saveManifest(manifest)
  }

  return manifest
}

function createEntry(
  id: string,
  collection: 'documents' | 'publications',
  title: string,
  pdfUrl: string | null,
): ManifestEntry {
  return {
    id,
    collection,
    title,
    pdfUrl: pdfUrl || null,
    localPath: null,
    downloadStatus: pdfUrl ? 'pending' : 'skipped',
    downloadError: null,
    fileSizeBytes: null,
    extractionMethod: null,
    extractionStatus: 'pending',
    extractionError: null,
    qualityScore: null,
    needsReview: false,
    reviewReason: null,
    textLength: null,
    cleanedTextLength: null,
    loadedToPayload: false,
    lastUpdated: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getByStatus(
  manifest: Manifest,
  stage: 'download' | 'extraction',
  status: string,
): ManifestEntry[] {
  return [...manifest.values()].filter((e) => {
    if (stage === 'download') return e.downloadStatus === status
    if (stage === 'extraction') return e.extractionStatus === status
    return false
  })
}

export function getByCollection(manifest: Manifest, collection: string): ManifestEntry[] {
  return [...manifest.values()].filter((e) => e.collection === collection)
}

export function printStats(manifest: Manifest): void {
  const entries = [...manifest.values()]
  const total = entries.length
  const byCollection = { documents: 0, publications: 0 }
  const download = { pending: 0, downloaded: 0, failed: 0, skipped: 0 }
  const extraction = { pending: 0, extracted: 0, failed: 0 }
  const methods = { digital: 0, ocr: 0, mixed: 0 }

  for (const e of entries) {
    byCollection[e.collection]++
    download[e.downloadStatus]++
    extraction[e.extractionStatus]++
    if (e.extractionMethod) methods[e.extractionMethod]++
  }

  const needsReview = entries.filter((e) => e.needsReview).length
  const loaded = entries.filter((e) => e.loadedToPayload).length

  console.log(`\nManifest: ${total} entries`)
  console.log(`  Documents: ${byCollection.documents}, Publications: ${byCollection.publications}`)
  console.log(`\n  Download: ${download.downloaded} done, ${download.pending} pending, ${download.failed} failed, ${download.skipped} skipped`)
  console.log(`  Extraction: ${extraction.extracted} done, ${extraction.pending} pending, ${extraction.failed} failed`)
  if (methods.digital + methods.ocr + methods.mixed > 0) {
    console.log(`  Methods: ${methods.digital} digital, ${methods.ocr} OCR, ${methods.mixed} mixed`)
  }
  if (needsReview > 0) console.log(`  Needs review: ${needsReview}`)
  if (loaded > 0) console.log(`  Loaded to Payload: ${loaded}`)
}
