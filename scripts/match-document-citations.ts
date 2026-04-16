/**
 * Match Document References to Publications and Documents in the Knowledge Hub
 *
 * For each references_cited row with source_document_id set but no
 * target_publication_id, try to find a matching item by:
 *   1. Exact DOI match against publications (high confidence)
 *   2. Title trigram similarity against publications (threshold >= 0.80)
 *   3. Title trigram similarity against documents (threshold >= 0.80)
 *
 * Updates target_publication_id OR target_document_id and match_method/
 * match_confidence columns.
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
      SELECT id, source_document_id, cited_title, cited_authors, cited_year, cited_doi
      FROM references_cited
      WHERE source_document_id IS NOT NULL
        AND target_publication_id IS NULL
        AND target_document_id IS NULL
        AND target_dataset_id IS NULL
        AND cited_title IS NOT NULL
        AND length(cited_title) > 5
    `)
    console.log(`\n${refs.length} unmatched document references to check`)

    let doiPubMatches = 0, doiDsMatches = 0, titleMatches = 0, docMatches = 0, dsTitleMatches = 0, failed = 0

    // --- Pass 1: DOI matching (fast, exact) against publications and datasets ---
    console.log('\nPass 1: DOI matching...')
    const withDoi = refs.filter((r: any) => r.cited_doi && /10\.\d+\//.test(r.cited_doi))
    console.log(`  ${withDoi.length} references have DOIs`)

    for (const ref of withDoi) {
      const doi = String(ref.cited_doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim()

      const { rows: [pubMatch] } = await db.query(
        `SELECT id FROM publications WHERE lower(doi) = $1 LIMIT 1`, [doi],
      )
      if (pubMatch) {
        if (!dryRun) {
          await db.query(
            `UPDATE references_cited SET target_publication_id = $1, link_type = 'internal',
             match_method = 'doi_exact', match_confidence = 1.0 WHERE id = $2`,
            [pubMatch.id, ref.id],
          )
        }
        doiPubMatches++
        continue
      }

      const { rows: [dsMatch] } = await db.query(
        `SELECT id FROM datasets WHERE lower(doi) = $1 LIMIT 1`, [doi],
      )
      if (dsMatch) {
        if (!dryRun) {
          await db.query(
            `UPDATE references_cited SET target_dataset_id = $1, link_type = 'internal',
             match_method = 'doi_exact', match_confidence = 1.0 WHERE id = $2`,
            [dsMatch.id, ref.id],
          )
        }
        doiDsMatches++
      }
    }
    console.log(`  DOI matches: ${doiPubMatches} publication, ${doiDsMatches} dataset`)

    // --- Pass 2: Title trigram matching across publications, datasets, documents ---
    console.log('\nPass 2: Title trigram matching...')
    const doiMatchedIds = new Set<number>()
    // DOI-matched refs already updated above — re-fetch unmatched set for title pass
    const { rows: stillUnmatched } = await db.query(`
      SELECT id, source_document_id, cited_title, cited_year
      FROM references_cited
      WHERE source_document_id IS NOT NULL
        AND target_publication_id IS NULL
        AND target_document_id IS NULL
        AND target_dataset_id IS NULL
        AND cited_title IS NOT NULL
        AND length(cited_title) > 10
    `)
    console.log(`  ${stillUnmatched.length} references to match by title`)

    const TRGM_THRESHOLD = 0.80
    let checked = 0

    for (const ref of stillUnmatched) {
      checked++
      if (checked % 500 === 0) {
        process.stdout.write(`\r  Checked ${checked}/${stillUnmatched.length} (pub=${titleMatches} ds=${dsTitleMatches} doc=${docMatches})`)
      }

      const title = String(ref.cited_title).trim()
      if (title.length < 10) continue

      try {
        // 1. Try publications (with year filter)
        const pubQuery = ref.cited_year
          ? `SELECT id, similarity(lower(title), lower($1)) as sim
             FROM publications WHERE title % $1
               AND (year IS NULL OR year BETWEEN $2::int - 2 AND $2::int + 2)
             ORDER BY similarity(lower(title), lower($1)) DESC LIMIT 1`
          : `SELECT id, similarity(lower(title), lower($1)) as sim
             FROM publications WHERE title % $1
             ORDER BY similarity(lower(title), lower($1)) DESC LIMIT 1`
        const { rows: [pubMatch] } = await db.query(pubQuery, ref.cited_year ? [title, ref.cited_year] : [title])
        if (pubMatch && pubMatch.sim >= TRGM_THRESHOLD) {
          if (!dryRun) {
            await db.query(
              `UPDATE references_cited SET target_publication_id = $1, link_type = 'internal',
               match_method = 'title_trigram', match_confidence = $2 WHERE id = $3`,
              [pubMatch.id, pubMatch.sim, ref.id],
            )
          }
          titleMatches++
          continue
        }

        // 2. Try datasets
        const { rows: [dsMatch] } = await db.query(`
          SELECT id, similarity(lower(title), lower($1)) as sim
          FROM datasets WHERE title % $1
          ORDER BY similarity(lower(title), lower($1)) DESC LIMIT 1
        `, [title])
        if (dsMatch && dsMatch.sim >= TRGM_THRESHOLD) {
          if (!dryRun) {
            await db.query(
              `UPDATE references_cited SET target_dataset_id = $1, link_type = 'internal',
               match_method = 'title_trigram', match_confidence = $2 WHERE id = $3`,
              [dsMatch.id, dsMatch.sim, ref.id],
            )
          }
          dsTitleMatches++
          continue
        }

        // 3. Try documents (skip self)
        const { rows: [docMatch] } = await db.query(`
          SELECT id, similarity(lower(title), lower($1)) as sim
          FROM documents WHERE title % $1 AND id != $2
          ORDER BY similarity(lower(title), lower($1)) DESC LIMIT 1
        `, [title, ref.source_document_id || 0])
        if (docMatch && docMatch.sim >= TRGM_THRESHOLD) {
          if (!dryRun) {
            await db.query(
              `UPDATE references_cited SET target_document_id = $1, link_type = 'internal',
               match_method = 'title_trigram', match_confidence = $2 WHERE id = $3`,
              [docMatch.id, docMatch.sim, ref.id],
            )
          }
          docMatches++
        }
      } catch (err: any) {
        failed++
      }
    }
    console.log(`\r  Checked ${checked}/${stillUnmatched.length} (pub=${titleMatches} ds=${dsTitleMatches} doc=${docMatches})`)

    console.log('\n========== Summary ==========')
    console.log(`DOI matches:          ${doiPubMatches} publication, ${doiDsMatches} dataset`)
    console.log(`Title trigram matches: ${titleMatches} publication, ${dsTitleMatches} dataset, ${docMatches} document`)
    console.log(`Failed: ${failed}`)
    const totalThisRun = doiPubMatches + doiDsMatches + titleMatches + dsTitleMatches + docMatches
    console.log(`Total matched: ${totalThisRun} / ${refs.length} (${Math.round(100 * totalThisRun / refs.length)}%)`)

    if (!dryRun) {
      const { rows: [{ count: pubCount }] } = await db.query(`
        SELECT count(*)::int as count FROM references_cited
        WHERE source_document_id IS NOT NULL AND target_publication_id IS NOT NULL
      `)
      const { rows: [{ count: dsCount }] } = await db.query(`
        SELECT count(*)::int as count FROM references_cited
        WHERE source_document_id IS NOT NULL AND target_dataset_id IS NOT NULL
      `)
      const { rows: [{ count: docCount }] } = await db.query(`
        SELECT count(*)::int as count FROM references_cited
        WHERE source_document_id IS NOT NULL AND target_document_id IS NOT NULL
      `)
      console.log(`\nTotal document→publication citations: ${pubCount}`)
      console.log(`Total document→dataset citations:     ${dsCount}`)
      console.log(`Total document→document citations:    ${docCount}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
