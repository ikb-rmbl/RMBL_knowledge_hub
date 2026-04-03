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

const TEXT_PATTERNS = [
  /[Mm]entor(?:ed by|:\s*|\s+by\s+)\s*(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/m,
  /[Ff]aculty\s+(?:[Mm]entor|[Aa]dvisor|[Ss]ponsor)[:\s]+(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/m,
  /[Aa]dvisor[:\s]+(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/m,
  /[Ss]upervisor[:\s]+(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/m,
  /(?:under the (?:direction|guidance|supervision) of|supervised by)\s+(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/mi,
  /(?:REU|Research Experience).*?[Mm]entor[:\s]+(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/m,
  /[Pp]rincipal\s+[Ii]nvestigator[:\s]+(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+?)(?:\n|,|\.\s|$)/m,
]

const REF_PATTERN = /[Mm]entor[:\s]*(?:Dr\.\s*)?([A-Z][a-zA-Z.\'\- ]+)/

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

  let foundFromRef = 0
  let foundFromText = 0
  let matchedToRegistry = 0
  const mentorCounts = new Map<string, number>()
  const enriched: { sourceId: string; title: string; mentor: string; source: string; matched: boolean }[] = []

  for (const s of students) {
    let mentorName: string | null = null
    let source = ''

    // Check restofreference first
    const r = rawById.get(s._sourceId)
    const ref = r?.restofreference || ''
    const refMatch = ref.match(REF_PATTERN)
    if (refMatch) {
      const name = cleanMentorName(refMatch[1])
      if (isValidName(name)) {
        mentorName = name
        source = 'reference'
        foundFromRef++
      }
    }

    // Check full text if no ref match
    if (!mentorName) {
      const txtPath = join(textDir, `pub_${s._sourceId}.txt`)
      if (existsSync(txtPath)) {
        const text = readFileSync(txtPath, 'utf-8')
        for (const pattern of TEXT_PATTERNS) {
          const match = text.match(pattern)
          if (match) {
            const name = cleanMentorName(match[1])
            if (isValidName(name)) {
              mentorName = name
              source = 'fulltext'
              foundFromText++
              break
            }
          }
        }
      }
    }

    if (!mentorName) continue

    mentorCounts.set(mentorName, (mentorCounts.get(mentorName) || 0) + 1)

    // Try to match to author registry
    const parts = mentorName.split(/\s+/)
    const familyName = parts[parts.length - 1].toLowerCase()
    const candidates = authorByFamily.get(familyName) || []
    const matched = candidates.length > 0

    if (matched) matchedToRegistry++

    // Store mentor info on the publication
    if (!s._mentor) {
      s._mentor = mentorName
      s._mentorSource = source
    }

    enriched.push({
      sourceId: s._sourceId,
      title: s.title.slice(0, 50),
      mentor: mentorName,
      source,
      matched,
    })
  }

  console.log(`\nMentors found: ${foundFromRef + foundFromText}`)
  console.log(`  From restofreference: ${foundFromRef}`)
  console.log(`  From full text: ${foundFromText}`)
  console.log(`  Matched to author registry: ${matchedToRegistry}`)

  console.log('\nTop mentors:')
  for (const [name, count] of [...mentorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const parts = name.split(/\s+/)
    const familyName = parts[parts.length - 1].toLowerCase()
    const inRegistry = (authorByFamily.get(familyName) || []).length > 0
    console.log(`  ${name}: ${count} papers${inRegistry ? ' (in registry)' : ''}`)
  }

  console.log('\nSample enrichments:')
  for (const e of enriched.slice(0, 10)) {
    console.log(`  [${e.source}] ${e.mentor}${e.matched ? ' ✓' : ''} → ${e.title}`)
  }

  if (!dryRun) {
    writeFileSync(`${OUTPUT_DIR}/publications-normalized.json`, JSON.stringify(pubs, null, 2))
    console.log(`\nUpdated publications-normalized.json with _mentor field`)
  }

  // Summary
  console.log(`\n========== Summary ==========`)
  console.log(`Student papers scanned:    ${students.length}`)
  console.log(`Mentors found:             ${foundFromRef + foundFromText} (${((foundFromRef + foundFromText) / students.length * 100).toFixed(0)}%)`)
  console.log(`Unique mentor names:       ${mentorCounts.size}`)
  console.log(`Matched to registry:       ${matchedToRegistry}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
