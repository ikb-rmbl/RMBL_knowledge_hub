/**
 * Match LLM-extracted dataset citations (datasets.cited_references, from
 * extract-dataset-variables-llm.ts) to publications and insert
 * datasets_rels rows (path='relatedPublications') — the same links the
 * "Has companion publication" chip and Related Works read.
 *
 * Matching: exact lowercased DOI first, then trigram similarity between the
 * citation string and publication titles (similarity > 0.5 on the best
 * candidate). Idempotent — existing links are skipped.
 *
 * Usage:
 *   npx tsx scripts/link-dataset-citations.ts [--dry-run] [--target=neon]
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })
  try {
    const { rows } = await db.query(`
      SELECT id, cited_references FROM datasets
      WHERE jsonb_typeof(cited_references) = 'array' AND jsonb_array_length(cited_references) > 0
    `)
    console.log(`${rows.length} datasets with cited references`)
    let byDoi = 0, byTitle = 0, already = 0, unmatched = 0

    for (const d of rows) {
      for (const ref of d.cited_references as { doi: string | null; citation: string }[]) {
        let pubId: number | null = null
        let how = ''
        if (ref.doi) {
          const r = await db.query(`SELECT id FROM publications WHERE lower(doi) = $1 LIMIT 1`, [ref.doi])
          if (r.rows[0]) { pubId = r.rows[0].id; how = 'doi' }
        }
        if (!pubId && ref.citation?.length > 30) {
          // citation strings embed authors/journal, so compare against titles
          // with word_similarity (title ⊂ citation), not symmetric similarity
          const r = await db.query(
            `SELECT id, word_similarity(lower(title), lower($1)) AS sim
             FROM publications WHERE length(title) > 20
             ORDER BY sim DESC LIMIT 1`,
            [ref.citation],
          )
          if (r.rows[0]?.sim > 0.5) { pubId = r.rows[0].id; how = 'title' }
        }
        if (!pubId) { unmatched++; continue }

        const exists = await db.query(
          `SELECT 1 FROM datasets_rels WHERE parent_id = $1 AND publications_id = $2`,
          [d.id, pubId],
        )
        if (exists.rows.length) { already++; continue }
        if (!dryRun) {
          await db.query(
            `INSERT INTO datasets_rels (parent_id, publications_id, path, "order")
             VALUES ($1, $2, 'relatedPublications',
                     coalesce((SELECT max("order") FROM datasets_rels WHERE parent_id = $1), 0) + 1)`,
            [d.id, pubId],
          )
        }
        if (how === 'doi') byDoi++
        else byTitle++
      }
    }
    console.log(`Done: ${byDoi} new links by DOI, ${byTitle} by title similarity, ${already} already linked, ${unmatched} unmatched`)
  } finally {
    await db.end()
  }
}

main()
