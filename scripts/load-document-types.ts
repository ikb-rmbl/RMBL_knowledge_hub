/**
 * Populate documents.document_type from LLM extraction data.
 */
import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub' })
  const docs = JSON.parse(readFileSync('scripts/output/document-entity-extraction.json', 'utf-8'))
  let updated = 0, skipped = 0
  for (const item of docs) {
    if (item.collection !== 'documents') continue
    const rawId = String(item.id).replace(/^doc_/, '')
    const itemId = parseInt(rawId, 10)
    const docType = item.strategy3?.extraction?.documentType
    if (!itemId || !docType) { skipped++; continue }
    const { rowCount } = await db.query(
      'UPDATE documents SET document_type = $1, updated_at = NOW() WHERE id = $2 AND document_type IS NULL',
      [docType, itemId],
    )
    if ((rowCount || 0) > 0) updated++
  }
  console.log(`Updated ${updated}, skipped ${skipped}`)
  await db.end()
}
main()
