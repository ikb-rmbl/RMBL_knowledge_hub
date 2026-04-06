/**
 * Unified enrichment pipeline for normalized publications.
 *
 * Combines three enrichment steps:
 *   1. dois    — CrossRef + Unpaywall lookup for publications missing DOIs
 *   2. orcids  — ORCID matching from DataCite-harvested registry
 *   3. mentors — Mentor/advisor extraction from student papers
 *
 * Usage:
 *   npx tsx scripts/enrich.ts [--step=dois|orcids|mentors|all] [--dry-run] [--limit=N] [--update-payload]
 *
 * Default step is "all" (runs dois → orcids → mentors in sequence).
 * When step=all, the file is read once, passed through all steps, and written once.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OUTPUT_DIR, STAGING_DIR, CONCURRENCY, DELAYS } from './lib/config.js'
import { queryCrossRef, queryUnpaywall } from './lib/crossref-client.js'
import { ensureAuth, getAllPaginated, patchRecord, checkServer } from './lib/payload-client.js'
import type { NormalizedPublication } from './lib/types.js'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface EnrichOpts {
  dryRun: boolean
  limit: number
  updatePayload?: boolean
}

// ---------------------------------------------------------------------------
// Step 1: DOI enrichment
// ---------------------------------------------------------------------------

export async function enrichDois(opts: EnrichOpts, pubs?: NormalizedPublication[]): Promise<NormalizedPublication[]> {
  const standalone = !pubs
  const outputPath = `${OUTPUT_DIR}/publications-normalized.json`

  if (!pubs) {
    pubs = JSON.parse(readFileSync(outputPath, 'utf-8'))
  }

  const DELAY_MS = DELAYS.CROSSREF_MS

  // Find articles with journal name but no DOI
  let candidates = pubs!.filter(
    (p) => !p.doi && p.journal && p.title && p.authors.length > 0 &&
    (p.publicationType === 'article' || p.publicationType === 'chapter'),
  )

  console.log(`Found ${candidates.length} articles/chapters with journal but no DOI`)

  if (opts.limit < candidates.length) {
    candidates = candidates.slice(0, opts.limit)
    console.log(`Limited to ${opts.limit}`)
  }

  if (opts.dryRun) {
    console.log('(DRY RUN — no changes will be saved)')
  }

  // Step 1: CrossRef search with relaxed year filter
  console.log(`\nStep 1: CrossRef search (+/- 1 year, 0.75 similarity threshold)...`)
  let newDois = 0
  let newAbstracts = 0

  await runConcurrent(
    candidates,
    CONCURRENCY.API_CALLS,
    async (pub) => {
      const result = await queryCrossRef(
        pub.title,
        pub.authors[0]?.family || '',
        pub.year,
        { relaxed: true },
      )
      if (result.doi) {
        pub.doi = result.doi
        pub._crossrefEnriched = true
        pub.externalUrl = pub.externalUrl || `https://doi.org/${result.doi}`
        newDois++
      }
      if (result.abstract && !pub.abstract) {
        pub.abstract = result.abstract
        newAbstracts++
      }
      await sleep(DELAY_MS)
    },
    'CrossRef (relaxed)',
  )

  console.log(`  Found ${newDois} new DOIs, ${newAbstracts} new abstracts`)

  // Step 2: Unpaywall for newly discovered DOIs
  const newDoiPubs = candidates.filter((p) => p.doi && !p.pdfLink)
  if (newDoiPubs.length > 0) {
    console.log(`\nStep 2: Unpaywall for ${newDoiPubs.length} newly DOI'd publications...`)
    let newPdfs = 0

    await runConcurrent(
      newDoiPubs,
      CONCURRENCY.API_CALLS,
      async (pub) => {
        const result = await queryUnpaywall(pub.doi!)
        pub._oaStatus = result.oaStatus
        if (result.pdfUrl) {
          pub.pdfLink = result.pdfUrl
          pub._unpaywallEnriched = true
          newPdfs++
        }
        await sleep(200)
      },
      'Unpaywall',
    )

    console.log(`  Found ${newPdfs} new PDFs`)
  }

  // Save if standalone
  if (standalone && !opts.dryRun) {
    writeFileSync(outputPath, JSON.stringify(pubs, null, 2))
    console.log(`\nUpdated ${outputPath}`)
  }

  // Summary
  const totalDois = pubs!.filter((p) => p.doi).length
  const totalPdfs = pubs!.filter((p) => p.pdfLink).length
  const totalAbstracts = pubs!.filter((p) => p.abstract).length

  console.log('\n========== DOI Enrichment Summary ==========')
  console.log(`Total DOIs:      ${totalDois} (+${newDois} this run)`)
  console.log(`Total PDFs:      ${totalPdfs}`)
  console.log(`Total abstracts: ${totalAbstracts} (+${newAbstracts} this run)`)

  return pubs!
}

// ---------------------------------------------------------------------------
// Step 2: ORCID enrichment
// ---------------------------------------------------------------------------

interface OrcidEntry {
  name: string
  orcid: string
  affiliation: string | null
  source: string
}

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

export async function enrichOrcids(opts: EnrichOpts, pubs?: NormalizedPublication[]): Promise<NormalizedPublication[]> {
  const standalone = !pubs
  const pubsPath = `${OUTPUT_DIR}/publications-normalized.json`

  console.log('ORCID Enrichment for Publication Authors')
  console.log('========================================')
  if (opts.dryRun) console.log('(DRY RUN)')

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
  if (!pubs) {
    pubs = JSON.parse(readFileSync(pubsPath, 'utf-8'))
  }
  console.log(`Publications: ${pubs!.length}`)

  // Enrich
  let authorsEnriched = 0
  let pubsEnriched = 0
  const enrichedPubs: { sourceId: string; title: string; enrichedAuthors: { name: string; orcid: string }[] }[] = []

  for (const pub of pubs!) {
    let pubChanged = false
    const enrichedAuthors: { name: string; orcid: string }[] = []

    for (const author of pub.authors as (typeof pub.authors[number] & { orcid?: string })[]) {
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

  // Save updated publications if standalone
  if (standalone && !opts.dryRun) {
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
  if (opts.updatePayload && !opts.dryRun) {
    const serverUp = await checkServer()
    if (!serverUp) {
      console.log('\nPayload server not running — skipping database updates.')
    } else {
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
  }

  // Summary stats
  const totalWithOrcid = pubs!.reduce((n, p) => n + p.authors.filter((a) => (a as any).orcid).length, 0)
  const totalAuthors = pubs!.reduce((n, p) => n + p.authors.length, 0)
  console.log(`\n========== ORCID Enrichment Summary ==========`)
  console.log(`Authors with ORCID:  ${totalWithOrcid} / ${totalAuthors} (${(totalWithOrcid / totalAuthors * 100).toFixed(1)}%)`)
  console.log(`Publications touched: ${pubsEnriched}`)
  console.log(`New ORCIDs assigned:  ${authorsEnriched}`)

  return pubs!
}

// ---------------------------------------------------------------------------
// Step 3: Mentor enrichment
// ---------------------------------------------------------------------------

// Patterns that capture the FULL line after the label (may contain multiple names)
const MULTI_NAME_PATTERNS = [
  /[Mm]entors?[:\s]+(.+)/m,
  /[Aa]dvisors?[:\s]+(.+)/m,
  /[Ff]aculty\s+(?:[Mm]entor|[Aa]dvisor|[Ss]ponsor)s?[:\s]+(.+)/m,
  /[Ss]upervisors?[:\s]+(.+)/m,
  /[Cc]ollaborators?[:\s]+(.+)/m,
  /[Pp]rincipal\s+[Ii]nvestigators?[:\s]+(.+)/m,
  /(?:under the (?:direction|guidance|supervision) of|supervised by)\s+(.+)/mi,
]

const REF_PATTERN = /[Mm]entor[:\s]*(.+)/

// Words that indicate an institution, not a person
const INSTITUTION_WORDS = /\b(university|college|department|institute|laboratory|school|program|center|rmbl\b|research\b|summer\b|full.?time|independent|reu\b|course|science|biology|ecology|studies|faculty)\b/i

/** Split a line like "Dr. Mary Price & Dr. Nickolas Waser" into individual names */
function splitNames(line: string): string[] {
  // Clean the line
  let cleaned = line
    .replace(/\bPh\.?D\.?\b/gi, '')
    .replace(/\bDr\.\s*/gi, '')
    .replace(/\bM\.?S\.?\b/g, '')
    .replace(/\d+\.?\d*/g, '') // remove footnote numbers like "2" or "2.3"
    .replace(/[–—]/g, '') // remove dashes
    .replace(/\([^)]*\)/g, '') // remove parenthetical content (affiliations)
    .replace(/\bStudent:.*$/i, '') // remove "Student:" and everything after
    .trim()

  // Stop at first newline
  cleaned = cleaned.split(/\n/)[0]

  // Stop at common terminators (institutions, program names)
  cleaned = cleaned.replace(/\s*(?:Rocky Mountain|University |Summer |Full.?[Tt]ime|Independent|REU\b|RMBL\b|Department |College |Center |Institute |School |Program ).*/i, '')
  cleaned = cleaned.replace(/[,;]\s*$/, '').trim()

  if (!cleaned) return []

  // Split on common separators: ", ", " and ", " & ", ";"
  const parts = cleaned.split(/\s*(?:,\s*(?:and\s+)?|;\s*|\s+&\s+|\s+and\s+)\s*/i)

  return parts
    .map((p) => p.replace(/^[^a-zA-Z]+|[^a-zA-Z.]+$/g, '').trim()) // strip leading/trailing non-alpha (keep trailing period for initials)
    .map((p) => p.replace(/\s+/g, ' ').trim()) // normalize whitespace
    .filter((p) => p.length > 4 && p.length < 35)
    .filter((p) => !p.match(/^(The|This|Our|My|We|In|On|At|By|To|None|NA|TBD)/i))
    .filter((p) => !INSTITUTION_WORDS.test(p)) // filter out institution names
    .filter((p) => p.split(/\s+/).length >= 2) // must have first + last name
    .filter((p) => /^[A-Z]/.test(p)) // must start with uppercase
    .filter((p) => !/\d/.test(p)) // no remaining digits
}

export async function enrichMentors(opts: EnrichOpts, pubs?: NormalizedPublication[]): Promise<NormalizedPublication[]> {
  const standalone = !pubs
  const textDir = join(STAGING_DIR, 'publications')

  console.log('Student Paper Mentor Enrichment')
  console.log('===============================')
  if (opts.dryRun) console.log('(DRY RUN)')

  if (!pubs) {
    pubs = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
  }
  const raw: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-raw.json`, 'utf-8'))
  const rawById = new Map(raw.map((r) => [r.id, r]))

  // Use any[] for student papers since we add dynamic _mentors/_mentorSource fields
  const students = pubs!.filter((p) => p.publicationType === 'student_paper') as any[]
  // Clear old mentor data before re-extracting
  for (const s of students) {
    delete s._mentors
    delete s._mentor
    delete s._mentorSource
  }
  console.log(`\nStudent papers: ${students.length}`)

  // Load author registry for matching
  const authors: any[] = existsSync(`${OUTPUT_DIR}/author-registry.json`)
    ? JSON.parse(readFileSync(`${OUTPUT_DIR}/author-registry.json`, 'utf-8'))
    : []
  const authorByFamily = new Map<string, any[]>()
  for (const a of authors) {
    const key = a.familyName.toLowerCase()
    if (!authorByFamily.has(key)) authorByFamily.set(key, [])
    authorByFamily.get(key)!.push(a)
  }

  let papersWithMentors = 0
  let totalNamesFound = 0
  let fromRef = 0
  let fromText = 0
  let matchedToRegistry = 0
  const mentorCounts = new Map<string, number>()
  const enriched: { sourceId: string; title: string; names: string[]; source: string }[] = []

  for (const s of students) {
    const allNames: string[] = []
    let source = ''

    // Check restofreference first
    const r = rawById.get(s._sourceId)
    const ref = r?.restofreference || ''
    const refMatch = ref.match(REF_PATTERN)
    if (refMatch) {
      const names = splitNames(refMatch[1])
      if (names.length > 0) {
        allNames.push(...names)
        source = 'reference'
        fromRef += names.length
      }
    }

    // Check full text
    if (allNames.length === 0) {
      const txtPath = join(textDir, `pub_${s._sourceId}.txt`)
      if (existsSync(txtPath)) {
        const text = readFileSync(txtPath, 'utf-8').slice(0, 2000) // first ~2 pages
        for (const pattern of MULTI_NAME_PATTERNS) {
          const match = text.match(pattern)
          if (match) {
            const names = splitNames(match[1])
            if (names.length > 0) {
              allNames.push(...names)
              source = 'fulltext'
              fromText += names.length
              break
            }
          }
        }
      }
    }

    if (allNames.length === 0) continue

    papersWithMentors++
    totalNamesFound += allNames.length

    for (const name of allNames) {
      mentorCounts.set(name, (mentorCounts.get(name) || 0) + 1)
      const parts = name.split(/\s+/)
      const familyName = parts[parts.length - 1].toLowerCase()
      if ((authorByFamily.get(familyName) || []).length > 0) matchedToRegistry++
    }

    // Store on the publication record
    s._mentors = allNames
    s._mentorSource = source

    enriched.push({
      sourceId: s._sourceId,
      title: s.title.slice(0, 50),
      names: allNames,
      source,
    })
  }

  console.log(`\nPapers with mentors/co-authors: ${papersWithMentors}`)
  console.log(`Total names found: ${totalNamesFound}`)
  console.log(`  From restofreference: ${fromRef}`)
  console.log(`  From full text: ${fromText}`)
  console.log(`  Matched to author registry: ${matchedToRegistry}`)

  console.log('\nTop mentors/co-authors:')
  for (const [name, count] of [...mentorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const parts = name.split(/\s+/)
    const familyName = parts[parts.length - 1].toLowerCase()
    const inRegistry = (authorByFamily.get(familyName) || []).length > 0
    console.log(`  ${name}: ${count} papers${inRegistry ? ' (in registry)' : ''}`)
  }

  console.log('\nSample enrichments:')
  for (const e of enriched.filter(e => e.names.length >= 2).slice(0, 10)) {
    console.log(`  [${e.source}] ${e.names.join(', ')} -> ${e.title}`)
  }
  console.log('\nSingle mentor samples:')
  for (const e of enriched.filter(e => e.names.length === 1).slice(0, 5)) {
    console.log(`  [${e.source}] ${e.names[0]} -> ${e.title}`)
  }

  // Save if standalone
  if (standalone && !opts.dryRun) {
    writeFileSync(`${OUTPUT_DIR}/publications-normalized.json`, JSON.stringify(pubs, null, 2))
    console.log(`\nUpdated publications-normalized.json with _mentor field`)
  }

  // Papers with multiple mentors
  const multiMentor = enriched.filter((e) => e.names.length >= 2)
  console.log(`\nPapers with 2+ mentors/co-authors: ${multiMentor.length}`)

  // Summary
  console.log(`\n========== Mentor Enrichment Summary ==========`)
  console.log(`Student papers scanned:    ${students.length}`)
  console.log(`Papers with mentors:       ${papersWithMentors} (${(papersWithMentors / students.length * 100).toFixed(0)}%)`)
  console.log(`Total names found:         ${totalNamesFound}`)
  console.log(`Unique names:              ${mentorCounts.size}`)
  console.log(`Matched to registry:       ${matchedToRegistry}`)

  return pubs!
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const stepArg = args.find((a) => a.startsWith('--step='))?.split('=')[1] || 'all'
  const dryRun = args.includes('--dry-run')
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
  const limit = limitArg ? parseInt(limitArg) : Infinity
  const updatePayload = args.includes('--update-payload')

  const opts: EnrichOpts = { dryRun, limit, updatePayload }
  const validSteps = ['dois', 'orcids', 'mentors', 'all']

  if (!validSteps.includes(stepArg)) {
    console.error(`Invalid step: ${stepArg}. Valid steps: ${validSteps.join(', ')}`)
    process.exit(1)
  }

  console.log(`\n=== Enrichment Pipeline ===`)
  console.log(`Step: ${stepArg}`)
  console.log(`Dry run: ${dryRun}`)
  console.log(`Limit: ${limit === Infinity ? 'none' : limit}`)
  console.log(`Update Payload: ${updatePayload}`)
  console.log('')

  if (stepArg === 'all') {
    // Read once, pass through all steps, write once
    const outputPath = `${OUTPUT_DIR}/publications-normalized.json`
    let pubs: NormalizedPublication[] = JSON.parse(readFileSync(outputPath, 'utf-8'))

    pubs = await enrichDois(opts, pubs)
    console.log('')
    pubs = await enrichOrcids(opts, pubs)
    console.log('')
    pubs = await enrichMentors(opts, pubs)

    if (!dryRun) {
      writeFileSync(outputPath, JSON.stringify(pubs, null, 2))
      console.log(`\nWrote ${outputPath}`)
    }
  } else if (stepArg === 'dois') {
    await enrichDois(opts)
  } else if (stepArg === 'orcids') {
    await enrichOrcids(opts)
  } else if (stepArg === 'mentors') {
    await enrichMentors(opts)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
