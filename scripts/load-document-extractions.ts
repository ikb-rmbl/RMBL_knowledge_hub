/**
 * Load Document Entity Extractions
 *
 * Reads `document-entity-extraction.json` (standard extractor output) and
 * `longform-entity-extraction.json` (chapter-aware extractor output) and
 * inserts each extracted entity into `entity_candidates`. Mirrors the
 * VLM-result loader (`load-extraction-results.ts`) but for the
 * documents-collection extraction format that `extract-document-entities.ts`
 * + `extract-longform-entities.ts` produce.
 *
 * What this loads:
 *   - species         → entity_candidates(entity_type='species')
 *   - places          → entity_candidates(entity_type='place')
 *   - protocolsNamed  → entity_candidates(entity_type='protocol')
 *   - concepts        → entity_candidates(entity_type='concept')
 *
 * What this does NOT load (handled by other scripts):
 *   - agencies        → cluster-stakeholders.ts reads the JSON directly
 *   - referencedWorks → load-referenced-works.ts already ran
 *
 * What this does NOT do (deferred to the linker/cluster scripts):
 *   - Creating canonical species/places/protocols/concepts rows
 *   - Creating entity_mentions
 *
 * Idempotency: `entity_candidates` has a NOT EXISTS guard on
 * (entity_type, source_collection, source_item_id, lower(raw_name)) so
 * re-running is safe — already-loaded rows are silently skipped.
 *
 * Usage:
 *   npx tsx scripts/load-document-extractions.ts
 *   npx tsx scripts/load-document-extractions.ts --dry-run
 *   npx tsx scripts/load-document-extractions.ts --since-doc-id=4144   # only the FR notices
 */

import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const sinceDocId = parseInt(args.find(a => a.startsWith('--since-doc-id='))?.split('=')[1] || '0') || 0

const OUTPUT_DIR = 'scripts/output'
const FILES = [
  `${OUTPUT_DIR}/document-entity-extraction.json`,
  `${OUTPUT_DIR}/longform-entity-extraction.json`,
]

interface InsertResult {
  inserted: number
  duplicate: number
  errors: number
}

async function insertCandidate(
  db: pg.Pool,
  entityType: 'species' | 'place' | 'protocol' | 'concept',
  rawName: string,
  rawAttributes: any,
  itemId: number,
  collection: string,
): Promise<'inserted' | 'duplicate' | 'error'> {
  if (!rawName || !rawName.trim()) return 'error'
  if (dryRun) return 'inserted'
  try {
    const { rowCount } = await db.query(
      `INSERT INTO entity_candidates (entity_type, raw_name, raw_attributes, source_collection, source_item_id, confidence)
       SELECT $1::varchar, $2::text, $3::jsonb, $5::varchar, $4::integer, 1.0
       WHERE NOT EXISTS (
         SELECT 1 FROM entity_candidates
         WHERE entity_type = $1::varchar
           AND source_collection = $5::varchar
           AND source_item_id = $4::integer
           AND lower(raw_name) = lower($2::text)
       )`,
      [entityType, rawName.trim(), JSON.stringify(rawAttributes ?? {}), itemId, collection],
    )
    return (rowCount || 0) > 0 ? 'inserted' : 'duplicate'
  } catch (err: any) {
    console.log(`    error (${entityType}/${rawName.slice(0, 40)}): ${err.message?.slice(0, 80)}`)
    return 'error'
  }
}

/** The extractor returns each item either as a string (the simple shape)
 *  or as an object with at least `name`. Normalize to `{ name, ...rest }`. */
function asEntity(v: any): { name: string; rest: any } | null {
  if (typeof v === 'string') return { name: v, rest: {} }
  if (v && typeof v === 'object') {
    const name = v.name || v.canonicalName || v.scientificName || v.commonName
    if (!name) return null
    const { name: _, ...rest } = v
    return { name: String(name), rest }
  }
  return null
}

async function loadFile(db: pg.Pool, path: string): Promise<InsertResult> {
  const r: InsertResult = { inserted: 0, duplicate: 0, errors: 0 }
  if (!existsSync(path)) {
    console.log(`  ${path}: not found, skipping`)
    return r
  }
  const records: any[] = JSON.parse(readFileSync(path, 'utf-8'))
  console.log(`  ${path}: ${records.length} records`)

  const docs = records.filter((rec) => rec.collection === 'documents'
                                      && (sinceDocId === 0 || rec.id >= sinceDocId))
  console.log(`    documents to process: ${docs.length}${sinceDocId > 0 ? ` (since id ${sinceDocId})` : ''}`)

  for (const rec of docs) {
    const ext = rec.strategy3?.extraction
    if (!ext) continue

    const sources: Array<{ key: string; type: 'species' | 'place' | 'protocol' | 'concept' }> = [
      { key: 'species',        type: 'species'  },
      { key: 'places',         type: 'place'    },
      { key: 'protocolsNamed', type: 'protocol' },
      { key: 'concepts',       type: 'concept'  },
    ]

    for (const { key, type } of sources) {
      const list = ext[key]
      if (!Array.isArray(list)) continue
      for (const v of list) {
        const e = asEntity(v)
        if (!e) { r.errors++; continue }
        const result = await insertCandidate(db, type, e.name, e.rest, rec.id, 'documents')
        if      (result === 'inserted')  r.inserted++
        else if (result === 'duplicate') r.duplicate++
        else                             r.errors++
      }
    }
  }
  return r
}

async function main() {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 4,
  })

  console.log('Load Document Extractions')
  console.log('=========================')
  console.log(`  dry-run: ${dryRun}`)
  console.log(`  since-doc-id: ${sinceDocId || '(all)'}`)
  console.log()

  const total: InsertResult = { inserted: 0, duplicate: 0, errors: 0 }
  for (const path of FILES) {
    console.log(`--- ${path} ---`)
    const r = await loadFile(db, path)
    total.inserted  += r.inserted
    total.duplicate += r.duplicate
    total.errors    += r.errors
    console.log(`    inserted=${r.inserted}, duplicate=${r.duplicate}, errors=${r.errors}`)
    console.log()
  }

  console.log('========== Summary ==========')
  console.log(`  Inserted:  ${total.inserted}`)
  console.log(`  Duplicate: ${total.duplicate}`)
  console.log(`  Errors:    ${total.errors}`)
  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
