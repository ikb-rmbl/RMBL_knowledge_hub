/**
 * Parse LexisNexis full-text export PDF (text-extracted) into stories JSON.
 *
 * Each article is delimited by "Body" and "End of Document" markers.
 * Metadata (title, publication, date, byline) appears before "Body".
 *
 * Usage:
 *   pdftotext "Files (300).PDF" /tmp/lexis-fulltext.txt
 *   npx tsx scripts/parse-lexis-fulltext.ts /tmp/lexis-fulltext.txt
 */

import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'

const inputFile = process.argv[2]
if (!inputFile) {
  console.error('Usage: npx tsx scripts/parse-lexis-fulltext.ts <text-file>')
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

  // Skip the table of contents — find first "Body" marker
  while (i < lines.length && lines[i].trim() !== 'Body') i++

  while (i < lines.length) {
    // Find next "Body" marker
    while (i < lines.length && lines[i].trim() !== 'Body') i++
    if (i >= lines.length) break

    // Walk backwards from "Body" to extract metadata
    let title = ''
    let publication = ''
    let date: string | null = null
    let author: string | null = null
    let highlight: string | null = null

    // Search backwards for metadata (within 30 lines before "Body")
    const bodyLine = i
    for (let j = Math.max(0, bodyLine - 30); j < bodyLine; j++) {
      const line = lines[j].trim()

      // Byline
      if (line.startsWith('Byline:')) {
        author = line.replace('Byline:', '').trim()
        // May continue to next line
        if (j + 1 < bodyLine && !lines[j + 1].trim().startsWith('Highlight:') && !lines[j + 1].trim().startsWith('Body') && !lines[j + 1].trim().startsWith('Length:')) {
          author += ' ' + lines[j + 1].trim()
        }
        author = author.slice(0, 150)
      }

      // Highlight (used as summary)
      if (line.startsWith('Highlight:')) {
        highlight = line.replace('Highlight:', '').trim()
      }

      // Date line — looks like "April 8, 2026 Wednesday 12:19 PM EST"
      const dateMatch = line.match(/^([A-Z][a-z]+ \d{1,2},?\s*\d{4})\b/)
      if (dateMatch && !line.startsWith('Copyright') && !line.startsWith('Length')) {
        date = parseDate(dateMatch[1])
      }

      // Length line
      if (line.startsWith('Length:')) continue
      if (line.startsWith('Copyright')) continue
    }

    // Title and publication: find the "Page X of Y" line, then collect text lines.
    // Lexis repeats the title twice — first occurrence is the title, then publication, then date.
    for (let j = Math.max(0, bodyLine - 30); j < bodyLine; j++) {
      const line = lines[j].trim()
      if (line.match(/^Page \d+ of \d+$/)) {
        // Collect all non-empty, non-metadata lines between Page marker and Body
        const textLines: string[] = []
        for (let k = j + 1; k < bodyLine; k++) {
          const tl = lines[k].trim()
          if (!tl) continue
          if (tl.startsWith('Copyright') || tl.startsWith('Length') ||
              tl.startsWith('Byline') || tl.startsWith('Highlight') ||
              tl === 'Body' || tl.startsWith('All Rights')) continue
          textLines.push(tl)
        }
        // First occurrence = title (may wrap across lines). Look for where title repeats.
        if (textLines.length >= 2) {
          // Find the repeated title — it starts the same as textLines[0]
          let titleEndIdx = 1
          for (let t = 1; t < textLines.length; t++) {
            if (textLines[t].startsWith(textLines[0].slice(0, 20))) {
              titleEndIdx = t
              break
            }
          }
          title = textLines.slice(0, titleEndIdx).join(' ').trim()

          // After the repeated title, look for publication (short line before date)
          for (let t = titleEndIdx; t < textLines.length; t++) {
            const tl = textLines[t]
            // Skip lines that look like the title repeated
            if (tl.startsWith(textLines[0].slice(0, 15))) continue
            // Date line
            if (tl.match(/^[A-Z][a-z]+ \d{1,2},?\s*\d{4}/)) break
            // Publication: short non-date line
            if (tl.length < 100 && !tl.match(/^\d{4}/)) {
              publication = tl
              break
            }
          }
        } else if (textLines.length === 1) {
          title = textLines[0]
        }
        break
      }
    }

    // If no title found via Page marker, use the line before publication/date
    if (!title) {
      for (let j = bodyLine - 1; j >= Math.max(0, bodyLine - 15); j--) {
        const line = lines[j].trim()
        if (line && !line.startsWith('Body') && !line.startsWith('Byline') &&
            !line.startsWith('Highlight') && !line.startsWith('Length') &&
            !line.startsWith('Copyright') && !line.match(/^Page \d+/) &&
            !line.match(/^[A-Z][a-z]+ \d{1,2},?\s*\d{4}/)) {
          title = line
          break
        }
      }
    }

    i++ // move past "Body"

    // Collect full text until "End of Document"
    const bodyLines: string[] = []
    while (i < lines.length && lines[i].trim() !== 'End of Document') {
      const line = lines[i].trim()
      // Skip page headers (repeated title + page number)
      if (line.match(/^Page \d+ of \d+$/)) { i++; continue }
      if (line === title) { i++; continue } // skip repeated title at page tops
      // Skip Load-Date line
      if (line.startsWith('Load-Date:')) { i++; continue }
      bodyLines.push(lines[i]) // preserve original whitespace for paragraphs
      i++
    }
    i++ // skip "End of Document"

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
      source: 'LexisNexis',
    })
  }

  console.log(`Parsed ${articles.length} articles with full text`)

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
