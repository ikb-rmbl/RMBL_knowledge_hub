/**
 * Parse LexisNexis results PDF (text-extracted) into stories JSON.
 *
 * Expects pdftotext output. Each entry has:
 *   - Numbered header (e.g., "1.")
 *   - Title (one or more lines)
 *   - Snippet text
 *   - Metadata line: Date: ... | Publication: ... | Source: ... | Byline: ...
 *
 * Deduplicates by title (keeps first occurrence, usually the most prominent outlet).
 *
 * Usage:
 *   pdftotext input.pdf /tmp/lexis.txt
 *   npx tsx scripts/parse-lexis-pdf.ts /tmp/lexis.txt
 */

import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'

const inputFile = process.argv[2]
const pdfFile = process.argv[3] // optional: original PDF for link extraction
if (!inputFile) {
  console.error('Usage: npx tsx scripts/parse-lexis-pdf.ts <text-file> [original-pdf-for-links]')
  process.exit(1)
}

const OUTPUT_FILE = 'scripts/output/lexis-articles.json'

import { execSync } from 'child_process'

interface LexisArticle {
  title: string
  summary: string
  sourceUrl: string | null
  date: string | null
  author: string | null
  publication: string | null
  source: string | null
  jurisdiction: string | null
}

function parseDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr.trim())
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
  } catch { return null }
}

function main() {
  const text = readFileSync(inputFile, 'utf-8')
  const lines = text.split('\n')

  const articles: LexisArticle[] = []
  let i = 0

  // Skip header until we find "1."
  while (i < lines.length && !lines[i].match(/^\d+\.$/)) i++

  while (i < lines.length) {
    // Look for numbered entry
    const numMatch = lines[i].match(/^(\d+)\.$/)
    if (!numMatch) { i++; continue }

    i++ // skip the number line

    // Skip blank lines
    while (i < lines.length && lines[i].trim() === '') i++

    // Collect title lines (until we hit snippet text or metadata)
    const titleLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^(Date:|Jurisdiction:|Source:)/) && !lines[i].match(/^Page \d+ of \d+$/)) {
      // Title lines are typically shorter and don't start with "..."
      const line = lines[i].trim()
      if (line.startsWith('...') || line.startsWith('A ') || line.startsWith('The ') || line.startsWith('In ') ||
          line.startsWith('Click') || line.startsWith('Graph') || line.startsWith('GOTHIC') ||
          line.length > 120 || (titleLines.length > 0 && line.match(/\.\.\.\s*$/))) {
        break
      }
      titleLines.push(line)
      i++
    }

    const title = titleLines.join(' ').trim()
    if (!title || title.length < 5) continue

    // Collect snippet/body lines until we hit metadata
    const snippetLines: string[] = []
    while (i < lines.length) {
      const line = lines[i].trim()
      if (line === '') { i++; continue }
      if (line.match(/^Page \d+ of \d+$/)) { i++; continue }
      if (line.match(/^(Date:|Jurisdiction:)/) || line.match(/\| Date:/) || line.match(/^\d+\.$/)) break
      snippetLines.push(line)
      i++
    }
    const summary = snippetLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500)

    // Parse metadata line(s) — may span multiple lines
    let metaText = ''
    while (i < lines.length) {
      const line = lines[i].trim()
      if (line === '' || line.match(/^\d+\.$/) || line.match(/^Page \d+ of \d+$/)) break
      metaText += ' ' + line
      i++
    }

    let date: string | null = null
    let publication: string | null = null
    let source: string | null = null
    let author: string | null = null
    let jurisdiction: string | null = null

    const dateMatch = metaText.match(/Date:\s*([A-Za-z]+ \d{1,2},?\s*\d{4})/)
    if (dateMatch) date = parseDate(dateMatch[1])

    const pubMatch = metaText.match(/Publication:\s*([^|]+)/)
    if (pubMatch) publication = pubMatch[1].trim()

    const sourceMatch = metaText.match(/Source:\s*([^|]+)/)
    if (sourceMatch) source = sourceMatch[1].trim()

    const bylineMatch = metaText.match(/Byline:\s*([^|]+)/)
    if (bylineMatch) author = bylineMatch[1].trim().slice(0, 100)

    const jurisMatch = metaText.match(/Jurisdiction:\s*([^|]+)/)
    if (jurisMatch) jurisdiction = jurisMatch[1].trim()

    articles.push({ title, summary, sourceUrl: null, date, author, publication, source, jurisdiction })
  }

  console.log(`Parsed ${articles.length} total entries`)

  // Deduplicate by normalized title (keep first occurrence)
  const seen = new Map<string, LexisArticle>()
  for (const a of articles) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!seen.has(key)) seen.set(key, a)
  }
  const unique = [...seen.values()]
  console.log(`${unique.length} unique articles after dedup (removed ${articles.length - unique.length} syndication duplicates)`)

  // Show top publications
  const pubs = new Map<string, number>()
  for (const a of articles) {
    const pub = a.publication || a.source || 'Unknown'
    pubs.set(pub, (pubs.get(pub) || 0) + 1)
  }
  console.log('\nTop publications:')
  const sorted = [...pubs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  for (const [pub, count] of sorted) console.log(`  ${pub}: ${count}`)

  // Year distribution
  const years = new Map<string, number>()
  for (const a of unique) {
    const year = a.date?.slice(0, 4) || 'unknown'
    years.set(year, (years.get(year) || 0) + 1)
  }
  console.log('\nYear distribution:')
  for (const [year, count] of [...years.entries()].sort()) console.log(`  ${year}: ${count}`)

  // Extract source URLs from the original PDF if provided
  if (pdfFile) {
    console.log(`\nExtracting links from PDF: ${pdfFile}`)
    try {
      const xmlOutput = execSync(
        `pdftohtml -xml -stdout "${pdfFile}"`,
        { maxBuffer: 50 * 1024 * 1024, encoding: 'utf-8' },
      )
      // Extract all href URLs with their surrounding text context
      const linkPattern = /<a href="([^"]+)">/g
      const textPattern = /<text[^>]*>([^<]*)<\/text>/g
      const allLinks: string[] = []
      let m
      while ((m = linkPattern.exec(xmlOutput)) !== null) {
        const url = m[1].replace(/&amp;/g, '&')
        if (!url.includes('lexisnexis.com/about') && !url.includes('privacy-policy') &&
            !url.includes('terms/general') && !url.includes('terms/copyright')) {
          allLinks.push(url)
        }
      }
      console.log(`  Found ${allLinks.length} non-boilerplate links`)

      // Deduplicate consecutive links (title line wraps cause repeats)
      const dedupedLinks: string[] = []
      let lastUrl = ''
      for (const url of allLinks) {
        if (url !== lastUrl) {
          dedupedLinks.push(url)
          lastUrl = url
        }
      }
      console.log(`  ${dedupedLinks.length} unique consecutive links (1 per article)`)

      // Links appear in the same order as articles in the PDF.
      // The original (pre-dedup) article list maps 1:1 to links.
      // Assign links to original articles, then propagate to deduped set.
      const linksByTitle = new Map<string, string>()
      for (let li = 0; li < Math.min(articles.length, dedupedLinks.length); li++) {
        const key = articles[li].title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        if (!linksByTitle.has(key)) {
          linksByTitle.set(key, dedupedLinks[li])
        }
      }

      // Assign to deduped articles — prefer non-Lexis source URLs
      for (const article of unique) {
        const key = article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        const url = linksByTitle.get(key)
        if (url) article.sourceUrl = url
      }

      const withUrl = unique.filter(a => a.sourceUrl).length
      console.log(`  Assigned URLs to ${withUrl}/${unique.length} articles`)
    } catch (err: any) {
      console.log(`  Link extraction failed: ${err.message?.slice(0, 100)}`)
    }
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(unique, null, 2))
  console.log(`\nSaved ${unique.length} unique articles to ${OUTPUT_FILE}`)
}

main()
