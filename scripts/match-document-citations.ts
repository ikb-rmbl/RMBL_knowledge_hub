/**
 * Match Document References to Publications in the Knowledge Hub
 *
 * For each references_cited row with source_document_id set but no
 * target_publication_id, try to find a matching publication by:
 *   1. Exact DOI match (high confidence)
 *   2. Title similarity (trigram threshold >= 0.75)
 *   3. Title + author + year heuristic
 *
 * Updates target_publication_id and match_method/match_confidence columns.
 *
 * Usage:
 *   npx tsx scripts/match-document-citations.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

async function main() {
  console.log('Match Document Citations to Publications')
  console.log('========================================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Ensure pg_trgm extension is available (usually already installed)
    await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')

    // Get unmatched document references
    const { rows: refs } = await db.query(`
      SELECT id, cited_title, cited_authors, cited_year, cited_doi
      FROM references_cited
      WHERE source_document_id IS NOT NULL
        AND target_publication_id IS NULL
        AND cited_title IS NOT NULL
        AND length(cited_title) > 5
    `)
    console.log(`\n${refs.length} unmatched document references to check`)

    let doiMatches = 0, titleMatches = 0, failed = 0

    // --- Pass 1: DOI matching (fast, exact) ---
    console.log('\nPass 1: DOI matching...')
    const withDoi = refs.filter((r: any) => r.cited_doi && /10\.\d+\//.test(r.cited_doi))
    console.log(`  ${withDoi.length} references have DOIs`)

    for (const ref of withDoi) {
      const doi = String(ref.cited_doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim()
      const { rows: [match] } = await db.query(
        `SELECT id FROM publications WHERE lower(doi) = $1 LIMIT 1`,
        [doi],
      )
      if (match) {
        if (!dryRun) {
          await db.query(
            `UPDATE references_cited SET target_publication_id = $1, link_type = 'internal',
             match_method = 'doi_exact', match_confidence = 1.0 WHERE id = $2`,
            [match.id, ref.id],
          )
        }
        doiMatches++
      }
    }
    console.log(`  DOI matches: ${doiMatches}`)

    // --- Pass 2: Title trigram matching for remaining refs ---
    console.log('\nPass 2: Title trigram matching...')
    const remaining = refs.filter((r: any) => !(r.cited_doi && /10\.\d+\//.test(r.cited_doi)))
    console.log(`  ${remaining.length} references to match by title`)

    const TRGM_THRESHOLD = 0.80 // trigram similarity threshold (below 0.8 yields many false positives)
    let checked = 0

    for (const ref of remaining) {
      checked++
      if (checked % 500 === 0) process.stdout.write(`\r  Checked ${checked}/${remaining.length} (${titleMatches} matched)`)

      const title = String(ref.cited_title).trim()
      if (title.length < 10) continue // skip very short titles

      // Use trigram similarity with an optional year filter
      let query: string
      let params: any[]
      if (ref.cited_year) {
        query = `
          SELECT id, title, year, similarity(lower(title), lower($1)) as sim
          FROM publications
          WHERE title % $1
            AND (year IS NULL OR year BETWEEN $2::int - 2 AND $2::int + 2)
          ORDER BY similarity(lower(title), lower($1)) DESC
          LIMIT 1
        `
        params = [title, ref.cited_year]
      } else {
        query = `
          SELECT id, title, year, similarity(lower(title), lower($1)) as sim
          FROM publications
          WHERE title % $1
          ORDER BY similarity(lower(title), lower($1)) DESC
          LIMIT 1
        `
        params = [title]
      }

      try {
        const { rows: [match] } = await db.query(query, params)
        if (match && match.sim >= TRGM_THRESHOLD) {
          if (!dryRun) {
            await db.query(
              `UPDATE references_cited SET target_publication_id = $1, link_type = 'internal',
               match_method = 'title_trigram', match_confidence = $2 WHERE id = $3`,
              [match.id, match.sim, ref.id],
            )
          }
          titleMatches++
        }
      } catch (err: any) {
        failed++
      }
    }
    console.log(`\r  Checked ${checked}/${remaining.length} (${titleMatches} matched)`)

    console.log('\n========== Summary ==========')
    console.log(`DOI matches: ${doiMatches}`)
    console.log(`Title matches: ${titleMatches}`)
    console.log(`Failed: ${failed}`)
    console.log(`Total matched: ${doiMatches + titleMatches} / ${refs.length} (${Math.round(100 * (doiMatches + titleMatches) / refs.length)}%)`)

    if (!dryRun) {
      const { rows: [{ count: totalMatched }] } = await db.query(`
        SELECT count(*)::int as count FROM references_cited
        WHERE source_document_id IS NOT NULL AND target_publication_id IS NOT NULL
      `)
      console.log(`\nTotal document→publication citations in DB: ${totalMatched}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
