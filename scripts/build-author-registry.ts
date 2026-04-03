/**
 * Build Unified Author Registry
 *
 * Extracts authors from all three collections, normalizes name formats,
 * deduplicates by ORCID and name similarity, and creates a unified
 * author registry. Loads into Payload's Authors collection.
 *
 * Sources:
 *   - Publications: structured {given, family, orcid}
 *   - Datasets: mixed-format {name, orcid, affiliation}
 *   - Documents: extracted from summary text ("Author: X", "By X")
 *
 * Usage:
 *   npx tsx scripts/build-author-registry.ts [--dry-run] [--load-payload]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'
import { ensureAuth, createRecord, getAllPaginated, checkServer } from './lib/payload-client.js'
import type { NormalizedPublication, NormalizedDocument } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const loadPayload = args.includes('--load-payload')

// ---------------------------------------------------------------------------
// Unified Author type
// ---------------------------------------------------------------------------

interface AuthorRecord {
  id: string // internal dedup key
  displayName: string
  familyName: string
  givenName: string
  orcid: string | null
  affiliation: string | null
  publicationIds: string[] // source IDs
  datasetIds: string[] // source IDs
  documentIds: string[] // source post IDs
}

// ---------------------------------------------------------------------------
// Name parsing utilities
// ---------------------------------------------------------------------------

function parseCreatorName(name: string): { given: string; family: string } {
  const cleaned = name.trim()
  if (!cleaned) return { given: '', family: '' }

  // "LastName, FirstName" or "LastName, I.N."
  if (cleaned.includes(',')) {
    const [family, ...rest] = cleaned.split(',')
    return { family: family.trim(), given: rest.join(',').trim() }
  }

  // "FirstName LastName" or "F. LastName" or "FirstName MiddleName LastName"
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return { given: '', family: parts[0] }

  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
}

function expandInitials(given: string): string {
  // "J. A." stays as is, "JA" → "J. A.", "J" → "J."
  if (!given) return ''
  // Already expanded
  if (given.includes('.')) return given
  // Single initial
  if (given.length === 1) return given + '.'
  // Multiple initials without dots: "RWH" → "R. W. H."
  if (/^[A-Z]{2,5}$/.test(given)) {
    return given.split('').join('. ') + '.'
  }
  return given
}

function buildDisplayName(given: string, family: string): string {
  if (!given) return family
  // Expand initials for display
  const expanded = expandInitials(given)
  return `${expanded} ${family}`.trim()
}

function normalizeKey(family: string, given: string): string {
  // Lowercase, first initial only — used for dedup grouping
  const f = family.toLowerCase().trim()
  const g = given.charAt(0).toLowerCase()
  return `${f}|${g}`
}

// ---------------------------------------------------------------------------
// Extract authors from documents
// ---------------------------------------------------------------------------

function extractDocumentAuthor(doc: NormalizedDocument): { name: string } | null {
  const summary = doc.summary || ''
  if (!summary) return null

  // Pattern: "Author: Name"
  const authorMatch = summary.match(/Author:\s*([A-Z][a-zA-Z.'\- ]+?)(?:\s+Organization:|\s+Date:|\s*$)/i)
  if (authorMatch) return { name: authorMatch[1].trim() }

  // Pattern: "By Name"
  const byMatch = summary.match(/^By\s+([A-Z][a-zA-Z.'\- ]+?)(?:\s+and\s|\s*\.|\s*$)/i)
  if (byMatch) return { name: byMatch[1].trim() }

  // Pattern: "Name: Organization" at start (newspaper byline)
  const bylineMatch = summary.match(/^([A-Z][a-z]+ [A-Z][a-zA-Z'\-]+)(?:\s*:\s*|\s+of\s+|\s+for\s+)/)
  if (bylineMatch) {
    const name = bylineMatch[1].trim()
    // Avoid matching place names or organizations
    if (name.split(' ').length >= 2 && name.length < 40) return { name }
  }

  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Build Unified Author Registry')
  console.log('=============================')
  if (dryRun) console.log('(DRY RUN)')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Step 1: Extract from Publications
  console.log('\nStep 1: Extracting from Publications...')
  const pubs: NormalizedPublication[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))

  const authorMap = new Map<string, AuthorRecord>()

  for (const pub of pubs) {
    for (const author of pub.authors) {
      if (!author.family) continue

      const key = author.orcid || normalizeKey(author.family, author.given)
      const existing = authorMap.get(key)

      if (existing) {
        if (!existing.publicationIds.includes(pub._sourceId)) {
          existing.publicationIds.push(pub._sourceId)
        }
        // Upgrade: add ORCID if we didn't have one
        if (author.orcid && !existing.orcid) {
          existing.orcid = author.orcid
          // Re-key by ORCID
          const oldKey = normalizeKey(existing.familyName, existing.givenName)
          if (oldKey !== key) authorMap.delete(oldKey)
        }
        // Upgrade: prefer longer given name
        if (author.given.length > existing.givenName.length) {
          existing.givenName = author.given
          existing.displayName = buildDisplayName(author.given, existing.familyName)
        }
      } else {
        authorMap.set(key, {
          id: key,
          displayName: buildDisplayName(author.given, author.family),
          familyName: author.family,
          givenName: author.given,
          orcid: author.orcid || null,
          affiliation: null,
          publicationIds: [pub._sourceId],
          datasetIds: [],
          documentIds: [],
        })
      }
    }
  }
  console.log(`  ${authorMap.size} unique authors from ${pubs.length} publications`)

  // Step 2: Extract from Datasets
  console.log('\nStep 2: Extracting from Datasets...')
  const datasets: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
  let datasetAuthorsAdded = 0

  for (const ds of datasets) {
    for (const creator of ds.creators || []) {
      if (!creator.name || creator.name === 'Unknown' || creator.name === 'RMBL' || creator.name === 'NOAA' || creator.name === 'NOAA NCEI') continue

      const { given, family } = parseCreatorName(creator.name)
      if (!family || family.length < 2) continue

      const orcid = creator.orcid?.replace('https://orcid.org/', '') || null
      const key = orcid || normalizeKey(family, given)
      const existing = authorMap.get(key)

      if (existing) {
        if (!existing.datasetIds.includes(ds._sourceId)) {
          existing.datasetIds.push(ds._sourceId)
        }
        if (orcid && !existing.orcid) existing.orcid = orcid
        if (creator.affiliation && !existing.affiliation) existing.affiliation = creator.affiliation
        if (given.length > existing.givenName.length) {
          existing.givenName = given
          existing.displayName = buildDisplayName(given, existing.familyName)
        }
      } else {
        authorMap.set(key, {
          id: key,
          displayName: buildDisplayName(given, family),
          familyName: family,
          givenName: given,
          orcid,
          affiliation: creator.affiliation || null,
          publicationIds: [],
          datasetIds: [ds._sourceId],
          documentIds: [],
        })
        datasetAuthorsAdded++
      }
    }
  }
  console.log(`  ${datasetAuthorsAdded} new authors from datasets (${authorMap.size} total)`)

  // Step 3: Extract from Documents
  console.log('\nStep 3: Extracting from Documents...')
  const docs: NormalizedDocument[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/sustainable-library-normalized.json`, 'utf-8'))
  let docAuthorsFound = 0
  let docAuthorsNew = 0

  for (const doc of docs) {
    const extracted = extractDocumentAuthor(doc)
    if (!extracted) continue
    docAuthorsFound++

    const { given, family } = parseCreatorName(extracted.name)
    if (!family || family.length < 2) continue

    const key = normalizeKey(family, given)
    const existing = authorMap.get(key)

    if (existing) {
      if (!existing.documentIds.includes(doc._sourcePostId)) {
        existing.documentIds.push(doc._sourcePostId)
      }
    } else {
      authorMap.set(key, {
        id: key,
        displayName: buildDisplayName(given, family),
        familyName: family,
        givenName: given,
        orcid: null,
        affiliation: null,
        publicationIds: [],
        datasetIds: [],
        documentIds: [doc._sourcePostId],
      })
      docAuthorsNew++
    }
  }
  console.log(`  ${docAuthorsFound} authors found in summaries, ${docAuthorsNew} new (${authorMap.size} total)`)

  // Load ORCID registry to enrich affiliations
  const orcidPath = `${OUTPUT_DIR}/orcids-harvested.json`
  if (existsSync(orcidPath)) {
    const orcids: { orcid: string; affiliation: string | null }[] = JSON.parse(readFileSync(orcidPath, 'utf-8'))
    let enriched = 0
    for (const entry of orcids) {
      for (const [, author] of authorMap) {
        if (author.orcid === entry.orcid && !author.affiliation && entry.affiliation) {
          author.affiliation = entry.affiliation
          enriched++
        }
      }
    }
    console.log(`\nEnriched ${enriched} affiliations from ORCID registry`)
  }

  // Convert to array and sort
  const authors = [...authorMap.values()].sort((a, b) => a.familyName.localeCompare(b.familyName))

  // Save registry
  const outputPath = `${OUTPUT_DIR}/author-registry.json`
  writeFileSync(outputPath, JSON.stringify(authors, null, 2))

  // Stats
  const withOrcid = authors.filter((a) => a.orcid).length
  const withAffiliation = authors.filter((a) => a.affiliation).length
  const withPubs = authors.filter((a) => a.publicationIds.length > 0).length
  const withDatasets = authors.filter((a) => a.datasetIds.length > 0).length
  const withDocs = authors.filter((a) => a.documentIds.length > 0).length
  const crossCollection = authors.filter((a) =>
    (a.publicationIds.length > 0 ? 1 : 0) + (a.datasetIds.length > 0 ? 1 : 0) + (a.documentIds.length > 0 ? 1 : 0) > 1,
  ).length

  console.log('\n========== Author Registry ==========')
  console.log(`Total unique authors: ${authors.length}`)
  console.log(`With ORCID:          ${withOrcid}`)
  console.log(`With affiliation:    ${withAffiliation}`)
  console.log(`With publications:   ${withPubs}`)
  console.log(`With datasets:       ${withDatasets}`)
  console.log(`With documents:      ${withDocs}`)
  console.log(`Cross-collection:    ${crossCollection} (appear in 2+ collections)`)

  // Top authors by work count
  console.log('\nTop authors by total works:')
  const sorted = authors.sort((a, b) =>
    (b.publicationIds.length + b.datasetIds.length + b.documentIds.length) -
    (a.publicationIds.length + a.datasetIds.length + a.documentIds.length),
  )
  for (const a of sorted.slice(0, 15)) {
    const total = a.publicationIds.length + a.datasetIds.length + a.documentIds.length
    console.log(`  ${a.displayName} (${total} works: ${a.publicationIds.length}p/${a.datasetIds.length}d/${a.documentIds.length}doc)${a.orcid ? ' ORCID' : ''}`)
  }

  console.log(`\nOutput: ${outputPath}`)

  // Load to Payload
  if (loadPayload && !dryRun) {
    const serverUp = await checkServer()
    if (!serverUp) {
      console.log('\nPayload server not running — skipping load.')
      return
    }

    await ensureAuth()

    // Get Payload IDs for publications, datasets, documents
    console.log('\nLoading Payload IDs for linking...')
    const payloadPubs = await getAllPaginated('publications')
    const pubPayloadByTitle = new Map(payloadPubs.map((p: any) => [p.title, Number(p.id)]))

    const payloadDatasets = await getAllPaginated('datasets')
    const dsPayloadByTitle = new Map(payloadDatasets.map((d: any) => [d.title, Number(d.id)]))

    const payloadDocs = await getAllPaginated('documents')
    const docPayloadByTitle = new Map(payloadDocs.map((d: any) => [d.title, Number(d.id)]))

    // Load normalized data for title lookups
    const pubById = new Map(pubs.map((p) => [p._sourceId, p]))
    const dsById = new Map(datasets.map((d: any) => [d._sourceId, d]))
    const docById = new Map(docs.map((d) => [d._sourcePostId, d]))

    console.log(`Loading ${Math.min(authors.length, 2000)} authors into Payload...`)
    let loaded = 0
    let errors = 0

    // Load top authors (by work count) up to 2000
    const toLoad = sorted.slice(0, 2000)
    for (let i = 0; i < toLoad.length; i++) {
      const author = toLoad[i]

      // Resolve publication Payload IDs
      const pubIds = author.publicationIds
        .map((sid) => pubById.get(sid)?.title)
        .filter(Boolean)
        .map((title) => pubPayloadByTitle.get(title!))
        .filter(Boolean) as number[]

      const dsIds = author.datasetIds
        .map((sid) => dsById.get(sid)?.title)
        .filter(Boolean)
        .map((title) => dsPayloadByTitle.get(title!))
        .filter(Boolean) as number[]

      const docIds = author.documentIds
        .map((sid) => docById.get(sid)?.title)
        .filter(Boolean)
        .map((title) => docPayloadByTitle.get(title!))
        .filter(Boolean) as number[]

      try {
        await createRecord('authors', {
          displayName: author.displayName,
          familyName: author.familyName,
          givenName: author.givenName || undefined,
          orcid: author.orcid || undefined,
          affiliation: author.affiliation || undefined,
          publications: pubIds.length > 0 ? pubIds : undefined,
          datasets: dsIds.length > 0 ? dsIds : undefined,
          documents: docIds.length > 0 ? docIds : undefined,
        })
        loaded++
      } catch {
        errors++
      }

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r  ${i + 1}/${toLoad.length} (${loaded} ok, ${errors} err)`)
      }
    }
    console.log(`\r  ${toLoad.length} processed: ${loaded} loaded, ${errors} errors`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
