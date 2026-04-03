/**
 * Extract mentors/advisors from student papers.
 *
 * Scans restofreference field and full text of student papers to find
 * mentor names. Matches against the author registry and updates the
 * normalized publication data with mentor information.
 *
 * Usage:
 *   npx tsx scripts/enrich-student-mentors.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { OUTPUT_DIR, STAGING_DIR } from './lib/config.js'

const dryRun = process.argv.includes('--dry-run')
const textDir = join(STAGING_DIR, 'publications')

// ---------------------------------------------------------------------------
// Mentor extraction patterns
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

/** Split a line like "Dr. Mary Price & Dr. Nickolas Waser" into individual names */
function splitNames(line: string): string[] {
  // Clean the line
  let cleaned = line
    .replace(/\bPh\.?D\.?\b/gi, '')
    .replace(/\bDr\.\s*/gi, '')
    .replace(/\bM\.?S\.?\b/g, '')
    .trim()

  // Stop at common terminators
  cleaned = cleaned.split(/\n/)[0]
  cleaned = cleaned.replace(/\s*(?:Rocky Mountain|University of|Summer |Full.?[Tt]ime|Independent|REU|RMBL|Department of|College of).*/i, '')
  cleaned = cleaned.replace(/[,;]\s*$/, '').trim()

  if (!cleaned) return []

  // Split on common separators: ", ", " and ", " & ", ";"
  const parts = cleaned.split(/\s*(?:,\s*(?:and\s+)?|;\s*|\s+&\s+|\s+and\s+)\s*/i)

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 3 && p.length < 40)
    .filter((p) => !p.match(/^(The|This|Our|My|We|In|On|At|By|To|Dr|None|NA|TBD|Summer|Winter|Spring|Fall)/i))
    .filter((p) => p.split(/\s+/).length >= 2) // must have first + last name
}

function isValidName(name: string): boolean {
  if (name.length < 3 || name.length > 40) return false
  if (/^(The|This|Our|My|We|In|On|At|By|To|Dr|None|NA|TBD)/i.test(name)) return false
  // Must have at least a first and last name
  return name.trim().split(/\s+/).length >= 2
}

function cleanMentorName(name: string): string {
  return name
    .replace(/^Dr\.\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Student Paper Mentor Enrichment')
  console.log('===============================')
  if (dryRun) console.log('(DRY RUN)')

  const pubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
  const raw: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-raw.json`, 'utf-8'))
  const rawById = new Map(raw.map((r) => [r.id, r]))

  const students = pubs.filter((p) => p.publicationType === 'student_paper')
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
    console.log(`  [${e.source}] ${e.names.join(', ')} → ${e.title}`)
  }
  console.log('\nSingle mentor samples:')
  for (const e of enriched.filter(e => e.names.length === 1).slice(0, 5)) {
    console.log(`  [${e.source}] ${e.names[0]} → ${e.title}`)
  }

  if (!dryRun) {
    writeFileSync(`${OUTPUT_DIR}/publications-normalized.json`, JSON.stringify(pubs, null, 2))
    console.log(`\nUpdated publications-normalized.json with _mentor field`)
  }

  // Papers with multiple mentors
  const multiMentor = enriched.filter((e) => e.names.length >= 2)
  console.log(`\nPapers with 2+ mentors/co-authors: ${multiMentor.length}`)

  // Summary
  console.log(`\n========== Summary ==========`)
  console.log(`Student papers scanned:    ${students.length}`)
  console.log(`Papers with mentors:       ${papersWithMentors} (${(papersWithMentors / students.length * 100).toFixed(0)}%)`)
  console.log(`Total names found:         ${totalNamesFound}`)
  console.log(`Unique names:              ${mentorCounts.size}`)
  console.log(`Matched to registry:       ${matchedToRegistry}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
