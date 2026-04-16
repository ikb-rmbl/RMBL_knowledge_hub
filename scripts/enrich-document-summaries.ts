/**
 * Enrich Document Summaries from Extraction Data
 *
 * Builds a structured summary sentence for documents that have only a short citation
 * or no summary at all, using the LLM-extracted documentType, dateRange, agencies,
 * top places, and top concepts.
 *
 * Only replaces summary when the existing summary is shorter than MIN_EXISTING_LENGTH
 * characters (preserves hand-written or PDF-extracted summaries).
 *
 * Usage:
 *   npx tsx scripts/enrich-document-summaries.ts [--dry-run]
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const MIN_EXISTING_LENGTH = 100 // only replace summaries shorter than this

const DOC_TYPE_LABELS: Record<string, string> = {
  technical_report: 'Technical report',
  correspondence: 'Correspondence',
  news_article: 'News article',
  environmental_assessment: 'Environmental assessment',
  management_plan: 'Management plan',
  legislation: 'Legislation',
  county_plan: 'County plan',
  water_report: 'Water report',
  recreation_study: 'Recreation study',
  land_use_plan: 'Land use plan',
  wildlife_survey: 'Wildlife survey',
  mining_permit: 'Mining permit',
  other: 'Document',
}

function buildSummary(extraction: any): string | null {
  const parts: string[] = []

  // Document type + date range
  const docType = extraction.documentType
  const typeLabel = docType ? (DOC_TYPE_LABELS[docType] || docType.replace(/_/g, ' ')) : 'Document'
  const dateRange = extraction.dateRange ? ` (${extraction.dateRange})` : ''
  parts.push(`${typeLabel}${dateRange}.`)

  // Top places (max 3)
  const places: string[] = (extraction.places || [])
    .filter((p: any) => p.name)
    .slice(0, 3)
    .map((p: any) => p.name)
  if (places.length > 0) {
    parts.push(`Covers ${places.join(', ')}.`)
  }

  // Top concepts (max 4) — prefer primary-topic concepts
  const concepts: any[] = extraction.concepts || []
  const primaryConcepts = concepts.filter((c: any) => c.role === 'primary topic').slice(0, 4)
  const fallbackConcepts = concepts.slice(0, 4)
  const topConcepts = (primaryConcepts.length >= 2 ? primaryConcepts : fallbackConcepts).map((c: any) => c.name).filter(Boolean)
  if (topConcepts.length > 0) {
    parts.push(`Topics: ${topConcepts.join(', ')}.`)
  }

  // Top agencies (max 3)
  const agencies: string[] = (extraction.agencies || [])
    .filter((a: string) => a && a.length > 2)
    .slice(0, 3)
  if (agencies.length > 0) {
    parts.push(`Agencies: ${agencies.join(', ')}.`)
  }

  // Number of referenced works
  const refCount = (extraction.referencedWorks || []).length
  if (refCount > 0) {
    parts.push(`Cites ${refCount} external work${refCount === 1 ? '' : 's'}.`)
  }

  const summary = parts.join(' ')
  return summary.length > 20 ? summary : null
}

async function main() {
  console.log('Enrich Document Summaries')
  console.log('=========================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const docs = JSON.parse(readFileSync('scripts/output/document-entity-extraction.json', 'utf-8')) as any[]
  console.log(`${docs.length} document extractions to process`)

  let updated = 0, preserved = 0, skipped = 0, missing = 0

  try {
    for (const item of docs) {
      if (item.collection !== 'documents') continue
      const itemId = typeof item.id === 'string' ? parseInt(item.id.replace(/^doc_/, ''), 10) : item.id
      if (!itemId) continue

      const extraction = item.strategy3?.extraction
      if (!extraction) { skipped++; continue }

      const newSummary = buildSummary(extraction)
      if (!newSummary) { skipped++; continue }

      // Check existing summary length
      const { rows: [existing] } = await db.query(
        'SELECT summary FROM documents WHERE id = $1',
        [itemId],
      )
      if (!existing) { missing++; continue }

      const existingLen = existing.summary ? String(existing.summary).length : 0
      if (existingLen >= MIN_EXISTING_LENGTH) {
        preserved++
        continue
      }

      if (dryRun) {
        if (updated < 5) {
          console.log(`  [${itemId}] "${item.title.slice(0, 60)}"`)
          console.log(`    → ${newSummary}`)
        }
        updated++
        continue
      }

      await db.query(
        'UPDATE documents SET summary = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(newSummary), itemId],
      )
      updated++
    }

    console.log('\n========== Summary ==========')
    console.log(`Updated: ${updated}`)
    console.log(`Preserved (existing >${MIN_EXISTING_LENGTH} chars): ${preserved}`)
    console.log(`Skipped (no extraction): ${skipped}`)
    console.log(`Missing (doc not in DB): ${missing}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
