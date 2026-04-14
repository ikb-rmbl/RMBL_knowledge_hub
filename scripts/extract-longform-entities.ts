/**
 * Extract entities from long-form documents (>40 pages / >80K chars).
 *
 * Handles theses, books, long reports, and environmental assessments using
 * chapter-aware text chunking:
 *
 *   1. Chapter-structured: split on "Chapter N" boundaries, extract per-chapter
 *   2. Section-structured: split on heading patterns, extract per-section
 *   3. Unstructured: fixed-size chunks with overlap
 *
 * Theses get additional metadata: chapter titles, chapter summaries, and
 * chapter-specific research questions.
 *
 * Works for both publications and documents collections.
 *
 * Usage:
 *   npx tsx scripts/extract-longform-entities.ts [--dry-run] [--limit=N] [--collection=publications|documents|all]
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
const collFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const RESULTS_PATH = `${OUTPUT_DIR}/longform-entity-extraction.json`
const PROGRESS_INTERVAL = 10
const MAX_CHUNK_CHARS = 12000
const MAX_CHAPTERS = 12 // cap chapters per document

// ---------------------------------------------------------------------------
// Structure detection and splitting
// ---------------------------------------------------------------------------

interface TextChunk {
  label: string       // "Chapter 3: Methods" or "Section 2.1" or "Chunk 4 of 8"
  text: string
  chapterNum: number | null
  isChapter: boolean
}

function detectAndSplit(text: string, title: string, docType: string): TextChunk[] {
  // Strategy 1: Chapter-structured (theses, books)
  const chapterPattern = /\n\s*(Chapter\s+(\d+)[^\n]{0,80})\n/gi
  const chapterMatches: { heading: string; num: number; pos: number }[] = []
  let match
  while ((match = chapterPattern.exec(text))) {
    const num = parseInt(match[2])
    // Dedup: only keep first occurrence of each chapter number
    if (!chapterMatches.find((m) => m.num === num)) {
      chapterMatches.push({ heading: match[1].trim(), num, pos: match.index })
    }
  }

  if (chapterMatches.length >= 2) {
    const chapters: TextChunk[] = []

    // Preface/Abstract before first chapter
    if (chapterMatches[0].pos > 500) {
      const prefaceText = text.slice(0, chapterMatches[0].pos)
      if (prefaceText.length > 200) {
        chapters.push({
          label: 'Preface & Abstract',
          text: prefaceText.slice(0, MAX_CHUNK_CHARS),
          chapterNum: 0,
          isChapter: true,
        })
      }
    }

    // Each chapter
    for (let i = 0; i < chapterMatches.length; i++) {
      const start = chapterMatches[i].pos
      const end = i + 1 < chapterMatches.length ? chapterMatches[i + 1].pos : text.length
      const chapterText = text.slice(start, end)

      // For long chapters, take beginning + end to stay within token budget
      let truncated: string
      if (chapterText.length <= MAX_CHUNK_CHARS) {
        truncated = chapterText
      } else {
        const headLen = Math.floor(MAX_CHUNK_CHARS * 0.6)
        const tailLen = MAX_CHUNK_CHARS - headLen - 80
        truncated = chapterText.slice(0, headLen) +
          '\n\n[...middle of chapter omitted...]\n\n' +
          chapterText.slice(-tailLen)
      }

      chapters.push({
        label: chapterMatches[i].heading,
        text: truncated,
        chapterNum: chapterMatches[i].num,
        isChapter: true,
      })
    }

    // Cap chapters
    if (chapters.length > MAX_CHAPTERS) {
      // Keep preface + evenly sample chapters
      const preface = chapters[0].chapterNum === 0 ? [chapters[0]] : []
      const rest = chapters.filter((c) => c.chapterNum !== 0)
      const step = rest.length / (MAX_CHAPTERS - preface.length)
      const sampled = preface.slice()
      for (let i = 0; i < MAX_CHAPTERS - preface.length; i++) {
        sampled.push(rest[Math.round(i * step)])
      }
      return sampled
    }
    return chapters
  }

  // Strategy 2: Section-structured (numbered headings like "1.2 Water Resources")
  const sectionPattern = /\n(\d+\.(?:\d+\.?)?\s+[A-Z][^\n]{3,60})\n/g
  const sectionMatches: { heading: string; pos: number }[] = []
  while ((match = sectionPattern.exec(text))) {
    // Only top-level sections (1. or 2., not 1.2.3)
    if (match[1].match(/^\d+\.\s/) || match[1].match(/^\d+\.\d+\s/)) {
      sectionMatches.push({ heading: match[1].trim(), pos: match.index })
    }
  }

  if (sectionMatches.length >= 3) {
    const sections: TextChunk[] = []
    for (let i = 0; i < Math.min(sectionMatches.length, MAX_CHAPTERS); i++) {
      const start = sectionMatches[i].pos
      const end = i + 1 < sectionMatches.length ? sectionMatches[i + 1].pos : text.length
      let sectionText = text.slice(start, end)
      if (sectionText.length > MAX_CHUNK_CHARS) {
        sectionText = sectionText.slice(0, MAX_CHUNK_CHARS)
      }
      sections.push({
        label: sectionMatches[i].heading,
        text: sectionText,
        chapterNum: null,
        isChapter: false,
      })
    }
    return sections
  }

  // Strategy 3: Unstructured — fixed-size chunks
  const chunks: TextChunk[] = []
  const totalChunks = Math.min(Math.ceil(text.length / MAX_CHUNK_CHARS), MAX_CHAPTERS)
  const chunkSize = Math.ceil(text.length / totalChunks)

  for (let i = 0; i < totalChunks; i++) {
    let start = i * chunkSize
    let end = Math.min(start + chunkSize, text.length)
    // Try to break at paragraph boundary
    if (end < text.length) {
      const paraBreak = text.lastIndexOf('\n\n', end)
      if (paraBreak > start + chunkSize * 0.6) end = paraBreak
    }
    chunks.push({
      label: `Part ${i + 1} of ${totalChunks}`,
      text: text.slice(start, end).slice(0, MAX_CHUNK_CHARS),
      chapterNum: null,
      isChapter: false,
    })
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const THESIS_CHAPTER_PROMPT = `You are extracting structured information from a SINGLE CHAPTER of a thesis or dissertation about environmental science in the Gunnison Basin / Western Colorado region.

Extract the following from this chapter. Only extract entities EXPLICITLY mentioned — do not infer.

Return a JSON object:
{
  "chapterTitle": "descriptive title for this chapter",
  "chapterSummary": "2-3 sentence summary of this chapter's content",
  "researchQuestion": "the research question addressed in this chapter, or null",
  "species": [{"scientificName": "...", "commonName": "...", "family": "...", "kingdom": "...", "role": "study subject|habitat component|predator|prey|pollinator|etc"}],
  "places": [{"name": "...", "type": "study_site|watershed|stream|peak|valley|meadow|county|region", "parentName": "...", "coordinates": "...", "elevation": "...", "role": "study site|reference site"}],
  "protocols": [{"proposedName": "...", "category": "sampling|measurement|analytical|experimental|observational|computational|laboratory", "description": "...", "role": "primary method|data collection|analysis"}],
  "concepts": [{"name": "...", "type": "process|phenomenon|measurement|metric|framework|theory|hypothesis", "scope": "general_ecology|climate|hydrology|population_ecology|community_ecology|evolution|biogeochemistry|landscape|molecular|methodological", "role": "primary focus|context|measured variable"}],
  "statisticalMethods": [{"name": "...", "software": "...", "purpose": "..."}]
}

Return valid JSON only.`

const DOCUMENT_SECTION_PROMPT = `You are extracting structured information from a section of a community, environmental, or policy document from the Gunnison Basin / Western Colorado region.

Extract the following ONLY if explicitly mentioned — do not infer.

Return a JSON object:
{
  "species": [{"scientificName": "...", "commonName": "...", "family": "...", "kingdom": "...", "role": "managed species|threatened species|habitat component|pest|invasive|game species|livestock"}],
  "places": [{"name": "...", "type": "watershed|stream|river|lake|reservoir|peak|valley|mine|town|county|national_forest|wilderness_area|blm_land|subdivision", "parentName": "...", "role": "subject area|affected area|project site|jurisdiction"}],
  "concepts": [{"name": "...", "type": "process|phenomenon|measurement|framework|policy|regulation|land_use|resource", "scope": "water_resources|mining|wildlife|land_use|recreation|energy|agriculture|forestry|conservation|climate|geology|community_planning|environmental_review", "role": "primary topic|context|regulatory framework|concern"}],
  "agencies": ["list of agencies/organizations mentioned"],
  "referencedWorks": [{"title": "...", "authors": "...", "year": "...", "type": "report|legislation|study|plan|permit|other", "identifier": "report number, bill number, DOI, or null"}]
}

Return valid JSON only.`

const PUBLICATION_SECTION_PROMPT = `You are extracting structured information from a section of a long scientific publication (article, book chapter, or report) about environmental science in the Gunnison Basin / Western Colorado region.

Extract the following ONLY if explicitly mentioned — do not infer.

Return a JSON object:
{
  "species": [{"scientificName": "...", "commonName": "...", "family": "...", "kingdom": "...", "role": "study subject|habitat component|predator|prey|pollinator|etc"}],
  "places": [{"name": "...", "type": "study_site|watershed|stream|peak|valley|meadow|county|region", "parentName": "...", "coordinates": "...", "elevation": "...", "role": "study site|reference site"}],
  "protocols": [{"proposedName": "...", "category": "sampling|measurement|analytical|experimental|observational|computational|laboratory", "description": "...", "role": "primary method|data collection|analysis"}],
  "concepts": [{"name": "...", "type": "process|phenomenon|measurement|metric|framework|theory|hypothesis", "scope": "general_ecology|climate|hydrology|population_ecology|community_ecology|evolution|biogeochemistry|landscape|molecular|methodological", "role": "primary focus|context|measured variable"}]
}

Return valid JSON only.`

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------

async function callClaude(prompt: string, text: string, label: string): Promise<any | null> {
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
        max_tokens: 4096,
        messages: [{ role: 'user', content: `${prompt}\n\nSection: "${label}"\n\n${text}` }],
      }),
    })

    if (res.status === 529 || res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const backoff = 30 + attempt * 30
        await sleep(backoff * 1000)
        continue
      }
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    const responseText = data.content?.[0]?.text || ''
    const inputTokens = data.usage?.input_tokens || 0
    const outputTokens = data.usage?.output_tokens || 0

    let cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    try {
      return { extraction: JSON.parse(cleaned), inputTokens, outputTokens }
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try { return { extraction: JSON.parse(cleaned.slice(start, end + 1)), inputTokens, outputTokens } } catch {}
      }
      return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeChapterExtractions(parts: any[]): any {
  const speciesByName = new Map<string, any>()
  const placesByName = new Map<string, any>()
  const conceptsByName = new Map<string, any>()
  const protocolsByName = new Map<string, any>()
  const allAgencies = new Set<string>()
  const refsByTitle = new Map<string, any>()
  const chapters: any[] = []

  for (const p of parts) {
    if (p._chapterMeta) chapters.push(p._chapterMeta)

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
    for (const pr of p.protocols || p.protocolsNamed || []) {
      const key = (pr.proposedName || pr.name || '').toLowerCase()
      if (key && !protocolsByName.has(key)) protocolsByName.set(key, pr)
    }
    for (const a of p.agencies || []) allAgencies.add(a)
    for (const r of p.referencedWorks || []) {
      const key = (r.title || '').toLowerCase().slice(0, 60)
      if (key && !refsByTitle.has(key)) refsByTitle.set(key, r)
    }
  }

  return {
    species: [...speciesByName.values()],
    places: [...placesByName.values()],
    protocolsNamed: [...protocolsByName.values()],
    concepts: [...conceptsByName.values()],
    agencies: [...allAgencies],
    referencedWorks: [...refsByTitle.values()],
    chapters: chapters.length > 0 ? chapters : undefined,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Extract Long-Form Entities')
  console.log('==========================')
  if (dryRun) console.log('(DRY RUN)')
  if (!ANTHROPIC_API_KEY && !dryRun) { console.error('Error: ANTHROPIC_API_KEY required'); process.exit(1) }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Load long items from both collections
    type LongItem = { id: number; collection: string; title: string; docType: string; fullText: string; textLen: number }
    const items: LongItem[] = []

    if (collFilter === 'all' || collFilter === 'publications') {
      const { rows } = await db.query(`
        SELECT id, title, publication_type, full_text, length(full_text) as text_len
        FROM publications
        WHERE full_text IS NOT NULL AND length(full_text) > 80000
          AND id NOT IN (SELECT DISTINCT source_item_id FROM entity_candidates WHERE entity_type = 'species')
        ORDER BY id
      `)
      for (const r of rows) items.push({ id: r.id, collection: 'publications', title: r.title, docType: r.publication_type, fullText: r.full_text, textLen: r.text_len })
    }

    if (collFilter === 'all' || collFilter === 'documents') {
      const { rows } = await db.query(`
        SELECT id, title, full_text, length(full_text) as text_len
        FROM documents
        WHERE full_text IS NOT NULL AND length(full_text) > 120000
        ORDER BY id
      `)
      for (const r of rows) items.push({ id: r.id, collection: 'documents', title: r.title, docType: 'document', fullText: r.full_text, textLen: r.text_len })
    }

    console.log(`\n${items.length} long-form items (${items.filter((i) => i.collection === 'publications').length} publications, ${items.filter((i) => i.collection === 'documents').length} documents)`)

    // Resume
    let results: any[] = []
    const processedKeys = new Set<string>()
    if (existsSync(RESULTS_PATH)) {
      results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
      for (const r of results) processedKeys.add(`${r.collection}:${r.id}`)
      console.log(`Resuming: ${processedKeys.size} already processed`)
    }

    const remaining = items.filter((i) => !processedKeys.has(`${i.collection}:${i.id}`)).slice(0, limit)
    console.log(`Processing: ${remaining.length}`)

    if (remaining.length === 0) { console.log('Nothing to process.'); return }

    const startTime = Date.now()
    let sessionProcessed = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]
      const chunks = detectAndSplit(item.fullText, item.title, item.docType)
      const isThesis = item.docType === 'thesis' || item.docType === 'book'
      const isDocument = item.collection === 'documents'

      if (dryRun) {
        const structType = chunks[0]?.isChapter ? 'chapters' : chunks.length > 1 ? 'sections' : 'single'
        console.log(`  ${item.collection}:${item.id}: "${item.title.slice(0, 55)}" (${(item.textLen / 1000).toFixed(0)}K → ${chunks.length} ${structType})`)
        if (isThesis && chunks[0]?.isChapter) {
          for (const ch of chunks.slice(0, 5)) console.log(`    ${ch.label}`)
          if (chunks.length > 5) console.log(`    ... +${chunks.length - 5} more`)
        }
        sessionProcessed++
        continue
      }

      try {
        const chunkExtractions: any[] = []
        let docCost = 0

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci]
          const prompt = isThesis && chunk.isChapter ? THESIS_CHAPTER_PROMPT
            : isDocument ? DOCUMENT_SECTION_PROMPT
            : PUBLICATION_SECTION_PROMPT

          const result = await callClaude(prompt, chunk.text, `${item.title} — ${chunk.label}`)

          if (result) {
            const ext = result.extraction
            totalInputTokens += result.inputTokens
            totalOutputTokens += result.outputTokens
            docCost += (result.inputTokens * 3 + result.outputTokens * 15) / 1_000_000

            // Attach chapter metadata for theses
            if (isThesis && chunk.isChapter) {
              ext._chapterMeta = {
                chapterNum: chunk.chapterNum,
                label: chunk.label,
                chapterTitle: ext.chapterTitle || chunk.label,
                chapterSummary: ext.chapterSummary || null,
                researchQuestion: ext.researchQuestion || null,
              }
            }
            chunkExtractions.push(ext)
          }

          if (ci < chunks.length - 1) await sleep(300)
        }

        const merged = chunkExtractions.length > 0
          ? mergeChapterExtractions(chunkExtractions)
          : { species: [], places: [], protocolsNamed: [], concepts: [] }

        results.push({
          id: item.id,
          collection: item.collection,
          title: item.title,
          docType: item.docType,
          strategy3: {
            extraction: merged,
            cost: docCost,
            chunks: chunks.length,
            structureType: chunks[0]?.isChapter ? 'chapters' : chunks.length > 1 ? 'sections' : 'unstructured',
          },
        })

        sessionProcessed++
      } catch (err: any) {
        console.log(` error on ${item.collection}:${item.id}: ${err.message?.slice(0, 100)}`)
        results.push({
          id: item.id, collection: item.collection, title: item.title, docType: item.docType,
          strategy3: { extraction: { species: [], places: [], protocolsNamed: [], concepts: [] }, error: err.message?.slice(0, 200) },
        })
        sessionProcessed++
      }

      // Incremental save
      writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))

      if (sessionProcessed % PROGRESS_INTERVAL === 0 || i === remaining.length - 1) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = sessionProcessed / (elapsed / 60)
        const totalRemaining = remaining.length - sessionProcessed
        const etaMin = rate > 0 ? totalRemaining / rate : 0
        const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000
        console.log(`  [${sessionProcessed}/${remaining.length}] ${(elapsed / 60).toFixed(1)}min, ${rate.toFixed(1)} items/min, cost=$${cost.toFixed(2)}, ETA ${Math.round(etaMin)}min`)
      }
    }

    console.log(`\n========== Summary ==========`)
    console.log(`  Total results: ${results.length}`)
    console.log(`  This session: ${sessionProcessed}`)
    const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000
    console.log(`  Cost: $${cost.toFixed(2)}`)
    if (!dryRun) console.log(`  Saved to: ${RESULTS_PATH}`)

    // Stats
    let totalSpecies = 0, totalPlaces = 0, totalProtocols = 0, totalConcepts = 0, chaptersFound = 0
    for (const r of results) {
      const e = r.strategy3?.extraction
      if (e) {
        totalSpecies += (e.species || []).length
        totalPlaces += (e.places || []).length
        totalProtocols += (e.protocolsNamed || []).length
        totalConcepts += (e.concepts || []).length
        if (e.chapters) chaptersFound += e.chapters.length
      }
    }
    console.log(`  Extracted: ${totalSpecies} species, ${totalPlaces} places, ${totalProtocols} protocols, ${totalConcepts} concepts`)
    if (chaptersFound > 0) console.log(`  Thesis chapters with metadata: ${chaptersFound}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
