/**
 * Re-link orphaned entity candidates to EXISTING concepts/protocols without
 * re-clustering.
 *
 * Background: cluster-concepts/cluster-protocols filtered their rebuild input
 * on the PREVIOUS run's resolved_entity_id (fixed alongside this script), so
 * re-runs silently dropped previously-resolved candidates — wiping all 18K
 * concept→publication and 5K protocol→publication mentions while keeping the
 * raw candidates in entity_candidates. A full re-cluster would restore them
 * but reassigns entity IDs, invalidating neighborhoods/graphs/primers. This
 * backfill is the cheap alternative: match unresolved candidates to the
 * EXISTING entities (exact name/alias first, then pgvector cosine similarity
 * against stored embeddings) and insert the missing entity_mentions.
 *
 * Candidates that match nothing are clustered among THEMSELVES and inserted
 * as new entities (additive — existing IDs untouched). This matters because
 * the buggy re-cluster didn't just drop mentions: the research-paper concept
 * vocabulary itself vanished from the registry (current concepts were built
 * from document candidates only). --no-create disables this phase.
 *
 * Additive + reversible: inserted mentions carry
 * extraction_method='cand_backfill' — delete those rows to undo.
 *
 * Usage:
 *   npx tsx scripts/backfill-candidate-mentions.ts [--dry-run] [--type=concept|protocol]
 *     [--threshold=0.82] [--target=neon|local] [--limit=N] [--no-create]
 */

import pg from 'pg'
import './lib/config.js'
import { embedTexts, clusterCandidates } from './lib/embedding-cluster.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] || 'local'
const onlyType = args.find((a) => a.startsWith('--type='))?.split('=')[1] || null
const thresholdArg = args.find((a) => a.startsWith('--threshold='))?.split('=')[1]
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : null

const noCreate = args.includes('--no-create')

const EXTRACTION_METHOD = 'cand_backfill'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

// Thresholds mirror the cluster scripts that formed these entities
const TYPES: Record<string, { table: string; threshold: number; hasAliases: boolean }> = {
  concept: { table: 'concepts', threshold: 0.82, hasAliases: true },
  protocol: { table: 'protocols', threshold: 0.83, hasAliases: false },
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }
  if (!process.env.VOYAGE_API_KEY) {
    console.error('Error: VOYAGE_API_KEY required')
    process.exit(1)
  }
  const db = new pg.Pool({ connectionString, max: 4 })
  console.log(`Target: ${target}${dryRun ? ' (dry run)' : ''}`)

  for (const [entityType, cfg] of Object.entries(TYPES)) {
    if (onlyType && entityType !== onlyType) continue
    const threshold = thresholdArg ? parseFloat(thresholdArg) : cfg.threshold
    console.log(`\n=== ${entityType} (table ${cfg.table}, threshold ${threshold}) ===`)

    // Unresolved candidates whose source item still exists
    const { rows: candidates } = await db.query(
      `SELECT ec.id, ec.raw_name, ec.raw_attributes, ec.source_collection, ec.source_item_id
       FROM entity_candidates ec
       WHERE ec.entity_type = $1 AND ec.resolved_entity_id IS NULL
         AND (
           (ec.source_collection = 'publications' AND EXISTS (SELECT 1 FROM publications p WHERE p.id = ec.source_item_id)) OR
           (ec.source_collection = 'datasets' AND EXISTS (SELECT 1 FROM datasets d WHERE d.id = ec.source_item_id)) OR
           (ec.source_collection = 'documents' AND EXISTS (SELECT 1 FROM documents dc WHERE dc.id = ec.source_item_id))
         )
       ORDER BY ec.id ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
      [entityType],
    )
    console.log(`${candidates.length} unresolved candidates with live source items`)
    if (candidates.length === 0) continue

    // Pass 1: exact name/alias match (case-insensitive)
    const { rows: entities } = await db.query(
      `SELECT id, name${cfg.hasAliases ? ', aliases' : ''} FROM ${cfg.table}`,
    )
    const byName = new Map<string, number>()
    for (const e of entities) {
      byName.set(e.name.toLowerCase().trim(), e.id)
      for (const a of e.aliases || []) {
        const key = String(a).toLowerCase().trim()
        if (!byName.has(key)) byName.set(key, e.id)
      }
    }
    const matches = new Map<number, { entityId: number; confidence: number; how: string }>()
    for (const c of candidates) {
      const key = (c.raw_attributes?.name || c.raw_name || '').toLowerCase().trim()
      const hit = key ? byName.get(key) : undefined
      if (hit) matches.set(c.id, { entityId: hit, confidence: 1.0, how: 'name' })
    }
    console.log(`  exact name/alias matches: ${matches.size}`)

    // Pass 2: embedding similarity for the rest (same text recipe as the
    // cluster scripts, matched against the stored entity embeddings)
    const rest = candidates.filter((c) => !matches.has(c.id))
    const restEmbeddings = new Map<number, number[]>()
    if (rest.length > 0) {
      console.log(`  embedding ${rest.length} remaining candidates...`)
      const texts = rest.map((c) => `${c.raw_attributes?.name || c.raw_name} — ${c.raw_attributes?.definition || c.raw_attributes?.description || ''}`)
      const embeddings = await embedTexts(texts)
      let embMatched = 0
      for (let i = 0; i < rest.length; i++) {
        restEmbeddings.set(rest[i].id, embeddings[i])
        const vec = `[${embeddings[i].join(',')}]`
        const { rows: nearest } = await db.query(
          `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM ${cfg.table}
           WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 1`,
          [vec],
        )
        if (nearest.length > 0 && nearest[0].sim >= threshold) {
          matches.set(rest[i].id, { entityId: nearest[0].id, confidence: Number(nearest[0].sim), how: 'embedding' })
          embMatched++
        }
        if ((i + 1) % 1000 === 0) process.stdout.write(`\r    ${i + 1}/${rest.length} (${embMatched} matched)`)
      }
      console.log(`\r    ${rest.length}/${rest.length} — embedding matches: ${embMatched}`)
    }

    const unmatchedCands = candidates.filter((c) => !matches.has(c.id) && restEmbeddings.has(c.id))
    console.log(`  total matched: ${matches.size}; unmatched: ${unmatchedCands.length}`)

    // Phase 3: cluster the unmatched among themselves → NEW entities
    // (additive; existing entity ids untouched, so neighborhoods/graphs stay valid)
    let newClusters: { members: typeof unmatchedCands; centroid: number[] }[] = []
    if (!noCreate && unmatchedCands.length > 0) {
      const objs = unmatchedCands.map((c) => ({ ...c, embedding: restEmbeddings.get(c.id)! }))
      newClusters = clusterCandidates(objs, threshold) as any
      console.log(`  would create ${newClusters.length} new ${cfg.table} from unmatched candidates`)
    }

    if (dryRun) {
      console.log('  (dry run — no writes)')
      continue
    }

    // Insert mentions (skipping ones that already exist) + resolve candidates
    let inserted = 0
    let skippedExisting = 0
    for (const c of candidates) {
      const m = matches.get(c.id)
      if (!m) continue
      const { rowCount } = await db.query(
        `INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, confidence, extraction_method)
         SELECT $1::text, $2::int, $3::varchar, $4::int, $5::real, $6::varchar
         WHERE NOT EXISTS (
           SELECT 1 FROM entity_mentions
           WHERE entity_type = $1::text AND entity_id = $2::int AND collection = $3::varchar AND item_id = $4::int
         )`,
        [entityType, m.entityId, c.source_collection, c.source_item_id, m.confidence, EXTRACTION_METHOD],
      )
      if (rowCount === 1) inserted++
      else skippedExisting++
      await db.query(`UPDATE entity_candidates SET resolved_entity_id = $2 WHERE id = $1`, [c.id, m.entityId])
    }
    console.log(`  inserted ${inserted} mentions (${skippedExisting} already existed)`)

    // Phase 3 writes: create new entities + their mentions
    let createdEntities = 0
    let createdMentions = 0
    for (const cluster of newClusters) {
      const best = [...cluster.members].sort(
        (a, b) =>
          ((b.raw_attributes?.definition || b.raw_attributes?.description || '').length) -
          ((a.raw_attributes?.definition || a.raw_attributes?.description || '').length),
      )[0]
      const name = best.raw_attributes?.name || best.raw_name
      if (!name) continue
      const centroidVec = JSON.stringify(cluster.centroid)
      let entityId: number | null = null
      if (entityType === 'concept') {
        const aliases = [...new Set(cluster.members.flatMap((m: any) => m.raw_attributes?.aliases || []))]
        const { rows } = await db.query(
          `INSERT INTO concepts (name, concept_type, definition, scope, aliases, embedding)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [name, best.raw_attributes?.type || null, best.raw_attributes?.definition || null, best.raw_attributes?.scope || null, aliases, centroidVec],
        )
        entityId = rows[0].id
      } else {
        const { rows } = await db.query(
          `INSERT INTO protocols (name, slug, category, subcategory, description, embedding, standardized, approved)
           VALUES ($1, $2, $3, $4, $5, $6, false, false)
           ON CONFLICT (slug) DO UPDATE SET name = protocols.name
           RETURNING id`,
          [name, slugify(name), best.raw_attributes?.category || null, best.raw_attributes?.subcategory || null, best.raw_attributes?.description || null, centroidVec],
        )
        entityId = rows[0].id
      }
      if (entityId === null) continue
      createdEntities++
      for (const m of cluster.members) {
        const { rowCount } = await db.query(
          `INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, confidence, extraction_method)
           SELECT $1::text, $2::int, $3::varchar, $4::int, 1.0, $5::varchar
           WHERE NOT EXISTS (
             SELECT 1 FROM entity_mentions
             WHERE entity_type = $1::text AND entity_id = $2::int AND collection = $3::varchar AND item_id = $4::int
           )`,
          [entityType, entityId, m.source_collection, m.source_item_id, EXTRACTION_METHOD],
        )
        if (rowCount === 1) createdMentions++
        await db.query(`UPDATE entity_candidates SET resolved_entity_id = $2 WHERE id = $1`, [m.id, entityId])
      }
    }
    if (!noCreate) console.log(`  created ${createdEntities} new ${cfg.table} with ${createdMentions} mentions`)

    // Recompute rollups (same formulas as the cluster scripts)
    await db.query(`
      UPDATE ${cfg.table} t SET
        mention_count = (SELECT count(*) FROM entity_mentions WHERE entity_type = $1 AND entity_id = t.id),
        publication_count = (SELECT count(DISTINCT item_id) FROM entity_mentions WHERE entity_type = $1 AND entity_id = t.id AND collection = 'publications')
    `, [entityType])
    const { rows: [stats] } = await db.query(
      `SELECT count(*) FILTER (WHERE publication_count > 0) AS with_pubs, count(*) AS total FROM ${cfg.table}`,
    )
    console.log(`  rollups: ${stats.with_pubs}/${stats.total} ${cfg.table} now have publication mentions`)
  }

  await db.end()
  console.log(dryRun ? '\nDry run complete.' : '\nDone.')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
