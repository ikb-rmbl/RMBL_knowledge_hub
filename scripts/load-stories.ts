/**
 * Load scraped news articles into the stories table.
 *
 * Usage:
 *   npx tsx scripts/load-stories.ts
 */

import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import './lib/config.js'

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })

  // Load from all available scraped article files
  const articleFiles = [
    'scripts/output/news-articles.json',
    'scripts/output/gunnison-times-articles.json',
  ]
  const articles: any[] = []
  for (const f of articleFiles) {
    if (existsSync(f)) {
      const data = JSON.parse(readFileSync(f, 'utf-8'))
      articles.push(...data)
      console.log(`  ${f}: ${data.length} articles`)
    }
  }

  // Load Lexis articles (index PDF — summary only, no full text)
  const lexisFile = 'scripts/output/lexis-articles.json'
  if (existsSync(lexisFile)) {
    const lexis = JSON.parse(readFileSync(lexisFile, 'utf-8'))
    for (const a of lexis) {
      articles.push({
        title: a.title,
        fullText: null,
        summary: a.summary || null,
        date: a.date || null,
        author: a.author || null,
        url: null,
        source: a.publication || a.source || 'LexisNexis',
        storyType: 'news_article',
      })
    }
    console.log(`  ${lexisFile}: ${lexis.length} articles`)
  }

  // Load Lexis full-text articles (overrides index-only entries with same title)
  const lexisFullFile = 'scripts/output/lexis-fulltext-articles.json'
  if (existsSync(lexisFullFile)) {
    const lexisFull = JSON.parse(readFileSync(lexisFullFile, 'utf-8'))
    for (const a of lexisFull) {
      articles.push({
        title: a.title,
        fullText: a.fullText || null,
        summary: a.summary || null,
        date: a.date || null,
        author: a.author || null,
        url: null,
        source: a.publication || 'LexisNexis',
        storyType: 'news_article',
      })
    }
    console.log(`  ${lexisFullFile}: ${lexisFull.length} articles`)
  }

  console.log(`Loading ${articles.length} articles into stories table...`)

  let loaded = 0, skipped = 0
  for (const a of articles) {
    if ((!a.fullText || a.fullText.length < 50) && (!a.summary || a.summary.length < 20)) { skipped++; continue }
    // Skip calendar/event listings
    const titleLower = a.title.toLowerCase()
    if (titleLower.includes('community calendar') || titleLower.includes('calendar of events')
      || titleLower.includes('kids calendar') || titleLower.includes("kid's calendar")
      || titleLower.startsWith('briefs')) { skipped++; continue }

    // Prefer byline from article text over CMS author
    let author = a.author
    const bySearch = (a.fullText || '').slice(0, 500).replace(/\r/g, '\n')
    const byMatch = bySearch.match(/\[?\s*[Bb][Yy]\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*\]?/m)
    if (byMatch) author = byMatch[1].trim()
    if (author === 'Michelle') author = null

    const dateStr = a.date ? new Date(a.date).toISOString() : null

    const sourceUrl = a.url || null
    const summary = a.summary || a.excerpt?.slice(0, 300) || null

    // Dedup: check source_url if available, otherwise title match
    let exists = false
    if (sourceUrl) {
      const { rows } = await db.query('SELECT 1 FROM stories WHERE source_url = $1 LIMIT 1', [sourceUrl])
      exists = rows.length > 0
    } else {
      const { rows } = await db.query('SELECT 1 FROM stories WHERE lower(title) = lower($1) LIMIT 1', [a.title])
      exists = rows.length > 0
    }
    if (exists) { skipped++; continue }

    const { rowCount } = await db.query(
      `INSERT INTO stories (title, story_type, author, date, summary, full_text, source_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, NOW(), NOW())`,
      [a.title, a.storyType || 'news_article', author, dateStr, summary, a.fullText || null, sourceUrl],
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
