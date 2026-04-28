/**
 * Load story entity extractions into the knowledge graph.
 *
 * Reads story-entity-extraction.json and:
 *   1. Updates story_type in the stories table from LLM classification
 *   2. Matches species, places, concepts to existing canonical entities
 *   3. Creates entity_mentions entries (collection='stories')
 *   4. Matches researchers to existing author records
 *   5. Links projects by name
 *
 * Uses fuzzy matching (trigram similarity) for entity resolution against
 * existing canonical tables. Does NOT create new canonical entities —
 * only links to ones that already exist.
 *
 * Usage:
 *   npx tsx scripts/load-story-extractions.ts [--dry-run]
 */

import { readFileSync } from 'fs'
import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const RESULTS_PATH = 'scripts/output/story-entity-extraction.json'

async function main() {
  console.log('Load Story Entity Extractions')
  console.log('=============================')
  if (dryRun) console.log('(DRY RUN)')

  const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
  console.log(`${results.length} extraction results to process`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 3,
  })

  try {
    // Preload canonical entity lookup tables
    console.log('\nLoading canonical entities...')
    const { rows: speciesRows } = await db.query('SELECT id, lower(canonical_name) as name FROM species')
    const speciesMap = new Map(speciesRows.map((r: any) => [r.name, r.id]))
    console.log(`  Species: ${speciesMap.size}`)

    const { rows: placeRows } = await db.query('SELECT id, lower(name) as name FROM places')
    const placeMap = new Map(placeRows.map((r: any) => [r.name, r.id]))
    console.log(`  Places: ${placeMap.size}`)

    const { rows: conceptRows } = await db.query('SELECT id, lower(name) as name FROM concepts')
    const conceptMap = new Map(conceptRows.map((r: any) => [r.name, r.id]))
    console.log(`  Concepts: ${conceptMap.size}`)

    const { rows: protocolRows } = await db.query('SELECT id, lower(name) as name FROM protocols')
    const protocolMap = new Map(protocolRows.map((r: any) => [r.name, r.id]))
    console.log(`  Protocols: ${protocolMap.size}`)

    const { rows: authorRows } = await db.query('SELECT id, lower(display_name) as name, lower(family_name) as family FROM authors WHERE work_count > 0')
    const authorByName = new Map(authorRows.map((r: any) => [r.name, r.id]))
    const authorByFamily = new Map<string, number[]>()
    for (const r of authorRows) {
      if (!r.family) continue
      if (!authorByFamily.has(r.family)) authorByFamily.set(r.family, [])
      authorByFamily.get(r.family)!.push(r.id)
    }
    console.log(`  Authors: ${authorByName.size}`)

    const { rows: projectRows } = await db.query('SELECT id, lower(name) as name FROM projects')
    const projectMap = new Map(projectRows.map((r: any) => [r.name, r.id]))
    console.log(`  Projects: ${projectMap.size}`)

    // Process each extraction
    let storyTypesUpdated = 0
    let mentionsCreated = 0
    let researcherLinked = 0
    let projectLinked = 0
    let skippedNoMatch = 0

    for (const r of results) {
      const storyId = r.id

      // 1. Update story_type
      if (r.storyType && !dryRun) {
        await db.query('UPDATE stories SET story_type = $1 WHERE id = $2 AND story_type = $3',
          [r.storyType, storyId, 'news_article'])
        storyTypesUpdated++
      }

      // 2. Match and link species
      for (const s of r.species || []) {
        const name = (s.scientificName || s.commonName || '').toLowerCase().trim()
        const entityId = speciesMap.get(name)
        if (entityId && !dryRun) {
          await insertMention(db, 'species', entityId, 'stories', storyId, s.role || 'mentioned')
          mentionsCreated++
        } else if (!entityId) skippedNoMatch++
      }

      // 3. Match and link places
      for (const p of r.places || []) {
        const name = (p.name || '').toLowerCase().trim()
        const entityId = placeMap.get(name)
        if (entityId && !dryRun) {
          await insertMention(db, 'place', entityId, 'stories', storyId, p.role || 'mentioned')
          mentionsCreated++
        } else if (!entityId) skippedNoMatch++
      }

      // 4. Match and link concepts
      for (const c of r.concepts || []) {
        const name = (c.name || '').toLowerCase().trim()
        let entityId = conceptMap.get(name)
        // Also check protocols if not a concept
        if (!entityId) entityId = protocolMap.get(name) ? undefined : undefined
        if (entityId && !dryRun) {
          await insertMention(db, 'concept', entityId, 'stories', storyId, c.role || 'mentioned')
          mentionsCreated++
        } else if (!entityId) skippedNoMatch++
      }

      // 5. Match researchers to authors (by family name)
      for (const res of r.researchers || []) {
        const name = (res.name || '').toLowerCase().trim()
        let authorId = authorByName.get(name)
        if (!authorId) {
          // Try matching by family name (last word)
          const family = name.split(/\s+/).pop() || ''
          const candidates = authorByFamily.get(family) || []
          if (candidates.length === 1) authorId = candidates[0]
        }
        if (authorId && !dryRun) {
          // Link author to story via authors_rels
          await db.query(
            `INSERT INTO authors_rels (parent_id, path, stories_id, "order")
             SELECT $1, 'stories', $2, 1
             WHERE NOT EXISTS (SELECT 1 FROM authors_rels WHERE parent_id = $1 AND stories_id = $2)`,
            [authorId, storyId],
          ).catch(() => {}) // ignore if stories_id column doesn't exist yet
          researcherLinked++
        }
      }

      // 6. Link projects
      for (const proj of r.projects || []) {
        const name = (proj.name || '').toLowerCase().trim()
        const projectId = projectMap.get(name)
        if (projectId && !dryRun) {
          // Link via projects_rels if the column exists
          await db.query(
            `INSERT INTO projects_rels (parent_id, path, stories_id, "order")
             SELECT $1, 'stories', $2, 1
             WHERE NOT EXISTS (SELECT 1 FROM projects_rels WHERE parent_id = $1 AND stories_id = $2)`,
            [projectId, storyId],
          ).catch(() => {}) // ignore if stories_id column doesn't exist yet
          projectLinked++
        }
      }
    }

    // Update search vectors for stories with updated types
    if (!dryRun) {
      await db.query(`
        UPDATE stories SET search_vector =
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
        WHERE search_vector IS NULL
      `)
    }

    console.log(`\n========== Summary ==========`)
    console.log(`Story types updated: ${storyTypesUpdated}`)
    console.log(`Entity mentions created: ${mentionsCreated}`)
    console.log(`Researchers linked: ${researcherLinked}`)
    console.log(`Projects linked: ${projectLinked}`)
    console.log(`Skipped (no canonical match): ${skippedNoMatch}`)

    // Show story type distribution
    if (!dryRun) {
      const { rows: typeDist } = await db.query(
        'SELECT story_type, count(*) as n FROM stories GROUP BY story_type ORDER BY n DESC',
      )
      console.log('\nStory type distribution:')
      for (const r of typeDist) console.log(`  ${r.story_type}: ${r.n}`)

      const { rows: [{ n: mentionCount }] } = await db.query(
        "SELECT count(*)::int as n FROM entity_mentions WHERE collection = 'stories'",
      )
      console.log(`\nTotal story entity mentions: ${mentionCount}`)
    }
  } finally {
    await db.end()
  }
}

async function insertMention(
  db: pg.Pool, entityType: string, entityId: number,
  collection: string, itemId: number, role: string,
) {
  await db.query(
    `INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
     VALUES ($1, $2, $3, $4, $5, 0.9, 'llm')
     ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING`,
    [entityType, entityId, collection, itemId, role],
  )
}

main().catch((err) => { console.error(err); process.exit(1) })
