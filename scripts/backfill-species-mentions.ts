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
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const speciesLimit = limitArg ? parseInt(limitArg) : Infinity

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

function isMultiWord(s: string): boolean {
  return /\S+\s+\S/.test(s)
}
function isCapitalizedSingle(s: string): boolean {
  return /^[A-Z][a-z]+$/.test(s) && s.length >= 6
}
function isLatinBinomial(s: string): boolean {
  return /^[A-Z][a-z]+ [a-z]/.test(s)
}

function termsFor(species: { canonical_name: string; common_names: string[] | null; synonyms: string[] | null }): string[] {
  const out = new Set<string>()
  // `allowSingleCap` controls whether `isCapitalizedSingle` applies. Latin
  // genus names ("Marmota") arrive via canonical_name and synonyms, so we
  // accept them there. Common-name fields can hold capitalized English
  // words ("Beaver", "Marmots") — tsvector is case-insensitive so those
  // would over-match every mention regardless of case. Skip them.
  const consider = (t: string | null | undefined, allowSingleCap: boolean) => {
    const s = (t || '').trim()
    if (!s) return
    if (isLatinBinomial(s)) { out.add(s); return }
    if (isMultiWord(s) && s.length >= 8) { out.add(s); return }
    if (allowSingleCap && isCapitalizedSingle(s)) { out.add(s); return }
    // Otherwise: too generic to use as a backfill term.
  }
  consider(species.canonical_name, true)
  for (const cn of species.common_names || []) consider(cn, false)
  for (const syn of species.synonyms || []) consider(syn, true)
  return Array.from(out)
}

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

  let totalInserted = 0
  let totalSkippedExisting = 0
  let totalSkippedNoTerms = 0
  const perCollection: Record<Collection, number> = { publications: 0, documents: 0, datasets: 0, stories: 0 }
  const updatedSpecies = new Set<number>()

  for (let i = 0; i < speciesList.length; i++) {
    const sp = speciesList[i]
    const terms = termsFor(sp)
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

main().catch((err) => { console.error(err); process.exit(1) })
