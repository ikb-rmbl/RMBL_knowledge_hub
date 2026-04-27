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
        url: a.sourceUrl || null,
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
        url: a.sourceUrl || null,
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

    const sourceUrl = a.url || a.sourceUrl || null
    const summary = a.summary || a.excerpt?.slice(0, 300) || null

    // Dedup: check by source_url or normalized title
    const normTitle = a.title.replace(/\s+/g, ' ').replace(/\s+(['''])/g, '$1').trim()
    let existingId: number | null = null
    let existingTextLen = 0

    if (sourceUrl) {
      const { rows } = await db.query('SELECT id, length(coalesce(full_text, summary, \'\')) as tlen FROM stories WHERE source_url = $1 LIMIT 1', [sourceUrl])
      if (rows.length > 0) { existingId = rows[0].id; existingTextLen = rows[0].tlen }
    }
    if (!existingId) {
      const { rows } = await db.query(
        "SELECT id, length(coalesce(full_text, summary, '')) as tlen FROM stories WHERE lower(regexp_replace(title, '\\s+', ' ', 'g')) = lower($1) LIMIT 1",
        [normTitle],
      )
      if (rows.length > 0) { existingId = rows[0].id; existingTextLen = rows[0].tlen }
    }

    // If a match exists, update it if we have more content
    const newTextLen = (a.fullText || '').length + (summary || '').length
    if (existingId) {
      if (newTextLen > existingTextLen) {
        await db.query(
          `UPDATE stories SET full_text = COALESCE($1, full_text), summary = COALESCE($2, summary),
           author = COALESCE($3, author), source_url = COALESCE($4, source_url),
           updated_at = NOW() WHERE id = $5`,
          [a.fullText || null, summary, author, sourceUrl, existingId],
        )
        loaded++
      } else {
        // Still update missing fields (author, source_url) even if text isn't longer
        await db.query(
          `UPDATE stories SET author = COALESCE(author, $1), source_url = COALESCE(source_url, $2),
           updated_at = NOW() WHERE id = $3`,
          [author, sourceUrl, existingId],
        )
        skipped++
      }
      continue
    }

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
