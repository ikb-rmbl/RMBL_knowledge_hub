/**
 * Deduplicate stories in the database.
 *
 * Three passes:
 *   1. Remove non-relevant articles (calendars, legals, agendas, market reports)
 *   2. Remove exact title duplicates (keep longest full_text, then lowest id)
 *   3. Remove syndication near-duplicates (trigram similarity >0.85, keep longest text)
 *
 * Requires pg_trgm extension for similarity().
 *
 * Usage:
 *   npx tsx scripts/dedup-stories.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')

// Titles/patterns that are never relevant to RMBL
const EXCLUDE_TITLES = [
  'people & happenings',
  'crested butte legals',
  'gunnison legals',
  'summer activities',
  'summer activities guide',
]

const EXCLUDE_PATTERNS = [
  '%community calendar%',
  '%calendar of events%',
  '%kids calendar%',
  "kid's calendar%",
  'briefs%',
]

// Title patterns for non-RMBL articles that slip through keyword search
const IRRELEVANT_PATTERNS = [
  '%fetal%neonatal%',
  '%crested butte town council issues agenda%',
  '%research and markets%offers%',
  '%research and markets%adds%',
  '%water cooler %/%/%',
]

async function main() {
  console.log('Deduplicate Stories')
  console.log('===================')
  if (dryRun) console.log('(DRY RUN)\n')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    const { rows: [{ n: before }] } = await db.query('SELECT count(*)::int as n FROM stories')
    console.log(`Starting with ${before} stories\n`)

    // Pass 1: Remove non-relevant articles by exact title or pattern
    const { rows: pass1 } = await db.query(`
      SELECT id, title FROM stories
      WHERE lower(title) = ANY($1)
        OR lower(title) LIKE ANY($2)
        OR lower(title) LIKE ANY($3)
    `, [EXCLUDE_TITLES, EXCLUDE_PATTERNS, IRRELEVANT_PATTERNS])
    console.log(`Pass 1 — Non-relevant: ${pass1.length} articles`)
    if (pass1.length > 0 && !dryRun) {
      const ids = pass1.map((r: any) => r.id)
      await db.query('DELETE FROM stories WHERE id = ANY($1)', [ids])
    }
    for (const r of pass1.slice(0, 10)) console.log(`  - ${r.title}`)
    if (pass1.length > 10) console.log(`  ... and ${pass1.length - 10} more`)

    // Pass 2: Remove exact title duplicates (keep longest text, then lowest id)
    const { rows: pass2 } = await db.query(`
      SELECT id, title FROM (
        SELECT id, title,
          ROW_NUMBER() OVER (
            PARTITION BY lower(title)
            ORDER BY length(coalesce(full_text, '')) DESC, id ASC
          ) as rn
        FROM stories
      ) sub
      WHERE rn > 1
    `)
    console.log(`\nPass 2 — Exact title duplicates: ${pass2.length} articles`)
    if (pass2.length > 0 && !dryRun) {
      const ids = pass2.map((r: any) => r.id)
      await db.query('DELETE FROM stories WHERE id = ANY($1)', [ids])
    }
    for (const r of pass2.slice(0, 10)) console.log(`  - ${r.title}`)
    if (pass2.length > 10) console.log(`  ... and ${pass2.length - 10} more`)

    // Pass 3: Remove syndication near-duplicates (similarity > 0.85)
    const { rows: pass3 } = await db.query(`
      SELECT b.id, b.title, a.title as kept_title,
        round(similarity(lower(a.title), lower(b.title))::numeric, 2) as sim
      FROM stories a
      JOIN stories b ON b.id > a.id
        AND similarity(lower(a.title), lower(b.title)) > 0.85
      WHERE length(coalesce(a.full_text, '')) >= length(coalesce(b.full_text, ''))
    `)
    console.log(`\nPass 3 — Syndication near-duplicates (>0.85 similarity): ${pass3.length} articles`)
    if (pass3.length > 0 && !dryRun) {
      const ids = pass3.map((r: any) => r.id)
      await db.query('DELETE FROM stories WHERE id = ANY($1)', [ids])
    }
    for (const r of pass3.slice(0, 10)) console.log(`  - [${r.sim}] "${r.title}" → kept "${r.kept_title}"`)
    if (pass3.length > 10) console.log(`  ... and ${pass3.length - 10} more`)

    // Pass 4: Remove false-positive matches with no RMBL relevance
    // An article is relevant if it mentions RMBL, Rocky Mountain Biological, or Gothic (the town)
    const { rows: pass4 } = await db.query(`
      SELECT id, title, length(full_text) as text_len
      FROM stories
      WHERE full_text IS NOT NULL
        AND (length(full_text) - length(replace(lower(full_text), 'rmbl', ''))) / 4 = 0
        AND (length(full_text) - length(replace(lower(full_text), 'rocky mountain biological', ''))) / 25 = 0
        AND (length(full_text) - length(replace(lower(full_text), 'gothic', ''))) / 6 = 0
        AND lower(full_text) NOT LIKE '%biological laboratory%'
    `)
    console.log(`\nPass 4 — Likely research papers or tangential long texts: ${pass4.length} articles`)
    if (pass4.length > 0 && !dryRun) {
      const ids = pass4.map((r: any) => r.id)
      await db.query('DELETE FROM stories WHERE id = ANY($1)', [ids])
    }
    for (const r of pass4.slice(0, 10)) console.log(`  - [${r.text_len} chars] ${r.title}`)
    if (pass4.length > 10) console.log(`  ... and ${pass4.length - 10} more`)

    // Update search vectors for any remaining entries missing them
    if (!dryRun) {
      await db.query(`
        UPDATE stories SET search_vector =
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
        WHERE search_vector IS NULL
      `)
    }

    const { rows: [{ n: after }] } = await db.query('SELECT count(*)::int as n FROM stories')
    const removed = before - after
    console.log(`\n========== Summary ==========`)
    console.log(`Before: ${before}`)
    console.log(`Removed: ${dryRun ? pass1.length + pass2.length + pass3.length : removed} (${pass1.length} non-relevant, ${pass2.length} exact dupes, ${pass3.length} syndication dupes)`)
    console.log(`After: ${dryRun ? before - pass1.length - pass2.length - pass3.length : after}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
