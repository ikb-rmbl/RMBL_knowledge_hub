/**
 * STATUS: Historical one-shot (completed). Idempotent — safe to re-run if
 *         build-authors.ts is re-run with an older version that drops
 *         position info, but no expected re-runs in normal operation.
 *
 * Fix Author Ordering in authors_rels
 *
 * The `publications_authors` table (Payload inline array) has correct author
 * ordering from CrossRef/scraping. The `authors_rels` table (deduped registry)
 * has broken ordering because build-authors.ts discarded position info.
 *
 * This script:
 *   1. Matches each `publications_authors` entry to its `authors_rels` entry
 *      by fuzzy name match (family name + given initial)
 *   2. Updates `authors_rels.order` to match `publications_authors._order`
 *   3. Creates missing `authors_rels` entries for authors that were dropped
 *   4. Creates new author records if no match exists in the registry
 *
 * Usage:
 *   npx tsx scripts/fix-author-order.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

function normalize(s: string | null): string {
  return (s || '').toLowerCase().replace(/[.,'"]/g, '').replace(/\s+/g, ' ').trim()
}

function initialOf(given: string | null): string {
  return (given || '').trim().charAt(0).toLowerCase()
}

async function main() {
  console.log('Fix Author Ordering')
  console.log('===================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 3,
  })

  try {
    // Pre-flight stats
    const { rows: [before] } = await db.query(`
      SELECT
        COUNT(DISTINCT publications_id) FILTER (WHERE "order" = 1) as pubs_with_first,
        COUNT(*) FILTER (WHERE "order" = 1) as order_1_count,
        COUNT(DISTINCT publications_id) as total_pubs
      FROM authors_rels WHERE path = 'publications'
    `)
    console.log(`\nBefore: ${before.pubs_with_first} pubs have order=1 entries (${before.order_1_count} total), ${before.total_pubs} pubs linked`)

    // Load all deduped authors for matching
    const { rows: authors } = await db.query(`
      SELECT id, family_name, given_name, display_name FROM authors
    `)
    console.log(`Loaded ${authors.length} authors from registry`)

    // Build lookup indexes
    const byFamilyInitial = new Map<string, any[]>() // "smith|j" → [author, ...]
    const byFamily = new Map<string, any[]>()         // "smith" → [author, ...]
    for (const a of authors) {
      const fam = normalize(a.family_name)
      const init = initialOf(a.given_name)
      if (fam) {
        const key = init ? `${fam}|${init}` : fam
        if (!byFamilyInitial.has(key)) byFamilyInitial.set(key, [])
        byFamilyInitial.get(key)!.push(a)
        if (!byFamily.has(fam)) byFamily.set(fam, [])
        byFamily.get(fam)!.push(a)
      }
    }

    // Load all publications_authors (ground truth ordering)
    const { rows: pubAuthors } = await db.query(`
      SELECT _parent_id as pub_id, _order, given, family
      FROM publications_authors
      ORDER BY _parent_id, _order
    `)
    console.log(`Loaded ${pubAuthors.length} publication-author entries (ground truth)`)

    // Load existing authors_rels for publications
    const { rows: existingRels } = await db.query(`
      SELECT id, parent_id as author_id, publications_id as pub_id, "order"
      FROM authors_rels WHERE path = 'publications'
    `)
    // Build lookup: pub_id → [{ relId, authorId, authorFam, authorGiven }]
    const relsByPub = new Map<number, any[]>()
    const authorById = new Map<number, any>()
    for (const a of authors) authorById.set(a.id, a)
    for (const r of existingRels) {
      if (!relsByPub.has(r.pub_id)) relsByPub.set(r.pub_id, [])
      const author = authorById.get(r.author_id)
      relsByPub.get(r.pub_id)!.push({
        relId: r.id,
        authorId: r.author_id,
        familyName: normalize(author?.family_name || ''),
        givenInitial: initialOf(author?.given_name || ''),
        currentOrder: r.order,
      })
    }

    // Group pubAuthors by publication
    const pubAuthorsByPub = new Map<number, typeof pubAuthors>()
    for (const pa of pubAuthors) {
      if (!pubAuthorsByPub.has(pa.pub_id)) pubAuthorsByPub.set(pa.pub_id, [])
      pubAuthorsByPub.get(pa.pub_id)!.push(pa)
    }

    let orderFixed = 0, relsCreated = 0, authorsCreated = 0, unmatched = 0
    const pubsProcessed = new Set<number>()

    for (const [pubId, paList] of pubAuthorsByPub) {
      pubsProcessed.add(pubId)
      const rels = relsByPub.get(pubId) || []

      for (const pa of paList) {
        const paFam = normalize(pa.family)
        const paInit = initialOf(pa.given)
        const targetOrder = pa._order

        // Try to find matching rel entry
        let matchedRel = null

        // Strategy 1: exact family + initial match in existing rels
        for (const rel of rels) {
          if (rel.familyName === paFam && (rel.givenInitial === paInit || !paInit || !rel.givenInitial)) {
            matchedRel = rel
            break
          }
        }

        // Strategy 2: family-only match if unambiguous
        if (!matchedRel) {
          const familyMatches = rels.filter((r: any) => r.familyName === paFam)
          if (familyMatches.length === 1) matchedRel = familyMatches[0]
        }

        if (matchedRel) {
          // Fix ordering if wrong
          if (matchedRel.currentOrder !== targetOrder) {
            if (!dryRun) {
              await db.query('UPDATE authors_rels SET "order" = $1 WHERE id = $2', [targetOrder, matchedRel.relId])
            }
            orderFixed++
          }
          // Mark as used so we don't double-match
          matchedRel.familyName = '__used__'
        } else {
          // No existing rel — need to create one
          // Find or create author in registry
          const key = paInit ? `${paFam}|${paInit}` : paFam
          const candidates = byFamilyInitial.get(key) || []

          let authorId: number | null = null

          if (candidates.length === 1) {
            authorId = candidates[0].id
          } else if (candidates.length > 1) {
            // Try tighter match on full given name
            const paGiven = normalize(pa.given)
            const tightMatch = candidates.find((c: any) => normalize(c.given_name) === paGiven)
            if (tightMatch) authorId = tightMatch.id
            else authorId = candidates[0].id // best guess
          }

          if (!authorId && paFam.length >= 2) {
            // Create new author
            if (!dryRun) {
              const displayName = [pa.given, pa.family].filter(Boolean).join(' ')
              const { rows: [newAuthor] } = await db.query(
                `INSERT INTO authors (display_name, family_name, given_name, work_count, created_at, updated_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW()) RETURNING id`,
                [displayName, pa.family, pa.given],
              )
              authorId = newAuthor.id
              // Add to lookup
              const newEntry = { id: authorId, family_name: pa.family, given_name: pa.given }
              byFamilyInitial.get(key)?.push(newEntry) || byFamilyInitial.set(key, [newEntry])
            }
            authorsCreated++
          }

          if (authorId) {
            if (!dryRun) {
              try {
                await db.query(
                  `INSERT INTO authors_rels (parent_id, path, publications_id, "order")
                   SELECT $1, 'publications', $2, $3
                   WHERE NOT EXISTS (
                     SELECT 1 FROM authors_rels WHERE parent_id = $1 AND publications_id = $2 AND path = 'publications'
                   )`,
                  [authorId, pubId, targetOrder],
                )
              } catch { /* skip FK failures */ }
            }
            relsCreated++
          } else {
            unmatched++
          }
        }
      }
    }

    // Update work_count for all authors
    if (!dryRun) {
      console.log('\nUpdating author work counts...')
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
    }

    // Post-fix stats
    if (!dryRun) {
      const { rows: [after] } = await db.query(`
        SELECT
          COUNT(DISTINCT publications_id) as total_pubs,
          COUNT(*) FILTER (WHERE "order" = 1) as order_1_count,
          (SELECT COUNT(*) FROM (
            SELECT publications_id FROM authors_rels
            WHERE path = 'publications' AND "order" = 1
            GROUP BY publications_id HAVING COUNT(*) = 1
          ) sub) as clean_single_first
        FROM authors_rels WHERE path = 'publications'
      `)
      console.log(`\nAfter:`)
      console.log(`  ${after.clean_single_first} pubs have clean single first author (was ~1,997)`)
      console.log(`  ${after.order_1_count} order=1 entries total`)
    }

    console.log(`\n========== Summary ==========`)
    console.log(`Orders fixed: ${orderFixed}`)
    console.log(`New rels created: ${relsCreated}`)
    console.log(`New authors created: ${authorsCreated}`)
    console.log(`Unmatched (no author found): ${unmatched}`)
    console.log(`Publications processed: ${pubsProcessed.size}`)

    // Spot-check pub 13
    if (!dryRun) {
      console.log(`\nSpot-check pub 13 (Anderson et al. 2025):`)
      const { rows: check } = await db.query(`
        SELECT a.family_name, a.given_name, ar."order"
        FROM authors_rels ar JOIN authors a ON a.id = ar.parent_id
        WHERE ar.publications_id = 13 AND ar.path = 'publications'
        ORDER BY ar."order"
      `)
      for (const r of check) console.log(`  ${r.order}. ${r.given_name || ''} ${r.family_name}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
