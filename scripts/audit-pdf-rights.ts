/**
 * PDF redistribution-rights audit (roadmap item 5)
 *
 * Scope: publications whose PDF WE serve — pdf_link on rmbl.org (the legacy
 * Pubs DB file store) or S3. External publisher/repository links are out of
 * scope: linking out is not redistribution.
 *
 * Classification per publication (written to pdf_rights_basis):
 *   - student_paper / thesis         → 'rmbl_owned' (RMBL program works)
 *   - DOI + Unpaywall CC license     → 'oa_licensed:<license>'
 *   - DOI + gold/hybrid/diamond OA   → 'oa_published' (publisher OA, license
 *                                       unstated — low risk)
 *   - DOI + green/bronze OA          → 'review' (free-to-read elsewhere is not
 *                                       a grant to redistribute the version we
 *                                       host)
 *   - DOI + closed, or no DOI        → 'unknown' (highest risk)
 *
 * Outputs scripts/output/pdf-rights-worklist.csv for 'review' + 'unknown'
 * rows — the manual-review queue. Do this while the legacy Pubs DB is up:
 * its records may answer deposit provenance questions.
 *
 * Re-runs skip rows already classified (--force rechecks everything).
 *
 * Usage:
 *   npx tsx scripts/audit-pdf-rights.ts [--dry-run] [--force] [--limit=N] [--target=neon]
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import { OUTPUT_DIR, UNPAYWALL_API, UNPAYWALL_EMAIL, DELAYS } from './lib/config.js'
import { sleep } from './lib/concurrency.js'

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const SERVED_PDF = `pdf_link ~* '^https?://((www\\.)?rmbl\\.org|[^/]*s3[.-][^/]*amazonaws)'`

interface UnpaywallRights {
  oaStatus: string | null
  license: string | null
}

async function fetchRights(doi: string): Promise<UnpaywallRights | null> {
  try {
    const res = await fetch(`${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      oaStatus: data.oa_status ?? null,
      license: data.best_oa_location?.license ?? data.oa_locations?.find((l: any) => l.license)?.license ?? null,
    }
  } catch {
    return null
  }
}

function classify(pubType: string, doi: string | null, rights: UnpaywallRights | null): string {
  if (pubType === 'student_paper' || pubType === 'thesis') return 'rmbl_owned'
  if (!doi) return 'unknown'
  if (!rights || !rights.oaStatus) return 'unknown'
  if (rights.license && rights.license.startsWith('cc')) return `oa_licensed:${rights.license}`
  if (['gold', 'hybrid', 'diamond'].includes(rights.oaStatus)) return 'oa_published'
  if (['green', 'bronze'].includes(rights.oaStatus)) return 'review'
  return 'unknown' // closed
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })
  try {
    const { rows } = await db.query(
      `SELECT id, title, year, journal, doi, publication_type, pdf_link, pdf_rights_basis
       FROM publications
       WHERE ${SERVED_PDF} ${force ? '' : 'AND pdf_rights_basis IS NULL'}
       ORDER BY id ${limit ? `LIMIT ${limit}` : ''}`,
    )
    console.log(`${rows.length} served-PDF publications to classify`)

    const counts: Record<string, number> = {}
    let checked = 0
    for (const row of rows) {
      const doi = row.doi?.trim() || null
      let rights: UnpaywallRights | null = null
      const structural = row.publication_type === 'student_paper' || row.publication_type === 'thesis'
      if (!structural && doi) {
        rights = await fetchRights(doi)
        await sleep(DELAYS.UNPAYWALL_MS)
      }
      const basis = classify(row.publication_type, doi, rights)
      counts[basis] = (counts[basis] ?? 0) + 1
      if (!dryRun) {
        // updated_at bump keeps incremental sync aware of the change
        await db.query(
          `UPDATE publications SET pdf_rights_basis = $1, pdf_rights_checked_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [basis, row.id],
        )
      }
      checked++
      if (checked % 100 === 0) process.stdout.write(`\r  ${checked}/${rows.length} classified`)
    }
    console.log(`\r  ${checked}/${rows.length} classified`)

    console.log(`\nBasis distribution (this run):`)
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(24)} ${v}`)
    }

    // Worklist for manual review (whole table, not just this run)
    const { rows: worklist } = await db.query(
      `SELECT id, pdf_rights_basis, publication_type, year, doi, journal, title, pdf_link
       FROM publications
       WHERE ${SERVED_PDF} AND (pdf_rights_basis IN ('review', 'unknown') OR pdf_rights_basis IS NULL)
       ORDER BY pdf_rights_basis, year DESC NULLS LAST`,
    )
    if (target === 'local' && !dryRun) {
      const path = join(OUTPUT_DIR, 'pdf-rights-worklist.csv')
      const header = 'id,basis,type,year,doi,journal,title,pdf_link'
      const body = worklist
        .map((r: any) => [r.id, r.pdf_rights_basis, r.publication_type, r.year, r.doi, r.journal, r.title, r.pdf_link].map(csvEscape).join(','))
        .join('\n')
      writeFileSync(path, `${header}\n${body}\n`)
      console.log(`\n${worklist.length} rows need manual review → ${path}`)
    } else {
      console.log(`\n${worklist.length} rows in the manual-review queue.`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
