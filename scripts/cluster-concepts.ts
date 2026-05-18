/**
 * Cluster Concept Candidates
 *
 * Groups similar concept candidates from entity_candidates into canonical
 * Concept records using embedding-based clustering. Concept names vary
 * across papers — e.g., "phenological mismatch" vs "phenology-pollinator
 * mismatch" vs "temporal mismatch" — so exact name matching is insufficient.
 *
 * Usage:
 *   npx tsx scripts/cluster-concepts.ts [--threshold=0.82] [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'
import { VOYAGE_API_KEY } from './lib/config.js'
import { embedTexts, cosineSimilarity, clusterCandidates, type Cluster } from './lib/embedding-cluster.js'
import { isJunkEntityName } from './lib/entity-filter.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const thresholdArg = args.find((a) => a.startsWith('--threshold='))?.split('=')[1]
const THRESHOLD = thresholdArg ? parseFloat(thresholdArg) : 0.82

interface Candidate {
  id: number; rawName: string; attrs: any; sourceItemId: number; sourceCollection: string; pubYear: number | null; embedding: number[]
}

function selectCanonical(cluster: Cluster<Candidate>) {
  const members = cluster.members
  const descLens = members.map(m => (m.attrs.definition || '').length)
  const aliasCount = members.map(m => (m.attrs.aliases || []).length)
  const years = members.map(m => m.pubYear || 2000)
  const maxDesc = Math.max(...descLens, 1)
  const maxAlias = Math.max(...aliasCount, 1)
  const minYear = Math.min(...years), maxYear = Math.max(...years)
  const yRange = maxYear - minYear || 1

  const scored = members.map((m, i) => {
    const centrality = cosineSimilarity(m.embedding, cluster.centroid)
    const detail = (descLens[i] / maxDesc) * 0.6 + (aliasCount[i] / maxAlias) * 0.4
    const recency = (years[i] - minYear) / yRange
    const score = centrality * 0.35 + detail * 0.35 + recency * 0.30
    return { member: m, score, centrality, detail, recency }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0].member

  const allAliases = new Set<string>()
  for (const m of members) for (const a of m.attrs.aliases || []) allAliases.add(a)

  return {
    name: best.attrs.name || best.rawName,
    conceptType: best.attrs.type || null,
    definition: best.attrs.definition || null,
    scope: best.attrs.scope || null,
    aliases: [...allAliases],
    centroid: cluster.centroid,
    canonicalMember: best,
    memberScores: scored,
  }
}

async function main() {
  console.log('Cluster Concept Candidates')
  console.log('==========================')
  console.log(`Threshold: ${THRESHOLD}`)
  if (dryRun) console.log('(DRY RUN)')

  if (!VOYAGE_API_KEY) { console.error('Error: VOYAGE_API_KEY required'); process.exit(1) }

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub', max: 2 })

  try {
    const { rows } = await db.query(`
      SELECT ec.id, ec.raw_name, ec.raw_attributes, ec.source_item_id, ec.source_collection, p.year as pub_year
      FROM entity_candidates ec LEFT JOIN publications p ON p.id = ec.source_item_id AND ec.source_collection = 'publications'
      WHERE ec.entity_type = 'concept' AND ec.resolved_entity_id IS NULL ORDER BY ec.id
    `)
    console.log(`\nLoaded ${rows.length} unresolved concept candidates`)
    if (rows.length === 0) { console.log('Nothing to cluster.'); return }

    console.log('Computing embeddings...')
    const texts = rows.map(c => `${c.raw_attributes.name || c.raw_name} — ${c.raw_attributes.definition || ''}`)
    const embeddings = await embedTexts(texts)
    console.log(`  ${embeddings.length} embeddings computed`)

    const candidateObjs: Candidate[] = rows.map((c, i) => ({
      id: c.id, rawName: c.raw_name, attrs: c.raw_attributes, sourceItemId: c.source_item_id,
      sourceCollection: c.source_collection || 'publications', pubYear: c.pub_year || null, embedding: embeddings[i],
    }))

    console.log(`\nClustering with threshold ${THRESHOLD}...`)
    const clusters = clusterCandidates(candidateObjs, THRESHOLD)
    const canonicals = clusters.map(selectCanonical)

    const multiMember = clusters.filter(c => c.members.length > 1)
    console.log(`  ${clusters.length} clusters formed`)
    console.log(`    multi-member: ${multiMember.length} (covering ${multiMember.reduce((n, c) => n + c.members.length, 0)} candidates)`)
    console.log(`    singletons: ${clusters.length - multiMember.length}`)

    console.log('\n  Top clusters:')
    const sorted = canonicals.map((c, i) => ({ c, cl: clusters[i] })).sort((a, b) => b.cl.members.length - a.cl.members.length)
    for (const { c, cl } of sorted.slice(0, 15)) {
      const pubs = cl.members.map(m => `${m.sourceItemId}(${m.pubYear || '?'})`).join(', ')
      console.log(`    ${cl.members.length}x  "${c.name}" [${c.conceptType}/${c.scope}]`)
      if (cl.members.length > 1) {
        const top = c.memberScores[0]
        console.log(`        canonical: pub:${c.canonicalMember.sourceItemId} score=${top.score.toFixed(3)}`)
      }
      console.log(`        pubs: ${pubs}`)
    }

    if (dryRun) {
      console.log(`\n(DRY RUN) Would create ${clusters.length} concept records and ${rows.length} entity_mentions`)
      return
    }

    await db.query("DELETE FROM entity_mentions WHERE entity_type = 'concept'")
    await db.query('DELETE FROM concepts')
    await db.query("UPDATE entity_candidates SET resolved_entity_id = NULL WHERE entity_type = 'concept'")

    console.log(`\nCreating ${canonicals.length} concept records...`)
    let created = 0
    const allCandIds: number[] = []
    const allResolvedIds: number[] = []
    const allMentionEntityIds: number[] = []
    const allMentionItemIds: number[] = []
    const allMentionCollections: string[] = []
    const allMentionRoles: string[] = []

    for (let ci = 0; ci < canonicals.length; ci++) {
      const canonical = canonicals[ci]
      const cluster = clusters[ci]

      // Skip "Unknown", "Na", "not specified", etc. — placeholder names the LLM emits
      // when source text didn't actually name a concept. See lib/entity-filter.ts.
      if (isJunkEntityName(canonical.name)) continue

      const { rows: [con] } = await db.query(
        `INSERT INTO concepts (name, concept_type, definition, scope, aliases, embedding)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [canonical.name, canonical.conceptType, canonical.definition, canonical.scope, canonical.aliases, JSON.stringify(canonical.centroid)],
      )
      created++

      for (const member of cluster.members) {
        allCandIds.push(member.id)
        allResolvedIds.push(con.id)
        allMentionEntityIds.push(con.id)
        allMentionItemIds.push(member.sourceItemId)
        allMentionCollections.push(member.sourceCollection || 'publications')
        allMentionRoles.push((member.attrs.role || 'referenced').slice(0, 30))
      }
    }

    if (allCandIds.length > 0) {
      await db.query(`
        UPDATE entity_candidates ec SET resolved_entity_id = t.resolved_id
        FROM unnest($1::int[], $2::int[]) AS t(cand_id, resolved_id)
        WHERE ec.id = t.cand_id
      `, [allCandIds, allResolvedIds])
    }

    if (allMentionEntityIds.length > 0) {
      await db.query(`
        INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
        SELECT 'concept', unnest($1::int[]), unnest($4::varchar[]), unnest($2::int[]), unnest($3::varchar[]), 1.0, 'vlm'
        ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING
      `, [allMentionEntityIds, allMentionItemIds, allMentionRoles, allMentionCollections])
    }

    await db.query(`
      UPDATE concepts SET
        mention_count = (SELECT count(*) FROM entity_mentions WHERE entity_type = 'concept' AND entity_id = concepts.id),
        publication_count = (SELECT count(DISTINCT item_id) FROM entity_mentions WHERE entity_type = 'concept' AND entity_id = concepts.id AND collection = 'publications')
    `)

    console.log(`  Created ${created} concept records, ${allMentionEntityIds.length} entity_mentions`)
    const { rows: [stats] } = await db.query(`SELECT count(*) as total, count(*) FILTER (WHERE publication_count > 1) as multi_pub FROM concepts`)
    console.log(`  Multi-publication concepts: ${stats.multi_pub}`)
  } finally {
    await db.end()
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1) })
