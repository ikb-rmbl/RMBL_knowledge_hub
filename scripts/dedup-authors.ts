/**
 * Author Deduplication
 *
 * Merges duplicate author entries in the registry. Detects duplicates by:
 *   1. Same ORCID on different records
 *   2. Same family name + matching first initial + one has full name, other has initials
 *   3. Exact name match with different formatting
 *
 * Merges work lists and keeps the best metadata (longest name, ORCID, affiliation).
 *
 * Usage:
 *   npx tsx scripts/dedup-authors.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'

const dryRun = process.argv.includes('--dry-run')

interface AuthorRecord {
  id: string
  displayName: string
  familyName: string
  givenName: string
  orcid: string | null
  affiliation: string | null
  publicationIds: string[]
  datasetIds: string[]
  documentIds: string[]
}

function initialsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  // Extract initials from each
  const getInitials = (s: string) =>
    s.replace(/\./g, ' ').trim().split(/\s+/).map((p) => p.charAt(0).toUpperCase()).filter(Boolean)

  const ai = getInitials(a)
  const bi = getInitials(b)

  if (ai.length === 0 || bi.length === 0) return false

  // First initial must match
  if (ai[0] !== bi[0]) return false

  // Check remaining initials match (as many as the shorter set has)
  const minLen = Math.min(ai.length, bi.length)
  for (let i = 0; i < minLen; i++) {
    if (ai[i] !== bi[i]) return false
  }

  return true
}

function mergeAuthors(primary: AuthorRecord, secondary: AuthorRecord): AuthorRecord {
  const familyName = primary.familyName.length >= secondary.familyName.length ? primary.familyName : secondary.familyName
  const givenName = primary.givenName.length >= secondary.givenName.length ? primary.givenName : secondary.givenName
  return {
    id: primary.orcid || secondary.orcid || primary.id,
    familyName,
    givenName,
    displayName: givenName ? `${givenName} ${familyName}` : familyName,
    orcid: primary.orcid || secondary.orcid,
    affiliation: primary.affiliation || secondary.affiliation,
    publicationIds: [...new Set([...primary.publicationIds, ...secondary.publicationIds])],
    datasetIds: [...new Set([...primary.datasetIds, ...secondary.datasetIds])],
    documentIds: [...new Set([...primary.documentIds, ...secondary.documentIds])],
  }
}

async function main() {
  console.log('Author Deduplication')
  console.log('====================')
  if (dryRun) console.log('(DRY RUN)')

  const registryPath = `${OUTPUT_DIR}/author-registry.json`
  const authors: AuthorRecord[] = JSON.parse(readFileSync(registryPath, 'utf-8'))
  console.log(`\nLoaded ${authors.length} authors`)

  // Phase 1: Merge by ORCID
  console.log('\nPhase 1: Merging by ORCID...')
  const byOrcid = new Map<string, AuthorRecord[]>()
  for (const a of authors) {
    if (a.orcid) {
      if (!byOrcid.has(a.orcid)) byOrcid.set(a.orcid, [])
      byOrcid.get(a.orcid)!.push(a)
    }
  }
  let orcidMerges = 0
  const mergedIds = new Set<string>()
  for (const [orcid, group] of byOrcid) {
    if (group.length > 1) {
      // Merge all into the first
      let primary = group[0]
      for (let i = 1; i < group.length; i++) {
        primary = mergeAuthors(primary, group[i])
        mergedIds.add(group[i].id)
        orcidMerges++
      }
      group[0].displayName = primary.displayName
      group[0].familyName = primary.familyName
      group[0].givenName = primary.givenName
      group[0].orcid = primary.orcid
      group[0].affiliation = primary.affiliation
      group[0].publicationIds = primary.publicationIds
      group[0].datasetIds = primary.datasetIds
      group[0].documentIds = primary.documentIds
    }
  }
  console.log(`  ${orcidMerges} merges by ORCID`)

  // Remove merged entries
  let remaining = authors.filter((a) => !mergedIds.has(a.id))

  // Phase 2: Merge by family name + initials
  console.log('\nPhase 2: Merging by name similarity...')
  const byFamily = new Map<string, AuthorRecord[]>()
  for (const a of remaining) {
    const key = a.familyName.toLowerCase()
    if (!byFamily.has(key)) byFamily.set(key, [])
    byFamily.get(key)!.push(a)
  }

  let nameMerges = 0
  const namesMerged = new Set<string>()
  const mergeLog: string[] = []

  for (const [, group] of byFamily) {
    if (group.length < 2) continue

    for (let i = 0; i < group.length; i++) {
      if (namesMerged.has(group[i].id)) continue

      for (let j = i + 1; j < group.length; j++) {
        if (namesMerged.has(group[j].id)) continue

        const a = group[i]
        const b = group[j]

        // Check if initials match
        if (!initialsMatch(a.givenName, b.givenName)) continue

        // Additional safety: one should have initials, other full name (or both match closely)
        const aIsInitials = a.givenName.replace(/\./g, '').replace(/\s/g, '').length <= 4
        const bIsInitials = b.givenName.replace(/\./g, '').replace(/\s/g, '').length <= 4

        // Skip if both have full (different) given names > 4 chars
        if (!aIsInitials && !bIsInitials) {
          // Both have full names — only merge if very similar
          if (a.givenName.toLowerCase() !== b.givenName.toLowerCase()) continue
        }

        // Merge
        const merged = mergeAuthors(a, b)
        group[i].displayName = merged.displayName
        group[i].familyName = merged.familyName
        group[i].givenName = merged.givenName
        group[i].orcid = merged.orcid
        group[i].affiliation = merged.affiliation
        group[i].publicationIds = merged.publicationIds
        group[i].datasetIds = merged.datasetIds
        group[i].documentIds = merged.documentIds

        namesMerged.add(b.id)
        nameMerges++
        if (mergeLog.length < 20) {
          mergeLog.push(`  ${a.displayName} + ${b.displayName} → ${merged.displayName}`)
        }
      }
    }
  }
  console.log(`  ${nameMerges} merges by name`)

  if (mergeLog.length > 0) {
    console.log('\nSample merges:')
    for (const line of mergeLog) console.log(line)
  }

  // Remove merged entries
  remaining = remaining.filter((a) => !namesMerged.has(a.id))

  // Save
  console.log(`\n========== Results ==========`)
  console.log(`Before: ${authors.length}`)
  console.log(`ORCID merges: ${orcidMerges}`)
  console.log(`Name merges: ${nameMerges}`)
  console.log(`After: ${remaining.length}`)
  console.log(`Reduction: ${authors.length - remaining.length} (${((authors.length - remaining.length) / authors.length * 100).toFixed(1)}%)`)

  if (!dryRun) {
    remaining.sort((a, b) => a.familyName.localeCompare(b.familyName))
    writeFileSync(registryPath, JSON.stringify(remaining, null, 2))
    console.log(`\nSaved to ${registryPath}`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
