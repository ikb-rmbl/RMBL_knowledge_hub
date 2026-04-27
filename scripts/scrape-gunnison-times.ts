/**
 * Scrape RMBL-related news articles from Gunnison Country Times.
 *
 * Only ~15 results, so no pagination needed. Polite: 2s delay between requests.
 *
 * Usage:
 *   npx tsx scripts/scrape-gunnison-times.ts [--dry-run]
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { sleep } from './lib/concurrency.js'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const OUTPUT_DIR = 'scripts/output'
const ARTICLES_FILE = `${OUTPUT_DIR}/gunnison-times-articles.json`
const DELAY_MS = 2000
const BASE_URL = 'https://www.gunnisontimes.com'
const SEARCH_URL = `${BASE_URL}/browse.html?search_filter=RMBL`
const USER_AGENT = 'RMBLKnowledgeHub/1.0 (research; ikb@rmbl.org)'

interface Article {
  url: string
  title: string
  date: string | null
  author: string | null
  summary: string | null
  fullText: string | null
  source: string
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function extractArticleUrls(html: string): { url: string; title: string }[] {
  const articles: { url: string; title: string }[] = []
  // Match links to /stories/ pages (site uses single quotes for href)
  const matches = html.matchAll(/<h3[^>]*>\s*<a\s+href=['"](\/stories\/[^'"]+)['"][^>]*>([^<]+)<\/a>/gi)
  for (const m of matches) {
    const url = `${BASE_URL}${m[1].replace(/\?$/, '')}`
    const title = m[2].trim().replace(/&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&amp;/g, '&').replace(/&#8216;/g, "'")
    // Skip duplicates and non-article links
    if (title.length > 10 && !articles.some(a => a.url === url)) {
      articles.push({ url, title })
    }
  }
  return articles
}

function extractArticleContent(html: string): { fullText: string; author: string | null; date: string | null; summary: string | null } {
  let fullText = ''
  let author: string | null = null
  let date: string | null = null
  let summary: string | null = null

  // Try JSON-LD first
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1])
      if (ld.datePublished) date = ld.datePublished
      if (ld.description) summary = ld.description.slice(0, 300)
      if (ld.author?.name) author = ld.author.name
    } catch { /* ignore */ }
  }

  // Extract body from <div class='body main-body ...'> to the next major section
  // The main-body has deeply nested divs, so we grab until below-story or ad section
  const bodyStart = html.search(/class=['"][^'"]*main-body[^'"]*['"]/)
  const bodyEnd = html.search(/class=['"][^'"]*below-story[^'"]*['"]/)
  const contentMatch = bodyStart >= 0 && bodyEnd > bodyStart
    ? [null, html.slice(bodyStart, bodyEnd)] as RegExpMatchArray
    : null
  if (contentMatch) {
    fullText = contentMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:h[1-6]|blockquote|li)>/gi, '\n\n')
      .replace(/<\/?(?:div|span|strong|em|b|i|a|p|ul|ol|li|h[1-6]|blockquote)[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#8217;|&#x2019;|\u2019/g, "'")
      .replace(/&#8220;|&#8221;|&#x201c;|&#x201d;|\u201c|\u201d/g, '"')
      .replace(/&#8211;|\u2013/g, '–')
      .replace(/&#8212;|\u2014/g, '—')
      .replace(/&amp;/g, '&')
      .replace(/ {2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  // Extract byline from text
  if (!author) {
    const bySearch = fullText.slice(0, 500).replace(/\r/g, '\n')
    const byMatch = bySearch.match(/\[?\s*[Bb][Yy]\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*\]?/m)
    if (byMatch) author = byMatch[1].trim()
  }

  return { fullText, author, date, summary }
}

async function main() {
  console.log('Scrape Gunnison Country Times — RMBL Articles')
  console.log('==============================================')
  if (dryRun) console.log('(DRY RUN)')

  // Fetch search results page
  console.log(`Fetching: ${SEARCH_URL}`)
  const searchHtml = await fetchPage(SEARCH_URL)
  const urls = extractArticleUrls(searchHtml)
  console.log(`Found ${urls.length} article links`)

  // Filter out letters to the editor and non-articles
  const filtered = urls.filter(u =>
    !u.title.toLowerCase().startsWith('letters to') &&
    !u.title.toLowerCase().includes('community calendar')
  )
  console.log(`${filtered.length} after filtering`)

  if (dryRun) {
    for (const u of filtered) console.log(`  ${u.title}`)
    return
  }

  // Fetch each article
  const articles: Article[] = []
  for (let i = 0; i < filtered.length; i++) {
    const u = filtered[i]
    try {
      await sleep(DELAY_MS)
      const html = await fetchPage(u.url)
      const { fullText, author, date, summary } = extractArticleContent(html)

      articles.push({
        url: u.url,
        title: u.title,
        date,
        author,
        summary,
        fullText: fullText || null,
        source: 'Gunnison Country Times',
      })

      const textLen = fullText ? fullText.length : 0
      console.log(`  ${i + 1}/${filtered.length}: ${u.title.slice(0, 60)} (${textLen} chars)`)
    } catch (err: any) {
      console.log(`  Error: ${u.title.slice(0, 40)} — ${err.message}`)
    }
  }

  writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2))
  console.log(`\nSaved ${articles.length} articles to ${ARTICLES_FILE}`)
  console.log(`  With text: ${articles.filter(a => a.fullText && a.fullText.length > 50).length}`)
}

main().catch(err => { console.error(err); process.exit(1) })
