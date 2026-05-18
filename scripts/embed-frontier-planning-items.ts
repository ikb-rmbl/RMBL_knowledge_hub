/**
 * Embed frontier planning items with Voyage AI voyage-4.
 *
 * Embeds only the raw item text (not the parent-frontier title) — we
 * want clusters to surface "same kind of investment across different
 * frontiers" rather than "items that happen to share a parent."
 *
 * Resumable: by default only embeds rows where embedding IS NULL.
 *
 * Usage:
 *   npx tsx scripts/embed-frontier-planning-items.ts
 *   npx tsx scripts/embed-frontier-planning-items.ts --force        # re-embed all
 *   npx tsx scripts/embed-frontier-planning-items.ts --limit=200    # partial batch
 */

import pg from 'pg'
import { embedTexts } from './lib/embedding-cluster.js'
import './lib/config.js'

const args = process.argv.slice(2)
const force = args.includes('--force')
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10)

// Mirror generate-embeddings.ts: voyage handles up to 32K chars per item,
// but planning items are short sentences — well under the limit.
const MAX_CHARS = 32_000

async function main() {
  console.log('Embed frontier planning items')
  console.log('=============================')

  if (!process.env.VOYAGE_API_KEY) {
    console.error('VOYAGE_API_KEY missing from .env')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const whereClause = force ? '' : 'WHERE embedding IS NULL'
  const limitClause = limit > 0 ? `LIMIT ${limit}` : ''
  const { rows: items } = await db.query(
    `SELECT id, text FROM frontier_planning_items ${whereClause} ORDER BY id ${limitClause}`,
  )

  if (items.length === 0) {
    console.log('  Nothing to embed.')
    await db.end()
    return
  }

  console.log(`  ${items.length} items to embed${force ? ' (--force)' : ''}`)

  // Truncate over-long texts defensively (won't matter for this corpus).
  const texts = items.map((r: any) => (r.text || '').slice(0, MAX_CHARS))

  console.log('  Calling Voyage AI...')
  const t0 = Date.now()
  const vectors = await embedTexts(texts)
  console.log(`  Got ${vectors.length} embeddings in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  if (vectors.length !== items.length) {
    throw new Error(`embedding count mismatch: ${vectors.length} vs ${items.length}`)
  }

  console.log('  Writing to DB...')
  let written = 0
  for (let i = 0; i < items.length; i++) {
    const vec = `[${vectors[i].join(',')}]`
    await db.query(
      'UPDATE frontier_planning_items SET embedding = $1::vector WHERE id = $2',
      [vec, items[i].id],
    )
    written++
    if (written % 200 === 0) process.stdout.write(`\r  Updated ${written}/${items.length}`)
  }
  process.stdout.write(`\r  Updated ${written}/${items.length}\n`)

  const { rows: [{ n }] } = await db.query(
    'SELECT count(*)::int AS n FROM frontier_planning_items WHERE embedding IS NOT NULL',
  )
  console.log(`\nDone: ${n} items have embeddings`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
