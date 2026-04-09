/**
 * Ingest Manually-Acquired PDFs
 *
 * Workflow:
 *   1. Technician runs `npx tsx scripts/export-pdf-worklist.ts` to get a CSV
 *   2. Technician finds + downloads PDFs to scripts/output/pdf-staging/manual/
 *      using the suggested_filename pattern (e.g., pub_6497.pdf)
 *   3. Technician fills in `source_description` in the worklist CSV
 *   4. Technician runs this script:
 *        npx tsx scripts/ingest-manual-pdfs.ts --worklist=scripts/output/pdf-worklist.csv
 *
 * For each PDF in the manual/ directory, this script:
 *   - validates filename pattern + PDF magic bytes
 *   - looks up the publication/document in the database
 *   - moves the PDF to the canonical staging path
 *   - extracts text via the existing pdf-extract pipeline
 *   - writes full_text + pdf_restricted=true + pdf_source_description + pdf_acquired_at
 *   - updates the PDF manifest
 *   - moves the source PDF from manual/ to manual/processed/<date>/
 *   - appends to scripts/output/manual-ingest-log.json
 *
 * Usage:
 *   npx tsx scripts/ingest-manual-pdfs.ts [--worklist=path.csv] [--dry-run] [--limit=N]
 */

import pg from 'pg'
import { readdirSync, readFileSync, writeFileSync, statSync, renameSync, mkdirSync, existsSync, appendFileSync } from 'fs'
import { join, basename } from 'path'
import './lib/config.js'
import { OUTPUT_DIR, STAGING_DIR } from './lib/config.js'
import { extractText } from './lib/pdf-extract.js'
import { loadManifest, saveManifest, type ManifestEntry } from './lib/pdf-manifest.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const worklistPath = args.find((a) => a.startsWith('--worklist='))?.split('=')[1]
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

const MANUAL_DIR = join(STAGING_DIR, 'manual')
const PROCESSED_DIR_BASE = join(MANUAL_DIR, 'processed')
const LOG_PATH = join(OUTPUT_DIR, 'manual-ingest-log.json')

interface IngestLogEntry {
  id: string
  collection: 'publications' | 'documents'
  db_id: number
  title: string
  ingested_at: string
  source_description: string
  pdf_size_bytes: number
  extracted_text_length: number
  extraction_method: string
  quality_score: number
}

// ---------------------------------------------------------------------------
// CSV parsing (simple — handles quoted fields)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (ch === ',' && !inQ) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

function loadWorklistDescriptions(path: string): Map<string, string> {
  const result = new Map<string, string>()
  if (!existsSync(path)) return result
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return result
  const header = parseCsvLine(lines[0])
  const idIdx = header.indexOf('id')
  const descIdx = header.indexOf('source_description')
  if (idIdx < 0 || descIdx < 0) {
    console.warn(`  Worklist ${path} is missing 'id' or 'source_description' columns`)
    return result
  }
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const id = fields[idIdx]?.trim()
    const desc = fields[descIdx]?.trim()
    if (id && desc) result.set(id, desc)
  }
  return result
}

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

function parseFilename(filename: string): { collection: 'publications' | 'documents'; id: number } | null {
  const m = filename.match(/^(pub|doc)_(\d+)\.pdf$/i)
  if (!m) return null
  return {
    collection: m[1].toLowerCase() === 'pub' ? 'publications' : 'documents',
    id: parseInt(m[2], 10),
  }
}

// ---------------------------------------------------------------------------
// PDF validation
// ---------------------------------------------------------------------------

function isValidPdf(path: string): boolean {
  try {
    const fd = readFileSync(path)
    return fd.length >= 4 && fd[0] === 0x25 && fd[1] === 0x50 && fd[2] === 0x44 && fd[3] === 0x46
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Ingest Manual PDFs')
  console.log('==================')
  if (dryRun) console.log('(DRY RUN — no DB writes, no file moves)')
  console.log(`Manual directory: ${MANUAL_DIR}`)
  console.log()

  // Ensure manual directory exists
  if (!existsSync(MANUAL_DIR)) {
    mkdirSync(MANUAL_DIR, { recursive: true })
    console.log('Created manual/ directory. Drop PDFs here using the pub_<id>.pdf or doc_<id>.pdf naming convention.')
    return
  }

  // Load worklist descriptions if provided
  let descriptions = new Map<string, string>()
  if (worklistPath) {
    descriptions = loadWorklistDescriptions(worklistPath)
    console.log(`Loaded ${descriptions.size} source descriptions from worklist`)
  }

  // Find candidate PDFs in manual/
  const allFiles = readdirSync(MANUAL_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'))
  if (allFiles.length === 0) {
    console.log(`\nNo PDFs found in ${MANUAL_DIR}`)
    console.log('Drop PDFs in this directory using the pub_<id>.pdf or doc_<id>.pdf naming convention.')
    return
  }

  console.log(`Found ${allFiles.length} candidate PDFs`)
  const candidates = allFiles.slice(0, limit)
  if (candidates.length < allFiles.length) {
    console.log(`(processing first ${limit})`)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  let succeeded = 0
  let failed = 0
  const failures: { file: string; reason: string }[] = []
  const successLog: IngestLogEntry[] = []

  try {
    const manifest = loadManifest()

    for (const filename of candidates) {
      const sourcePath = join(MANUAL_DIR, filename)
      console.log(`\n--- ${filename} ---`)

      // 1. Parse filename
      const parsed = parseFilename(filename)
      if (!parsed) {
        console.log('  SKIP: filename does not match pub_<id>.pdf or doc_<id>.pdf')
        failures.push({ file: filename, reason: 'invalid filename pattern' })
        failed++
        continue
      }
      const { collection, id } = parsed
      const manifestKey = `${collection === 'publications' ? 'pub' : 'doc'}:${id}`

      // 2. Verify the record exists in the database
      const { rows } = await db.query(`SELECT id, title FROM ${collection} WHERE id = $1`, [id])
      if (rows.length === 0) {
        console.log(`  SKIP: ${collection}.id=${id} not found in database`)
        failures.push({ file: filename, reason: `${collection} id=${id} not in DB` })
        failed++
        continue
      }
      const record = rows[0]
      console.log(`  Match: [${collection}:${id}] ${(record.title || '').slice(0, 70)}`)

      // 3. Validate PDF magic bytes
      if (!isValidPdf(sourcePath)) {
        console.log('  SKIP: not a valid PDF (missing %PDF- magic bytes)')
        failures.push({ file: filename, reason: 'invalid PDF magic bytes' })
        failed++
        continue
      }
      const stats = statSync(sourcePath)
      console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`)

      // 4. Resolve source description
      const sourceDescription = descriptions.get(String(id)) || 'manual ingest'
      console.log(`  Source: ${sourceDescription}`)

      if (dryRun) {
        console.log('  (DRY RUN) would extract text and update DB')
        succeeded++
        continue
      }

      // 5. Move PDF to canonical staging path
      const canonicalDir = join(STAGING_DIR, collection)
      mkdirSync(canonicalDir, { recursive: true })
      const canonicalName = `${collection === 'publications' ? 'pub' : 'doc'}_${id}.pdf`
      const canonicalPath = join(canonicalDir, canonicalName)
      try {
        renameSync(sourcePath, canonicalPath)
      } catch (err: any) {
        console.log(`  ERROR: failed to move PDF: ${err.message}`)
        failures.push({ file: filename, reason: `move failed: ${err.message}` })
        failed++
        continue
      }

      // 6. Extract text
      let extraction
      try {
        extraction = await extractText(canonicalPath)
      } catch (err: any) {
        console.log(`  ERROR: text extraction failed: ${err.message}`)
        failures.push({ file: filename, reason: `extraction failed: ${err.message}` })
        failed++
        continue
      }
      if (!extraction.text || extraction.text.length < 100) {
        console.log(`  ERROR: extracted text is too short (${extraction.text?.length || 0} chars)`)
        failures.push({ file: filename, reason: 'extracted text too short' })
        failed++
        continue
      }
      console.log(`  Extracted: ${extraction.text.length} chars (${extraction.method}, quality=${extraction.qualityScore.toFixed(2)})`)

      // 7. Save text file alongside PDF
      const textPath = canonicalPath.replace(/\.pdf$/i, '.txt')
      writeFileSync(textPath, extraction.text)

      // 8. Update database
      try {
        await db.query(
          `UPDATE ${collection}
           SET full_text = $1,
               pdf_restricted = true,
               pdf_source_description = $2,
               pdf_acquired_at = NOW(),
               updated_at = NOW()
           WHERE id = $3`,
          [extraction.text, sourceDescription, id],
        )
      } catch (err: any) {
        console.log(`  ERROR: DB update failed: ${err.message}`)
        failures.push({ file: filename, reason: `DB update failed: ${err.message}` })
        failed++
        continue
      }

      // 9. Update manifest
      const existing = manifest.get(manifestKey)
      const entry: ManifestEntry = {
        id: manifestKey,
        collection,
        title: existing?.title || record.title || '',
        pdfUrl: existing?.pdfUrl || null,
        localPath: canonicalPath,
        downloadStatus: 'downloaded',
        downloadError: null,
        fileSizeBytes: stats.size,
        extractionMethod: extraction.method,
        extractionStatus: 'extracted',
        extractionError: null,
        qualityScore: extraction.qualityScore,
        needsReview: extraction.needsReview,
        reviewReason: extraction.reviewReason,
        textLength: extraction.text.length,
        cleanedTextLength: extraction.text.length,
        loadedToPayload: true,
        lastUpdated: new Date().toISOString(),
      }
      manifest.set(manifestKey, entry)

      // 10. Move source from manual/ to manual/processed/<date>/
      const dateStr = new Date().toISOString().slice(0, 10)
      const processedDir = join(PROCESSED_DIR_BASE, dateStr)
      mkdirSync(processedDir, { recursive: true })
      // The source PDF was already moved to canonical path; copy a marker breadcrumb
      const breadcrumb = join(processedDir, filename + '.processed.txt')
      writeFileSync(
        breadcrumb,
        `Original filename: ${filename}\nIngested: ${new Date().toISOString()}\nMoved to: ${canonicalPath}\nSource: ${sourceDescription}\n`,
      )

      // 11. Append to ingest log
      successLog.push({
        id: manifestKey,
        collection,
        db_id: id,
        title: record.title || '',
        ingested_at: new Date().toISOString(),
        source_description: sourceDescription,
        pdf_size_bytes: stats.size,
        extracted_text_length: extraction.text.length,
        extraction_method: extraction.method,
        quality_score: extraction.qualityScore,
      })

      console.log('  ✓ Ingested')
      succeeded++
    }

    if (!dryRun) {
      saveManifest(manifest)
      // Append to ingest log file (as JSON lines for safe append)
      if (successLog.length > 0) {
        let existing: IngestLogEntry[] = []
        if (existsSync(LOG_PATH)) {
          try {
            existing = JSON.parse(readFileSync(LOG_PATH, 'utf-8'))
          } catch {
            // If file is corrupt, archive it and start fresh
            renameSync(LOG_PATH, LOG_PATH + '.broken-' + Date.now())
          }
        }
        existing.push(...successLog)
        writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2))
      }
    }
  } finally {
    await db.end()
  }

  // Summary
  console.log('\n========== Summary ==========')
  console.log(`Processed: ${candidates.length}`)
  console.log(`Succeeded: ${succeeded}`)
  console.log(`Failed:    ${failed}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  ${f.file}: ${f.reason}`)
    }
  }
  if (!dryRun && successLog.length > 0) {
    console.log(`\nLog: ${LOG_PATH}`)
    console.log(`Manifest updated`)
    console.log(`Source PDFs moved to canonical paths under ${STAGING_DIR}`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
