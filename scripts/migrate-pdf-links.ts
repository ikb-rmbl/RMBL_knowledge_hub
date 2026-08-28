/**
 * Relink rights-cleared publication PDFs from the retiring rmbl.org file
 * store to the public S3 serving bucket (roadmap item 5 remediation).
 *
 * Scope: publications with pdf_link on rmbl.org whose pdf_rights_basis is
 * cleared for redistribution (rmbl_owned, oa_licensed:*, oa_published) AND
 * whose PDF exists in the serving bucket. 'review'/'unknown' rows are left
 * untouched — their links die at the legacy shutdown unless triage clears
 * them (then re-run this after re-uploading).
 *
 * Serving URL: https://rmbl-hub-pdfs.s3.amazonaws.com/publications/pub_<id>.pdf
 * (private archive twin: s3://rmbl-hub-pdfs-private/pdf-staging/publications/)
 *
 * Curation-aware (skips rows where an admin curated pdfLink) and bumps
 * updated_at so incremental sync sees the change — though pdf_link is a
 * remote-wins field in sync, so run with --target=neon for production
 * rather than relying on sync:push.
 *
 * Usage:
 *   npx tsx scripts/migrate-pdf-links.ts [--dry-run] [--limit=N] [--target=neon]
 */

import pg from 'pg'
import './lib/config.js'
import { curatedSkipClause } from './lib/curation.js'

const dryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const SERVING_BASE = 'https://rmbl-hub-pdfs.s3.amazonaws.com/publications'

async function s3Has(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${SERVING_BASE}/pub_${id}.pdf`, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })
  try {
    const { rows } = await db.query(
      `SELECT id, pdf_rights_basis FROM publications
       WHERE pdf_link ~* '^https?://(www\\.)?rmbl\\.org'
         AND (pdf_rights_basis = 'rmbl_owned' OR pdf_rights_basis LIKE 'oa_licensed:%' OR pdf_rights_basis = 'oa_published')
       ORDER BY id ${limit ? `LIMIT ${limit}` : ''}`,
    )
    console.log(`${rows.length} cleared publications with legacy pdf_link`)

    let relinked = 0
    let notInBucket = 0
    let curatedSkipped = 0
    for (const row of rows) {
      if (!(await s3Has(row.id))) {
        notInBucket++
        continue
      }
      const newUrl = `${SERVING_BASE}/pub_${row.id}.pdf`
      if (dryRun) {
        relinked++
        continue
      }
      const res = await db.query(
        `UPDATE publications SET pdf_link = $1, updated_at = NOW()
         WHERE id = $2 AND ${curatedSkipClause(['pdf_link'])}`,
        [newUrl, row.id],
      )
      if (res.rowCount) relinked++
      else curatedSkipped++
    }
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Done: ${relinked} relinked to S3, ` +
        `${notInBucket} not in bucket (upload first), ${curatedSkipped} admin-curated skipped.`,
    )
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
