/**
 * Relink rights-cleared publication PDFs from the retired rmbl.org file store
 * to the public S3 serving bucket (roadmap item 5 remediation).
 *
 * Scope: publications with pdf_link on rmbl.org whose pdf_rights_basis is
 * cleared for redistribution AND whose PDF is (or, with --upload, can be put)
 * in the serving bucket. Cleared bases:
 *   rmbl_owned, oa_licensed:*, oa_published  — from audit-pdf-rights.ts
 *   rmbl_served — everything rmbl.org itself used to serve. RMBL admin cleared
 *     these for public redistribution on 2026-11-09, when the rmbl.org site
 *     migration broke the wp-content/uploads links. Set by --clear-rmbl-served
 *     on the 'review'/'unknown' rows; audit-pdf-rights.ts never overrides it.
 *
 * Serving URL: https://rmbl-hub-pdfs.s3.amazonaws.com/publications/pub_<id>.<ext>
 * Private archive: s3://rmbl-hub-pdfs-private/pdf-staging/publications/pub_<id>.<ext>
 * <ext> follows the legacy link: almost all are pdf, but rmbl.org also served
 * one .docx student paper and one .zip (a 1969 flora).
 * Both are named by the LOCAL publication id. --upload therefore only runs
 * against local, and --target=neon only touches a row whose title matches the
 * local row with the same id, so an id that drifted between the databases can
 * never be pointed at another paper's PDF.
 *
 * Curation-aware (skips rows where an admin curated pdfLink) and bumps
 * updated_at. pdf_link is a remote-wins field in sync, so production needs its
 * own --target=neon run rather than relying on sync:push.
 *
 * Usage (local first, then production):
 *   npx tsx scripts/migrate-pdf-links.ts --clear-rmbl-served --upload [--dry-run] [--limit=N]
 *   npx tsx scripts/migrate-pdf-links.ts --clear-rmbl-served --target=neon [--dry-run]
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import pg from 'pg'
import './lib/config.js'
import { curatedSkipClause } from './lib/curation.js'

const run = promisify(execFile)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const clearRmblServed = args.includes('--clear-rmbl-served')
const upload = args.includes('--upload')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}
if (upload && target !== 'local') {
  console.error('--upload copies files named by LOCAL ids; run it against local, then relink neon separately.')
  process.exit(1)
}

const SERVING_BUCKET = 'rmbl-hub-pdfs'
const SERVING_BASE = `https://${SERVING_BUCKET}.s3.amazonaws.com/publications`
const ARCHIVE_BUCKET = 'rmbl-hub-pdfs-private'
const ARCHIVE_PREFIX = 'pdf-staging/publications'
const ARCHIVE = `s3://${ARCHIVE_BUCKET}/${ARCHIVE_PREFIX}`

const LEGACY_LINK = `pdf_link ~* '^https?://(www\\.)?rmbl\\.org'`
const CLEARED = `(pdf_rights_basis IN ('rmbl_owned', 'oa_published', 'rmbl_served') OR pdf_rights_basis LIKE 'oa_licensed:%')`

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
}

/** The served file's extension, from the legacy link; anything unrecognised is a PDF. */
function extOf(link: string | null): string {
  const ext = (link ?? '').split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''
  return ext in CONTENT_TYPES ? ext : 'pdf'
}

async function servingHas(id: number, ext: string): Promise<boolean> {
  // The serving prefix is public-read, so a missing object answers 403 (no
  // ListBucket) or 404. Anything else is transient: retry, then abort rather
  // than misreport the row as missing.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${SERVING_BASE}/pub_${id}.${ext}`, { method: 'HEAD' })
      if (res.ok) return true
      if (res.status === 403 || res.status === 404) return false
      throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (attempt >= 3) throw new Error(`HEAD pub_${id}.${ext} failed: ${err instanceof Error ? err.message : err}`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

/** Copy the archived file into the serving bucket; false when the archive has no copy. */
async function publishFromArchive(id: number, ext: string): Promise<boolean> {
  const src = `${ARCHIVE}/pub_${id}.${ext}`
  try {
    await run('aws', ['s3api', 'head-object', '--bucket', ARCHIVE_BUCKET, '--key', `${ARCHIVE_PREFIX}/pub_${id}.${ext}`])
  } catch (err) {
    // Only a 404 means "not archived". Anything else (network drop, expired
    // credentials) must stop the run, or the row is misreported as unrecoverable.
    if (/\b(404|Not Found)\b/.test(String((err as { stderr?: string }).stderr ?? ''))) return false
    throw err
  }
  if (!dryRun) {
    await run('aws', ['s3', 'cp', src, `s3://${SERVING_BUCKET}/publications/pub_${id}.${ext}`,
      '--content-type', CONTENT_TYPES[ext], '--only-show-errors'])
  }
  return true
}

const normTitle = (t: string | null) => (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })
  const local = target === 'neon' ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : db
  try {
    // ---- 1. record the admin clearance -------------------------------------
    if (clearRmblServed) {
      const { rows: toClear } = await db.query<{ id: number; pdf_rights_basis: string | null }>(
        `SELECT id, pdf_rights_basis FROM publications
          WHERE ${LEGACY_LINK} AND (pdf_rights_basis IN ('review', 'unknown') OR pdf_rights_basis IS NULL)`,
      )
      const byBasis: Record<string, number> = {}
      for (const r of toClear) byBasis[r.pdf_rights_basis ?? 'NULL'] = (byBasis[r.pdf_rights_basis ?? 'NULL'] ?? 0) + 1
      console.log(`Clearing ${toClear.length} rmbl.org-served PDFs as 'rmbl_served' (was: ${JSON.stringify(byBasis)})`)
      if (!dryRun && toClear.length > 0) {
        await db.query(
          `UPDATE publications SET pdf_rights_basis = 'rmbl_served', pdf_rights_checked_at = NOW(), updated_at = NOW()
            WHERE id = ANY($1::int[])`,
          [toClear.map((r) => r.id)],
        )
      }
    }

    // ---- 2. relink (and, locally, publish) ----------------------------------
    // In a dry run the clearance above was not written, so select as if it had been.
    const clearedNow = dryRun && clearRmblServed
      ? `(${CLEARED} OR pdf_rights_basis IN ('review', 'unknown') OR pdf_rights_basis IS NULL)`
      : CLEARED
    const { rows } = await db.query<{ id: number; title: string | null; pdf_link: string }>(
      `SELECT id, title, pdf_link FROM publications WHERE ${LEGACY_LINK} AND ${clearedNow}
        ORDER BY id ${limit ? `LIMIT ${limit}` : ''}`,
    )
    console.log(`${rows.length} cleared publications with a legacy rmbl.org pdf_link`)

    const localTitle = new Map<number, string>()
    if (target === 'neon' && rows.length > 0) {
      const { rows: lr } = await local.query<{ id: number; title: string | null }>(
        'SELECT id, title FROM publications WHERE id = ANY($1::int[])',
        [rows.map((r) => r.id)],
      )
      for (const r of lr) localTitle.set(r.id, normTitle(r.title))
    }

    let relinked = 0
    let published = 0
    let curatedSkipped = 0
    const idMismatch: number[] = []
    const unavailable: number[] = []
    for (const row of rows) {
      if (target === 'neon' && localTitle.get(row.id) !== normTitle(row.title)) {
        idMismatch.push(row.id)
        continue
      }
      const ext = extOf(row.pdf_link)
      if (!(await servingHas(row.id, ext))) {
        if (upload && (await publishFromArchive(row.id, ext))) {
          published++
        } else {
          unavailable.push(row.id)
          continue
        }
      }
      if (dryRun) {
        relinked++
        continue
      }
      const res = await db.query(
        `UPDATE publications SET pdf_link = $1, updated_at = NOW()
          WHERE id = $2 AND ${curatedSkipClause(['pdf_link'])}`,
        [`${SERVING_BASE}/pub_${row.id}.${ext}`, row.id],
      )
      if (res.rowCount) relinked++
      else curatedSkipped++
      if ((relinked + curatedSkipped) % 50 === 0) process.stdout.write(`\r  ${relinked} relinked`)
    }

    console.log(
      `\r${dryRun ? '[dry-run] ' : ''}Done: ${relinked} relinked to S3` +
        (upload ? ` (${published} ${dryRun ? 'would be ' : ''}published from the private archive)` : '') +
        `, ${curatedSkipped} admin-curated skipped.`,
    )
    if (unavailable.length) {
      console.log(`${unavailable.length} not in the serving bucket${upload ? ' or the archive' : ' (re-run locally with --upload)'}: ` +
        unavailable.join(', '))
    }
    if (idMismatch.length) {
      console.log(`${idMismatch.length} skipped: title differs from the local row with the same id: ${idMismatch.join(', ')}`)
    }
  } finally {
    await db.end()
    if (local !== db) await local.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
