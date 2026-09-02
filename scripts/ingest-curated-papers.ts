/**
 * Curated RMBL papers ingest (manual curation effort, 2025–mid-2026)
 *
 * Input: scripts/data/rmbl-curated-papers-2026.json — the hand-curated RMBL
 * papers list (from RMBL_2025_Pubs_Sept2025.xlsx), CrossRef-enriched where a
 * DOI resolves. Every row is ground truth "this IS RMBL research".
 *
 * For each paper:
 *   - match by DOI (normalized), then title similarity (pg_trgm >= 0.9)
 *   - matched  → assert rmbl_research='yes' AND record it as an admin
 *     curation (curated_fields += 'rmblResearch') so pipelines never flip it
 *   - unmatched → tombstone check, then INSERT with data_source='manual',
 *     discovery_method='manual_entry', authors from CrossRef where available
 *
 * Idempotent: re-runs match the previously inserted rows by DOI/title.
 *
 * Usage:
 *   npx tsx scripts/ingest-curated-papers.ts [--dry-run] [--target=neon]
 *
 * Follow local runs with generate-embeddings.ts and build-authors.ts (new
 * papers have no author registry links until the next build).
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { extractKeys, matchesAnyTombstone, type TombstoneKeys } from './lib/dedup-keys.js'

const dryRun = process.argv.includes('--dry-run')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

interface CuratedPaper {
  year: number
  firstAuthor: string | null
  pocAuthor: string | null
  journal: string | null
  citation: string | null
  doi: string | null
  sheet: string
  title?: string
  crossrefYear?: number
  crossrefJournal?: string | null
  authors?: { family: string; given: string | null }[]
  abstract?: string | null
}

async function main() {
  const papers: CuratedPaper[] = JSON.parse(
    readFileSync(join(import.meta.dirname, 'data', 'rmbl-curated-papers-2026.json'), 'utf-8'),
  )
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''} — ${papers.length} curated papers`)
  const db = new pg.Pool({ connectionString })
  try {
    const tombstones: TombstoneKeys[] = (
      await db.query(`SELECT keys FROM duplicate_tombstones WHERE collection = 'publications'`)
    ).rows.map((r) => r.keys)

    let asserted = 0
    let alreadySet = 0
    let inserted = 0
    let skipped = 0
    for (const p of papers) {
      // --- match ---
      let match: { id: number; rmbl_research: string | null; curated: boolean } | null = null
      if (p.doi) {
        const { rows } = await db.query(
          `SELECT id, rmbl_research, curated_fields @> '["rmblResearch"]'::jsonb AS curated
           FROM publications WHERE lower(regexp_replace(doi, '^https?://doi\\.org/', '')) = $1 LIMIT 1`,
          [p.doi],
        )
        match = rows[0] ?? null
      }
      if (!match && p.title) {
        const { rows } = await db.query(
          `SELECT id, rmbl_research, curated_fields @> '["rmblResearch"]'::jsonb AS curated
           FROM publications WHERE similarity(lower(title), lower($1)) >= 0.9
           ORDER BY similarity(lower(title), lower($1)) DESC LIMIT 1`,
          [p.title],
        )
        match = rows[0] ?? null
      }

      if (match) {
        if (match.rmbl_research === 'yes' && match.curated) {
          alreadySet++
          continue
        }
        if (!dryRun) {
          await db.query(
            `UPDATE publications SET rmbl_research = 'yes',
               curated_fields = CASE WHEN curated_fields @> '["rmblResearch"]'::jsonb
                 THEN curated_fields ELSE curated_fields || '["rmblResearch"]'::jsonb END,
               updated_at = NOW()
             WHERE id = $1`,
            [match.id],
          )
        }
        asserted++
        continue
      }

      // --- insert ---
      if (!p.title) {
        console.log(`  ! no match and no title — skipped: ${(p.citation ?? p.doi ?? '?').slice(0, 70)}`)
        skipped++
        continue
      }
      const keys = extractKeys('publications', { doi: p.doi, title: p.title, year: p.crossrefYear ?? p.year })
      if (matchesAnyTombstone(keys, tombstones)) {
        console.log(`  ~ tombstoned, skipped: ${p.title.slice(0, 60)}`)
        skipped++
        continue
      }
      if (dryRun) {
        console.log(`  [dry-run] INSERT [${p.year}] ${p.title.slice(0, 70)}`)
        inserted++
        continue
      }
      const res = await db.query(
        `INSERT INTO publications
           (title, year, journal, doi, abstract, publication_type, data_source,
            discovery_method, pdf_available, rmbl_research, curated_fields, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'article', 'manual', 'manual_entry', false, 'yes',
                 '["rmblResearch"]'::jsonb, NOW(), NOW())
         RETURNING id`,
        [p.title, p.crossrefYear ?? p.year, p.crossrefJournal ?? p.journal, p.doi, p.abstract ?? null],
      )
      const newId = res.rows[0].id
      const authors = p.authors ?? []
      for (let i = 0; i < authors.length; i++) {
        await db.query(
          `INSERT INTO publications_authors (_order, _parent_id, id, given, family)
           VALUES ($1, $2, gen_random_uuid()::text, $3, $4)`,
          [i + 1, newId, authors[i].given ?? '', authors[i].family],
        )
      }
      inserted++
    }
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Done: ${inserted} inserted, ${asserted} rmbl_research asserted, ` +
        `${alreadySet} already curated, ${skipped} skipped.`,
    )
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
