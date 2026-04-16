/**
 * Extract Document Authors via LLM
 *
 * Documents in the Sustainable Library mostly lack author metadata. Many have
 * author info buried in the text (title page, header, signature line) or in the
 * summary field. This script extracts structured author data using Claude on the
 * first ~3000 chars of full_text (where authors typically appear).
 *
 * Output: scripts/output/document-authors.json — array of {docId, authors: [...]}
 * Resume: skips docs already in the results file.
 *
 * Usage:
 *   npx tsx scripts/extract-document-authors.ts [--dry-run] [--limit=N]
 */

import pg from 'pg'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const RESULTS_PATH = `${OUTPUT_DIR}/document-authors.json`
const MAX_CHARS = 4000
const SAVE_EVERY = 25

const PROMPT = `You are extracting author information from a community, environmental, or policy document.

Many of these documents have no individual person authors — they are produced by agencies, committees, or organizations. If the document is clearly produced by an institution with no named author, return an empty array.

Extract ONLY named individual people who are listed as the author, editor, preparer, or primary contact. Do NOT extract:
- People merely mentioned in the body text
- Recipients of letters (unless they are the author)
- Staff members or officials mentioned in passing
- Organizations, agencies, or committees

Return a JSON object:
{
  "authors": [
    {
      "fullName": "Full name as written (e.g., 'John A. Smith' or 'Jane Doe')",
      "givenName": "First and middle names/initials",
      "familyName": "Last name",
      "affiliation": "Institution if stated, or null",
      "role": "author|editor|preparer|contact|signatory"
    }
  ]
}

Return valid JSON only. If no individual authors, return {"authors": []}.`

interface AuthorRecord {
  fullName: string
  givenName: string | null
  familyName: string | null
  affiliation: string | null
  role: string | null
}

interface DocResult {
  docId: number
  title: string
  authors: AuthorRecord[]
  error?: string
}

async function callClaude(text: string, title: string): Promise<AuthorRecord[] | null> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `${PROMPT}\n\nDocument title: "${title}"\n\nDocument text:\n${text}`,
        }],
      }),
    })
    if (res.status === 529 || res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const backoff = 30 + attempt * 30
        console.log(` retry ${attempt + 1} after ${backoff}s (${res.status})`)
        await sleep(backoff * 1000)
        continue
      }
    }
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json() as any
    const txt = data.content?.[0]?.text || ''
    // Strip markdown fences if present
    const cleaned = txt.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      return Array.isArray(parsed.authors) ? parsed.authors : []
    } catch {
      return null
    }
  }
  return null
}

async function main() {
  console.log('Extract Document Authors')
  console.log('========================')
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Get documents with full text (and enough to contain author info)
    const { rows: docs } = await db.query(`
      SELECT id, title, left(full_text, ${MAX_CHARS}) as text_snippet
      FROM documents
      WHERE full_text IS NOT NULL AND length(full_text) >= 200
      ORDER BY id
    `)
    console.log(`${docs.length} documents with full text`)

    // Resume support
    let results: DocResult[] = []
    const processedIds = new Set<number>()
    if (existsSync(RESULTS_PATH)) {
      results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
      for (const r of results) processedIds.add(r.docId)
      console.log(`Resuming: ${processedIds.size} already processed`)
    }

    const remaining = docs.filter((d: any) => !processedIds.has(d.id)).slice(0, limit)
    console.log(`Processing: ${remaining.length}`)
    if (remaining.length === 0) { console.log('Nothing to process.'); return }

    const startTime = Date.now()
    let sessionProcessed = 0, withAuthors = 0, totalAuthors = 0
    let totalInputTokens = 0, totalOutputTokens = 0

    for (let i = 0; i < remaining.length; i++) {
      const doc = remaining[i]
      if (dryRun) {
        console.log(`  ${doc.id}: "${doc.title.slice(0, 60)}" (${doc.text_snippet.length} chars)`)
        sessionProcessed++
        continue
      }

      try {
        const authors = await callClaude(doc.text_snippet, doc.title)
        results.push({ docId: doc.id, title: doc.title, authors: authors || [] })
        if (authors && authors.length > 0) {
          withAuthors++
          totalAuthors += authors.length
        }
        sessionProcessed++
      } catch (err: any) {
        console.log(`  error on ${doc.id}: ${err.message?.slice(0, 100)}`)
        results.push({ docId: doc.id, title: doc.title, authors: [], error: err.message?.slice(0, 200) })
        sessionProcessed++
      }

      if (sessionProcessed % SAVE_EVERY === 0) {
        writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))
        const elapsed = (Date.now() - startTime) / 1000
        const rate = sessionProcessed / (elapsed / 60)
        const eta = (remaining.length - sessionProcessed) / rate
        console.log(`  [${sessionProcessed}/${remaining.length}] ${(elapsed / 60).toFixed(1)}min, ${rate.toFixed(0)}/min, ${withAuthors} with authors, ETA ${eta.toFixed(0)}min`)
      }
      await sleep(100)
    }

    writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2))

    console.log('\n========== Summary ==========')
    console.log(`Processed this session: ${sessionProcessed}`)
    console.log(`Total results: ${results.length}`)
    console.log(`With authors (session): ${withAuthors}`)
    console.log(`Total authors extracted (session): ${totalAuthors}`)
    console.log(`Saved to: ${RESULTS_PATH}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
