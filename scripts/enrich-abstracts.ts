/**
 * Enrich Abstracts & Descriptions
 *
 * Tier 1 (api): Fetch abstracts from OpenAlex/CrossRef for publications with DOIs,
 *               DataCite for datasets with DOIs.
 * Tier 2 (fulltext): Extract abstracts from full text via regex for publications
 *                     and documents.
 * Tier 3 (semantic-scholar): Fetch abstracts and TLDR summaries from Semantic Scholar
 *                            for DOIs where OpenAlex/CrossRef had no abstract.
 * Tier 4 (pdf): Download PDFs and extract text for publications with PDF links
 *               but no full text, then apply regex extraction.
 *
 * Usage:
 *   npx tsx scripts/enrich-abstracts.ts [--step=api|fulltext|semantic-scholar|pdf|all] [--dry-run] [--limit=N]
 */

import pg from 'pg'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { sleep, runConcurrent } from './lib/concurrency.js'
import { OPENALEX_API, OPENALEX_MAILTO, CROSSREF_API, CROSSREF_MAILTO, DATACITE_API, STAGING_DIR, CONCURRENCY, DELAYS } from './lib/config.js'
import { reconstructAbstract } from './lib/publication-discovery.js'
import { ensureAuth, patchRecord, checkServer } from './lib/payload-client.js'
import { extractText, checkTools } from './lib/pdf-extract.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const step = args.find((a) => a.startsWith('--step='))?.split('=')[1] || 'all'
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const OPENALEX_BATCH_SIZE = 50

// ---------------------------------------------------------------------------
// Tier 1: API-based enrichment
// ---------------------------------------------------------------------------

async function enrichPublicationsViaApi(db: pg.Pool): Promise<void> {
  console.log('\n--- Publications: API Enrichment (OpenAlex + CrossRef) ---')

  const { rows } = await db.query(
    `SELECT id, doi FROM publications
     WHERE doi IS NOT NULL AND (abstract IS NULL OR length(abstract) < 10)
     ORDER BY id`,
  )
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} publications need abstracts (${candidates.length} to process)`)

  if (candidates.length === 0) return

  let updated = 0
  let oaFound = 0
  let crFound = 0
  const oaMissed: { id: number; doi: string }[] = []

  // Pass 1: Batch OpenAlex
  console.log('  Pass 1: OpenAlex batch lookup...')
  for (let i = 0; i < candidates.length; i += OPENALEX_BATCH_SIZE) {
    const batch = candidates.slice(i, i + OPENALEX_BATCH_SIZE)
    const doiFilter = batch.map((r) => r.doi).join('|')

    try {
      const url = `${OPENALEX_API}/works?filter=doi:${encodeURIComponent(doiFilter)}&select=doi,abstract_inverted_index&per_page=${OPENALEX_BATCH_SIZE}&mailto=${OPENALEX_MAILTO}`
      const res = await fetch(url)

      if (res.ok) {
        const data = await res.json()
        const abstractByDoi = new Map<string, string>()
        for (const work of data.results || []) {
          const doi = work.doi?.replace('https://doi.org/', '')?.toLowerCase()
          const abstract = reconstructAbstract(work.abstract_inverted_index)
          if (doi && abstract) abstractByDoi.set(doi, abstract)
        }

        for (const row of batch) {
          const abstract = abstractByDoi.get(row.doi.toLowerCase())
          if (abstract) {
            if (!dryRun) {
              await db.query('UPDATE publications SET abstract = $1 WHERE id = $2', [abstract, row.id])
            }
            oaFound++
            updated++
          } else {
            oaMissed.push(row)
          }
        }
      } else if (res.status === 429) {
        console.log('  Rate limited, waiting 5s...')
        await sleep(5000)
        i -= OPENALEX_BATCH_SIZE
        continue
      }
    } catch (err) {
      // Add all batch items to missed list for CrossRef fallback
      oaMissed.push(...batch)
    }

    if ((i + OPENALEX_BATCH_SIZE) % 250 === 0 || i + OPENALEX_BATCH_SIZE >= candidates.length) {
      process.stdout.write(`\r    ${Math.min(i + OPENALEX_BATCH_SIZE, candidates.length)}/${candidates.length} (${oaFound} found)`)
    }
    await sleep(DELAYS.OPENALEX_MS)
  }
  console.log(`\r    ${candidates.length} checked, ${oaFound} abstracts from OpenAlex`)

  // Pass 2: CrossRef fallback for missed DOIs
  const crCandidates = oaMissed.slice(0, limit - updated)
  if (crCandidates.length > 0) {
    console.log(`  Pass 2: CrossRef fallback for ${crCandidates.length} remaining...`)
    for (let i = 0; i < crCandidates.length; i++) {
      const row = crCandidates[i]
      try {
        const res = await fetch(`${CROSSREF_API}/${encodeURIComponent(row.doi)}?mailto=${CROSSREF_MAILTO}`)
        if (res.ok) {
          const data = await res.json()
          let abstract = data.message?.abstract || null
          if (abstract) {
            abstract = abstract.replace(/<[^>]+>/g, '').trim()
            if (abstract.length > 10) {
              if (!dryRun) {
                await db.query('UPDATE publications SET abstract = $1 WHERE id = $2', [abstract, row.id])
              }
              crFound++
              updated++
            }
          }
        }
      } catch {}

      if ((i + 1) % 50 === 0 || i + 1 === crCandidates.length) {
        process.stdout.write(`\r    ${i + 1}/${crCandidates.length} (${crFound} found)`)
      }
      await sleep(DELAYS.CROSSREF_MS)
    }
    console.log(`\r    ${crCandidates.length} checked, ${crFound} abstracts from CrossRef`)
  }

  console.log(`  Total: ${updated} publications enriched (${oaFound} OpenAlex, ${crFound} CrossRef)`)
}

async function enrichDatasetsViaApi(db: pg.Pool): Promise<void> {
  console.log('\n--- Datasets: API Enrichment (DataCite) ---')

  const { rows } = await db.query(
    `SELECT id, doi FROM datasets
     WHERE doi IS NOT NULL
     AND (description IS NULL OR description::text = 'null' OR length(description::text) < 20)
     ORDER BY id`,
  )
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} datasets need descriptions (${candidates.length} to process)`)

  if (candidates.length === 0) return

  const serverUp = await checkServer()
  if (!serverUp) {
    console.log('  Payload server not running — skipping dataset enrichment')
    return
  }
  await ensureAuth()

  let updated = 0
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]
    try {
      const res = await fetch(`${DATACITE_API}/${encodeURIComponent(row.doi)}`)
      if (res.ok) {
        const data = await res.json()
        const descriptions = data.data?.attributes?.descriptions || []
        const desc = descriptions.find((d: any) => d.description && d.description.length > 10)
        if (desc) {
          if (!dryRun) {
            await patchRecord('datasets', String(row.id), { description: desc.description })
          }
          updated++
        }
      }
    } catch {}

    if ((i + 1) % 20 === 0 || i + 1 === candidates.length) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} (${updated} enriched)`)
    }
    await sleep(DELAYS.METADATA_MS)
  }
  console.log(`\r  ${candidates.length} checked, ${updated} datasets enriched`)
}

// ---------------------------------------------------------------------------
// Tier 2: Full-text regex extraction
// ---------------------------------------------------------------------------

const ABSTRACT_PATTERNS = [
  // "Abstract" header followed by text, ending at next section
  /(?:^|\n)\s*\x0C?Abstract:?\s*\n+([\s\S]{50,3000}?)(?:\n\s*(?:Introduction|Methods|Background|Keywords|Mentor|Student|Table of Contents|Acknowledgment|References|Literature Cited)\b)/i,
  // "Abstract" header followed by text until double newline
  /(?:^|\n)\s*\x0C?Abstract:?\s*\n+([\s\S]{50,2000}?)\n\s*\n/i,
  // "ABSTRACT" (all caps) variant
  /(?:^|\n)\s*ABSTRACT\s*\n+([\s\S]{50,2000}?)\n\s*\n/i,
]

function extractAbstractFromText(fullText: string): string | null {
  for (const pattern of ABSTRACT_PATTERNS) {
    const match = fullText.match(pattern)
    if (match && match[1]) {
      // Clean up: normalize whitespace, trim
      const cleaned = match[1].replace(/\s+/g, ' ').trim()
      if (cleaned.length >= 50 && cleaned.length <= 3000) {
        return cleaned
      }
    }
  }
  return null
}

function extractSummaryFromText(fullText: string): string | null {
  // Take first substantial paragraph (skip short header lines)
  const lines = fullText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  // Skip lines that look like headers/titles (short, all caps, etc.)
  let startIdx = 0
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].length < 50 || /^[A-Z\s\d.,:-]+$/.test(lines[i])) {
      startIdx = i + 1
    } else {
      break
    }
  }

  // Take next ~300 words
  const textLines = lines.slice(startIdx, startIdx + 20)
  const text = textLines.join(' ').replace(/\s+/g, ' ').trim()
  const words = text.split(/\s+/).slice(0, 300)
  const summary = words.join(' ')

  return summary.length >= 50 ? summary : null
}

async function enrichPublicationsViaFulltext(db: pg.Pool): Promise<void> {
  console.log('\n--- Publications: Full-Text Regex Extraction ---')

  const { rows } = await db.query(
    `SELECT id, full_text FROM publications
     WHERE (abstract IS NULL OR length(abstract) < 10)
     AND full_text IS NOT NULL AND length(full_text) > 100
     ORDER BY id`,
  )
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} publications with full text but no abstract (${candidates.length} to process)`)

  if (candidates.length === 0) return

  let extracted = 0
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]
    const abstract = extractAbstractFromText(row.full_text)
    if (abstract) {
      if (!dryRun) {
        await db.query('UPDATE publications SET abstract = $1 WHERE id = $2', [abstract, row.id])
      }
      extracted++
    }

    if ((i + 1) % 100 === 0 || i + 1 === candidates.length) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} (${extracted} extracted)`)
    }
  }
  console.log(`\r  ${candidates.length} scanned, ${extracted} abstracts extracted`)
}

async function enrichDocumentsViaFulltext(db: pg.Pool): Promise<void> {
  console.log('\n--- Documents: Full-Text Summary Extraction ---')

  const { rows } = await db.query(
    `SELECT id, full_text FROM documents
     WHERE (summary IS NULL OR summary::text = 'null' OR length(summary::text) < 20)
     AND full_text IS NOT NULL AND length(full_text) > 100
     ORDER BY id`,
  )
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} documents with full text but no summary (${candidates.length} to process)`)

  if (candidates.length === 0) return

  const serverUp = await checkServer()
  if (!serverUp) {
    console.log('  Payload server not running — skipping document enrichment')
    return
  }
  await ensureAuth()

  let extracted = 0
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]
    const summary = extractSummaryFromText(row.full_text)
    if (summary) {
      if (!dryRun) {
        await patchRecord('documents', String(row.id), { summary })
      }
      extracted++
    }

    if ((i + 1) % 50 === 0 || i + 1 === candidates.length) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} (${extracted} extracted)`)
    }
  }
  console.log(`\r  ${candidates.length} scanned, ${extracted} summaries extracted`)
}

// ---------------------------------------------------------------------------
// Tier 3: Semantic Scholar — abstracts and TLDR summaries
// ---------------------------------------------------------------------------

const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1/paper'

async function enrichPublicationsViaSemanticScholar(db: pg.Pool): Promise<void> {
  console.log('\n--- Publications: Semantic Scholar (abstracts + TLDR) ---')

  const { rows } = await db.query(
    `SELECT id, doi FROM publications
     WHERE doi IS NOT NULL AND (abstract IS NULL OR length(abstract) < 10)
     ORDER BY id`,
  )
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} publications still need abstracts (${candidates.length} to process)`)

  if (candidates.length === 0) return

  let abstracts = 0
  let tldrs = 0
  let notFound = 0

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]
    try {
      const res = await fetch(`${SEMANTIC_SCHOLAR_API}/DOI:${row.doi}?fields=abstract,tldr`)
      if (res.ok) {
        const data = await res.json()

        // Prefer real abstract over TLDR
        let abstract: string | null = null
        if (data.abstract && data.abstract.length > 20 && !data.abstract.match(/^<jats:[^>]*\/?>$/)) {
          abstract = data.abstract.replace(/<[^>]+>/g, '').trim()
          if (abstract && abstract.length > 20) abstracts++
        }
        if (!abstract && data.tldr?.text) {
          abstract = data.tldr.text
          tldrs++
        }

        if (abstract && abstract.length > 20) {
          if (!dryRun) {
            await db.query('UPDATE publications SET abstract = $1 WHERE id = $2', [abstract, row.id])
          }
        }
      } else if (res.status === 429) {
        console.log('  Rate limited, waiting 10s...')
        await sleep(10000)
        i-- // retry
        continue
      } else {
        notFound++
      }
    } catch {
      notFound++
    }

    if ((i + 1) % 50 === 0 || i + 1 === candidates.length) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} (${abstracts} abstracts, ${tldrs} TLDRs, ${notFound} not found)`)
    }
    await sleep(200) // Semantic Scholar rate limit: ~5 req/sec
  }
  console.log(`\r  ${candidates.length} checked: ${abstracts} abstracts, ${tldrs} TLDRs, ${notFound} not found`)
}

// ---------------------------------------------------------------------------
// Tier 4: PDF download + text extraction for publications with PDF links
// ---------------------------------------------------------------------------

async function enrichCollectionViaPdf(
  db: pg.Pool,
  collection: 'publications' | 'documents',
  idPrefix: string,
  textField: string,
  summaryField: string | null,
  summaryExtractor: ((text: string) => string | null) | null,
): Promise<void> {
  console.log(`\n--- ${collection}: PDF Download + Text Extraction ---`)

  const query = collection === 'publications'
    ? `SELECT id, pdf_link FROM publications WHERE pdf_link IS NOT NULL AND (full_text IS NULL OR length(full_text) < 100) ORDER BY id`
    : `SELECT id, pdf_link FROM documents WHERE pdf_link IS NOT NULL AND (full_text IS NULL OR length(full_text) < 100) ORDER BY id`

  const { rows } = await db.query(query)
  const candidates = rows.slice(0, limit)
  console.log(`  ${rows.length} ${collection} with PDF links but no text (${candidates.length} to process)`)

  if (candidates.length === 0) return

  const tools = checkTools()
  if (!tools.pdftotext) {
    console.log('  pdftotext not available — install poppler (brew install poppler)')
    return
  }

  const pdfDir = join(STAGING_DIR, collection)
  mkdirSync(pdfDir, { recursive: true })

  let downloaded = 0
  let extracted = 0
  let summariesFound = 0
  let errors = 0

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]
    const pdfPath = join(pdfDir, `${idPrefix}${row.id}.pdf`)
    const txtPath = join(pdfDir, `${idPrefix}${row.id}.txt`)

    try {
      // Step 1: Download PDF if not already present
      if (!existsSync(pdfPath)) {
        const res = await fetch(row.pdf_link, { redirect: 'follow' })
        if (!res.ok || !res.headers.get('content-type')?.includes('pdf')) {
          errors++
          continue
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        writeFileSync(pdfPath, buffer)
        downloaded++
      }

      // Step 2: Extract text (and save to staging as .txt)
      let text: string | null = null
      if (existsSync(txtPath)) {
        text = readFileSync(txtPath, 'utf-8')
      } else {
        const result = await extractText(pdfPath)
        if (result.text && result.text.length > 100) {
          text = result.text
          if (!dryRun) {
            writeFileSync(txtPath, text)
          }
        }
      }

      if (text && text.length > 100) {
        extracted++
        const summary = summaryField && summaryExtractor ? summaryExtractor(text) : null
        if (summary) summariesFound++

        if (!dryRun) {
          if (summary) {
            await db.query(`UPDATE ${collection} SET ${textField} = $1, ${summaryField} = $2 WHERE id = $3`, [text, summary, row.id])
          } else {
            await db.query(`UPDATE ${collection} SET ${textField} = $1 WHERE id = $2`, [text, row.id])
          }
        }
      }
    } catch {
      errors++
    }

    if ((i + 1) % 25 === 0 || i + 1 === candidates.length) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} (${downloaded} downloaded, ${extracted} extracted, ${summariesFound} summaries, ${errors} errors)`)
    }
    await sleep(DELAYS.DOWNLOAD_MS)
  }
  console.log(`\r  ${candidates.length} processed: ${downloaded} downloaded, ${extracted} text extracted, ${summariesFound} summaries found, ${errors} errors`)
}

async function enrichPublicationsViaPdf(db: pg.Pool): Promise<void> {
  await enrichCollectionViaPdf(db, 'publications', 'pub_', 'full_text', 'abstract', extractAbstractFromText)
}

async function enrichDocumentsViaPdf(db: pg.Pool): Promise<void> {
  // Documents: full_text is varchar (direct SQL), summary extraction uses extractSummaryFromText
  // Note: summary is jsonb in Payload but we write full_text directly via SQL
  await enrichCollectionViaPdf(db, 'documents', 'doc_', 'full_text', null, null)
  // Summary extraction handled separately via --step=fulltext since it needs Payload API for jsonb
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Enrich Abstracts & Descriptions')
  console.log('===============================')
  console.log(`Step: ${step}`)
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
  })

  const runApi = step === 'api' || step === 'all'
  const runFulltext = step === 'fulltext' || step === 'all'
  const runSS = step === 'semantic-scholar' || step === 'all'
  const runPdf = step === 'pdf' || step === 'all'

  // Tier 1: API (OpenAlex/CrossRef/DataCite)
  if (runApi) {
    await enrichPublicationsViaApi(db)
    await enrichDatasetsViaApi(db)
  }

  // Tier 2: Full-text regex
  if (runFulltext) {
    await enrichPublicationsViaFulltext(db)
    await enrichDocumentsViaFulltext(db)
  }

  // Tier 3: Semantic Scholar
  if (runSS) {
    await enrichPublicationsViaSemanticScholar(db)
  }

  // Tier 4: PDF download + extraction
  if (runPdf) {
    await enrichPublicationsViaPdf(db)
    await enrichDocumentsViaPdf(db)
  }

  // Summary
  const { rows: pubStats } = await db.query(
    `SELECT count(*) as total,
            count(*) FILTER (WHERE abstract IS NOT NULL AND length(abstract) > 10) as with_abstract
     FROM publications`,
  )
  const { rows: dsStats } = await db.query(
    `SELECT count(*) as total,
            count(*) FILTER (WHERE description IS NOT NULL AND description::text != 'null' AND length(description::text) > 20) as with_desc
     FROM datasets`,
  )
  const { rows: docStats } = await db.query(
    `SELECT count(*) as total,
            count(*) FILTER (WHERE summary IS NOT NULL AND summary::text != 'null' AND length(summary::text) > 20) as with_summary
     FROM documents`,
  )

  console.log('\n========== Coverage ==========')
  console.log(`Publications: ${pubStats[0].with_abstract}/${pubStats[0].total} with abstracts (${(pubStats[0].with_abstract / pubStats[0].total * 100).toFixed(0)}%)`)
  console.log(`Datasets:     ${dsStats[0].with_desc}/${dsStats[0].total} with descriptions (${(dsStats[0].with_desc / dsStats[0].total * 100).toFixed(0)}%)`)
  console.log(`Documents:    ${docStats[0].with_summary}/${docStats[0].total} with summaries (${(docStats[0].with_summary / docStats[0].total * 100).toFixed(0)}%)`)

  await db.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
