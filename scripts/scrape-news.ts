/**
 * Scrape news articles about RMBL from Crested Butte News.
 *
 * Phase 1: Collect article URLs from search result pages
 * Phase 2: Fetch each article's content
 *
 * Polite: 2-second delay between requests, identifies itself in User-Agent.
 *
 * Usage:
 *   npx tsx scripts/scrape-news.ts [--limit=N] [--dry-run]
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { sleep } from './lib/concurrency.js'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const OUTPUT_DIR = 'scripts/output'
const URLS_FILE = `${OUTPUT_DIR}/news-urls.json`
const ARTICLES_FILE = `${OUTPUT_DIR}/news-articles.json`
const DELAY_MS = 2000
const BASE_URL = 'https://crestedbuttenews.com'
const SEARCH_URL = `${BASE_URL}/?s=RMBL`
const USER_AGENT = 'RMBLKnowledgeHub/1.0 (research; ikb@rmbl.org)'

interface ArticleUrl {
  url: string
  title: string
  date: string | null
  excerpt: string | null
}

interface Article extends ArticleUrl {
  fullText: string | null
  author: string | null
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function extractArticleUrls(html: string): ArticleUrl[] {
  const articles: ArticleUrl[] = []

  // Match article entries - CB News uses <article> or <h2> with links
  const entryPattern = /<article[^>]*>[\s\S]*?<\/article>/gi
  const entries = html.match(entryPattern) || []

  for (const entry of entries) {
    // Extract URL and title from the first <a> with href inside an h2
    const linkMatch = entry.match(/<h2[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/i)
      || entry.match(/<a\s+href="(https:\/\/crestedbuttenews\.com\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([^<]+)<\/a>/i)
    if (!linkMatch) continue

    const url = linkMatch[1]
    const title = linkMatch[2].trim().replace(/&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&amp;/g, '&')

    // Extract date
    const dateMatch = entry.match(/<time[^>]*datetime="([^"]+)"/) || entry.match(/(\w+ \d{1,2}, \d{4})/)
    const date = dateMatch ? dateMatch[1] : null

    // Extract excerpt
    const excerptMatch = entry.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    const excerpt = excerptMatch
      ? excerptMatch[1].replace(/<[^>]+>/g, '').replace(/&\w+;/g, ' ').trim().slice(0, 300)
      : null

    if (url.includes('crestedbuttenews.com/20')) {
      articles.push({ url, title, date, excerpt })
    }
  }

  return articles
}

function hasNextPage(html: string, currentPage: number): boolean {
  return html.includes(`/page/${currentPage + 1}/?s=`) || html.includes(`/page/${currentPage + 1}/&`)
}

function extractArticleContent(html: string): { fullText: string; author: string | null } {
  // Extract main content - CB News typically uses .entry-content or article content
  const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div[^>]*class="[^"]*(?:post-tags|share|related|comments))/i)
    || html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

  let fullText = ''
  if (contentMatch) {
    fullText = contentMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<\/?(?:div|span|strong|em|b|i|a|p|br|h[1-6]|ul|ol|li|blockquote)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;|&#8221;/g, '"')
      .replace(/&#8211;/g, '–')
      .replace(/&#8212;/g, '—')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  // Extract author
  const authorMatch = html.match(/<span[^>]*class="[^"]*author[^"]*"[^>]*>(?:<a[^>]*>)?([^<]+)/)
    || html.match(/by\s+([A-Z][a-z]+ [A-Z][a-z]+)/i)
  const author = authorMatch ? authorMatch[1].trim() : null

  return { fullText, author }
}

async function main() {
  console.log('Scrape RMBL News Articles')
  console.log('========================')
  if (dryRun) console.log('(DRY RUN)')

  // Phase 1: Collect URLs
  let allUrls: ArticleUrl[] = []
  if (existsSync(URLS_FILE)) {
    allUrls = JSON.parse(readFileSync(URLS_FILE, 'utf-8'))
    console.log(`Loaded ${allUrls.length} cached URLs from ${URLS_FILE}`)
  } else {
    console.log('\nPhase 1: Collecting article URLs...')
    let page = 1
    const maxPages = 30

    while (page <= maxPages) {
      const url = page === 1 ? SEARCH_URL : `${BASE_URL}/page/${page}/?s=RMBL`
      console.log(`  Page ${page}: ${url}`)

      try {
        const html = await fetchPage(url)
        const urls = extractArticleUrls(html)
        if (urls.length === 0) {
          console.log('  No more results, stopping.')
          break
        }
        allUrls.push(...urls)
        console.log(`  Found ${urls.length} articles (total: ${allUrls.length})`)

        if (!hasNextPage(html, page)) {
          console.log('  No next page link, stopping.')
          break
        }
      } catch (err: any) {
        console.log(`  Error: ${err.message}`)
        break
      }

      page++
      await sleep(DELAY_MS)
    }

    // Deduplicate by URL
    const seen = new Set<string>()
    allUrls = allUrls.filter(u => {
      if (seen.has(u.url)) return false
      seen.add(u.url)
      return true
    })

    writeFileSync(URLS_FILE, JSON.stringify(allUrls, null, 2))
    console.log(`\nSaved ${allUrls.length} unique URLs to ${URLS_FILE}`)
  }

  if (dryRun) {
    console.log(`\nWould fetch ${Math.min(allUrls.length, limit)} articles`)
    return
  }

  // Phase 2: Fetch article content
  console.log('\nPhase 2: Fetching article content...')
  const existing: Article[] = existsSync(ARTICLES_FILE)
    ? JSON.parse(readFileSync(ARTICLES_FILE, 'utf-8'))
    : []
  const existingUrls = new Set(existing.map(a => a.url))
  const toFetch = allUrls.filter(u => !existingUrls.has(u.url)).slice(0, limit)
  console.log(`${toFetch.length} articles to fetch (${existing.length} already cached)`)

  const articles = [...existing]
  let fetched = 0

  for (const item of toFetch) {
    try {
      const html = await fetchPage(item.url)
      const { fullText, author } = extractArticleContent(html)

      articles.push({
        ...item,
        fullText: fullText || null,
        author,
      })
      fetched++

      const textLen = fullText ? fullText.length : 0
      console.log(`  ${fetched}/${toFetch.length}: ${item.title.slice(0, 60)} (${textLen} chars)`)

      // Save incrementally every 10 articles
      if (fetched % 10 === 0) {
        writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2))
      }
    } catch (err: any) {
      console.log(`  Error fetching ${item.url}: ${err.message}`)
    }

    await sleep(DELAY_MS)
  }

  writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2))
  console.log(`\nSaved ${articles.length} articles to ${ARTICLES_FILE}`)
  console.log(`  With text: ${articles.filter(a => a.fullText && a.fullText.length > 50).length}`)
}

main().catch(err => { console.error(err); process.exit(1) })
