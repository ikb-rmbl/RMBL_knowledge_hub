/**
 * Pre-compute a unified knowledge graph combining all entity and collection types.
 *
 * Strategy: edge-first construction with connectivity pruning.
 *   1. Load ALL entities, items, and authors as candidate nodes
 *   2. Build ALL edges (co-occurrence weight ≥2, structural edges with no minimum)
 *   3. Prune nodes with graph degree < minDegree (removes weakly-connected nodes)
 *   4. Run ForceAtlas2 layout
 *
 * This avoids ad-hoc mention-count thresholds and hard edge caps. The graph
 * structure itself determines which nodes are included.
 *
 * Usage:
 *   npx tsx scripts/build-unified-graph.ts [--min-degree=2] [--exclude-docs] [--output=unified.json]
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'

const Graph = (await import('graphology')).default
const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default

const args = process.argv.slice(2)
const minDegree = parseInt(args.find((a) => a.startsWith('--min-degree='))?.split('=')[1] || '2')
const minCooccurrence = parseInt(args.find((a) => a.startsWith('--min-cooccurrence='))?.split('=')[1] || '2')
const excludeDocs = args.includes('--exclude-docs')
const outputFile = args.find((a) => a.startsWith('--output='))?.split('=')[1] || 'unified.json'

async function main() {
  console.log(`Building unified knowledge graph`)
  console.log(`  Strategy: edge-first, prune degree < ${minDegree}, co-occurrence weight ≥ ${minCooccurrence}`)
  if (excludeDocs) console.log('  Mode: research only (excluding documents/stakeholders)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 3,
  })

  const graph = new Graph()
  const edgeKeys = new Set<string>()

  // Class-pair multipliers rebalance ForceAtlas2 + Louvain so they produce
  // cross-cutting communities instead of like-type silos. Without this,
  // entity-entity co-occurrence (431K edges, 74% of total layout weight)
  // dominates and pulls species-with-species, concept-with-concept etc.
  // Like-type pairs are penalised; cross-type pairs are boosted.
  const ENTITY_TYPES = new Set(['species', 'concept', 'protocol', 'place', 'stakeholder'])
  const ITEM_TYPES = new Set(['pub', 'dataset', 'document', 'story'])
  function classOf(t: string): string {
    if (ENTITY_TYPES.has(t)) return 'entity'
    if (ITEM_TYPES.has(t)) return 'item'
    return t // 'author', etc.
  }
  function classMultiplier(sourceType: string, targetType: string): number {
    const a = classOf(sourceType), b = classOf(targetType)
    return a === b ? 0.5 : 2.0
  }

  function addEdge(source: string, target: string, weight: number) {
    if (!graph.hasNode(source) || !graph.hasNode(target)) return
    if (source === target) return
    const k1 = `${source}--${target}`, k2 = `${target}--${source}`
    if (edgeKeys.has(k1) || edgeKeys.has(k2)) return
    const sType = source.split('-')[0], tType = target.split('-')[0]
    const adjusted = weight * classMultiplier(sType, tType)
    try { graph.addEdge(source, target, { weight: adjusted }); edgeKeys.add(k1) }
    catch {}
  }

  // Collection filter for research mode
  const collectionFilter = excludeDocs
    ? "AND em.collection IN ('publications', 'datasets')"
    : ''

  // =====================================================================
  // PHASE 1: Load ALL candidate nodes
  // =====================================================================
  console.log('\nPhase 1: Loading candidate nodes...')

  // Species (all with at least 1 mention)
  const { rows: species } = await db.query(`
    SELECT s.id, s.canonical_name as name, s.kingdom, s.family, s.mention_count
    FROM species s WHERE s.mention_count > 0
  `)
  for (const s of species) {
    graph.addNode(`species-${s.id}`, {
      label: s.name, nodeType: 'species', kingdom: s.kingdom, family: s.family,
      degree: s.mention_count || 0, size: 1.5 + Math.log((s.mention_count || 0) + 1) * 0.8,
      x: -100 + Math.random() * 50, y: -100 + Math.random() * 50,
    })
  }
  console.log(`  ${species.length} species`)

  // Concepts
  const { rows: concepts } = await db.query(`
    SELECT id, name, scope, concept_type, mention_count
    FROM concepts WHERE mention_count > 0
  `)
  for (const c of concepts) {
    graph.addNode(`concept-${c.id}`, {
      label: c.name, nodeType: 'concept', scope: c.scope, conceptType: c.concept_type,
      degree: c.mention_count || 0, size: 1.5 + Math.log((c.mention_count || 0) + 1) * 0.8,
      x: 100 + Math.random() * 50, y: -100 + Math.random() * 50,
    })
  }
  console.log(`  ${concepts.length} concepts`)

  // Protocols
  const { rows: protocols } = await db.query(`
    SELECT id, name, category, mention_count
    FROM protocols WHERE mention_count > 0
  `)
  for (const p of protocols) {
    graph.addNode(`protocol-${p.id}`, {
      label: p.name, nodeType: 'protocol', category: p.category,
      degree: p.mention_count || 0, size: 1.5 + Math.log((p.mention_count || 0) + 1) * 0.8,
      x: 0 + Math.random() * 50, y: 100 + Math.random() * 50,
    })
  }
  console.log(`  ${protocols.length} protocols`)

  // Places (exclude broad-scale)
  const { rows: places } = await db.query(`
    SELECT id, name, place_type, scale, mention_count
    FROM places
    WHERE mention_count > 0
      AND (scale IS NULL OR scale IN ('site', 'local'))
      AND (place_type IS NULL OR place_type NOT IN ('country', 'state', 'region'))
  `)
  for (const p of places) {
    graph.addNode(`place-${p.id}`, {
      label: p.name, nodeType: 'place', placeType: p.place_type, scale: p.scale,
      degree: p.mention_count || 0, size: 1.5 + Math.log((p.mention_count || 0) + 1) * 0.8,
      x: 50 + Math.random() * 50, y: -50 + Math.random() * 50,
    })
  }
  console.log(`  ${places.length} places`)

  // Stakeholders (excluded in research mode)
  let stakeholders: any[] = []
  if (!excludeDocs) {
    const { rows } = await db.query(`
      SELECT id, name, stakeholder_type, document_count, publication_count
      FROM stakeholders WHERE (document_count + publication_count) > 0
    `)
    stakeholders = rows
    for (const s of stakeholders) {
      const deg = s.document_count + s.publication_count
      graph.addNode(`stakeholder-${s.id}`, {
        label: s.name, nodeType: 'stakeholder', stakeholderType: s.stakeholder_type,
        degree: deg, size: 1.5 + Math.log(deg + 1) * 0.8,
        x: -150 + Math.random() * 50, y: 0 + Math.random() * 50,
      })
    }
  }
  console.log(`  ${stakeholders.length} stakeholders${excludeDocs ? ' (excluded)' : ''}`)

  // Authors (all with work_count > 0)
  const { rows: authors } = await db.query(`
    SELECT id, display_name, work_count FROM authors WHERE work_count > 0 ORDER BY work_count DESC
  `)
  for (const a of authors) {
    graph.addNode(`author-${a.id}`, {
      label: a.display_name, nodeType: 'author',
      degree: a.work_count, size: 1.5 + Math.log(a.work_count + 1) * 0.8,
      x: -100 + Math.random() * 50, y: 100 + Math.random() * 50,
    })
  }
  console.log(`  ${authors.length} authors`)

  // Publications (all with citation count > 0 or any entity mention)
  const { rows: pubs } = await db.query(`
    SELECT id, title, coalesce(external_citation_count, 0) as cite_count
    FROM publications
    WHERE coalesce(external_citation_count, 0) > 0
       OR id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'publications')
    ORDER BY cite_count DESC
  `)
  for (const p of pubs) {
    graph.addNode(`pub-${p.id}`, {
      label: p.title.slice(0, 50), nodeType: 'publication',
      degree: p.cite_count, size: 1.5 + Math.log(p.cite_count + 1) * 0.6,
      x: 100 + Math.random() * 50, y: 100 + Math.random() * 50,
    })
  }
  console.log(`  ${pubs.length} publications`)

  // Documents (excluded in research mode)
  let documents: any[] = []
  if (!excludeDocs) {
    const { rows } = await db.query(`
      SELECT id, title, document_type
      FROM documents
      WHERE id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'documents')
    `)
    documents = rows
    for (const d of documents) {
      graph.addNode(`document-${d.id}`, {
        label: (d.title || '').slice(0, 50), nodeType: 'document',
        documentType: d.document_type,
        degree: 0, size: 2,
        x: -50 + Math.random() * 50, y: 50 + Math.random() * 50,
      })
    }
  }
  console.log(`  ${documents.length} documents${excludeDocs ? ' (excluded)' : ''}`)

  // Datasets (all with entity mentions)
  const { rows: datasets } = await db.query(`
    SELECT id, title, publication_year
    FROM datasets
    WHERE id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'datasets')
  `)
  for (const d of datasets) {
    graph.addNode(`dataset-${d.id}`, {
      label: d.title.slice(0, 50), nodeType: 'dataset', year: d.publication_year,
      degree: 0, size: 2,
      x: 0 + Math.random() * 50, y: -50 + Math.random() * 50,
    })
  }
  console.log(`  ${datasets.length} datasets`)

  // Stories (excluded in research mode, like documents)
  let stories: any[] = []
  if (!excludeDocs) {
    const { rows } = await db.query(`
      SELECT id, title, story_type
      FROM stories
      WHERE id IN (SELECT DISTINCT item_id FROM entity_mentions WHERE collection = 'stories')
    `)
    stories = rows
    for (const s of stories) {
      graph.addNode(`story-${s.id}`, {
        label: (s.title || '').slice(0, 50), nodeType: 'story',
        storyType: s.story_type,
        degree: 0, size: 2,
        x: -50 + Math.random() * 50, y: -50 + Math.random() * 50,
      })
    }
  }
  console.log(`  ${stories.length} stories${excludeDocs ? ' (excluded)' : ''}`)

  console.log(`  Total candidate nodes: ${graph.order}`)

  // =====================================================================
  // PHASE 2: Build ALL edges (no caps)
  // =====================================================================
  console.log('\nPhase 2: Building edges...')

  // Entity co-occurrence (weight ≥ minCooccurrence)
  const { rows: cooccurrences } = await db.query(`
    SELECT em1.entity_type as t1, em1.entity_id as id1, em2.entity_type as t2, em2.entity_id as id2,
      COUNT(DISTINCT (em1.collection || ':' || em1.item_id)) as weight
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.item_id = em1.item_id AND em2.collection = em1.collection
      AND (em2.entity_type > em1.entity_type OR (em2.entity_type = em1.entity_type AND em2.entity_id > em1.entity_id))
    WHERE em1.entity_type IN ('species', 'concept', 'protocol', 'place')
      AND em2.entity_type IN ('species', 'concept', 'protocol', 'place')
      ${collectionFilter.replace(/em\./g, 'em1.')}
    GROUP BY em1.entity_type, em1.entity_id, em2.entity_type, em2.entity_id
    HAVING COUNT(DISTINCT (em1.collection || ':' || em1.item_id)) >= $1
  `, [minCooccurrence])
  let entityEdges = 0
  for (const e of cooccurrences) {
    addEdge(`${e.t1}-${e.id1}`, `${e.t2}-${e.id2}`, Math.min(parseInt(e.weight), 5)) // cap co-occurrence
    entityEdges++
  }
  console.log(`  ${entityEdges} entity co-occurrence edges`)

  // Entity ↔ Publication
  const { rows: entityPubLinks } = await db.query(`
    SELECT em.entity_type, em.entity_id, em.item_id
    FROM entity_mentions em
    WHERE em.collection = 'publications'
      AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
  `)
  let epEdges = 0
  for (const e of entityPubLinks) addEdge(`${e.entity_type}-${e.entity_id}`, `pub-${e.item_id}`, 1), epEdges++
  console.log(`  ${epEdges} entity↔publication edges`)

  // Author ↔ Publication
  const { rows: authorPubLinks } = await db.query(`
    SELECT parent_id as author_id, publications_id as pub_id
    FROM authors_rels WHERE publications_id IS NOT NULL AND path = 'publications'
  `)
  let apEdges = 0
  for (const e of authorPubLinks) addEdge(`author-${e.author_id}`, `pub-${e.pub_id}`, 3), apEdges++ // boosted
  console.log(`  ${apEdges} author↔publication edges`)

  // Co-authorship (≥2 shared works across publications + datasets + documents)
  const { rows: coauthorEdges } = await db.query(`
    WITH pairs AS (
      SELECT ar1.parent_id AS a1, ar2.parent_id AS a2
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.publications_id = ar1.publications_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'publications'
      WHERE ar1.path = 'publications'
      UNION ALL
      SELECT ar1.parent_id, ar2.parent_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.datasets_id = ar1.datasets_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'datasets'
      WHERE ar1.path = 'datasets'
      UNION ALL
      SELECT ar1.parent_id, ar2.parent_id
      FROM authors_rels ar1
      JOIN authors_rels ar2 ON ar2.documents_id = ar1.documents_id AND ar2.parent_id > ar1.parent_id AND ar2.path = 'documents'
      WHERE ar1.path = 'documents'
    )
    SELECT a1, a2, COUNT(*) AS shared
    FROM pairs GROUP BY a1, a2
    HAVING COUNT(*) >= 2
  `)
  let caEdges = 0
  for (const e of coauthorEdges) addEdge(`author-${e.a1}`, `author-${e.a2}`, parseInt(e.shared) * 5), caEdges++ // boosted
  console.log(`  ${caEdges} co-authorship edges`)

  // Author ↔ Entity (across publications + datasets + documents)
  const { rows: authorEntityLinks } = await db.query(`
    WITH author_works AS (
      SELECT parent_id AS author_id, 'publications'::text AS collection, publications_id AS item_id FROM authors_rels WHERE path = 'publications' AND publications_id IS NOT NULL
      UNION ALL
      SELECT parent_id, 'datasets', datasets_id FROM authors_rels WHERE path = 'datasets' AND datasets_id IS NOT NULL
      UNION ALL
      SELECT parent_id, 'documents', documents_id FROM authors_rels WHERE path = 'documents' AND documents_id IS NOT NULL
    )
    SELECT aw.author_id, em.entity_type, em.entity_id,
      COUNT(DISTINCT (em.collection || ':' || em.item_id)) AS shared
    FROM author_works aw
    JOIN entity_mentions em ON em.collection = aw.collection AND em.item_id = aw.item_id
    WHERE em.entity_type IN ('species', 'concept', 'protocol', 'place')
    GROUP BY aw.author_id, em.entity_type, em.entity_id
    HAVING COUNT(DISTINCT (em.collection || ':' || em.item_id)) >= 2
  `)
  let aeEdges = 0
  for (const e of authorEntityLinks) addEdge(`author-${e.author_id}`, `${e.entity_type}-${e.entity_id}`, Math.min(parseInt(e.shared), 5)), aeEdges++ // capped
  console.log(`  ${aeEdges} author↔entity edges`)

  // Pub↔Pub citations
  const { rows: citations } = await db.query(`
    SELECT source_publication_id as src, target_publication_id as tgt
    FROM references_cited
    WHERE source_publication_id IS NOT NULL AND target_publication_id IS NOT NULL
  `)
  let citEdges = 0
  for (const e of citations) addEdge(`pub-${e.src}`, `pub-${e.tgt}`, 6), citEdges++ // boosted
  console.log(`  ${citEdges} pub↔pub citation edges`)

  // Document edges (excluded in research mode)
  if (!excludeDocs) {
    // Document ↔ Entity
    const { rows: docEntityLinks } = await db.query(`
      SELECT em.entity_type, em.entity_id, em.item_id
      FROM entity_mentions em
      WHERE em.collection = 'documents'
        AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
    `)
    let docEntEdges = 0
    for (const e of docEntityLinks) addEdge(`document-${e.item_id}`, `${e.entity_type}-${e.entity_id}`, 1), docEntEdges++
    console.log(`  ${docEntEdges} document↔entity edges`)

    // Story ↔ Entity
    const { rows: storyEntityLinks } = await db.query(`
      SELECT em.entity_type, em.entity_id, em.item_id
      FROM entity_mentions em
      WHERE em.collection = 'stories'
        AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
    `)
    let storyEntEdges = 0
    for (const e of storyEntityLinks) addEdge(`story-${e.item_id}`, `${e.entity_type}-${e.entity_id}`, 1), storyEntEdges++
    console.log(`  ${storyEntEdges} story↔entity edges`)

    // Story ↔ Publication (from references_cited — keep strongest link per pair)
    const { rows: storyPubLinks } = await db.query(`
      SELECT source_story_id as story_id, target_publication_id as pub_id,
        CASE link_type
          WHEN 'title_match' THEN 3
          WHEN 'researcher_match' THEN 2
          WHEN 'entity_match' THEN 1
          ELSE 1
        END as weight
      FROM (
        SELECT DISTINCT ON (source_story_id, target_publication_id)
          source_story_id, target_publication_id, link_type
        FROM references_cited
        WHERE source_story_id IS NOT NULL AND target_publication_id IS NOT NULL
        ORDER BY source_story_id, target_publication_id,
          CASE link_type WHEN 'title_match' THEN 1 WHEN 'researcher_match' THEN 2 ELSE 3 END
      ) best
    `)
    let spEdges = 0
    for (const e of storyPubLinks) addEdge(`story-${e.story_id}`, `pub-${e.pub_id}`, e.weight), spEdges++
    console.log(`  ${spEdges} story↔publication edges`)

    // Story ↔ Document (via shared entities ≥3)
    const { rows: storyDocLinks } = await db.query(`
      SELECT em1.item_id as story_id, em2.item_id as doc_id,
        COUNT(DISTINCT (em1.entity_type || ':' || em1.entity_id)) as shared
      FROM entity_mentions em1
      JOIN entity_mentions em2 ON em2.entity_type = em1.entity_type AND em2.entity_id = em1.entity_id
      WHERE em1.collection = 'stories' AND em2.collection = 'documents'
        AND em1.entity_type IN ('species', 'concept', 'protocol', 'place')
      GROUP BY em1.item_id, em2.item_id
      HAVING COUNT(DISTINCT (em1.entity_type || ':' || em1.entity_id)) >= 3
    `)
    let sdEdges = 0
    for (const e of storyDocLinks) addEdge(`story-${e.story_id}`, `document-${e.doc_id}`, Math.min(parseInt(e.shared), 5)), sdEdges++
    console.log(`  ${sdEdges} story↔document edges`)

    // Story ↔ Story (via shared entities ≥3)
    const { rows: storyStoryLinks } = await db.query(`
      SELECT em1.item_id as s1, em2.item_id as s2,
        COUNT(DISTINCT (em1.entity_type || ':' || em1.entity_id)) as shared
      FROM entity_mentions em1
      JOIN entity_mentions em2 ON em2.entity_type = em1.entity_type AND em2.entity_id = em1.entity_id
        AND em2.item_id > em1.item_id
      WHERE em1.collection = 'stories' AND em2.collection = 'stories'
        AND em1.entity_type IN ('species', 'concept', 'protocol', 'place')
      GROUP BY em1.item_id, em2.item_id
      HAVING COUNT(DISTINCT (em1.entity_type || ':' || em1.entity_id)) >= 3
    `)
    let ssEdges = 0
    for (const e of storyStoryLinks) addEdge(`story-${e.s1}`, `story-${e.s2}`, Math.min(parseInt(e.shared), 5)), ssEdges++
    console.log(`  ${ssEdges} story↔story edges`)

    // Stakeholder ↔ Item
    const { rows: stakeholderLinks } = await db.query(`
      SELECT em.entity_id, em.collection, em.item_id
      FROM entity_mentions em
      WHERE em.entity_type = 'stakeholder'
    `)
    let shEdges = 0
    for (const e of stakeholderLinks) {
      const itemNode = e.collection === 'documents' ? `document-${e.item_id}`
        : e.collection === 'stories' ? `story-${e.item_id}`
        : `pub-${e.item_id}`
      addEdge(`stakeholder-${e.entity_id}`, itemNode, 1), shEdges++
    }
    console.log(`  ${shEdges} stakeholder↔item edges`)

    // Document citations
    const { rows: docPubCit } = await db.query(`
      SELECT source_document_id as doc_id, target_publication_id as pub_id
      FROM references_cited WHERE source_document_id IS NOT NULL AND target_publication_id IS NOT NULL
    `)
    let dpcEdges = 0
    for (const e of docPubCit) addEdge(`document-${e.doc_id}`, `pub-${e.pub_id}`, 6), dpcEdges++ // boosted

    const { rows: docDocCit } = await db.query(`
      SELECT source_document_id as src, target_document_id as tgt
      FROM references_cited WHERE source_document_id IS NOT NULL AND target_document_id IS NOT NULL
    `)
    let ddcEdges = 0
    for (const e of docDocCit) addEdge(`document-${e.src}`, `document-${e.tgt}`, 6), ddcEdges++ // boosted
    console.log(`  ${dpcEdges} doc→pub + ${ddcEdges} doc↔doc citation edges`)

    // Author ↔ Document
    const { rows: authorDocLinks } = await db.query(`
      SELECT parent_id as author_id, documents_id as doc_id
      FROM authors_rels WHERE documents_id IS NOT NULL AND path = 'documents'
    `)
    let adEdges = 0
    for (const e of authorDocLinks) addEdge(`author-${e.author_id}`, `document-${e.doc_id}`, 3), adEdges++ // boosted
    console.log(`  ${adEdges} author↔document edges`)
  }

  // Dataset ↔ Entity
  const { rows: datasetEntityLinks } = await db.query(`
    SELECT em.entity_type, em.entity_id, em.item_id
    FROM entity_mentions em
    WHERE em.collection = 'datasets'
      AND em.entity_type IN ('species', 'concept', 'protocol', 'place')
  `)
  let deEdges = 0
  for (const e of datasetEntityLinks) addEdge(`dataset-${e.item_id}`, `${e.entity_type}-${e.entity_id}`, 1), deEdges++
  console.log(`  ${deEdges} dataset↔entity edges`)

  // Dataset ↔ Publication
  let dpEdges = 0
  const { rows: dpViaRepos } = await db.query(`SELECT publication_id, linked_dataset_id FROM data_repositories WHERE linked_dataset_id IS NOT NULL`)
  for (const e of dpViaRepos) addEdge(`dataset-${e.linked_dataset_id}`, `pub-${e.publication_id}`, 4), dpEdges++ // boosted
  const { rows: dpViaCit } = await db.query(`SELECT source_publication_id as pub_id, target_dataset_id as ds_id FROM references_cited WHERE target_dataset_id IS NOT NULL AND source_publication_id IS NOT NULL`)
  for (const e of dpViaCit) addEdge(`pub-${e.pub_id}`, `dataset-${e.ds_id}`, 4), dpEdges++ // boosted
  const { rows: dpViaRels } = await db.query(`SELECT parent_id as ds_id, publications_id as pub_id FROM datasets_rels WHERE publications_id IS NOT NULL`)
  for (const e of dpViaRels) addEdge(`dataset-${e.ds_id}`, `pub-${e.pub_id}`, 4), dpEdges++ // boosted
  console.log(`  ${dpEdges} dataset↔publication edges`)

  // Dataset ↔ Author
  const { rows: datasetAuthorLinks } = await db.query(`SELECT parent_id as author_id, datasets_id as ds_id FROM authors_rels WHERE datasets_id IS NOT NULL AND path = 'datasets'`)
  let daEdges = 0
  for (const e of datasetAuthorLinks) addEdge(`author-${e.author_id}`, `dataset-${e.ds_id}`, 3), daEdges++ // boosted
  console.log(`  ${daEdges} dataset↔author edges`)

  console.log(`  Total edges: ${graph.size}`)

  // =====================================================================
  // PHASE 3: Prune by connectivity
  // =====================================================================
  console.log(`\nPhase 3: Pruning nodes with degree < ${minDegree}...`)
  let pruned = 0
  let changed = true
  while (changed) {
    changed = false
    const toPrune: string[] = []
    graph.forEachNode((node: string) => {
      if (graph.degree(node) < minDegree) toPrune.push(node)
    })
    for (const n of toPrune) { graph.dropNode(n); pruned++ }
    if (toPrune.length > 0) changed = true // removing nodes may reduce neighbors' degree
  }
  console.log(`  Pruned ${pruned} weakly-connected nodes → ${graph.order} nodes, ${graph.size} edges remaining`)

  // Report type breakdown after pruning
  const typeCounts: Record<string, number> = {}
  graph.forEachNode((_n: string, attrs: any) => {
    typeCounts[attrs.nodeType] = (typeCounts[attrs.nodeType] || 0) + 1
  })
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`)
  }

  // Update degree and size from actual graph edges
  graph.forEachNode((node: string) => {
    const deg = graph.degree(node)
    graph.setNodeAttribute(node, 'degree', deg)
    graph.setNodeAttribute(node, 'size', 1.5 + Math.log(deg + 1) * 0.8)
  })

  // =====================================================================
  // PHASE 4: Layout + Export
  // =====================================================================
  console.log('\nPhase 4: Running ForceAtlas2 layout...')
  forceAtlas2.assign(graph, {
    iterations: 800,
    settings: {
      gravity: 0.5,
      scalingRatio: 50,
      strongGravityMode: true,
      barnesHutOptimize: true,
      edgeWeightInfluence: 0.3,
    },
  })

  // Normalize coordinates to [-500, 500]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  graph.forEachNode((_n: string, attrs: any) => {
    if (attrs.x < minX) minX = attrs.x; if (attrs.x > maxX) maxX = attrs.x
    if (attrs.y < minY) minY = attrs.y; if (attrs.y > maxY) maxY = attrs.y
  })
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1
  graph.forEachNode((n: string) => {
    graph.setNodeAttribute(n, 'x', ((graph.getNodeAttribute(n, 'x') - minX) / rangeX - 0.5) * 1000)
    graph.setNodeAttribute(n, 'y', ((graph.getNodeAttribute(n, 'y') - minY) / rangeY - 0.5) * 1000)
  })

  // Export
  const output: any = {
    entityType: 'unified',
    colorField: 'nodeType',
    nodes: [] as any[],
    edges: [] as any[],
    meta: { minDegree, minCooccurrence, nodeCount: graph.order, edgeCount: graph.size, generatedAt: new Date().toISOString() },
  }
  graph.forEachNode((id: string, attrs: any) => { output.nodes.push({ id, ...attrs }) })
  graph.forEachEdge((_e: string, attrs: any, source: string, target: string) => {
    output.edges.push({ source, target, weight: attrs.weight })
  })

  mkdirSync('public/graph', { recursive: true })
  const outPath = `public/graph/${outputFile}`
  writeFileSync(outPath, JSON.stringify(output))
  console.log(`\nWritten to ${outPath} (${(JSON.stringify(output).length / 1024).toFixed(0)}KB)`)

  // Index of node IDs for cheap server-side membership checks (used by detail
  // pages to decide whether to show a "View in full graph" button).
  if (outputFile === 'unified.json') {
    const indexPath = 'public/graph/unified-node-index.json'
    const indexData = { nodes: output.nodes.map((n: any) => n.id) }
    writeFileSync(indexPath, JSON.stringify(indexData))
    console.log(`Written ${indexPath} (${(JSON.stringify(indexData).length / 1024).toFixed(0)}KB, ${indexData.nodes.length} ids)`)
  }

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
