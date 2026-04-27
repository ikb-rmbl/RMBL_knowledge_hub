/**
 * Extract entities from news stories using Claude API.
 *
 * Stories are journalistic articles about RMBL research and the Gunnison Basin.
 * The extraction prompt is adapted for news content — focuses on researchers
 * mentioned, species discussed, places referenced, and research topics covered.
 *
 * Usage:
 *   npx tsx scripts/extract-story-entities.ts [--dry-run] [--limit=N]
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
const RESULTS_PATH = `${OUTPUT_DIR}/story-entity-extraction.json`
const PROGRESS_INTERVAL = 25

const CHUNK_SIZE = 12000
const CHUNK_OVERLAP = 500
const MAX_CHUNKS = 5

const PROMPT = `You are extracting structured information from a news article about the Rocky Mountain Biological Laboratory (RMBL) or environmental research in the Gunnison Basin, Colorado.

These are journalistic articles from newspapers, wire services, and news websites. They cover RMBL research, local environmental issues, land management, and community events related to science and conservation.

Extract the following entities ONLY if they are explicitly named or clearly referenced in the text. Do NOT infer or fabricate information.

Return a JSON object:

{
  "species": [
    {
      "scientificName": "Genus species if given, otherwise use common name",
      "commonName": "common name or null",
      "kingdom": "Animalia|Plantae|Fungi or null",
      "role": "study_subject|mentioned|conservation_concern|pest|invasive"
    }
  ],
  "places": [
    {
      "name": "place name",
      "type": "study_site|town|valley|watershed|stream|river|lake|peak|meadow|county|state|national_forest|wilderness_area|facility",
      "parentName": "containing place or null",
      "role": "research_site|event_location|affected_area|reference"
    }
  ],
  "concepts": [
    {
      "name": "research topic or concept",
      "type": "research_topic|environmental_issue|policy|method|phenomenon",
      "scope": "climate|hydrology|population_ecology|community_ecology|evolution|conservation|land_use|water_resources|recreation|education",
      "role": "primary_topic|secondary_topic|context"
    }
  ],
  "researchers": [
    {
      "name": "full name as given in the article",
      "affiliation": "institution if mentioned, or null",
      "role": "quoted_source|study_author|mentioned|subject_of_article"
    }
  ],
  "agencies": ["list of organizations, agencies, or institutions mentioned"],
  "publicationsReferenced": [
    {
      "title": "title of the study or paper as described in the article",
      "journal": "journal or publication venue if mentioned, or null",
      "year": "publication year if mentioned, or null",
      "authors": "author names associated with the study, or null",
      "doi": "DOI if mentioned, or null"
    }
  ],
  "projects": [
    {
      "name": "project name as mentioned or clearly referenced in the article",
      "role": "primary_subject|mentioned|context"
    }
  ],
  "storyType": "news_article|research_summary|opinion_editorial|press_release|profile|obituary|event_coverage|legislative|field_notes|interview|feature|scientific_paper|other",
  "storyTopics": ["1-3 word topic tags summarizing what the story is about, max 5"]
}

Important:
- Researchers: extract ALL named scientists, professors, researchers, directors mentioned. Include their affiliation if stated (e.g., "RMBL", "University of Maryland", "USGS").
- Species: include both scientific names and common names (marmots, wildflowers, butterflies, etc.)
- Places: include RMBL, Gothic, specific research sites, and broader geographic references (Gunnison Basin, East River Valley, etc.)
- Concepts: focus on the research topics being discussed, not generic journalism terms
- publicationsReferenced: extract any specific studies, papers, or reports mentioned in the article. News articles often describe research findings — capture the study title (or a descriptive title if not explicitly named), the journal, year, and authors when stated. Examples: "a study published in Science", "research published in Proceedings of the Royal Society", "a paper in the journal Ecology".
- projects: extract named research projects, programs, or initiatives. Common RMBL projects include: SAIL (Surface Atmosphere Integrated Laboratory), SPLASH (Study of Precipitation, the Lower Atmosphere and Surface for Hydrometeorology), Warming Meadow / WaRM (Warming and Removal in Mountains), Marmot Project, Underwood-Inouye Long-term Phenology, East River Watershed Function SFA, Spatial Data Platform, RMBL 365. Also capture any other named projects, grants, or research programs mentioned.
- storyType: classify the article into one category. Use: "news_article" (standard reporting), "research_summary" (coverage of a specific study's findings), "opinion_editorial" (op-ed, commentary, or opinion piece), "press_release" (official release from an institution), "profile" (biographical piece about a person), "obituary" (death notice or memorial), "event_coverage" (festival, ceremony, meeting coverage), "legislative" (bill, law, government action), "field_notes" (observational notes from the field), "interview" (Q&A or interview format), "feature" (long-form narrative or magazine-style article), "scientific_paper" (appears to be a research paper rather than journalism), "other"
- storyTopics: brief tags like "marmot research", "snowpack forecasting", "RMBL expansion", "wildflower phenology"
- Return valid JSON only — no markdown, no commentary`

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaude(text: string, title: string): Promise<any | null> {
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
        model: 'claude-opus-4-7',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `${PROMPT}\n\nArticle title: "${title}"\n\nArticle text:\n${text}`,
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
        try {
          return { extraction: JSON.parse(cleaned.slice(start, end + 1)), inputTokens, outputTokens }
        } catch { /* fall through */ }
      }
      // Truncated JSON recovery
      if (start >= 0) {
        let attempt = cleaned.slice(start)
        attempt = attempt.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '')
        const openBraces = (attempt.match(/\{/g) || []).length - (attempt.match(/\}/g) || []).length
        const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length
        attempt += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces))
        try {
          return { extraction: JSON.parse(attempt), inputTokens, outputTokens }
        } catch { /* fall through */ }
      }
      console.log(` JSON parse failed (${responseText.length} chars)`)
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
  while (pos < text.length && chunks.length < MAX_CHUNKS) {
    let end = pos + CHUNK_SIZE
    if (end < text.length) {
      const paraBreak = text.lastIndexOf('\n\n', end)
      if (paraBreak > pos + CHUNK_SIZE * 0.6) end = paraBreak
    }
    chunks.push(text.slice(pos, end))
    pos = end - CHUNK_OVERLAP
    if (end >= text.length) break
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Merge extractions across chunks
// ---------------------------------------------------------------------------

function mergeExtractions(parts: any[]): any {
  if (parts.length === 1) return parts[0]

  const speciesByName = new Map<string, any>()
  const placesByName = new Map<string, any>()
  const conceptsByName = new Map<string, any>()
  const researchersByName = new Map<string, any>()
  const allAgencies = new Set<string>()
  const allTopics = new Set<string>()
  const pubsByTitle = new Map<string, any>()
  const projectsByName = new Map<string, any>()
  let storyType: string | null = null

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
    for (const r of p.researchers || []) {
      const key = (r.name || '').toLowerCase()
      if (key && !researchersByName.has(key)) researchersByName.set(key, r)
    }
    for (const a of p.agencies || []) allAgencies.add(a)
    for (const t of p.storyTopics || []) allTopics.add(t)
    for (const pub of p.publicationsReferenced || []) {
      const key = (pub.title || '').toLowerCase().slice(0, 60)
      if (key && !pubsByTitle.has(key)) pubsByTitle.set(key, pub)
    }
    for (const proj of p.projects || []) {
      const key = (proj.name || '').toLowerCase()
      if (key && !projectsByName.has(key)) projectsByName.set(key, proj)
    }
    if (p.storyType && !storyType) storyType = p.storyType
  }

  return {
    species: [...speciesByName.values()],
    places: [...placesByName.values()],
    concepts: [...conceptsByName.values()],
    researchers: [...researchersByName.values()],
    agencies: [...allAgencies],
    publicationsReferenced: [...pubsByTitle.values()],
    projects: [...projectsByName.values()],
    storyType,
    storyTopics: [...allTopics].slice(0, 5),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Extract Story Entities')
  console.log('======================')
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
    // Extract from stories with 1K-50K chars of full text
    // Skips: summary-only (<1K), very short articles, and extremely long items (>50K, likely full research papers)
    const { rows: stories } = await db.query(`
      SELECT id, title, full_text as text, length(full_text) as text_len
      FROM stories
      WHERE full_text IS NOT NULL
        AND length(full_text) BETWEEN 1000 AND 50000
      ORDER BY length(full_text) DESC, id
    `)
    console.log(`\n${stories.length} stories with extractable text`)

    // Resume support
    let results: any[] = []
    const processedIds = new Set<number>()
    if (existsSync(RESULTS_PATH)) {
      results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
      for (const r of results) processedIds.add(r.id)
      console.log(`Resuming: ${processedIds.size} already processed`)
    }

    const remaining = stories.filter((s) => !processedIds.has(s.id)).slice(0, limit)
    console.log(`Processing: ${remaining.length}`)

    if (remaining.length === 0 || dryRun) {
      if (dryRun) {
        const totalTokenEst = remaining.reduce((s, r) => s + Math.round(r.text_len * 0.3), 0)
        console.log(`Estimated tokens: ~${totalTokenEst.toLocaleString()} input`)
        console.log(`Estimated cost: ~$${(totalTokenEst * 3 / 1_000_000).toFixed(2)} (Sonnet input)`)
      }
      return
    }

    const startTime = Date.now()
    let sessionProcessed = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    for (let i = 0; i < remaining.length; i++) {
      const story = remaining[i]
      const chunks = chunkText(story.text)

      const chunkResults: any[] = []
      for (const chunk of chunks) {
        const result = await callClaude(chunk, story.title)
        if (result) {
          chunkResults.push(result.extraction)
          totalInputTokens += result.inputTokens
          totalOutputTokens += result.outputTokens
        }
        if (chunks.length > 1) await sleep(500)
      }

      if (chunkResults.length > 0) {
        const merged = mergeExtractions(chunkResults)
        const nSpecies = merged.species?.length || 0
        const nPlaces = merged.places?.length || 0
        const nConcepts = merged.concepts?.length || 0
        const nResearchers = merged.researchers?.length || 0
        const nPubs = merged.publicationsReferenced?.length || 0
        const nProjects = merged.projects?.length || 0
        const sType = merged.storyType || '?'

        results.push({
          id: story.id,
          title: story.title,
          ...merged,
        })

        console.log(`  ${i + 1}/${remaining.length}: [${sType}] ${story.title.slice(0, 45)} — ${nSpecies}sp ${nPlaces}pl ${nConcepts}co ${nResearchers}res ${nPubs}pub ${nProjects}prj`)
      } else {
        console.log(`  ${i + 1}/${remaining.length}: ${story.title.slice(0, 55)} — FAILED`)
      }

      sessionProcessed++

      // Save incrementally
      if (sessionProcessed % PROGRESS_INTERVAL === 0) {
        writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))
        const elapsed = (Date.now() - startTime) / 1000
        const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000
        console.log(`  [saved ${results.length} results, ${elapsed.toFixed(0)}s, $${cost.toFixed(2)}]`)
      }

      await sleep(300)
    }

    writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))

    const elapsed = (Date.now() - startTime) / 1000
    const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000
    console.log(`\n========== Summary ==========`)
    console.log(`Processed: ${sessionProcessed}`)
    console.log(`Total results: ${results.length}`)
    console.log(`Tokens: ${totalInputTokens.toLocaleString()} in, ${totalOutputTokens.toLocaleString()} out`)
    console.log(`Cost: $${cost.toFixed(2)}`)
    console.log(`Time: ${elapsed.toFixed(0)}s`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
