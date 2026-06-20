/**
 * One-shot backfill of `document_type` for Federal Register notices.
 *
 * Run after `load-to-payload.ts --collection=documents` if any FR rows
 * are missing `document_type` (typically because the loader's per-batch
 * post-load SQL pass only covers rows it inserted in that run; rows
 * loaded by an earlier run without the SQL pass are missed).
 *
 * Reads `scripts/output/discovered-fr-notices.json`, matches by
 * `sourceUrl`, sets `document_type` only when currently NULL (so it
 * never overwrites curator edits).
 *
 *   npx tsx scripts/backfill-fr-document-types.ts
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

async function main() {
  const d = JSON.parse(readFileSync('scripts/output/discovered-fr-notices.json', 'utf-8'))
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  let n = 0
  for (const doc of d.documents) {
    if (!doc.documentType || !doc.sourceUrl) continue
    const { rowCount } = await pool.query(
      'UPDATE documents SET document_type=$1 WHERE source_url=$2 AND document_type IS NULL',
      [doc.documentType, doc.sourceUrl],
    )
    n += rowCount ?? 0
  }
  console.log(`backfilled ${n} rows`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
