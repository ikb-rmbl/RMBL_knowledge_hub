/**
 * Extract entities from dataset metadata using Claude API (text-only).
 *
 * Feeds title + description + methods + keywords to Claude and extracts
 * species, places, protocols, and concepts in the same format as the
 * publication VLM extraction pipeline.
 *
 * Usage:
 *   npx tsx scripts/extract-dataset-entities.ts [--dry-run] [--limit=N]
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
const RESULTS_PATH = `${OUTPUT_DIR}/dataset-entity-extraction.json`
const BATCH_SIZE = 5 // datasets per API call (they're short)
const PROGRESS_INTERVAL = 25

const PROMPT = `You are extracting structured entity information from a research dataset's metadata. The metadata includes the dataset's title, description, methods, and keywords.

Extract the following entities ONLY if they are explicitly mentioned in the text. Do NOT infer or fabricate information.

Return a JSON object with these fields:

{
  "species": [
    {
      "scientificName": "Genus species",
      "commonName": "common name or null",
      "family": "taxonomic family or null",
      "kingdom": "Animalia|Plantae|Fungi|Bacteria|etc or null",
      "role": "study subject|habitat component|predator|prey|pollinator|host|parasite|etc"
    }
  ],
  "places": [
    {
      "name": "place name",
      "type": "study_site|watershed|stream|lake|peak|valley|meadow|county|state|region|country",
      "parentName": "containing place or null",
      "coordinates": "lat, lon or null",
      "elevation": "elevation with units or null",
      "role": "study site|data collection site|reference site|etc"
    }
  ],
  "protocols": [
    {
      "proposedName": "short descriptive name for the method",
      "category": "sampling|measurement|analytical|experimental|observational|computational|laboratory",
      "description": "1-2 sentence description of what this method does",
      "role": "primary method|data collection|analysis|quality control"
    }
  ],
  "concepts": [
    {
      "name": "concept name",
      "type": "process|phenomenon|measurement|metric|framework|theory|hypothesis",
      "scope": "general_ecology|climate|hydrology|population_ecology|community_ecology|evolution|biogeochemistry|landscape|molecular|methodological",
      "role": "primary focus|context|measured variable"
    }
  ],
  "relatedPublicationDois": ["10.xxxx/yyyy"]
}

Important:
- Extract ALL species mentioned, including those in keywords
- For places, be specific: extract named sites, watersheds, streams, mountains — not just "Colorado"
- For protocols, describe the data collection or analysis methods mentioned
- For concepts, focus on the scientific phenomena or variables the dataset measures
- Include any DOIs mentioned that reference related publications
- Return valid JSON only — no markdown, no commentary`

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaude(datasetTexts: { id: number; text: string }[]): Promise<{ id: number; extraction: any }[]> {
  const userContent = datasetTexts.map((d) =>
    `=== Dataset ${d.id} ===\n${d.text}`
  ).join('\n\n')

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
          content: `${PROMPT}\n\nExtract entities from each dataset below. Return a JSON array with one object per dataset, each containing an "id" field and the entity fields described above.\n\n${userContent}`,
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

    // Parse JSON array response
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      return arr.map((item: any) => ({
        id: item.id || datasetTexts[0]?.id,
        extraction: item,
      }))
    } catch {
      // Try to find JSON array in response
      const start = cleaned.indexOf('[')
      const end = cleaned.lastIndexOf(']')
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, end + 1))
          return parsed.map((item: any) => ({
            id: item.id || datasetTexts[0]?.id,
            extraction: item,
          }))
        } catch { /* fall through */ }
      }
      console.log(` JSON parse failed (${text.length} chars)`)
      return []
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Extract Dataset Entities')
  console.log('========================')
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
    // Load datasets with enough text for extraction
    const { rows: datasets } = await db.query(`
      SELECT id, title, full_text, methods, spatial_description
      FROM datasets
      WHERE full_text IS NOT NULL AND length(full_text) >= 100
      ORDER BY id
    `)
    console.log(`\n${datasets.length} datasets with extractable text`)

    // Resume support
    let results: any[] = []
    const processedIds = new Set<number>()
    if (existsSync(RESULTS_PATH)) {
      results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
      for (const r of results) processedIds.add(r.id)
      console.log(`Resuming: ${processedIds.size} already processed`)
    }

    const remaining = datasets.filter((d) => !processedIds.has(d.id)).slice(0, limit)
    console.log(`Processing: ${remaining.length}`)

    if (remaining.length === 0) {
      console.log('Nothing to process.')
      return
    }

    const startTime = Date.now()
    let sessionProcessed = 0
    let sessionCost = 0

    // Process in batches
    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      const batch = remaining.slice(i, i + BATCH_SIZE)

      const batchTexts = batch.map((d) => {
        const parts = [`Title: ${d.title}`]
        if (d.full_text) parts.push(`Description: ${d.full_text.slice(0, 4000)}`)
        if (d.methods) parts.push(`Methods: ${d.methods.slice(0, 3000)}`)
        if (d.spatial_description) parts.push(`Location: ${d.spatial_description}`)
        return { id: d.id, text: parts.join('\n\n') }
      })

      if (dryRun) {
        for (const bt of batchTexts) {
          console.log(`  ${bt.id}: ${bt.text.length} chars`)
        }
        sessionProcessed += batch.length
        continue
      }

      try {
        const extractions = await callClaude(batchTexts)

        for (const ext of extractions) {
          // Convert to the same format as publication VLM results for load-extraction-results.ts
          results.push({
            id: ext.id,
            collection: 'datasets',
            title: batch.find((d) => d.id === ext.id)?.title || '',
            strategy3: {
              extraction: {
                species: ext.extraction.species || [],
                places: ext.extraction.places || [],
                protocolsNamed: (ext.extraction.protocols || []).map((p: any) => ({
                  proposedName: p.proposedName,
                  category: p.category || 'sampling',
                  description: p.description || '',
                  role: p.role || 'data collection',
                })),
                concepts: ext.extraction.concepts || [],
                relatedPublicationDois: ext.extraction.relatedPublicationDois || [],
              },
              cost: 0, // approximate later from token counts
            },
          })
        }

        // Handle datasets that didn't get a response
        for (const d of batch) {
          if (!extractions.find((e) => e.id === d.id) && !results.find((r) => r.id === d.id)) {
            results.push({
              id: d.id,
              collection: 'datasets',
              title: d.title,
              strategy3: { extraction: { species: [], places: [], protocolsNamed: [], concepts: [] } },
            })
          }
        }

        sessionProcessed += batch.length
      } catch (err: any) {
        console.log(` error: ${err.message?.slice(0, 100)}`)
        sessionProcessed += batch.length
      }

      // Incremental save
      writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))

      // Progress
      if (sessionProcessed % PROGRESS_INTERVAL < BATCH_SIZE || i + BATCH_SIZE >= remaining.length) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = sessionProcessed / (elapsed / 60)
        const totalRemaining = remaining.length - sessionProcessed
        const etaMin = rate > 0 ? totalRemaining / rate : 0
        console.log(`  [${sessionProcessed}/${remaining.length}] ${(elapsed / 60).toFixed(1)}min, ${rate.toFixed(0)} ds/min, ETA ${Math.round(etaMin)}min`)
      }

      await sleep(500) // rate limiting between batches
    }

    console.log(`\n========== Summary ==========`)
    console.log(`  Total results: ${results.length}`)
    console.log(`  This session: ${sessionProcessed}`)
    if (!dryRun) console.log(`  Saved to: ${RESULTS_PATH}`)

    // Quick stats on what was extracted
    let totalSpecies = 0, totalPlaces = 0, totalProtocols = 0, totalConcepts = 0
    for (const r of results) {
      const e = r.strategy3?.extraction
      if (e) {
        totalSpecies += (e.species || []).length
        totalPlaces += (e.places || []).length
        totalProtocols += (e.protocolsNamed || []).length
        totalConcepts += (e.concepts || []).length
      }
    }
    console.log(`  Extracted: ${totalSpecies} species, ${totalPlaces} places, ${totalProtocols} protocols, ${totalConcepts} concepts`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
