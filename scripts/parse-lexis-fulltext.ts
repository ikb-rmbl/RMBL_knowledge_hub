/**
 * Parse LexisNexis full-text export PDF (text-extracted) into stories JSON.
 *
 * Each article is delimited by "Body" and "End of Document" markers.
 * Metadata (title, publication, date, byline) appears before "Body".
 *
 * Usage:
 *   pdftotext "Files (300).PDF" /tmp/lexis-fulltext.txt
 *   npx tsx scripts/parse-lexis-fulltext.ts /tmp/lexis-fulltext.txt [original-pdf-for-links]
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import './lib/config.js'

const inputFile = process.argv[2]
const pdfFile = process.argv[3] // optional: original PDF for link extraction
if (!inputFile) {
  console.error('Usage: npx tsx scripts/parse-lexis-fulltext.ts <text-file> [original-pdf-for-links]')
  process.exit(1)
}

const OUTPUT_FILE = 'scripts/output/lexis-fulltext-articles.json'

interface LexisArticle {
  title: string
  summary: string | null
  fullText: string
  date: string | null
  author: string | null
  publication: string | null
  sourceUrl: string | null
  source: string
}

function parseDate(dateStr: string): string | null {
  // Handle "April 8, 2026 Wednesday 12:19 PM EST" → "2026-04-08"
  const cleaned = dateStr.replace(/\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday).*$/i, '').trim()
  try {
    const d = new Date(cleaned)
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
  } catch { return null }
}

function main() {
  const text = readFileSync(inputFile, 'utf-8')
  const lines = text.split('\n')

  const articles: LexisArticle[] = []
  let i = 0
  let skippedMismatch = 0

  // Find all "Page 1 of N" markers — each starts a new article
  // Structure: Page 1 of N → title → title(repeated) → publication → date → ... → Body → text → End of Document
  while (i < lines.length) {
    // Find next "Page 1 of" marker
    while (i < lines.length && !lines[i].trim().match(/^Page 1 of \d+$/)) i++
    if (i >= lines.length) break

    i++ // skip the Page line

    // Collect all lines until "End of Document"
    const articleLines: string[] = []
    while (i < lines.length && lines[i].trim() !== 'End of Document') {
      articleLines.push(lines[i])
      i++
    }
    i++ // skip End of Document

    if (articleLines.length < 5) continue

    // Parse the article header: title is the first non-empty line(s)
    let title = ''
    let publication = ''
    let date: string | null = null
    let author: string | null = null
    let highlight: string | null = null
    let bodyStartIdx = -1

    // Find "Body" marker
    for (let j = 0; j < articleLines.length; j++) {
      if (articleLines[j].trim() === 'Body') { bodyStartIdx = j; break }
    }
    if (bodyStartIdx < 0) continue

    // Title: first non-empty line after "Page 1 of N"
    const headerLines: string[] = []
    for (let j = 0; j < bodyStartIdx; j++) {
      const line = articleLines[j].trim()
      if (!line) continue
      if (line.startsWith('Copyright') || line.startsWith('Length') ||
          line.startsWith('Byline') || line.startsWith('Highlight') ||
          line.startsWith('All Rights') || line.startsWith('Load-Date') ||
          line.match(/^Page \d+ of \d+$/)) continue
      headerLines.push(line)
    }

    // First line = title. If the title wraps, the second occurrence starts the same way.
    if (headerLines.length >= 1) {
      title = headerLines[0]
      // Check if title wraps to next line (next line starts with continuation, not a repeat)
      if (headerLines.length >= 2 && !headerLines[1].startsWith(headerLines[0].slice(0, 15))) {
        // Second line might be continuation or publication
        const isDate = headerLines[1].match(/^[A-Z][a-z]+ \d{1,2},?\s*\d{4}/)
        const isShort = headerLines[1].length < 80
        if (!isDate && !isShort) {
          // Likely title continuation
          title = headerLines[0] + ' ' + headerLines[1]
        }
      }
    }

    // Find publication (short line after the repeated title, before date)
    for (let j = 0; j < headerLines.length; j++) {
      const line = headerLines[j]
      if (line === title || line.startsWith(title.slice(0, 15))) continue
      if (line.match(/^[A-Z][a-z]+ \d{1,2},?\s*\d{4}/)) break
      if (line.length < 100 && !line.startsWith('Copyright') && !line.startsWith('Length')) {
        publication = line
        break
      }
    }

    // Extract metadata from header
    for (let j = 0; j < bodyStartIdx; j++) {
      const line = articleLines[j].trim()
      if (line.startsWith('Byline:')) {
        author = line.replace('Byline:', '').trim()
        if (j + 1 < bodyStartIdx) {
          const next = articleLines[j + 1].trim()
          if (next && !next.startsWith('Highlight') && !next.startsWith('Body') && !next.startsWith('Length')) {
            author += ' ' + next
          }
        }
        author = author.slice(0, 150)
      }
      if (line.startsWith('Highlight:')) highlight = line.replace('Highlight:', '').trim()
      const dateMatch = line.match(/^([A-Z][a-z]+ \d{1,2},?\s*\d{4})\b/)
      if (dateMatch && !line.startsWith('Copyright')) date = parseDate(dateMatch[1])
    }

    // Skip past "Body" marker for text extraction
    const bodyIdx = bodyStartIdx + 1

    // Collect body text from articleLines starting after "Body"
    const bodyLines: string[] = []
    for (let j = bodyIdx; j < articleLines.length; j++) {
      const line = articleLines[j].trim()
      if (line.match(/^Page \d+ of \d+$/)) continue
      if (line === title) continue // skip repeated title at page tops
      if (line.startsWith('Load-Date:')) continue
      bodyLines.push(articleLines[j])
    }

    const fullText = bodyLines.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!title || title.length < 5) continue
    if (fullText.length < 50) continue

    articles.push({
      title,
      summary: highlight || fullText.slice(0, 300).replace(/\n/g, ' ').trim(),
      fullText,
      date,
      author,
      publication: publication || null,
      sourceUrl: null,
      source: 'LexisNexis',
    })
  }

  console.log(`Parsed ${articles.length} articles with full text (${skippedMismatch} skipped: title/text mismatch)`)

  // Extract links from the original PDF if provided
  if (pdfFile) {
    console.log(`\nExtracting links from PDF: ${pdfFile}`)
    try {
      const xmlOutput = execSync(
        `pdftohtml -xml -stdout "${pdfFile}"`,
        { maxBuffer: 100 * 1024 * 1024, encoding: 'utf-8' },
      )

      // Extract all non-boilerplate links, deduplicate consecutive
      const allLinks: string[] = []
      let lastUrl = ''
      const linkPattern = /<a href="([^"]+)">/g
      let lm
      while ((lm = linkPattern.exec(xmlOutput)) !== null) {
        const url = lm[1].replace(/&amp;/g, '&')
        if (url.includes('lexisnexis.com/about') || url.includes('privacy-policy') ||
            url.includes('terms/general') || url.includes('terms/copyright')) continue
        if (url !== lastUrl) {
          allLinks.push(url)
          lastUrl = url
        }
      }

      // Filter to Lexis API links (one per article, in order)
      const lexisLinks = allLinks.filter(u => u.includes('advance.lexis.com'))
      console.log(`  ${allLinks.length} total links, ${lexisLinks.length} Lexis API links`)

      // Articles are in the same order as the PDF — assign Lexis links 1:1
      // (articles list here is pre-dedup, so count should match)
      for (let li = 0; li < Math.min(articles.length, lexisLinks.length); li++) {
        articles[li].sourceUrl = lexisLinks[li]
      }

      const withUrl = articles.filter(a => a.sourceUrl).length
      console.log(`  Assigned URLs to ${withUrl}/${articles.length} articles`)
    } catch (err: any) {
      console.log(`  Link extraction failed: ${err.message?.slice(0, 100)}`)
    }
  }

  // Deduplicate by title
  const seen = new Map<string, LexisArticle>()
  for (const a of articles) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!seen.has(key)) {
      seen.set(key, a)
    } else {
      // Keep the one with longer text
      const existing = seen.get(key)!
      if (a.fullText.length > existing.fullText.length) seen.set(key, a)
    }
  }
  const unique = [...seen.values()]
  console.log(`${unique.length} unique after dedup (removed ${articles.length - unique.length} duplicates)`)

  // Stats
  const avgLen = Math.round(unique.reduce((s, a) => s + a.fullText.length, 0) / unique.length)
  console.log(`Average full text length: ${avgLen} chars`)

  const withAuthor = unique.filter(a => a.author).length
  console.log(`With byline: ${withAuthor}/${unique.length}`)

  const withDate = unique.filter(a => a.date).length
  console.log(`With date: ${withDate}/${unique.length}`)

  writeFileSync(OUTPUT_FILE, JSON.stringify(unique, null, 2))
  console.log(`\nSaved ${unique.length} articles to ${OUTPUT_FILE}`)
}

main()
