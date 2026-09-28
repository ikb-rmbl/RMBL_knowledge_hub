/**
 * Backfill species → publication/document/dataset/story mentions via
 * tsvector text search.
 *
 * Problem: the original VLM/LLM entity extraction only linked species to a
 * fraction of the items that actually mention them. Marmota flaviventris,
 * for example, has ~7 extracted mentions but appears in ~480 publications
 * by text search. The species detail page therefore looks under-populated.
 *
 * This script generates the missing mentions by searching each collection's
 * tsvector for every species's canonical_name and selected aliases.
 *
 * Inserted rows are tagged role='text_match' / extraction_method='text_match'
 * / confidence=0.5 so they're distinguishable from human-curated and
 * extraction-derived mentions. Deletable with a single DELETE WHERE role.
 *
 * Usage:
 *   npx tsx scripts/backfill-species-mentions.ts [--dry-run] [--limit=N]
 *   npx tsx scripts/backfill-species-mentions.ts --prune-unsupported [--since=YYYY-MM-DD] [--dry-run]
 */

import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import pg from 'pg'
import { OUTPUT_DIR } from './lib/config.js'
import { specificTerms } from './lib/species-terms.js'

const args = process.argv.slice(2)
// Unknown flags used to be ignored, so `--help` ran a live backfill (2026-09-28).
const unknown = args.filter((a) => a !== '--dry-run' && a !== '--prune-unsupported' && !a.startsWith('--limit=') && !a.startsWith('--since='))
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}\nUsage: npx tsx scripts/backfill-species-mentions.ts [--dry-run] [--limit=N] | --prune-unsupported [--since=YYYY-MM-DD] [--dry-run]`)
  process.exit(1)
}
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const speciesLimit = limitArg ? parseInt(limitArg) : Infinity
// --prune-unsupported: delete text_match species mentions the current terms no
// longer produce (earlier runs linked every species of a genus to every paper
// naming the genus). Backs the rows up to CSV first; --since limits by created_at.
const pruneUnsupported = args.includes('--prune-unsupported')
const since = args.find((a) => a.startsWith('--since='))?.split('=')[1] ?? null

// Conservative term selection: only emit terms that are specific enough to
// produce few false-positive matches. Generic single-word common names like
// "trout" or "fish" appear across many species and would over-link.
//
// Rules:
//  - Latin binomials (`Marmota flaviventris`) — capitalized + lowercase pair.
//    Highly specific; always include.
//  - Multi-word common names (`yellow-bellied marmot`) with ≥ 8 chars total.
//    Phrase-distinctive; include.
//  - Capitalized single-word terms ≥ 6 chars (`Marmota` the genus,
//    `Salvelinus`). Latin-looking; include.
//  - Single-word lowercase terms — SKIPPED. ("trout", "marmot", "elk")
//
// And we match via phraseto_tsquery rather than plainto_tsquery so multi-word
// terms must appear adjacent and in order (after stemming).
const COLLECTIONS = ['publications', 'documents', 'datasets', 'stories'] as const
type Collection = typeof COLLECTIONS[number]

async function main() {
  console.log('Backfill species → mentions via text search')
  console.log('===========================================')
  if (dryRun) console.log('(DRY RUN — no inserts)')

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  // Process species in descending mention_count order so high-value species
  // land first (useful for incremental runs with --limit).
  const { rows: speciesList } = await db.query(`
    SELECT id, canonical_name, common_names, synonyms, mention_count, publication_count
    FROM species
    WHERE canonical_name IS NOT NULL AND length(canonical_name) >= 4
    ORDER BY mention_count DESC NULLS LAST, id
    ${Number.isFinite(speciesLimit) ? `LIMIT ${speciesLimit}` : ''}
  `)
  console.log(`  ${speciesList.length} species to process`)
  // Term uniqueness is judged against the whole registry, not just this (possibly --limit'ed) list.
  const { rows: allSpecies } = await db.query(`SELECT id, canonical_name, scientific_name, common_names, synonyms, mention_count FROM species WHERE canonical_name IS NOT NULL`)
  const termsById = specificTerms(allSpecies)

  if (pruneUnsupported) {
    await pruneUnsupportedMentions(db, termsById)
    await db.end()
    return
  }

  let totalInserted = 0
  let totalSkippedExisting = 0
  let totalSkippedNoTerms = 0
  const perCollection: Record<Collection, number> = { publications: 0, documents: 0, datasets: 0, stories: 0 }
  const updatedSpecies = new Set<number>()

  for (let i = 0; i < speciesList.length; i++) {
    const sp = speciesList[i]
    const terms = termsById.get(sp.id) ?? []
    if (terms.length === 0) {
      totalSkippedNoTerms++
      continue
    }

    // Build the tsvector OR query. Each term uses phraseto_tsquery so the
    // words must appear consecutively in the same order (after stemming) —
    // catches "yellow-bellied marmot" without matching unrelated docs that
    // happen to mention both "yellow" and "marmot" far apart.
    const tsCondition = terms.map((_, idx) => `search_vector @@ phraseto_tsquery('english', $${idx + 1})`).join(' OR ')

    for (const collection of COLLECTIONS) {
      // Find items matching ANY of the species' terms that aren't already
      // linked to this species (regardless of role/method).
      const { rows: matches } = await db.query(
        `SELECT t.id
         FROM ${collection} t
         WHERE (${tsCondition})
           ${collection === 'stories' ? "AND t.story_type IS DISTINCT FROM 'oral_history'" : ''}
           AND NOT EXISTS (
             SELECT 1 FROM entity_mentions em
             WHERE em.entity_type = 'species' AND em.entity_id = $${terms.length + 1}
               AND em.collection = $${terms.length + 2}
               AND em.item_id = t.id
           )`,
        [...terms, sp.id, collection],
      )

      if (matches.length === 0) continue

      if (dryRun) {
        totalInserted += matches.length
        perCollection[collection] += matches.length
        updatedSpecies.add(sp.id)
        continue
      }

      // Insert. ON CONFLICT covers concurrent runs and any role-collision we
      // didn't anticipate. role='text_match' makes the rows easy to find/revert.
      let inserted = 0
      for (const m of matches) {
        const { rowCount } = await db.query(
          `INSERT INTO entity_mentions
             (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
           VALUES ('species', $1, $2, $3, 'text_match', 0.5, 'text_match')
           ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING`,
          [sp.id, collection, m.id],
        )
        if (rowCount && rowCount > 0) inserted++
        else totalSkippedExisting++
      }
      totalInserted += inserted
      perCollection[collection] += inserted
      if (inserted > 0) updatedSpecies.add(sp.id)
    }

    if ((i + 1) % 50 === 0 || i + 1 === speciesList.length) {
      process.stdout.write(`\r  ${i + 1}/${speciesList.length} species processed, ${totalInserted} mentions added so far`)
    }
  }
  console.log('')

  // Recompute counts on species we actually touched.
  if (!dryRun && updatedSpecies.size > 0) {
    console.log(`  Recomputing mention_count / publication_count on ${updatedSpecies.size} species…`)
    await db.query(
      `UPDATE species s SET
         mention_count = (SELECT count(*)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id),
         publication_count = (SELECT count(DISTINCT item_id)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id AND collection = 'publications')
       WHERE s.id = ANY($1::int[])`,
      [Array.from(updatedSpecies)],
    )
  }

  console.log('')
  console.log('==== Summary ====')
  console.log(`  Species processed:        ${speciesList.length}`)
  console.log(`  Species with new mentions: ${updatedSpecies.size}`)
  console.log(`  Skipped (no usable terms): ${totalSkippedNoTerms}`)
  console.log(`  Mentions inserted:        ${totalInserted}`)
  console.log(`  Mentions skipped (dup):   ${totalSkippedExisting}`)
  console.log(`  By collection:`)
  for (const c of COLLECTIONS) console.log(`    ${c.padEnd(13)} ${perCollection[c]}`)

  await db.end()
}

async function pruneUnsupportedMentions(db: pg.Pool, termsById: Map<number, string[]>) {
  const { rows } = await db.query(
    `SELECT id, entity_id, collection, item_id, role, confidence, extraction_method, created_at FROM entity_mentions
      WHERE entity_type = 'species' AND extraction_method = 'text_match' ${since ? 'AND created_at >= $1' : ''}`,
    since ? [since] : [],
  )
  console.log(`  ${rows.length} text_match species mentions${since ? ` since ${since}` : ''} to check`)
  const bySpecies = new Map<number, typeof rows>()
  for (const r of rows) {
    if (!bySpecies.has(r.entity_id)) bySpecies.set(r.entity_id, [])
    bySpecies.get(r.entity_id)!.push(r)
  }
  const unsupported: typeof rows = []
  for (const [sid, rs] of bySpecies) {
    const terms = termsById.get(sid) ?? []
    for (const collection of COLLECTIONS) {
      const mine = rs.filter((r) => r.collection === collection)
      if (!mine.length) continue
      let ok = new Set<number>()
      if (terms.length) {
        const cond = terms.map((_, i) => `search_vector @@ phraseto_tsquery('english', $${i + 2})`).join(' OR ')
        const { rows: hit } = await db.query(`SELECT id FROM ${collection} WHERE id = ANY($1) AND (${cond})`, [mine.map((r) => r.item_id), ...terms])
        ok = new Set(hit.map((h) => h.id))
      }
      unsupported.push(...mine.filter((r) => !ok.has(r.item_id)))
    }
  }
  const perSpecies = new Map<number, number>()
  for (const r of unsupported) perSpecies.set(r.entity_id, (perSpecies.get(r.entity_id) ?? 0) + 1)
  const { rows: names } = await db.query(`SELECT id, canonical_name FROM species WHERE id = ANY($1)`, [[...perSpecies.keys()]])
  const nameOf = new Map(names.map((n) => [n.id, n.canonical_name]))
  console.log(`  ${unsupported.length} unsupported (${rows.length - unsupported.length} still match). Top:`)
  for (const [id, n] of [...perSpecies].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${String(n).padStart(5)}  ${nameOf.get(id)}`)
  if (dryRun || unsupported.length === 0) { if (dryRun) console.log('  (dry run — nothing deleted)'); return }

  const backup = `${OUTPUT_DIR}/backups/species-text-match-pruned-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`
  mkdirSync(dirname(backup), { recursive: true })
  const cols = ['id', 'entity_id', 'collection', 'item_id', 'role', 'confidence', 'extraction_method', 'created_at'] as const
  writeFileSync(backup, [cols.join(','), ...unsupported.map((r) => cols.map((c) => (c === 'created_at' ? new Date(r[c]).toISOString() : r[c])).join(','))].join('\n') + '\n')
  await db.query('DELETE FROM entity_mentions WHERE id = ANY($1::int[])', [unsupported.map((r) => r.id)])
  await db.query(
    `UPDATE species s SET
       mention_count = (SELECT count(*)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id),
       publication_count = (SELECT count(DISTINCT item_id)::int FROM entity_mentions WHERE entity_type='species' AND entity_id = s.id AND collection = 'publications')
     WHERE s.id = ANY($1::int[])`,
    [[...perSpecies.keys()]],
  )
  console.log(`  deleted ${unsupported.length} mentions (backup: ${backup}); rollups recomputed on ${perSpecies.size} species`)
}

main().catch((err) => { console.error(err); process.exit(1) })
