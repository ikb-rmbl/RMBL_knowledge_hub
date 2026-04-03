/**
 * Author Deduplication (standalone)
 *
 * Re-runs deduplication on the author registry file.
 * Uses shared logic from lib/author-dedup.ts.
 *
 * Usage:
 *   npx tsx scripts/dedup-authors.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'
import { deduplicateAuthors, type AuthorRecord } from './lib/author-dedup.js'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log('Author Deduplication')
  console.log('====================')
  if (dryRun) console.log('(DRY RUN)')

  const registryPath = `${OUTPUT_DIR}/author-registry.json`
  const authors: AuthorRecord[] = JSON.parse(readFileSync(registryPath, 'utf-8'))
  console.log(`\nLoaded ${authors.length} authors`)

  const { result, orcidMerges, nameMerges } = deduplicateAuthors(authors)

  console.log(`\nORCID merges: ${orcidMerges}`)
  console.log(`Name merges: ${nameMerges}`)
  console.log(`Before: ${authors.length} → After: ${result.length}`)

  if (!dryRun) {
    result.sort((a, b) => a.familyName.localeCompare(b.familyName))
    writeFileSync(registryPath, JSON.stringify(result, null, 2))
    console.log(`Saved to ${registryPath}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
