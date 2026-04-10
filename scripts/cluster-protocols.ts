/**
 * Cluster Protocol Candidates
 *
 * Groups similar protocol candidates from entity_candidates into canonical
 * Protocol records. Uses embedding-based clustering because VLM-generated
 * protocol names are highly descriptive and paper-specific, so exact name
 * matching only catches ~2% of duplicates.
 *
 * Algorithm:
 *   1. Load all entity_candidates where entity_type='protocol'
 *   2. Compute Voyage AI embeddings on (proposedName + " — " + description)
 *   3. Greedy centroid clustering: for each candidate, if cosine similarity
 *      to the nearest cluster centroid > threshold → merge, else → new cluster
 *   4. Create canonical Protocol records from cluster centroids
 *   5. Update entity_candidates.resolved_entity_id to point at the canonical
 *   6. Create entity_mentions rows linking each (protocol, publication) pair
 *
 * Usage:
 *   npx tsx scripts/cluster-protocols.ts [--threshold=0.80] [--dry-run] [--limit=N]
 */

import pg from 'pg'
import './lib/config.js'
import { VOYAGE_API_KEY, VOYAGE_MODEL, EMBEDDING_DIMENSIONS } from './lib/config.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const thresholdArg = args.find((a) => a.startsWith('--threshold='))?.split('=')[1]
const THRESHOLD = thresholdArg ? parseFloat(thresholdArg) : 0.80
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const EMBED_BATCH_SIZE = 128

// ---------------------------------------------------------------------------
// Embedding via Voyage AI
// ---------------------------------------------------------------------------

async function embedTexts(texts: string[]): Promise<number[][]> {
  const allEmbeddings: number[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: batch,
        model: VOYAGE_MODEL,
        input_type: 'document',
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Voyage AI error ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    allEmbeddings.push(...data.data.map((d: any) => d.embedding))
    if (i + EMBED_BATCH_SIZE < texts.length) await sleep(200)
  }
  return allEmbeddings
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ---------------------------------------------------------------------------
// Greedy centroid clustering
// ---------------------------------------------------------------------------

interface Candidate {
  id: number               // entity_candidates.id
  rawName: string          // proposedName
  attrs: any               // raw_attributes jsonb
  sourceItemId: number     // publication.id
  pubYear: number | null   // publication year (for recency scoring)
  embedding: number[]
}

interface Cluster {
  centroid: number[]
  members: Candidate[]
}

// Phase 1: group candidates into clusters based on embedding similarity
function clusterCandidates(candidates: Candidate[], threshold: number): Cluster[] {
  const clusters: Cluster[] = []

  for (const candidate of candidates) {
    let bestCluster: Cluster | null = null
    let bestSim = -1

    for (const cluster of clusters) {
      const sim = cosineSimilarity(candidate.embedding, cluster.centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestCluster = cluster
      }
    }

    if (bestCluster && bestSim >= threshold) {
      bestCluster.members.push(candidate)
      // Update centroid as running average
      for (let i = 0; i < bestCluster.centroid.length; i++) {
        bestCluster.centroid[i] =
          (bestCluster.centroid[i] * (bestCluster.members.length - 1) + candidate.embedding[i]) /
          bestCluster.members.length
      }
    } else {
      clusters.push({
        centroid: [...candidate.embedding],
        members: [candidate],
      })
    }
  }

  return clusters
}

// Phase 2: pick the canonical representative for each cluster using composite scoring.
// Scoring balances:
//   - Centrality (35%): cosine similarity to cluster centroid — prefers the "median" protocol
//   - Detail (35%): description length + equipment count + output count — prefers rich data
//   - Recency (30%): year of the source publication — prefers recent but not at expense of quality
interface CanonicalRecord {
  name: string
  description: string
  category: string
  subcategory: string | null
  standardized: boolean
  standardName: string | null
  standardReference: string | null
  equipment: string[]       // union across all members
  outputs: string[]         // union across all members
  centroid: number[]
  canonicalMember: Candidate // the member that scored highest
  memberScores: { candidate: Candidate; score: number; centrality: number; detail: number; recency: number }[]
}

function selectCanonical(cluster: Cluster): CanonicalRecord {
  const members = cluster.members

  // Compute per-member raw scores
  const descLens = members.map((m) => (m.attrs.description || '').length)
  const equipCounts = members.map((m) => (m.attrs.equipmentUsed || []).length)
  const outputCounts = members.map((m) => (m.attrs.outputMeasurements || []).length)
  const years = members.map((m) => m.pubYear || 2000)

  const maxDesc = Math.max(...descLens, 1)
  const maxEquip = Math.max(...equipCounts, 1)
  const maxOutput = Math.max(...outputCounts, 1)
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const yearRange = maxYear - minYear || 1

  const scored = members.map((m, i) => {
    const centrality = cosineSimilarity(m.embedding, cluster.centroid)
    const detail =
      (descLens[i] / maxDesc) * 0.4 +
      (equipCounts[i] / maxEquip) * 0.3 +
      (outputCounts[i] / maxOutput) * 0.3
    const recency = (years[i] - minYear) / yearRange

    // Composite score: centrality 35% + detail 35% + recency 30%
    const score = centrality * 0.35 + detail * 0.35 + recency * 0.30

    return { candidate: m, score, centrality, detail, recency }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0].candidate

  // Aggregate equipment and outputs from ALL members
  const allEquipment = new Set<string>()
  const allOutputs = new Set<string>()
  let standardized = false
  let standardName: string | null = null
  let standardReference: string | null = null

  for (const m of members) {
    for (const e of m.attrs.equipmentUsed || []) allEquipment.add(e)
    for (const o of m.attrs.outputMeasurements || []) allOutputs.add(o)
    if (m.attrs.isStandardized) {
      standardized = true
      if (m.attrs.standardName) standardName = m.attrs.standardName
      if (m.attrs.standardReference) standardReference = m.attrs.standardReference
    }
  }

  // Name: prefer standardName if available, else best-scoring member's proposedName
  const name = standardName || best.attrs.proposedName || best.rawName

  return {
    name,
    description: best.attrs.description || '',
    category: best.attrs.category || 'sampling',
    subcategory: best.attrs.subcategory || null,
    standardized,
    standardName,
    standardReference,
    equipment: [...allEquipment],
    outputs: [...allOutputs],
    centroid: cluster.centroid,
    canonicalMember: best,
    memberScores: scored,
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Cluster Protocol Candidates')
  console.log('===========================')
  console.log(`Threshold: ${THRESHOLD}`)
  if (dryRun) console.log('(DRY RUN)')
  console.log()

  if (!VOYAGE_API_KEY) {
    console.error('Error: VOYAGE_API_KEY required for embedding computation')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Load protocol candidates with publication year for recency scoring
    const { rows } = await db.query(`
      SELECT ec.id, ec.raw_name, ec.raw_attributes, ec.source_item_id, p.year as pub_year
      FROM entity_candidates ec
      LEFT JOIN publications p ON p.id = ec.source_item_id
      WHERE ec.entity_type = 'protocol'
        AND ec.resolved_entity_id IS NULL
      ORDER BY ec.id
    `)
    const candidates = rows.slice(0, limit)
    console.log(`Loaded ${rows.length} unresolved protocol candidates (processing ${candidates.length})`)

    if (candidates.length === 0) {
      console.log('Nothing to cluster.')
      return
    }

    // Build embedding texts
    console.log('\nComputing embeddings...')
    const texts = candidates.map((c) => {
      const attrs = c.raw_attributes
      return `${attrs.proposedName || c.raw_name} — ${attrs.description || ''}`
    })
    const embeddings = await embedTexts(texts)
    console.log(`  ${embeddings.length} embeddings computed (${EMBEDDING_DIMENSIONS} dims)`)

    // Build candidate objects with publication year
    const candidateObjs: Candidate[] = candidates.map((c, i) => ({
      id: c.id,
      rawName: c.raw_name,
      attrs: c.raw_attributes,
      sourceItemId: c.source_item_id,
      pubYear: c.pub_year || null,
      embedding: embeddings[i],
    }))

    // Cluster
    console.log(`\nClustering with threshold ${THRESHOLD}...`)
    const clusters = clusterCandidates(candidateObjs, THRESHOLD)

    // Select canonical records using composite scoring
    const canonicals = clusters.map(selectCanonical)

    // Report
    const multiMember = clusters.filter((c) => c.members.length > 1)
    const singletons = clusters.filter((c) => c.members.length === 1)
    console.log(`  ${clusters.length} clusters formed`)
    console.log(`    multi-member: ${multiMember.length} (covering ${multiMember.reduce((n, c) => n + c.members.length, 0)} candidates)`)
    console.log(`    singletons: ${singletons.length}`)
    console.log(`    standardized: ${canonicals.filter((c) => c.standardized).length}`)

    // Show top clusters with scoring details
    console.log('\n  Top clusters by size:')
    const sortedCanonicals = [...canonicals]
      .map((c, i) => ({ canonical: c, cluster: clusters[i] }))
      .sort((a, b) => b.cluster.members.length - a.cluster.members.length)

    for (const { canonical, cluster } of sortedCanonicals.slice(0, 15)) {
      const memberNames = cluster.members.map((m) => `pub:${m.sourceItemId}(${m.pubYear || '?'})`).join(', ')
      console.log(`    ${cluster.members.length}x  "${canonical.name}" [${canonical.category}${canonical.standardized ? ' ✓std' : ''}]`)
      console.log(`        canonical: pub:${canonical.canonicalMember.sourceItemId} (${canonical.canonicalMember.pubYear || '?'})`)
      if (cluster.members.length > 1) {
        const top = canonical.memberScores[0]
        console.log(`        score=${top.score.toFixed(3)} (centrality=${top.centrality.toFixed(2)} detail=${top.detail.toFixed(2)} recency=${top.recency.toFixed(2)})`)
      }
      console.log(`        members: ${memberNames}`)
    }

    if (dryRun) {
      console.log(`\n(DRY RUN) Would create ${clusters.length} protocol records and ${candidates.length} entity_mentions`)
      return
    }

    // Clear previous protocol records + mentions (for re-runs)
    console.log('\nClearing previous protocol data for re-run...')
    await db.query('DELETE FROM entity_mentions WHERE entity_type = \'protocol\'')
    await db.query('DELETE FROM protocols')
    await db.query('UPDATE entity_candidates SET resolved_entity_id = NULL WHERE entity_type = \'protocol\'')

    // Create Protocol records, collect batch data for mentions
    console.log(`Creating ${canonicals.length} protocol records...`)
    let created = 0
    const allCandIds: number[] = []
    const allResolvedIds: number[] = []
    const allMentionEntityIds: number[] = []
    const allMentionItemIds: number[] = []
    const allMentionRoles: string[] = []
    const allMentionMetadata: (string | null)[] = []

    for (let ci = 0; ci < canonicals.length; ci++) {
      const canonical = canonicals[ci]
      const cluster = clusters[ci]

      const slug = slugify(canonical.name)
      const { rows: [proto] } = await db.query(
        `INSERT INTO protocols
         (name, slug, category, subcategory, description, typical_equipment, typical_duration,
          output_measurements, standardized, standard_reference, approved, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, false, $10)
         ON CONFLICT (slug) DO UPDATE SET
           description = CASE WHEN length(EXCLUDED.description) > length(protocols.description) THEN EXCLUDED.description ELSE protocols.description END,
           typical_equipment = EXCLUDED.typical_equipment,
           output_measurements = EXCLUDED.output_measurements,
           standardized = EXCLUDED.standardized OR protocols.standardized
         RETURNING id`,
        [
          canonical.name,
          slug,
          canonical.category,
          canonical.subcategory,
          canonical.description,
          canonical.equipment,
          canonical.outputs,
          canonical.standardized,
          canonical.standardReference,
          JSON.stringify(canonical.centroid),
        ],
      )
      const protocolId = proto.id
      created++

      for (const member of cluster.members) {
        allCandIds.push(member.id)
        allResolvedIds.push(protocolId)
        allMentionEntityIds.push(protocolId)
        allMentionItemIds.push(member.sourceItemId)
        allMentionRoles.push((member.attrs.role || 'using').slice(0, 30))
        const stepIndices = member.attrs.protocolStepIndices || null
        allMentionMetadata.push(stepIndices ? JSON.stringify({ protocolStepIndices: stepIndices }) : null)
      }

      if (created % 50 === 0) {
        process.stdout.write(`\r  ${created}/${canonicals.length} protocols created`)
      }
    }

    // Batch UPDATE entity_candidates.resolved_entity_id
    if (allCandIds.length > 0) {
      await db.query(`
        UPDATE entity_candidates ec SET resolved_entity_id = t.resolved_id
        FROM unnest($1::int[], $2::int[]) AS t(cand_id, resolved_id)
        WHERE ec.id = t.cand_id
      `, [allCandIds, allResolvedIds])
    }

    // Batch INSERT entity_mentions
    if (allMentionEntityIds.length > 0) {
      await db.query(`
        INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method, metadata)
        SELECT 'protocol', unnest($1::int[]), 'publications', unnest($2::int[]), unnest($3::varchar[]), 1.0, 'vlm', unnest($4::jsonb[])
        ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING
      `, [allMentionEntityIds, allMentionItemIds, allMentionRoles, allMentionMetadata])
    }

    const mentions = allMentionEntityIds.length

    // Update counts
    console.log(`\r  ${created} protocols created, ${mentions} entity_mentions inserted`)
    console.log('\nUpdating mention and publication counts...')
    await db.query(`
      UPDATE protocols SET
        mention_count = (SELECT count(*) FROM entity_mentions WHERE entity_type = 'protocol' AND entity_id = protocols.id),
        publication_count = (SELECT count(DISTINCT item_id) FROM entity_mentions WHERE entity_type = 'protocol' AND entity_id = protocols.id AND collection = 'publications')
    `)

    // Final stats
    const { rows: [stats] } = await db.query(`
      SELECT count(*) as total,
             count(*) FILTER (WHERE approved) as approved_count,
             count(*) FILTER (WHERE standardized) as std_count,
             count(*) FILTER (WHERE publication_count > 1) as multi_pub
      FROM protocols
    `)
    console.log(`\nFinal protocol stats:`)
    console.log(`  Total: ${stats.total}`)
    console.log(`  Standardized: ${stats.std_count}`)
    console.log(`  Multi-publication: ${stats.multi_pub} (appear in 2+ papers)`)
    console.log(`  Approved: ${stats.approved_count} (curator must review)`)

  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
