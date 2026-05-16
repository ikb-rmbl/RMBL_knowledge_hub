/**
 * Stage 4 of the frontiers pipeline: structurally derive linkable_entities
 * for each synthesized frontier — entity IDs the detail page can render as
 * chips. No LLM — runs purely against cluster aggregates + DB.
 *
 * Per frontier:
 *  - concepts/protocols: fuzzy-match union tags into the entity tables via
 *    pg_trgm similarity (threshold tunable, default 0.7); duplicates resolved
 *    by highest publication_count
 *  - datasets/places/species/stakeholders/documents: aggregate the constituent
 *    neighborhoods' top_by_type entries, weighted by statement_count × degree
 *  - publications: union of constituent neighborhoods' primer_citations,
 *    weighted by statement_count
 *  - authors: derived from the publication set via authors_rels
 *  - projects: derived from publications + datasets + documents via projects_rels
 *  - data_gaps: free-text from union_datasets (descriptions of needed data,
 *    intentionally NOT linked to dataset entities — these are research opps)
 *
 * Usage:
 *   npx tsx scripts/link-frontier-entities.ts                      # default paths
 *   npx tsx scripts/link-frontier-entities.ts --syn=...json --clusters=...json
 *   npx tsx scripts/link-frontier-entities.ts --tag-threshold=0.75 --top-n=8
 */

import pg from 'pg'
import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const inputSyn = args.find((a) => a.startsWith('--syn='))?.split('=')[1] || 'scripts/output/frontiers-synthesized.json'
const inputClu = args.find((a) => a.startsWith('--clusters='))?.split('=')[1] || 'scripts/output/frontiers-clustered.json'
const outputPath = args.find((a) => a.startsWith('--output='))?.split('=')[1] || 'scripts/output/frontiers-linked.json'
const tagThreshold = parseFloat(args.find((a) => a.startsWith('--tag-threshold='))?.split('=')[1] || '0.7')
const topN = parseInt(args.find((a) => a.startsWith('--top-n='))?.split('=')[1] || '10')
// Filter candidate publications by entity-mention overlap with the frontier's
// resolved concept set. A pub is kept only if its entity_mentions include
// >=N of the frontier's concept IDs. Soft boost: weight × (1 + overlap_count).
// Disable with --concept-overlap-min=0 (keeps the older behavior).
const conceptOverlapMin = parseInt(args.find((a) => a.startsWith('--concept-overlap-min='))?.split('=')[1] || '1')

interface ClusterMeta {
  cluster_id: number
  neighborhoods: { id: number; statement_count: number }[]
  union_concepts: { tag: string; count: number }[]
  union_protocols: { tag: string; count: number }[]
  union_datasets: { tag: string; count: number }[]
}

async function resolveTags(
  db: pg.Pool,
  table: 'concepts' | 'protocols',
  tags: { tag: string; count: number }[],
  threshold: number,
): Promise<{
  displayed: Map<number, { id: number; name: string; weight: number }>,
  allIds: number[],   // includes near-duplicate entity rows for downstream joins
}> {
  const displayed = new Map<number, { id: number; name: string; weight: number }>()
  const allIdsSet = new Set<number>()
  if (tags.length === 0) return { displayed, allIds: [] }
  for (const t of tags) {
    const { rows } = await db.query(
      `SELECT id, name, publication_count, similarity(lower(name), $1) AS sim
       FROM ${table}
       WHERE similarity(lower(name), $1) >= $2
       ORDER BY sim DESC, publication_count DESC NULLS LAST`,
      [t.tag, threshold],
    )
    if (rows.length === 0) continue
    // Use the best match as the displayed entity; track all matches above
    // threshold for downstream entity_mentions joins (catches duplicate rows).
    const top = rows[0]
    const cur = displayed.get(top.id)
    if (cur) cur.weight += t.count
    else displayed.set(top.id, { id: top.id, name: top.name, weight: t.count })
    for (const r of rows) allIdsSet.add(r.id)
  }
  return { displayed, allIds: [...allIdsSet] }
}

async function aggregateFromTopByType(
  db: pg.Pool,
  nbrs: { id: number; statement_count: number }[],
  entityType: string,
): Promise<Map<number, { id: number; name: string; weight: number }>> {
  const out = new Map<number, { id: number; name: string; weight: number }>()
  if (nbrs.length === 0) return out
  const nbrIds = nbrs.map((n) => n.id)
  const wMap = new Map(nbrs.map((n) => [n.id, n.statement_count]))
  const { rows } = await db.query(
    `SELECT id, top_by_type->$2 AS items FROM neighborhoods WHERE id = ANY($1)`,
    [nbrIds, entityType],
  )
  for (const row of rows) {
    const sw = wMap.get(row.id) || 1
    const items = (row.items || []) as Array<{ id: string; name: string; degree?: number }>
    for (const item of items) {
      if (!item.id) continue
      const parts = item.id.split('-')
      if (parts.length < 2) continue
      const numId = parseInt(parts[parts.length - 1])
      if (isNaN(numId)) continue
      const cur = out.get(numId) || { id: numId, name: item.name || '', weight: 0 }
      cur.weight += sw * (item.degree || 1)
      out.set(numId, cur)
    }
  }
  return out
}

async function aggregatePublications(
  db: pg.Pool,
  nbrs: { id: number; statement_count: number }[],
): Promise<Map<number, { id: number; title: string; year: number | null; weight: number }>> {
  const out = new Map<number, { id: number; title: string; year: number | null; weight: number }>()
  if (nbrs.length === 0) return out
  const nbrIds = nbrs.map((n) => n.id)
  const wMap = new Map(nbrs.map((n) => [n.id, n.statement_count]))
  const { rows } = await db.query(
    `SELECT id, primer_citations FROM neighborhoods WHERE id = ANY($1)`,
    [nbrIds],
  )
  const pubWeights = new Map<number, number>()
  for (const row of rows) {
    const sw = wMap.get(row.id) || 1
    const cits = (row.primer_citations || []) as Array<{ pub_id?: number }>
    for (const c of cits) {
      if (typeof c.pub_id !== 'number') continue
      pubWeights.set(c.pub_id, (pubWeights.get(c.pub_id) || 0) + sw)
    }
  }
  if (pubWeights.size === 0) return out
  const pubIds = [...pubWeights.keys()]
  const { rows: pubs } = await db.query(
    `SELECT id, title, year FROM publications WHERE id = ANY($1)`,
    [pubIds],
  )
  for (const p of pubs) {
    out.set(p.id, { id: p.id, title: p.title, year: p.year, weight: pubWeights.get(p.id) || 0 })
  }
  return out
}

async function authorsForPublications(
  db: pg.Pool,
  pubWeights: Map<number, number>,
): Promise<Map<number, { id: number; display_name: string; weight: number }>> {
  const out = new Map<number, { id: number; display_name: string; weight: number }>()
  if (pubWeights.size === 0) return out
  const pubIds = [...pubWeights.keys()]
  const { rows } = await db.query(
    `SELECT ar.parent_id AS author_id, ar.publications_id AS pub_id, a.display_name
     FROM authors_rels ar
     JOIN authors a ON a.id = ar.parent_id
     WHERE ar.publications_id = ANY($1) AND ar.path = 'publications'`,
    [pubIds],
  )
  for (const r of rows) {
    const pubW = pubWeights.get(r.pub_id) || 0
    const cur = out.get(r.author_id) || { id: r.author_id, display_name: r.display_name, weight: 0 }
    cur.weight += pubW
    out.set(r.author_id, cur)
  }
  return out
}

/**
 * Filter the candidate publication pool to those mentioning at least
 * `min` of the frontier's resolved concept IDs (via entity_mentions),
 * and boost remaining weights by (1 + overlap_count).
 *
 * If the frontier resolved zero concepts (rare — small clusters), skip
 * filtering to avoid emptying the pool.
 */
async function filterPubsByConceptOverlap(
  db: pg.Pool,
  pubs: Map<number, { id: number; title: string; year: number | null; weight: number }>,
  conceptIds: number[],
  min: number,
): Promise<{ kept: Map<number, { id: number; title: string; year: number | null; weight: number }>; dropped: number }> {
  if (min <= 0 || conceptIds.length === 0 || pubs.size === 0) {
    return { kept: pubs, dropped: 0 }
  }
  const pubIds = [...pubs.keys()]
  const { rows } = await db.query(
    `SELECT item_id, count(DISTINCT entity_id)::int AS overlap
     FROM entity_mentions
     WHERE collection = 'publications'
       AND entity_type = 'concept'
       AND item_id = ANY($1)
       AND entity_id = ANY($2)
     GROUP BY item_id`,
    [pubIds, conceptIds],
  )
  const overlapBy = new Map<number, number>(rows.map((r: any) => [r.item_id, r.overlap]))
  const kept = new Map<number, { id: number; title: string; year: number | null; weight: number }>()
  let dropped = 0
  for (const [id, pub] of pubs) {
    const ov = overlapBy.get(id) || 0
    if (ov < min) { dropped++; continue }
    kept.set(id, { ...pub, weight: pub.weight * (1 + ov) })
  }
  return { kept, dropped }
}

async function projectsForItems(
  db: pg.Pool,
  pubIds: number[],
  dsIds: number[],
  docIds: number[],
): Promise<Map<number, { id: number; name: string; weight: number }>> {
  const out = new Map<number, { id: number; name: string; weight: number }>()
  if (pubIds.length + dsIds.length + docIds.length === 0) return out
  const { rows } = await db.query(
    `SELECT p.id, p.name,
       count(*) FILTER (WHERE pr.publications_id IS NOT NULL OR pr.datasets_id IS NOT NULL OR pr.documents_id IS NOT NULL) AS weight
     FROM projects p
     JOIN projects_rels pr ON pr.parent_id = p.id
     WHERE pr.publications_id = ANY($1) OR pr.datasets_id = ANY($2) OR pr.documents_id = ANY($3)
     GROUP BY p.id, p.name`,
    [pubIds, dsIds, docIds],
  )
  for (const r of rows) {
    out.set(r.id, { id: r.id, name: r.name, weight: parseInt(r.weight) || 0 })
  }
  return out
}

async function main() {
  console.log('Link frontier entities')
  console.log('======================')
  console.log(`syn:       ${inputSyn}`)
  console.log(`clusters:  ${inputClu}`)
  console.log(`tag fuzzy threshold: ${tagThreshold}`)
  console.log(`top-N per type: ${topN}`)

  const synData = JSON.parse(readFileSync(inputSyn, 'utf-8'))
  const cluData = JSON.parse(readFileSync(inputClu, 'utf-8'))
  const cluById = new Map<number, ClusterMeta>()
  for (const c of cluData.clusters) cluById.set(c.cluster_id, c)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 4,
  })

  const linked: any[] = []
  for (const f of synData.frontiers) {
    const cluster = cluById.get(f.cluster_id)
    if (!cluster) {
      console.log(`  cluster #${f.cluster_id}: not found in clusters file`)
      continue
    }
    const nbrs = cluster.neighborhoods

    const conceptsRes = await resolveTags(db, 'concepts', cluster.union_concepts, tagThreshold)
    const protocolsRes = await resolveTags(db, 'protocols', cluster.union_protocols, tagThreshold)
    const concepts = conceptsRes.displayed
    const protocols = protocolsRes.displayed
    const datasetsMap = await aggregateFromTopByType(db, nbrs, 'dataset')
    const placesMap = await aggregateFromTopByType(db, nbrs, 'place')
    const speciesMap = await aggregateFromTopByType(db, nbrs, 'species')
    const stakeholdersMap = await aggregateFromTopByType(db, nbrs, 'stakeholder')
    const documentsMap = await aggregateFromTopByType(db, nbrs, 'document')
    const rawPubsMap = await aggregatePublications(db, nbrs)
    // Filter publications by concept-overlap with the frontier's resolved
    // concept set (including near-duplicate concept rows so the join is
    // robust to concept-table duplication). Keeps only papers that are
    // topically aligned, avoiding tangential pubs that flow in just because
    // they were cited by any primer in any contributing neighborhood.
    let { kept: pubsMap, dropped } = await filterPubsByConceptOverlap(db, rawPubsMap, conceptsRes.allIds, conceptOverlapMin)
    let fallback = false
    // Safety floor: if the filter eliminated too much (rare — small concept
    // set or sparse VLM coverage), fall back to the raw pool. Better noisy
    // links than no links at all.
    if (pubsMap.size < 3 && rawPubsMap.size >= 3) {
      pubsMap = rawPubsMap
      dropped = 0
      fallback = true
    }
    const pubWeights = new Map([...pubsMap.values()].map((p) => [p.id, p.weight]))
    const authorsMap = await authorsForPublications(db, pubWeights)
    const projectsMap = await projectsForItems(
      db,
      [...pubsMap.keys()],
      [...datasetsMap.keys()],
      [...documentsMap.keys()],
    )

    const sortTake = <T extends { weight: number }>(arr: T[]) =>
      arr.sort((a, b) => b.weight - a.weight).slice(0, topN)

    const entry = {
      frontier_id: f.cluster_id,
      linkable_entities: {
        concepts: sortTake([...concepts.values()]),
        protocols: sortTake([...protocols.values()]),
        datasets: sortTake([...datasetsMap.values()].map((d) => ({ id: d.id, title: d.name, weight: d.weight }))),
        publications: sortTake([...pubsMap.values()]),
        authors: sortTake([...authorsMap.values()]),
        places: sortTake([...placesMap.values()]),
        species: sortTake([...speciesMap.values()].map((s) => ({ id: s.id, canonical_name: s.name, weight: s.weight }))),
        stakeholders: sortTake([...stakeholdersMap.values()]),
        documents: sortTake([...documentsMap.values()].map((d) => ({ id: d.id, title: d.name, weight: d.weight }))),
        projects: sortTake([...projectsMap.values()]),
      },
      data_gaps: cluster.union_datasets.map((d) => d.tag),
    }
    linked.push(entry)
    const le = entry.linkable_entities
    const fbTag = fallback ? ' [fallback]' : ''
    console.log(`  cluster #${f.cluster_id} ${f.title.slice(0, 48).padEnd(48)} | concepts:${le.concepts.length} prot:${le.protocols.length} pub:${le.publications.length}(−${dropped})${fbTag} auth:${le.authors.length} spp:${le.species.length} plc:${le.places.length} stk:${le.stakeholders.length} doc:${le.documents.length} ds:${le.datasets.length} proj:${le.projects.length}`)
  }

  writeFileSync(outputPath, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      source_syn: inputSyn,
      source_clusters: inputClu,
      tag_threshold: tagThreshold,
      top_n_per_type: topN,
      frontiers_linked: linked.length,
    },
    linked,
  }, null, 2))
  console.log(`\nWritten ${outputPath} (${linked.length} frontiers)`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
