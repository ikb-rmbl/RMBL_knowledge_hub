/**
 * Extract entities from community/policy documents using Claude API (text-only).
 *
 * Documents include environmental assessments, county plans, mining permits,
 * water management reports, wildlife surveys, and community planning documents.
 * The extraction prompt is adapted for policy/community content rather than
 * scientific articles.
 *
 * Uses full_text already in the database (extracted from PDFs via pdftotext/OCR).
 * No VLM needed since text extraction is already done.
 *
 * Usage:
 *   npx tsx scripts/extract-document-entities.ts [--dry-run] [--limit=N]
 *
 * Requires: ANTHROPIC_API_KEY
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const RESULTS_PATH = `${OUTPUT_DIR}/document-entity-extraction.json`
const PROGRESS_INTERVAL = 25

// Chunk size for long documents — each chunk gets its own API call,
// results are merged across chunks with dedup
const CHUNK_SIZE = 12000  // chars per chunk (~3-4K tokens)
const CHUNK_OVERLAP = 500 // overlap to avoid splitting entities at boundaries
const MAX_CHUNKS = 10     // cap chunks per document (covers ~120K chars = ~95th percentile)

const PROMPT = `You are extracting structured entity information from a community, environmental, or policy document from the Gunnison Basin / Western Colorado region.

These documents include: environmental assessments, county planning documents, water management reports, mining permits, wildlife surveys, land use plans, recreation studies, and community development proposals.

Extract the following entities ONLY if they are explicitly named in the text. Do NOT infer or fabricate information. Many of these documents are OCR-scanned and may contain errors — extract what you can confidently identify.

Return a JSON object with these fields:

{
  "species": [
    {
      "scientificName": "Genus species (if given, otherwise use common name as scientificName)",
      "commonName": "common name or null",
      "family": "taxonomic family or null",
      "kingdom": "Animalia|Plantae|Fungi or null",
      "role": "study subject|managed species|threatened species|habitat component|pest|invasive|game species|livestock"
    }
  ],
  "places": [
    {
      "name": "place name",
      "type": "watershed|stream|river|lake|reservoir|peak|valley|meadow|mine|town|county|national_forest|wilderness_area|blm_land|subdivision|ranch|state|region",
      "parentName": "containing place or null",
      "coordinates": "lat, lon if stated, or null",
      "elevation": "elevation if stated, or null",
      "role": "subject area|affected area|reference area|jurisdiction|project site"
    }
  ],
  "concepts": [
    {
      "name": "concept or topic name",
      "type": "process|phenomenon|measurement|framework|policy|regulation|land_use|resource",
      "scope": "water_resources|mining|wildlife|land_use|recreation|energy|agriculture|forestry|conservation|climate|geology|community_planning|environmental_review",
      "role": "primary topic|context|regulatory framework|concern"
    }
  ],
  "documentType": "environmental_assessment|management_plan|county_plan|water_report|mining_permit|wildlife_survey|land_use_plan|recreation_study|legislation|correspondence|technical_report|news_article|other",
  "agencies": ["list of government agencies, organizations, or entities mentioned as actors"],
  "dateRange": "time period covered by the document, if stated (e.g., '1975-1980')",
  "referencedWorks": [
    {
      "title": "title of the referenced work",
      "authors": "author names if given, or null",
      "year": "publication year if given, or null",
      "type": "report|legislation|study|book|article|plan|permit|other",
      "identifier": "any identifier: DOI, report number, bill number, case number, or null"
    }
  ]
}

Important:
- Places are especially important for these documents — extract ALL named geographic features, jurisdictions, water bodies, mountains, mines, towns, subdivisions
- For species, include both scientific names (if given) AND common names (deer, elk, trout, etc.)
- Concepts should reflect the policy/environmental topics, not scientific theory
- Include ALL agencies and organizations mentioned as actors (USFS, BLM, EPA, county commissioners, water districts, etc.)
- For referencedWorks, capture reports, studies, legislation, environmental impact statements, and other documents that are cited or referenced. Include report numbers, bill numbers, or DOIs when given.
- For documentType, choose the single best match
- Return valid JSON only — no markdown, no commentary`

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaude(docText: string, title: string): Promise<any | null> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `${PROMPT}\n\nDocument title: "${title}"\n\nDocument text:\n${docText}`,
        }],
      }),
    })

    if (res.status === 529 || res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const backoff = 30 + attempt * 30
        console.log(` retry ${attempt + 1} after ${backoff}s (${res.status})`)
        await sleep(backoff * 1000)
        continue
      }
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    const inputTokens = data.usage?.input_tokens || 0
    const outputTokens = data.usage?.output_tokens || 0

    // Parse JSON — handle truncated responses from max_tokens cutoff
    const stopReason = data.stop_reason
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    try {
      return { extraction: JSON.parse(cleaned), inputTokens, outputTokens }
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try {
          return { extraction: JSON.parse(cleaned.slice(start, end + 1)), inputTokens, outputTokens }
        } catch { /* fall through */ }
      }
      // Truncated JSON recovery: if stop_reason is max_tokens, try closing open braces/brackets
      if (start >= 0 && (stopReason === 'max_tokens' || end === -1 || end <= start)) {
        let attempt = cleaned.slice(start)
        // Trim to last complete value (before a trailing comma or incomplete string)
        attempt = attempt.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '')
        const openBraces = (attempt.match(/\{/g) || []).length - (attempt.match(/\}/g) || []).length
        const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length
        attempt += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces))
        try {
          const parsed = JSON.parse(attempt)
          console.log(` recovered truncated JSON (${text.length} chars, stop=${stopReason})`)
          return { extraction: parsed, inputTokens, outputTokens }
        } catch { /* fall through */ }
      }
      console.log(` JSON parse failed (${text.length} chars, stop=${stopReason})`)
      return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text]

  const chunks: string[] = []
  let pos = 0
  while (pos < text.length) {
    let end = pos + CHUNK_SIZE
    // Try to break at a paragraph boundary
    if (end < text.length) {
      const paraBreak = text.lastIndexOf('\n\n', end)
      if (paraBreak > pos + CHUNK_SIZE * 0.6) end = paraBreak
    }
    chunks.push(text.slice(pos, end))
    pos = end - CHUNK_OVERLAP
    if (pos < 0) pos = 0
    if (end >= text.length) break
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Merge extractions across chunks (dedup by name)
// ---------------------------------------------------------------------------

function mergeExtractions(parts: any[]): any {
  if (parts.length === 1) return parts[0]

  const speciesByName = new Map<string, any>()
  const placesByName = new Map<string, any>()
  const conceptsByName = new Map<string, any>()
  const allAgencies = new Set<string>()
  const refsByTitle = new Map<string, any>()
  let documentType: string | null = null
  let dateRange: string | null = null

  for (const p of parts) {
    for (const s of p.species || []) {
      const key = (s.scientificName || s.commonName || '').toLowerCase()
      if (key && !speciesByName.has(key)) speciesByName.set(key, s)
    }
    for (const pl of p.places || []) {
      const key = (pl.name || '').toLowerCase()
      if (key && !placesByName.has(key)) placesByName.set(key, pl)
    }
    for (const c of p.concepts || []) {
      const key = (c.name || '').toLowerCase()
      if (key && !conceptsByName.has(key)) conceptsByName.set(key, c)
    }
    for (const a of p.agencies || []) allAgencies.add(a)
    for (const r of p.referencedWorks || []) {
      const key = (r.title || '').toLowerCase().slice(0, 60)
      if (key && !refsByTitle.has(key)) refsByTitle.set(key, r)
    }
    if (p.documentType && !documentType) documentType = p.documentType
    if (p.dateRange && !dateRange) dateRange = p.dateRange
  }

  return {
    species: [...speciesByName.values()],
    places: [...placesByName.values()],
    concepts: [...conceptsByName.values()],
    agencies: [...allAgencies],
    referencedWorks: [...refsByTitle.values()],
    documentType,
    dateRange,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Extract Document Entities')
  console.log('=========================')
  if (dryRun) console.log('(DRY RUN)')
  if (!ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY required')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    const { rows: documents } = await db.query(`
      SELECT id, title, full_text, length(full_text) as text_len
      FROM documents
      WHERE full_text IS NOT NULL AND length(full_text) >= 100
      ORDER BY id
    `)
    console.log(`\n${documents.length} documents with extractable text`)

    // Resume support
    let results: any[] = []
    const processedIds = new Set<number>()
    if (existsSync(RESULTS_PATH)) {
      results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
      for (const r of results) processedIds.add(r.id)
      console.log(`Resuming: ${processedIds.size} already processed`)
    }

    const remaining = documents.filter((d) => !processedIds.has(d.id)).slice(0, limit)
    console.log(`Processing: ${remaining.length}`)

    if (remaining.length === 0) {
      console.log('Nothing to process.')
      return
    }

    const startTime = Date.now()
    let sessionProcessed = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    for (let i = 0; i < remaining.length; i++) {
      const doc = remaining[i]
      const allChunks = chunkText(doc.full_text)
      // Cap chunks: for very long documents, sample evenly from beginning, middle, end
      let chunks: string[]
      if (allChunks.length <= MAX_CHUNKS) {
        chunks = allChunks
      } else {
        // Always include first and last chunks; sample evenly from the rest
        const step = (allChunks.length - 2) / (MAX_CHUNKS - 2)
        chunks = [allChunks[0]]
        for (let ci = 1; ci < MAX_CHUNKS - 1; ci++) {
          chunks.push(allChunks[Math.round(ci * step)])
        }
        chunks.push(allChunks[allChunks.length - 1])
      }

      if (dryRun) {
        console.log(`  ${doc.id}: "${doc.title.slice(0, 60)}" (${doc.text_len} chars → ${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`)
        sessionProcessed++
        continue
      }

      try {
        const chunkExtractions: any[] = []
        let docCost = 0

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunkLabel = chunks.length > 1 ? ` [chunk ${ci + 1}/${chunks.length}]` : ''
          const result = await callClaude(chunks[ci], doc.title + chunkLabel)

          if (result) {
            chunkExtractions.push(result.extraction)
            totalInputTokens += result.inputTokens
            totalOutputTokens += result.outputTokens
            docCost += (result.inputTokens * 3 + result.outputTokens * 15) / 1_000_000
          }

          if (ci < chunks.length - 1) await sleep(300)
        }

        if (chunkExtractions.length > 0) {
          const merged = mergeExtractions(chunkExtractions)
          results.push({
            id: doc.id,
            collection: 'documents',
            title: doc.title,
            strategy3: {
              extraction: {
                species: merged.species || [],
                places: merged.places || [],
                protocolsNamed: [],  // documents don't have protocols
                concepts: merged.concepts || [],
                agencies: merged.agencies || [],
                referencedWorks: merged.referencedWorks || [],
                documentType: merged.documentType || null,
                dateRange: merged.dateRange || null,
              },
              cost: docCost,
              chunks: chunks.length,
            },
          })
        } else {
          results.push({
            id: doc.id,
            collection: 'documents',
            title: doc.title,
            strategy3: {
              extraction: { species: [], places: [], protocolsNamed: [], concepts: [] },
              error: 'no chunks produced valid JSON',
            },
          })
        }

        sessionProcessed++
      } catch (err: any) {
        console.log(` error on ${doc.id}: ${err.message?.slice(0, 100)}`)
        results.push({
          id: doc.id,
          collection: 'documents',
          title: doc.title,
          strategy3: { extraction: { species: [], places: [], protocolsNamed: [], concepts: [] }, error: err.message?.slice(0, 200) },
        })
        sessionProcessed++
      }

      // Incremental save
      writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))

      // Progress
      if (sessionProcessed % PROGRESS_INTERVAL === 0 || i === remaining.length - 1) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = sessionProcessed / (elapsed / 60)
        const totalRemaining = remaining.length - sessionProcessed
        const etaMin = rate > 0 ? totalRemaining / rate : 0
        const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000
        console.log(`  [${sessionProcessed}/${remaining.length}] ${(elapsed / 60).toFixed(1)}min, ${rate.toFixed(0)} docs/min, cost=$${cost.toFixed(2)}, ETA ${Math.round(etaMin)}min`)
      }

      await sleep(300)
    }

    console.log(`\n========== Summary ==========`)
    console.log(`  Total results: ${results.length}`)
    console.log(`  This session: ${sessionProcessed}`)
    const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000
    console.log(`  Cost: $${cost.toFixed(2)} (${totalInputTokens} input, ${totalOutputTokens} output tokens)`)
    if (!dryRun) console.log(`  Saved to: ${RESULTS_PATH}`)

    // Stats
    let totalSpecies = 0, totalPlaces = 0, totalConcepts = 0, totalAgencies = 0
    for (const r of results) {
      const e = r.strategy3?.extraction
      if (e) {
        totalSpecies += (e.species || []).length
        totalPlaces += (e.places || []).length
        totalConcepts += (e.concepts || []).length
        totalAgencies += (e.agencies || []).length
      }
    }
    console.log(`  Extracted: ${totalSpecies} species, ${totalPlaces} places, ${totalConcepts} concepts, ${totalAgencies} agency mentions`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
