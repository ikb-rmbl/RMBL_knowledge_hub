/**
 * ORCID Enrichment for Publication Authors
 *
 * Matches publication authors against the ORCID registry harvested from
 * DataCite dataset metadata. Updates author ORCID fields in the normalized
 * publications data and optionally in Payload.
 *
 * Matching strategy (conservative to avoid false positives):
 *   1. Exact last name match
 *   2. Given name initial match (first letter)
 *   3. For ambiguous matches (common last names), require 2+ initial match
 *
 * Usage:
 *   npx tsx scripts/enrich-orcids.ts [--dry-run] [--update-payload]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'
import { ensureAuth, getAllPaginated, patchRecord, checkServer } from './lib/payload-client.js'
import type { NormalizedPublication } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const updatePayload = args.includes('--update-payload')

interface OrcidEntry {
  name: string
  orcid: string
  affiliation: string | null
  source: string
}

// ---------------------------------------------------------------------------
// Build ORCID lookup index
// ---------------------------------------------------------------------------

interface OrcidCandidate {
  orcid: string
  givenName: string
  familyName: string
  affiliation: string | null
}

function buildOrcidIndex(entries: OrcidEntry[]): Map<string, OrcidCandidate[]> {
  const index = new Map<string, OrcidCandidate[]>()

  for (const entry of entries) {
    let familyName: string
    let givenName: string

    if (entry.name.includes(',')) {
      // "LastName, FirstName" format
      const parts = entry.name.split(',')
      familyName = parts[0].trim()
      givenName = parts.slice(1).join(',').trim()
    } else {
      // "FirstName LastName" format
      const parts = entry.name.trim().split(/\s+/)
      familyName = parts[parts.length - 1]
      givenName = parts.slice(0, -1).join(' ')
    }

    const key = familyName.toLowerCase()
    if (!index.has(key)) index.set(key, [])
    index.get(key)!.push({
      orcid: entry.orcid,
      givenName,
      familyName,
      affiliation: entry.affiliation,
    })
  }

  return index
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

function matchAuthorToOrcid(
  authorFamily: string,
  authorGiven: string,
  index: Map<string, OrcidCandidate[]>,
): OrcidCandidate | null {
  const key = authorFamily.toLowerCase()
  const candidates = index.get(key)
  if (!candidates || candidates.length === 0) return null

  // Extract initials from the author's given name
  // "J. A." -> ["J", "A"], "R. W. H." -> ["R", "W", "H"], "John" -> ["J"]
  const authorInitials = authorGiven
    .replace(/\./g, ' ')
    .trim()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase())
    .filter(Boolean)

  if (authorInitials.length === 0) {
    // No given name — only match if there's exactly one candidate for this surname
    return candidates.length === 1 ? candidates[0] : null
  }

  // Score each candidate
  let bestMatch: OrcidCandidate | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    const candidateInitials = candidate.givenName
      .replace(/\./g, ' ')
      .trim()
      .split(/\s+/)
      .map((p) => p.charAt(0).toUpperCase())
      .filter(Boolean)

    if (candidateInitials.length === 0) continue

    // First initial must match
    if (authorInitials[0] !== candidateInitials[0]) continue

    // Count matching initials
    let matchCount = 0
    for (let i = 0; i < Math.min(authorInitials.length, candidateInitials.length); i++) {
      if (authorInitials[i] === candidateInitials[i]) matchCount++
      else break
    }

    // Score: more matching initials = better
    const score = matchCount / Math.max(authorInitials.length, candidateInitials.length)

    if (score > bestScore) {
      bestScore = score
      bestMatch = candidate
    }
  }

  // Require at least first initial match
  // For ambiguous cases (multiple candidates with same last name), require 2+ initials
  if (bestMatch) {
    if (candidates.length === 1 && bestScore > 0) return bestMatch
    if (candidates.length > 1 && bestScore >= 0.5) return bestMatch
  }

  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('ORCID Enrichment for Publication Authors')
  console.log('========================================')
  if (dryRun) console.log('(DRY RUN)')

  // Load ORCID registry
  const orcidPath = `${OUTPUT_DIR}/orcids-harvested.json`
  if (!existsSync(orcidPath)) {
    console.error('No ORCID registry found. Run discover-datasets-datacite.ts first.')
    process.exit(1)
  }
  const orcidEntries: OrcidEntry[] = JSON.parse(readFileSync(orcidPath, 'utf-8'))
  const orcidIndex = buildOrcidIndex(orcidEntries)
  console.log(`\nORCID registry: ${orcidEntries.length} entries, ${orcidIndex.size} unique surnames`)

  // Load publications
  const pubsPath = `${OUTPUT_DIR}/publications-normalized.json`
  const pubs: NormalizedPublication[] = JSON.parse(readFileSync(pubsPath, 'utf-8'))
  console.log(`Publications: ${pubs.length}`)

  // Enrich
  let authorsEnriched = 0
  let pubsEnriched = 0
  const enrichedPubs: { sourceId: string; title: string; enrichedAuthors: { name: string; orcid: string }[] }[] = []

  for (const pub of pubs) {
    let pubChanged = false
    const enrichedAuthors: { name: string; orcid: string }[] = []

    for (const author of pub.authors) {
      if (author.orcid) continue // already has ORCID
      if (!author.family) continue

      const match = matchAuthorToOrcid(author.family, author.given, orcidIndex)
      if (match) {
        author.orcid = match.orcid
        authorsEnriched++
        pubChanged = true
        enrichedAuthors.push({ name: `${author.family}, ${author.given}`, orcid: match.orcid })
      }
    }

    if (pubChanged) {
      pubsEnriched++
      enrichedPubs.push({ sourceId: pub._sourceId, title: pub.title, enrichedAuthors })
    }
  }

  console.log(`\nEnriched ${authorsEnriched} authors across ${pubsEnriched} publications`)

  // Save updated publications
  if (!dryRun) {
    writeFileSync(pubsPath, JSON.stringify(pubs, null, 2))
    console.log(`Updated ${pubsPath}`)
  }

  // Show samples
  console.log('\nSample enrichments:')
  for (const ep of enrichedPubs.slice(0, 10)) {
    console.log(`  ${ep.title.slice(0, 50)}`)
    for (const a of ep.enrichedAuthors) {
      console.log(`    ${a.name} -> ${a.orcid}`)
    }
  }

  // Optionally update Payload
  if (updatePayload && !dryRun) {
    const serverUp = await checkServer()
    if (!serverUp) {
      console.log('\nPayload server not running — skipping database updates.')
      return
    }

    await ensureAuth()
    console.log('\nUpdating Payload...')

    const payloadPubs = await getAllPaginated('publications')
    const pubByTitle = new Map(payloadPubs.map((p: any) => [p.title, p]))

    let updated = 0
    for (const ep of enrichedPubs) {
      const payloadPub = pubByTitle.get(ep.title) as any
      if (!payloadPub) continue

      // Merge ORCIDs into existing authors array
      const authors = payloadPub.authors || []
      let changed = false
      for (const enriched of ep.enrichedAuthors) {
        const [family, given] = enriched.name.split(', ')
        const match = authors.find((a: any) => a.family === family && (!given || a.given?.startsWith(given.charAt(0))))
        if (match && !match.orcid) {
          match.orcid = enriched.orcid
          changed = true
        }
      }

      if (changed) {
        const ok = await patchRecord('publications', payloadPub.id, { authors })
        if (ok) updated++
      }
    }

    console.log(`Updated ${updated} publications in Payload`)
  }

  // Summary stats
  const totalWithOrcid = pubs.reduce((n, p) => n + p.authors.filter((a) => a.orcid).length, 0)
  const totalAuthors = pubs.reduce((n, p) => n + p.authors.length, 0)
  console.log(`\n========== Summary ==========`)
  console.log(`Authors with ORCID:  ${totalWithOrcid} / ${totalAuthors} (${(totalWithOrcid / totalAuthors * 100).toFixed(1)}%)`)
  console.log(`Publications touched: ${pubsEnriched}`)
  console.log(`New ORCIDs assigned:  ${authorsEnriched}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
