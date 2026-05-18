/**
 * STATUS: Historical one-shot (completed). Idempotent — safe to re-run if
 *         build-authors.ts produces new false merges, but no expected
 *         re-runs in normal operation.
 *
 * Split False Author Merges
 *
 * Finds authors whose linked publications have conflicting first initials
 * in publications_authors (ground truth), indicating false merges of
 * different people with the same family name.
 *
 * For each false merge:
 *   1. Groups publications by first initial of given name
 *   2. Keeps the largest group on the original author record
 *   3. Creates new author records for each other initial group
 *   4. Reassigns authors_rels entries
 *   5. Updates work_count
 *
 * Usage:
 *   npx tsx scripts/fix-author-splits.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'
import { curatedSafe } from './lib/curation.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

async function main() {
  console.log('Fix Author Splits')
  console.log('=================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 3,
  })

  try {
    // Find authors with conflicting initials across their publications.
    // Uses a "signature" — first initial + middle initial (if present) — to group.
    // "R. J." and "R. A." get different signatures; "R." and "R. J." get "R" and "R.J"
    const { rows: suspects } = await db.query(`
      WITH author_pub_sigs AS (
        SELECT a.id as author_id, a.display_name, a.family_name, a.given_name,
          ar.publications_id as pub_id, ar.id as rel_id, ar."order",
          pa.given as pub_given,
          CASE
            WHEN pa.given ~ '^[A-Z]\\. [A-Z]' THEN left(pa.given, 1) || '.' || substring(pa.given from 4 for 1)
            WHEN pa.given ~ '^[A-Z][a-z]+ [A-Z]' THEN left(pa.given, 1) || '.' || substring(pa.given from position(' ' in pa.given) + 1 for 1)
            ELSE left(pa.given, 1)
          END as sig
        FROM authors a
        JOIN authors_rels ar ON ar.parent_id = a.id AND ar.path = 'publications'
        JOIN publications_authors pa ON pa._parent_id = ar.publications_id
          AND lower(pa.family) = lower(a.family_name)
        WHERE pa.given IS NOT NULL AND length(pa.given) > 0
      )
      SELECT author_id, display_name, family_name, given_name,
        array_agg(DISTINCT sig ORDER BY sig) as sigs,
        count(DISTINCT sig) as n_sigs,
        count(DISTINCT pub_id) as pub_count
      FROM author_pub_sigs
      GROUP BY author_id, display_name, family_name, given_name
      HAVING count(DISTINCT sig) > 1
      ORDER BY count(DISTINCT sig) DESC, count(DISTINCT pub_id) DESC
    `)

    console.log(`\nFound ${suspects.length} authors with conflicting first initials`)

    let totalSplits = 0, totalNewAuthors = 0, totalReassigned = 0

    for (const s of suspects) {
      // Get all publications with their given-name variants and signatures
      const { rows: pubVariants } = await db.query(`
        SELECT ar.publications_id as pub_id, ar.id as rel_id, ar."order",
          pa.given as pub_given,
          CASE
            WHEN pa.given ~ '^[A-Z]\\. [A-Z]' THEN left(pa.given, 1) || '.' || substring(pa.given from 4 for 1)
            WHEN pa.given ~ '^[A-Z][a-z]+ [A-Z]' THEN left(pa.given, 1) || '.' || substring(pa.given from position(' ' in pa.given) + 1 for 1)
            ELSE left(pa.given, 1)
          END as sig
        FROM authors_rels ar
        JOIN publications_authors pa ON pa._parent_id = ar.publications_id
          AND lower(pa.family) = lower($1)
        WHERE ar.parent_id = $2 AND ar.path = 'publications'
          AND pa.given IS NOT NULL AND length(pa.given) > 0
      `, [s.family_name, s.author_id])

      // Group by signature (first + middle initial)
      const groups = new Map<string, typeof pubVariants>()
      for (const pv of pubVariants) {
        if (!groups.has(pv.sig)) groups.set(pv.sig, [])
        groups.get(pv.sig)!.push(pv)
      }

      if (groups.size <= 1) continue // no split needed (variants resolved to same initial)

      // Sort groups by size — keep largest on original author
      const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
      const [keepSig, keepPubs] = sorted[0]

      // Pick the best given name for the kept group
      const keepGivenNames = keepPubs.map((p: any) => p.pub_given)
      const bestKeepGiven = keepGivenNames.sort((a: string, b: string) => b.length - a.length)[0]

      if (dryRun && totalSplits < 15) {
        console.log(`\n  ${s.display_name} (id:${s.author_id}, ${s.pub_count} pubs) → keep "${keepSig}" (${keepPubs.length} pubs), split: ${sorted.slice(1).map(([sig, p]) => `"${sig}" (${p.length})`).join(', ')}`)
      }

      // Update original author's given_name to the best variant from the kept group
      if (!dryRun) {
        await db.query(
          `UPDATE authors SET ${curatedSafe('given_name', '$1')}, ${curatedSafe('display_name', '$2')}, updated_at = NOW() WHERE id = $3`,
          [bestKeepGiven, `${bestKeepGiven} ${s.family_name}`, s.author_id])
      }

      // Create new authors for each other initial group
      for (let gi = 1; gi < sorted.length; gi++) {
        const [sig, pubs] = sorted[gi]
        const givenNames = pubs.map((p: any) => p.pub_given)
        const bestGiven = givenNames.sort((a: string, b: string) => b.length - a.length)[0]
        const displayName = `${bestGiven} ${s.family_name}`

        let newAuthorId: number | null = null
        if (!dryRun) {
          // Check if an author with this specific name already exists
          const { rows: existing } = await db.query(
            `SELECT id FROM authors WHERE lower(family_name) = lower($1) AND left(lower(given_name), 1) = lower($2) AND work_count > 0 LIMIT 1`,
            [s.family_name, sig.charAt(0)],
          )
          if (existing.length > 0) {
            newAuthorId = existing[0].id
          } else {
            const { rows: [created] } = await db.query(
              `INSERT INTO authors (display_name, family_name, given_name, work_count, created_at, updated_at)
               VALUES ($1, $2, $3, 0, NOW(), NOW()) RETURNING id`,
              [displayName, s.family_name, bestGiven],
            )
            newAuthorId = created.id
            totalNewAuthors++
          }

          // Reassign authors_rels for these publications
          for (const p of pubs) {
            await db.query(
              'UPDATE authors_rels SET parent_id = $1 WHERE id = $2',
              [newAuthorId, p.rel_id],
            )
            totalReassigned++
          }
        } else {
          totalReassigned += pubs.length
          totalNewAuthors++
        }
      }

      totalSplits++
    }

    // Update work_count for all affected authors
    if (!dryRun) {
      console.log('\nUpdating work counts...')
      await db.query(`
        UPDATE authors a SET work_count = sub.total
        FROM (
          SELECT parent_id,
            COUNT(DISTINCT publications_id) FILTER (WHERE publications_id IS NOT NULL) +
            COUNT(DISTINCT datasets_id) FILTER (WHERE datasets_id IS NOT NULL) +
            COUNT(DISTINCT documents_id) FILTER (WHERE documents_id IS NOT NULL) as total
          FROM authors_rels
          GROUP BY parent_id
        ) sub
        WHERE a.id = sub.parent_id
      `)
      // Zero out authors that lost all publications
      await db.query(`
        UPDATE authors SET work_count = 0
        WHERE id NOT IN (SELECT DISTINCT parent_id FROM authors_rels)
          AND work_count > 0
      `)
    }

    console.log(`\n========== Summary ==========`)
    console.log(`Authors split: ${totalSplits}`)
    console.log(`New author records: ${totalNewAuthors}`)
    console.log(`Rels reassigned: ${totalReassigned}`)

    // Spot check
    if (!dryRun) {
      console.log('\nSpot check — Smiths:')
      const { rows: smiths } = await db.query(`
        SELECT id, display_name, work_count FROM authors
        WHERE family_name = 'Smith' AND work_count > 0
        ORDER BY work_count DESC
      `)
      for (const s of smiths) console.log(`  ${s.display_name} (id:${s.id}, ${s.work_count} works)`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
