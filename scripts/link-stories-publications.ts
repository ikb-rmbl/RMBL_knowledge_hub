/**
 * Build story↔publication links using three signals:
 *   1. Title matching — LLM-extracted publication references vs publications table
 *   2. Shared researchers — story researcher names matched to publication authors
 *   3. Shared entities — stories and publications mentioning the same entities
 *
 * Writes links to references_cited table (source_story_id → target_publication_id)
 * for use in graph building and related works.
 *
 * Usage:
 *   npx tsx scripts/link-stories-publications.ts [--dry-run]
 */

import { readFileSync } from 'fs'
import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log('Link Stories to Publications')
  console.log('===========================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 3,
  })

  try {
    const results = JSON.parse(readFileSync('scripts/output/story-entity-extraction.json', 'utf-8'))
    console.log(`${results.length} story extractions loaded`)

    // Ensure source_story_id column exists on references_cited
    await db.query(`
      ALTER TABLE references_cited ADD COLUMN IF NOT EXISTS source_story_id integer REFERENCES stories(id)
    `)

    // Signal 1: Title matching via trigram similarity
    console.log('\n--- Signal 1: Title matching ---')
    let titleMatches = 0

    for (const s of results) {
      for (const ref of s.publicationsReferenced || []) {
        if (!ref.title || ref.title.length < 15) continue

        // Try trigram similarity match
        const { rows } = await db.query(`
          SELECT id, title, similarity(lower(title), lower($1)) as sim
          FROM publications
          WHERE similarity(lower(title), lower($1)) > 0.4
          ORDER BY similarity(lower(title), lower($1)) DESC
          LIMIT 1
        `, [ref.title.slice(0, 150)])

        if (rows.length > 0) {
          if (!dryRun) {
            await db.query(`
              INSERT INTO references_cited (source_story_id, target_publication_id, link_type, match_method, raw_citation)
              SELECT $1, $2, 'title_match', 'title_similarity', $3
              WHERE NOT EXISTS (
                SELECT 1 FROM references_cited WHERE source_story_id = $1 AND target_publication_id = $2
              )
            `, [s.id, rows[0].id, ref.title.slice(0, 300)])
          }
          titleMatches++
        }
      }
    }
    console.log(`  ${titleMatches} title matches`)

    // Signal 2: Shared researchers → find publications by the same authors
    console.log('\n--- Signal 2: Shared researchers ---')
    let researcherMatches = 0

    for (const s of results) {
      const researchers = s.researchers || []
      if (researchers.length === 0) continue

      for (const res of researchers) {
        const familyName = (res.name || '').split(/\s+/).pop()?.toLowerCase()
        if (!familyName || familyName.length < 3) continue

        // Find publications by this researcher
        const { rows: pubs } = await db.query(`
          SELECT DISTINCT ar.publications_id as pub_id
          FROM authors_rels ar
          JOIN authors a ON a.id = ar.parent_id
          WHERE lower(a.family_name) = $1 AND ar.path = 'publications'
          LIMIT 10
        `, [familyName])

        for (const p of pubs) {
          if (!dryRun) {
            await db.query(`
              INSERT INTO references_cited (source_story_id, target_publication_id, link_type, match_method, raw_citation)
              SELECT $1, $2, 'researcher_match', 'researcher_name', $3
              WHERE NOT EXISTS (
                SELECT 1 FROM references_cited WHERE source_story_id = $1 AND target_publication_id = $2
              )
            `, [s.id, p.pub_id, `Researcher: ${res.name}`])
          }
          researcherMatches++
        }
      }
    }
    console.log(`  ${researcherMatches} researcher-based links`)

    // Signal 3: Shared entities (≥3 shared) — bulk query
    console.log('\n--- Signal 3: Shared entities ---')
    const { rows: entityLinks } = await db.query(`
      SELECT em1.item_id as story_id, em2.item_id as pub_id, count(*) as shared
      FROM entity_mentions em1
      JOIN entity_mentions em2 ON em2.entity_type = em1.entity_type AND em2.entity_id = em1.entity_id
      WHERE em1.collection = 'stories' AND em2.collection = 'publications'
      GROUP BY em1.item_id, em2.item_id
      HAVING count(*) >= 3
      ORDER BY count(*) DESC
    `)
    console.log(`  ${entityLinks.length} story-pub pairs with ≥3 shared entities`)

    let entityMatches = 0
    for (const e of entityLinks) {
      if (!dryRun) {
        await db.query(`
          INSERT INTO references_cited (source_story_id, target_publication_id, link_type, match_method, raw_citation)
          SELECT $1, $2, 'entity_match', 'shared_entities', $3
          WHERE NOT EXISTS (
            SELECT 1 FROM references_cited WHERE source_story_id = $1 AND target_publication_id = $2
          )
        `, [e.story_id, e.pub_id, `${e.shared} shared entities`])
      }
      entityMatches++
    }
    console.log(`  ${entityMatches} entity-based links`)

    // Summary
    if (!dryRun) {
      const { rows: [{ n }] } = await db.query(
        'SELECT count(*)::int as n FROM references_cited WHERE source_story_id IS NOT NULL',
      )
      console.log(`\nTotal story→publication links in DB: ${n}`)

      const { rows: [{ stories: linkedStories }] } = await db.query(
        'SELECT count(DISTINCT source_story_id)::int as stories FROM references_cited WHERE source_story_id IS NOT NULL',
      )
      const { rows: [{ pubs: linkedPubs }] } = await db.query(
        'SELECT count(DISTINCT target_publication_id)::int as pubs FROM references_cited WHERE source_story_id IS NOT NULL',
      )
      console.log(`Linked stories: ${linkedStories}`)
      console.log(`Linked publications: ${linkedPubs}`)
    } else {
      console.log(`\nWould create: ${titleMatches} title + ${researcherMatches} researcher + ${entityMatches} entity links`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
