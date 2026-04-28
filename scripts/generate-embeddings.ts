/**
 * Generate Embeddings for Concept Graph & Similarity Search
 *
 * Tier A (summary): One embedding per item from title + abstract/description.
 *                    Powers "Related Works" panels and hybrid search.
 * Tier B (chunks):  Future — multiple embeddings per item from full-text chunks.
 *                    Powers RAG Q&A and entity-level concept graphs.
 *
 * Requires: VOYAGE_API_KEY environment variable
 *
 * Usage:
 *   npx tsx scripts/generate-embeddings.ts [--collection=publications|datasets|documents|stories|all] [--level=summary] [--dry-run] [--limit=N] [--force]
 */

import pg from 'pg'
import { sleep } from './lib/concurrency.js'
import { VOYAGE_API_KEY, VOYAGE_MODEL, EMBEDDING_DIMENSIONS } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const collectionArg = args.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'
const levelArg = args.find((a) => a.startsWith('--level='))?.split('=')[1] || 'summary'
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const BATCH_SIZE = 128 // Voyage AI max batch size

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

function preparePublicationText(row: any): string {
  const parts = [row.title || '']
  if (row.abstract && row.abstract.length > 10) {
    parts.push(row.abstract)
  } else if (row.full_text && row.full_text.length > 100) {
    // Take first ~500 words of full text as fallback
    parts.push(row.full_text.split(/\s+/).slice(0, 500).join(' '))
  }
  if (row.journal) parts.push(`Published in: ${row.journal}`)
  return parts.join('. ').slice(0, 32000) // stay well under token limit
}

function prepareDatasetText(row: any): string {
  const parts = [row.title || '']
  const desc = typeof row.description === 'string' ? row.description :
    (row.description && typeof row.description === 'object') ? JSON.stringify(row.description).replace(/[{}"\\]/g, '').slice(0, 2000) : ''
  if (desc.length > 10) parts.push(desc)
  if (row.methods && row.methods.length > 10) {
    parts.push(row.methods.split(/\s+/).slice(0, 500).join(' '))
  }
  if (row.spatial_description) parts.push(`Location: ${row.spatial_description}`)
  return parts.join('. ').slice(0, 32000)
}

function prepareDocumentText(row: any): string {
  const parts = [row.title || '']
  const summary = typeof row.summary === 'string' ? row.summary :
    (row.summary && typeof row.summary === 'object') ? JSON.stringify(row.summary).replace(/[{}"\\]/g, '').slice(0, 2000) : ''
  if (summary.length > 10) {
    parts.push(summary)
  } else if (row.full_text && row.full_text.length > 100) {
    parts.push(row.full_text.split(/\s+/).slice(0, 500).join(' '))
  }
  return parts.join('. ').slice(0, 32000)
}

function prepareStoryText(row: any): string {
  const parts = [row.title || '']
  if (row.summary && row.summary.length > 20) parts.push(row.summary)
  if (row.full_text && row.full_text.length > 100) {
    parts.push(row.full_text.split(/\s+/).slice(0, 500).join(' '))
  }
  if (row.author) parts.push(`By: ${row.author}`)
  return parts.join('. ').slice(0, 32000)
}

// ---------------------------------------------------------------------------
// Embedding generation via Voyage AI REST API
// ---------------------------------------------------------------------------

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'

async function generateEmbeddings(
  texts: string[],
): Promise<number[][]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'document',
      output_dimension: EMBEDDING_DIMENSIONS,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Voyage AI API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.data.map((d: any) => d.embedding)
}

// ---------------------------------------------------------------------------
// Per-collection embedding
// ---------------------------------------------------------------------------

async function embedCollection(
  db: pg.Pool,
  collection: 'publications' | 'datasets' | 'documents' | 'stories',
  textPreparer: (row: any) => string,
): Promise<{ embedded: number; skipped: number; errors: number }> {
  const table = collection
  const whereClause = force ? '' : 'AND embedding IS NULL'

  const { rows } = await db.query(
    `SELECT * FROM ${table} WHERE true ${whereClause} ORDER BY id`,
  )
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} items need embeddings (${candidates.length} to process)`)

  if (candidates.length === 0) return { embedded: 0, skipped: 0, errors: 0 }

  let embedded = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const texts = batch.map(textPreparer)

    // Skip items with no meaningful text
    const validIndices: number[] = []
    const validTexts: string[] = []
    for (let j = 0; j < texts.length; j++) {
      if (texts[j].length > 20) {
        validIndices.push(j)
        validTexts.push(texts[j])
      } else {
        skipped++
      }
    }

    if (validTexts.length === 0) continue

    try {
      const embeddings = dryRun ? validTexts.map(() => []) : await generateEmbeddings(validTexts)

      for (let j = 0; j < validIndices.length; j++) {
        const row = batch[validIndices[j]]
        const embeddingStr = dryRun ? null : `[${embeddings[j].join(',')}]`

        if (!dryRun) {
          // Store on collection table
          await db.query(
            `UPDATE ${table} SET embedding = $1::vector WHERE id = $2`,
            [embeddingStr, row.id],
          )

          // Also store in content_chunks for future extensibility
          await db.query(
            `INSERT INTO content_chunks (collection, item_id, chunk_index, chunk_text, embedding, embedding_model, chunk_method)
             VALUES ($1, $2, 0, $3, $4::vector, $5, 'summary')
             ON CONFLICT DO NOTHING`,
            [collection, row.id, validTexts[j].slice(0, 5000), embeddingStr, VOYAGE_MODEL],
          )
        }
        embedded++
      }
    } catch (err: any) {
      console.error(`\n  Batch error: ${err.message?.slice(0, 100)}`)
      errors += validTexts.length

      if (err.message?.includes('rate') || err.message?.includes('429')) {
        console.log('  Rate limited, waiting 10s...')
        await sleep(10000)
        i -= BATCH_SIZE // retry
        continue
      }
    }

    if ((i + BATCH_SIZE) % (BATCH_SIZE * 5) === 0 || i + BATCH_SIZE >= candidates.length) {
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length} (${embedded} embedded, ${skipped} skipped, ${errors} errors)`)
    }

    await sleep(200) // respect rate limits
  }

  console.log(`\r  ${candidates.length} processed: ${embedded} embedded, ${skipped} skipped, ${errors} errors`)
  return { embedded, skipped, errors }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Generate Embeddings for Concept Graph')
  console.log('=====================================')
  console.log(`Model: ${VOYAGE_MODEL}, Dimensions: ${EMBEDDING_DIMENSIONS}`)
  console.log(`Collection: ${collectionArg}, Level: ${levelArg}`)
  if (force) console.log('(FORCE: re-generating all embeddings)')
  if (dryRun) console.log('(DRY RUN)')

  if (!VOYAGE_API_KEY && !dryRun) {
    console.error('\nError: VOYAGE_API_KEY environment variable is required.')
    console.error('Get an API key at https://dash.voyageai.com/ and set it:')
    console.error('  export VOYAGE_API_KEY=your-key-here')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
  })

  const runPubs = collectionArg === 'publications' || collectionArg === 'all'
  const runDatasets = collectionArg === 'datasets' || collectionArg === 'all'
  const runDocs = collectionArg === 'documents' || collectionArg === 'all'
  const runStories = collectionArg === 'stories' || collectionArg === 'all'

  let totalEmbedded = 0

  if (runPubs) {
    console.log('\n--- Publications ---')
    const r = await embedCollection(db, 'publications', preparePublicationText)
    totalEmbedded += r.embedded
  }

  if (runDatasets) {
    console.log('\n--- Datasets ---')
    const r = await embedCollection(db, 'datasets', prepareDatasetText)
    totalEmbedded += r.embedded
  }

  if (runDocs) {
    console.log('\n--- Documents ---')
    const r = await embedCollection(db, 'documents', prepareDocumentText)
    totalEmbedded += r.embedded
  }

  if (runStories) {
    console.log('\n--- Stories ---')
    const r = await embedCollection(db, 'stories', prepareStoryText)
    totalEmbedded += r.embedded
  }

  // Summary
  const { rows: stats } = await db.query(`
    SELECT 'publications' as collection, count(*) as total,
      count(*) FILTER (WHERE embedding IS NOT NULL) as with_embedding
    FROM publications
    UNION ALL
    SELECT 'datasets', count(*), count(*) FILTER (WHERE embedding IS NOT NULL) FROM datasets
    UNION ALL
    SELECT 'documents', count(*), count(*) FILTER (WHERE embedding IS NOT NULL) FROM documents
    UNION ALL
    SELECT 'stories', count(*), count(*) FILTER (WHERE embedding IS NOT NULL) FROM stories
  `)

  const { rows: chunkStats } = await db.query(
    `SELECT count(*) as chunks FROM content_chunks`,
  )

  console.log('\n========== Embedding Coverage ==========')
  for (const s of stats) {
    console.log(`${s.collection}: ${s.with_embedding}/${s.total} (${(s.with_embedding / s.total * 100).toFixed(0)}%)`)
  }
  console.log(`Content chunks: ${chunkStats[0].chunks}`)
  console.log(`Total embedded this run: ${totalEmbedded}`)

  await db.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
