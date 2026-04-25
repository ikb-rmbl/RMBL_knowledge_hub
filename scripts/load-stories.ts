/**
 * Load scraped news articles into the stories table.
 *
 * Usage:
 *   npx tsx scripts/load-stories.ts
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const articles = JSON.parse(readFileSync('scripts/output/news-articles.json', 'utf-8'))

  console.log(`Loading ${articles.length} articles into stories table...`)

  let loaded = 0, skipped = 0
  for (const a of articles) {
    if (!a.fullText || a.fullText.length < 50) { skipped++; continue }
    // Skip calendar/event listings
    const titleLower = a.title.toLowerCase()
    if (titleLower.includes('community calendar') || titleLower.includes('calendar of events')
      || titleLower.includes('kids calendar') || titleLower.includes("kid's calendar")
      || titleLower.startsWith('briefs')) { skipped++; continue }

    // Prefer byline from article text over CMS author
    let author = a.author
    const bySearch = a.fullText.slice(0, 500).replace(/\r/g, '\n')
    const byMatch = bySearch.match(/\[?\s*[Bb][Yy]\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*\]?/m)
    if (byMatch) author = byMatch[1].trim()
    if (author === 'Michelle') author = null

    const dateStr = a.date ? new Date(a.date).toISOString() : null

    const { rowCount } = await db.query(
      `INSERT INTO stories (title, story_type, author, date, summary, full_text, source_url, created_at, updated_at)
       SELECT $1::text, 'news_article', $2::text, $3::timestamptz, $4::text, $5::text, $6::text, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM stories WHERE source_url = $6::text)`,
      [a.title, author, dateStr, a.excerpt?.slice(0, 300) || null, a.fullText, a.url],
    )
    if ((rowCount || 0) > 0) loaded++
    else skipped++
  }

  // Update search vectors
  await db.query(`
    UPDATE stories SET search_vector =
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
    WHERE search_vector IS NULL
  `)

  const { rows: [{ n }] } = await db.query('SELECT count(*)::int as n FROM stories')
  console.log(`Loaded: ${loaded}, Skipped: ${skipped}, Total in DB: ${n}`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
