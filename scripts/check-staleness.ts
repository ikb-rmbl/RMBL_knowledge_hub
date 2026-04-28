/**
 * Check staleness of derived data (graph, communities, primers, embeddings).
 *
 * Compares timestamps across pipeline stages to identify what needs rebuilding.
 * Run after data changes to see what's out of date.
 *
 * Usage:
 *   npx tsx scripts/check-staleness.ts
 */

import { readFileSync, statSync } from 'fs'
import pg from 'pg'
import './lib/config.js'

function fileAge(path: string): { mtime: Date; age: string } | null {
  try {
    const stat = statSync(path)
    const hours = Math.round((Date.now() - stat.mtimeMs) / 3600000)
    const age = hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
    return { mtime: stat.mtime, age }
  } catch { return null }
}

async function main() {
  console.log('Pipeline Staleness Check')
  console.log('========================\n')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // 1. Source data timestamps
    console.log('--- Source Data ---')
    const { rows: [sources] } = await db.query(`
      SELECT
        (SELECT max(updated_at) FROM publications) as pub_latest,
        (SELECT max(updated_at) FROM datasets) as ds_latest,
        (SELECT max(updated_at) FROM documents) as doc_latest,
        (SELECT max(updated_at) FROM stories) as story_latest,
        (SELECT max(created_at) FROM entity_mentions) as mention_latest,
        (SELECT count(*) FROM publications) as pub_count,
        (SELECT count(*) FROM datasets) as ds_count,
        (SELECT count(*) FROM documents) as doc_count,
        (SELECT count(*) FROM stories) as story_count,
        (SELECT count(*) FROM entity_mentions) as mention_count
    `)
    console.log(`  Publications: ${sources.pub_count} (latest: ${sources.pub_latest?.toISOString().slice(0, 10) || '?'})`)
    console.log(`  Datasets: ${sources.ds_count} (latest: ${sources.ds_latest?.toISOString().slice(0, 10) || '?'})`)
    console.log(`  Documents: ${sources.doc_count} (latest: ${sources.doc_latest?.toISOString().slice(0, 10) || '?'})`)
    console.log(`  Stories: ${sources.story_count} (latest: ${sources.story_latest?.toISOString().slice(0, 10) || '?'})`)
    console.log(`  Entity mentions: ${sources.mention_count}`)

    // 2. Graph files
    console.log('\n--- Graph Files ---')
    const graphFiles = [
      { path: 'public/graph/unified.json', label: 'Unified graph' },
      { path: 'public/graph/unified-research.json', label: 'Research graph' },
      { path: 'public/graph/communities.json', label: 'Communities' },
      { path: 'public/graph/species.json', label: 'Species explore' },
      { path: 'public/graph/concepts.json', label: 'Concepts explore' },
      { path: 'public/graph/protocols.json', label: 'Protocols explore' },
      { path: 'public/graph/places.json', label: 'Places explore' },
      { path: 'public/graph/authors.json', label: 'Authors explore' },
      { path: 'public/graph/publications.json', label: 'Publications explore' },
      { path: 'public/graph/datasets.json', label: 'Datasets explore' },
    ]
    let oldestGraph: Date | null = null
    for (const gf of graphFiles) {
      const info = fileAge(gf.path)
      if (info) {
        console.log(`  ${gf.label.padEnd(25)} ${info.age.padEnd(10)} (${info.mtime.toISOString().slice(0, 10)})`)
        if (!oldestGraph || info.mtime < oldestGraph) oldestGraph = info.mtime
      } else {
        console.log(`  ${gf.label.padEnd(25)} MISSING`)
      }
    }

    // 3. Neighborhoods and primers
    console.log('\n--- Neighborhoods & Primers ---')
    const { rows: [nbrStats] } = await db.query(`
      SELECT
        count(*) as total,
        count(primer) as with_primer,
        min(primer_generated_at) as oldest_primer,
        max(primer_generated_at) as newest_primer
      FROM neighborhoods
    `)
    console.log(`  Neighborhoods: ${nbrStats.total}`)
    console.log(`  With primers: ${nbrStats.with_primer}`)
    if (nbrStats.oldest_primer) {
      console.log(`  Primer range: ${nbrStats.oldest_primer.toISOString().slice(0, 10)} — ${nbrStats.newest_primer.toISOString().slice(0, 10)}`)
    }

    // Check primer-content alignment
    const { rows: [alignment] } = await db.query(`
      SELECT
        count(*) FILTER (WHERE primer IS NOT NULL AND
          lower(primer) LIKE '%' || lower(split_part(title, ' ', 1)) || '%'
          AND lower(primer) LIKE '%' || lower(split_part(title, ' ', 3)) || '%'
        ) as aligned,
        count(*) FILTER (WHERE primer IS NOT NULL) as total_primers
      FROM neighborhoods
    `)
    if (alignment.total_primers > 0) {
      const pct = Math.round(alignment.aligned / alignment.total_primers * 100)
      console.log(`  Primer alignment: ${alignment.aligned}/${alignment.total_primers} (${pct}%)`)
      if (pct < 70) console.log(`  ⚠ LOW ALIGNMENT — primers may be stale from community re-detection`)
    }

    // 4. Staleness assessment
    console.log('\n--- Staleness Assessment ---')
    const warnings: string[] = []

    const mentionDate = sources.mention_latest ? new Date(sources.mention_latest) : null

    // Graph older than entity mentions?
    if (oldestGraph && mentionDate && oldestGraph < mentionDate) {
      warnings.push(`Graph files (${oldestGraph.toISOString().slice(0, 10)}) are older than latest entity mentions (${mentionDate.toISOString().slice(0, 10)}) — rebuild graphs`)
    }

    // Primers older than graph?
    if (nbrStats.newest_primer && oldestGraph && new Date(nbrStats.newest_primer) < oldestGraph) {
      warnings.push(`Primers (${nbrStats.newest_primer.toISOString().slice(0, 10)}) are older than graph (${oldestGraph.toISOString().slice(0, 10)}) — regenerate primers`)
    }

    // Missing primers on large neighborhoods?
    const { rows: [missing] } = await db.query(`
      SELECT count(*) as n FROM neighborhoods
      WHERE primer IS NULL AND size >= 50
        AND (COALESCE((type_counts->>'publication')::int, 0) >= 5
          OR COALESCE((type_counts->>'document')::int, 0) >= 5
          OR COALESCE((type_counts->>'story')::int, 0) >= 5)
    `)
    if (missing.n > 0) warnings.push(`${missing.n} large neighborhoods (size≥50) have no primer`)

    // Stories without entity extraction?
    const { rows: [storyExtraction] } = await db.query(`
      SELECT
        (SELECT count(*) FROM stories WHERE full_text IS NOT NULL AND length(full_text) >= 1000) as extractable,
        (SELECT count(DISTINCT item_id) FROM entity_mentions WHERE collection = 'stories') as extracted
    `)
    const unextracted = storyExtraction.extractable - storyExtraction.extracted
    if (unextracted > 10) warnings.push(`${unextracted} stories with full text have no entity extraction`)

    // Embeddings missing?
    const { rows: [embeddings] } = await db.query(`
      SELECT
        (SELECT count(*) FROM publications WHERE embedding IS NULL AND abstract IS NOT NULL) as pubs_missing,
        (SELECT count(*) FROM stories WHERE embedding IS NULL AND full_text IS NOT NULL) as stories_missing
    `)
    if (embeddings.pubs_missing > 50) warnings.push(`${embeddings.pubs_missing} publications missing embeddings`)
    if (embeddings.stories_missing > 50) warnings.push(`${embeddings.stories_missing} stories missing embeddings`)

    if (warnings.length === 0) {
      console.log('  ✓ Everything looks up to date')
    } else {
      for (const w of warnings) console.log(`  ⚠ ${w}`)
    }

    // 5. Rebuild recommendations
    if (warnings.length > 0) {
      console.log('\n--- Recommended Actions ---')
      if (warnings.some(w => w.includes('rebuild graphs'))) {
        console.log('  1. npx tsx scripts/build-explore-graph.ts')
        console.log('     npx tsx scripts/build-collection-graph.ts')
        console.log('     npx tsx scripts/build-unified-graph.ts')
      }
      if (warnings.some(w => w.includes('community re-detection') || w.includes('regenerate primers'))) {
        console.log('  2. npx tsx scripts/detect-communities.ts')
        console.log('     npx tsx scripts/describe-communities.ts')
        console.log('     npx tsx scripts/load-neighborhoods.ts')
        console.log('     npx tsx scripts/layout-neighborhoods.ts')
        console.log('     npx tsx scripts/generate-primers.ts --limit=100 --model=opus')
      }
      if (warnings.some(w => w.includes('no primer'))) {
        console.log('  3. npx tsx scripts/generate-primers.ts --skip-existing --limit=50 --model=opus')
      }
      if (warnings.some(w => w.includes('entity extraction'))) {
        console.log('  4. npx tsx scripts/extract-story-entities.ts')
        console.log('     npx tsx scripts/load-story-extractions.ts')
      }
      if (warnings.some(w => w.includes('embeddings'))) {
        console.log('  5. npx tsx scripts/generate-embeddings.ts')
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
