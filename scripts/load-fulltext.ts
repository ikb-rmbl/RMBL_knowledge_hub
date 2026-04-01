/**
 * Load extracted full text into Payload CMS.
 *
 * Reads .txt files from the PDF staging directory and updates the
 * corresponding document/publication records in Payload with the
 * fullText field. Also loads abstracts for publications that have
 * them in the normalized data but not in Payload.
 *
 * Usage:
 *   npx tsx scripts/load-fulltext.ts [--collection=documents|publications|all] [--limit=N] [--dry-run]
 *
 * Requires: npm run dev (Payload server running)
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { ensureAuth, patchRecord, getAllPaginated, checkServer } from './lib/payload-client.js'
import { OUTPUT_DIR, STAGING_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const dryRun = args.includes('--dry-run')

async function main() {
  console.log('Load Full Text into Payload')
  console.log('===========================')
  if (dryRun) console.log('(DRY RUN)')

  const serverUp = await checkServer()
  if (!serverUp) {
    console.error('ERROR: Payload dev server not running. Start with: npm run dev')
    process.exit(1)
  }

  await ensureAuth()

  const loadDocs = collectionFilter === 'all' || collectionFilter === 'documents'
  const loadPubs = collectionFilter === 'all' || collectionFilter === 'publications'

  if (loadPubs) await loadPublicationText()
  if (loadDocs) await loadDocumentText()

  console.log('\nDone.')
}

async function loadPublicationText() {
  console.log('\n--- Publications ---')

  const textDir = join(STAGING_DIR, 'publications')
  if (!existsSync(textDir)) {
    console.log('  No text directory found at', textDir)
    return
  }

  // Get all .txt files
  const txtFiles = readdirSync(textDir).filter((f) => f.endsWith('.txt'))
  console.log(`  ${txtFiles.length} text files found`)

  // Load normalized data for abstracts
  const normPath = join(OUTPUT_DIR, 'publications-normalized.json')
  const normalized: any[] = existsSync(normPath)
    ? JSON.parse(readFileSync(normPath, 'utf-8'))
    : []
  const normById = new Map(normalized.map((p) => [p._sourceId, p]))

  // Load Payload publication IDs by title
  console.log('  Loading publication records from Payload...')
  const payloadPubs = await getAllPaginated('publications')
  const payloadByTitle = new Map<string, { id: string; hasFullText: boolean; hasAbstract: boolean }>()
  for (const p of payloadPubs) {
    payloadByTitle.set(p.title, {
      id: String(p.id),
      hasFullText: Boolean(p.fullText),
      hasAbstract: Boolean(p.abstract),
    })
  }
  console.log(`  ${payloadByTitle.size} publications in Payload`)

  // Match text files to Payload records via source ID -> title
  let updated = 0
  let skipped = 0
  let notFound = 0
  let abstracts = 0

  const candidates = txtFiles.slice(0, limit)

  for (let i = 0; i < candidates.length; i++) {
    const filename = candidates[i]
    // pub_12345.txt -> sourceId = 12345
    const sourceId = filename.replace('pub_', '').replace('.txt', '')
    const norm = normById.get(sourceId)
    if (!norm) { notFound++; continue }

    const payloadEntry = payloadByTitle.get(norm.title)
    if (!payloadEntry) { notFound++; continue }

    // Skip if already has fullText
    if (payloadEntry.hasFullText) { skipped++; continue }

    const textPath = join(textDir, filename)
    const fullText = readFileSync(textPath, 'utf-8').trim()
    if (fullText.length < 50) { skipped++; continue }

    const patch: Record<string, unknown> = { fullText }

    // Also add abstract if missing
    if (!payloadEntry.hasAbstract && norm.abstract) {
      patch.abstract = norm.abstract
      abstracts++
    }

    if (!dryRun) {
      const ok = await patchRecord('publications', payloadEntry.id, patch)
      if (ok) updated++
    } else {
      updated++
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} processed, ${updated} updated`)
    }
  }

  console.log(`\r  ${candidates.length} processed: ${updated} updated, ${skipped} skipped, ${notFound} not found, ${abstracts} abstracts added`)
}

async function loadDocumentText() {
  console.log('\n--- Documents ---')

  const textDir = join(STAGING_DIR, 'documents')
  if (!existsSync(textDir)) {
    console.log('  No text directory found at', textDir)
    return
  }

  const txtFiles = readdirSync(textDir).filter((f) => f.endsWith('.txt'))
  console.log(`  ${txtFiles.length} text files found`)

  // Load normalized data for title matching
  const normPath = join(OUTPUT_DIR, 'sustainable-library-normalized.json')
  const normalized: any[] = existsSync(normPath)
    ? JSON.parse(readFileSync(normPath, 'utf-8'))
    : []
  const normById = new Map(normalized.map((d) => [d._sourcePostId, d]))

  // Load Payload document IDs
  console.log('  Loading document records from Payload...')
  const payloadDocs = await getAllPaginated('documents')
  const payloadByTitle = new Map<string, { id: string; hasFullText: boolean }>()
  for (const d of payloadDocs) {
    payloadByTitle.set(d.title, { id: String(d.id), hasFullText: Boolean(d.fullText) })
  }
  console.log(`  ${payloadByTitle.size} documents in Payload`)

  let updated = 0
  let skipped = 0
  let notFound = 0

  const candidates = txtFiles.slice(0, limit)

  for (let i = 0; i < candidates.length; i++) {
    const filename = candidates[i]
    // doc_12345.txt -> sourcePostId = 12345
    const sourceId = filename.replace('doc_', '').replace('.txt', '')
    const norm = normById.get(sourceId)
    if (!norm) { notFound++; continue }

    const payloadEntry = payloadByTitle.get(norm.title)
    if (!payloadEntry) { notFound++; continue }

    if (payloadEntry.hasFullText) { skipped++; continue }

    const textPath = join(textDir, filename)
    const fullText = readFileSync(textPath, 'utf-8').trim()
    if (fullText.length < 50) { skipped++; continue }

    if (!dryRun) {
      const ok = await patchRecord('documents', payloadEntry.id, { fullText })
      if (ok) updated++
    } else {
      updated++
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} processed, ${updated} updated`)
    }
  }

  console.log(`\r  ${candidates.length} processed: ${updated} updated, ${skipped} skipped, ${notFound} not found`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
