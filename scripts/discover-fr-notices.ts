/**
 * Discover RMBL-relevant Federal Register notices (EAs, EISs, RODs, RMPs,
 * Biological Opinions, ESA listings, etc.) across the federal land/water/
 * wildlife agencies that act in the Gunnison Basin and adjacent ranges.
 *
 * Output: scripts/output/discovered-fr-notices.json — normalized records
 * ready for loading into the documents collection (or for the applications
 * mining pipeline to traverse). No DB writes. No LLM calls.
 *
 * Usage:
 *   npx tsx scripts/discover-fr-notices.ts                # full run (2005+)
 *   npx tsx scripts/discover-fr-notices.ts --since=2020-01-01
 *   npx tsx scripts/discover-fr-notices.ts --term="Gunnison"  # single search term
 *   npx tsx scripts/discover-fr-notices.ts --dry-run        # show counts, no save
 */

import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'
import type { NormalizedDocument } from './lib/types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const since = args.find((a) => a.startsWith('--since='))?.split('=')[1] || '2005-01-01'
const singleTerm = args.find((a) => a.startsWith('--term='))?.split('=')[1]
const verbose = args.includes('--verbose')

const FR_API = 'https://www.federalregister.gov/api/v1/documents.json'
const USER_AGENT = 'RMBLKnowledgeCommons/0.1 (+https://rmblknowledgecommons.org; ikb@rmbl.org)'

// ---------------------------------------------------------------------------
// Search terms — RMBL service area geography + key species
// ---------------------------------------------------------------------------

const GEOGRAPHIC_TERMS = [
  // Core basin
  '"Gunnison Basin"',
  '"Crested Butte"',
  '"Gothic Colorado"',
  '"East River" Colorado',
  '"Upper Gunnison"',
  '"Gunnison County" Colorado',
  '"Black Canyon" Gunnison',
  'Curecanti',
  // National forests + BLM units
  '"Gunnison National Forest"',
  '"Grand Mesa" Colorado',
  '"Uncompahgre" Colorado',
  '"Gunnison Field Office"',
  '"Uncompahgre Field Office"',
  // Adjacent watersheds + passes
  '"West Elk"',
  '"Cochetopa"',
  '"Lake Fork Gunnison"',
  '"Roaring Fork" Colorado',
  '"Crystal River" Colorado',
  '"Pitkin County" Colorado',
  'Paonia Colorado',
  '"Kebler Pass"',
  '"Cottonwood Pass" Colorado',
  '"Independence Pass" Colorado',
  // Broader Western Slope
  'Saguache Colorado',
  '"Hinsdale County" Colorado',
  'Almont Colorado',
]

const SPECIES_TERMS = [
  '"Gunnison sage-grouse"',
  '"Colorado River cutthroat trout"',
  '"boreal toad" Colorado',
  '"Uncompahgre fritillary"',
  '"North American wolverine" Colorado',
  '"Canada lynx" Colorado',
]

const SEARCH_TERMS = singleTerm ? [singleTerm] : [...GEOGRAPHIC_TERMS, ...SPECIES_TERMS]

// ---------------------------------------------------------------------------
// Agency filter — federal land/water/wildlife agencies
// ---------------------------------------------------------------------------

// FR API caps at 7 agency filters per request. Umbrella departments
// (Agriculture, Interior) are redundant with their children's notices.
// USACE rarely acts in the Gunnison Basin so drop to stay under the cap.
const AGENCY_SLUGS = [
  'forest-service',                         // USFS
  'land-management-bureau',                 // BLM
  'national-park-service',                  // NPS
  'fish-and-wildlife-service',              // USFWS
  'environmental-protection-agency',        // EPA
  'natural-resources-conservation-service', // NRCS
  'reclamation-bureau',                     // BOR
]

// ---------------------------------------------------------------------------
// Relevance gate — FR search returns broad hits; reject obvious noise
// ---------------------------------------------------------------------------

// Counties + cities that prove geographic relevance
const BASIN_PROXIMITY_TERMS = [
  'gunnison', 'crested butte', 'gothic', 'curecanti', 'black canyon',
  'uncompahgre', 'paonia', 'almont', 'lake city', 'creede', 'silverton',
  'ouray', 'telluride', 'norwood', 'delta county', 'montrose county',
  'gunnison county', 'hinsdale county', 'saguache county', 'pitkin county',
  'mesa county', 'archuleta', 'la plata county', 'rio grande county',
  'colorado', 'gmug', 'rocky mountain region',
]

// Topic prefixes that are operational/non-substantive — exclude unless
// the notice clearly names a specific basin action.
const SKIP_TITLE_PATTERNS = [
  /^Newspapers Used for Publication of Legal Notices/i,
  /^Notice of Inventory Completion/i,        // NAGPRA museum collections
  /^Notice of Intended Disposition/i,        // NAGPRA disposition
  /^Notice of Receipt of Petition/i,         // generic petitions w/o specifics
  /^Amendment No\.\s*\d+ to Notice of a Major Disaster/i,  // FEMA amendments
  /^Sunshine Act Meeting/i,
]

function isRelevant(doc: any): { ok: boolean; reason?: string } {
  const title: string = doc.title || ''
  const abstract: string = doc.abstract || ''
  const haystack = (title + ' ' + abstract).toLowerCase()

  // Reject by title pattern
  for (const pat of SKIP_TITLE_PATTERNS) {
    if (pat.test(title)) return { ok: false, reason: 'title-pattern-skip' }
  }
  // Reject if no Colorado / basin signal in title or abstract
  const matched = BASIN_PROXIMITY_TERMS.some((t) => haystack.includes(t))
  if (!matched) return { ok: false, reason: 'no-geo-anchor' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// FR API client
// ---------------------------------------------------------------------------

interface FrDoc {
  document_number: string
  title: string
  abstract: string | null
  type: string                    // Notice | Rule | Proposed Rule | Presidential Document
  publication_date: string        // YYYY-MM-DD
  html_url: string
  pdf_url: string | null
  full_text_xml_url: string | null
  body_html_url: string | null
  agencies: { name: string; slug: string }[]
  topics?: string[]
  dates?: string                  // free-text effective/comment dates
  action?: string | null
  docket_ids?: string[]
  comment_url?: string | null
  comments_close_on?: string | null
}

interface FrPage {
  count: number
  total_pages: number
  next_page_url: string | null
  results: FrDoc[]
}

async function fetchPage(url: string): Promise<FrPage | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (!res.ok) {
      console.error(`  FR API ${res.status} for ${url.slice(0, 120)}`)
      return null
    }
    return (await res.json()) as FrPage
  } catch (err: any) {
    console.error(`  fetch error: ${err.message?.slice(0, 120)}`)
    return null
  }
}

async function searchFr(term: string, sinceDate: string): Promise<FrDoc[]> {
  const fields = [
    'document_number', 'title', 'abstract', 'type', 'publication_date',
    'html_url', 'pdf_url', 'full_text_xml_url', 'body_html_url',
    'agencies', 'topics', 'dates', 'action', 'docket_ids',
    'comment_url', 'comments_close_on',
  ]
  const params = new URLSearchParams()
  params.set('conditions[term]', term)
  params.set('conditions[publication_date][gte]', sinceDate)
  params.set('per_page', '1000')
  for (const slug of AGENCY_SLUGS) params.append('conditions[agencies][]', slug)
  for (const f of fields) params.append('fields[]', f)
  let url: string | null = `${FR_API}?${params}`

  const all: FrDoc[] = []
  let pageNum = 0
  while (url) {
    const page = await fetchPage(url)
    if (!page) break
    pageNum++
    all.push(...(page.results || []))
    if (verbose) console.log(`    page ${pageNum} / ${page.total_pages || '?'} (cumulative: ${all.length})`)
    url = page.next_page_url
    await sleep(150)  // be polite to free API
  }
  return all
}

// ---------------------------------------------------------------------------
// Classification — which kind of NEPA/policy action is this?
// ---------------------------------------------------------------------------

function classifyAction(doc: FrDoc): string[] {
  const t = (doc.title + ' ' + (doc.abstract || '')).toLowerCase()
  const tags: string[] = []
  if (/record of decision\b|^ROD\b/i.test(doc.title) || /\brecord of decision\b/i.test(t)) tags.push('ROD')
  if (/notice of intent\b/i.test(doc.title) || /\bnotice of intent\b/i.test(t)) tags.push('NOI')
  if (/notice of availability\b/i.test(doc.title) || /\bnotice of availability\b/i.test(t)) tags.push('NOA')
  if (/draft environmental impact|draft eis\b/i.test(t)) tags.push('DEIS')
  if (/final environmental impact|final eis\b/i.test(t)) tags.push('FEIS')
  if (/environmental assessment\b|^EA\b/i.test(t)) tags.push('EA')
  if (/finding of no significant impact|fonsi\b/i.test(t)) tags.push('FONSI')
  if (/categorical exclusion\b/i.test(t)) tags.push('CE')
  if (/resource management plan\b|land management plan\b/i.test(t)) tags.push('RMP/LMP')
  if (/biological opinion\b/i.test(t)) tags.push('BiOp')
  if (/critical habitat\b/i.test(t)) tags.push('critical-habitat')
  if (/endangered\b|threatened species\b|listing/i.test(t)) tags.push('ESA-listing')
  if (/grazing\b|allotment\b/i.test(t)) tags.push('grazing')
  if (/recreation\b|trail\b|special use permit\b/i.test(t)) tags.push('recreation')
  if (/timber\b|vegetation management\b|forest health\b/i.test(t)) tags.push('vegetation-mgmt')
  if (/mining\b|mineral\b|coal lease\b/i.test(t)) tags.push('mining')
  if (/water right\b|instream flow\b|water resources\b/i.test(t)) tags.push('water')
  return tags
}

// ---------------------------------------------------------------------------
// Normalize to NormalizedDocument
// ---------------------------------------------------------------------------

function normalize(doc: FrDoc, actionTags: string[]): NormalizedDocument {
  const agencyNames = doc.agencies.map((a) => a.name).join(', ')
  return {
    _sourcePostId: `fr-${doc.document_number}`,
    title: doc.title,
    summary: doc.abstract || doc.action || '',
    categories: [...(doc.topics || []), doc.type, ...actionTags],
    dateOriginal: doc.publication_date,
    geographicScope: [],  // populated later by entity extraction
    sourceFile: doc.pdf_url,
    sourceUrl: doc.html_url,
    ingestionDate: new Date().toISOString(),
    _tags: ['federal-register', ...doc.agencies.map((a) => `agency:${a.slug}`), ...actionTags],
    _pdfSizeBytes: null,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Discover Federal Register NEPA notices')
  console.log('======================================')
  console.log(`Date range: ${since} → present`)
  console.log(`Search terms: ${SEARCH_TERMS.length}`)
  console.log(`Agency filter: ${AGENCY_SLUGS.length} agencies`)
  console.log()

  const byDocNumber = new Map<string, FrDoc>()
  const rejectionCounts = new Map<string, number>()
  let totalApiHits = 0

  for (let i = 0; i < SEARCH_TERMS.length; i++) {
    const term = SEARCH_TERMS[i]
    process.stdout.write(`  [${i + 1}/${SEARCH_TERMS.length}] ${term} `)
    const docs = await searchFr(term, since)
    totalApiHits += docs.length
    let newCount = 0, rejectCount = 0
    for (const d of docs) {
      if (byDocNumber.has(d.document_number)) continue
      const rel = isRelevant(d)
      if (!rel.ok) {
        rejectCount++
        rejectionCounts.set(rel.reason!, (rejectionCounts.get(rel.reason!) || 0) + 1)
        continue
      }
      byDocNumber.set(d.document_number, d)
      newCount++
    }
    console.log(`→ ${docs.length} hits, ${newCount} kept, ${rejectCount} rejected`)
  }

  const kept = [...byDocNumber.values()]
  const normalized = kept.map((d) => normalize(d, classifyAction(d)))

  // Action-tag distribution
  const tagCounts = new Map<string, number>()
  for (const n of normalized) {
    for (const t of n._tags) if (!t.startsWith('agency:') && t !== 'federal-register') {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1)
    }
  }
  // Agency distribution
  const agencyCounts = new Map<string, number>()
  for (const n of normalized) {
    for (const t of n._tags) if (t.startsWith('agency:')) {
      agencyCounts.set(t.slice(7), (agencyCounts.get(t.slice(7)) || 0) + 1)
    }
  }

  console.log()
  console.log('Summary')
  console.log(`  Total API hits (with duplicates): ${totalApiHits}`)
  console.log(`  Unique documents discovered: ${byDocNumber.size}`)
  console.log(`  Kept after relevance gate: ${kept.length}`)
  console.log(`  Rejections:`)
  for (const [r, c] of rejectionCounts) console.log(`    ${r}: ${c}`)
  console.log()
  console.log(`  Top action tags:`)
  for (const [t, c] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${c.toString().padStart(4)}  ${t}`)
  }
  console.log()
  console.log(`  Top agencies:`)
  for (const [a, c] of [...agencyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.toString().padStart(4)}  ${a}`)
  }

  if (dryRun) {
    console.log('\nDry run — no output written.')
    return
  }

  mkdirSync('scripts/output', { recursive: true })
  const outPath = 'scripts/output/discovered-fr-notices.json'
  writeFileSync(outPath, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      since,
      search_terms_count: SEARCH_TERMS.length,
      agencies: AGENCY_SLUGS,
      total_api_hits: totalApiHits,
      unique_documents: byDocNumber.size,
      kept_after_relevance_gate: kept.length,
      action_tag_counts: Object.fromEntries(tagCounts),
      agency_counts: Object.fromEntries(agencyCounts),
    },
    documents: normalized,
    // Raw FR records preserved for downstream use (full_text_xml_url, comment_url, etc.)
    raw: kept,
  }, null, 2))
  console.log(`\nWritten ${outPath}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
