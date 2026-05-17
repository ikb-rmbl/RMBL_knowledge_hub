/**
 * Stage 5 of the frontiers pipeline: load the synthesized + linked
 * frontier entities into Postgres.
 *
 * Reads:
 *  - scripts/output/frontiers-synthesized-top100.json (prose + bullets)
 *  - scripts/output/frontiers-linked-top100.json     (linkable_entities + data_gaps)
 *  - scripts/output/frontiers-clustered.json         (cluster member_statement_ids)
 *  - scripts/output/frontiers-extracted.json         (the atomic statements themselves)
 *
 * Writes (after TRUNCATE):
 *  - frontiers
 *  - frontier_neighborhoods
 *  - frontier_entities
 *  - frontier_source_statements
 *
 * Cluster IDs are non-deterministic across re-runs of the pipeline, so we
 * TRUNCATE + re-insert rather than upsert. If admin-curated columns are
 * added later (similar to the curated_fields pattern on Publications),
 * the truncate approach will need to be revisited.
 *
 * Usage:
 *   npx tsx scripts/load-frontiers.ts
 *   npx tsx scripts/load-frontiers.ts --syn=... --linked=... --clusters=... --extracted=...
 *   npx tsx scripts/load-frontiers.ts --dry-run
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const synPath = args.find((a) => a.startsWith('--syn='))?.split('=')[1] || 'scripts/output/frontiers-synthesized-top100.json'
const linkedPath = args.find((a) => a.startsWith('--linked='))?.split('=')[1] || 'scripts/output/frontiers-linked-top100.json'
const clustersPath = args.find((a) => a.startsWith('--clusters='))?.split('=')[1] || 'scripts/output/frontiers-clustered.json'
const extractedPath = args.find((a) => a.startsWith('--extracted='))?.split('=')[1] || 'scripts/output/frontiers-extracted.json'

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function main() {
  console.log('Load frontiers into Postgres')
  console.log('============================')

  const syn = JSON.parse(readFileSync(synPath, 'utf-8'))
  const linked = JSON.parse(readFileSync(linkedPath, 'utf-8'))
  const clu = JSON.parse(readFileSync(clustersPath, 'utf-8'))
  const extracted = JSON.parse(readFileSync(extractedPath, 'utf-8'))

  console.log(`  ${syn.frontiers.length} synthesized frontiers`)
  console.log(`  ${linked.linked.length} linker outputs`)
  console.log(`  ${clu.clusters.length} clusters`)

  // Build statement-by-id map (id = global sequential, matching cluster.member_statement_ids)
  const stmtById = new Map<number, any>()
  let idCounter = 0
  for (const n of extracted.neighborhoods) {
    for (const s of (n.statements || [])) {
      stmtById.set(idCounter, {
        ...s,
        neighborhood_id: n.neighborhood_id,
        neighborhood_title: n.title,
      })
      idCounter++
    }
  }

  const cluById = new Map(clu.clusters.map((c: any) => [c.cluster_id, c]))
  const linkedById = new Map(linked.linked.map((l: any) => [l.frontier_id, l]))

  // Slugify with collision handling
  const slugUsed = new Set<string>()
  function uniqueSlug(title: string): string {
    let base = slugify(title) || 'frontier'
    let slug = base
    let i = 2
    while (slugUsed.has(slug)) {
      slug = `${base}-${i++}`
    }
    slugUsed.add(slug)
    return slug
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  if (dryRun) {
    console.log('\nDRY RUN — sample preview of first 3 inserts:')
    for (const f of syn.frontiers.slice(0, 3)) {
      const slug = uniqueSlug(f.title)
      const c: any = cluById.get(f.cluster_id)
      const l: any = linkedById.get(f.cluster_id)
      console.log(`  [${f.cluster_id}] "${f.title}" → slug=${slug}`)
      console.log(`    questions=${f.key_questions?.length || 0}  actions=${f.pushing_the_frontier?.length || 0}`)
      console.log(`    nbrs=${c?.neighborhoods?.length || 0}  source statements=${c?.member_statement_ids?.length || 0}`)
      const le = l?.linkable_entities || {}
      const linkCounts = Object.entries(le).map(([k, v]: any) => `${k}:${v.length}`).join(' ')
      console.log(`    linked: ${linkCounts}`)
    }
    await db.end()
    return
  }

  console.log('\nTruncating existing frontier rows...')
  await db.query(`TRUNCATE frontiers, frontier_neighborhoods, frontier_entities, frontier_source_statements RESTART IDENTITY CASCADE`)

  console.log('\nLoading frontiers...')
  let loaded = 0
  let nbrLinks = 0
  let entityLinks = 0
  let stmtRows = 0

  for (const f of syn.frontiers) {
    const slug = uniqueSlug(f.title)
    const cluster: any = cluById.get(f.cluster_id)
    const linkData: any = linkedById.get(f.cluster_id)

    // INSERT frontier
    const { rows } = await db.query(
      `INSERT INTO frontiers (
        cluster_id, slug, title, context, frontier_description, barriers,
        research_opportunities, impacts, cross_cutting_summary, tractability,
        framing_notes, key_questions, pushing_the_frontier, data_gaps,
        avg_management_relevance, source_cluster_size, source_neighborhoods,
        generated_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW()
      ) RETURNING id`,
      [
        f.cluster_id,
        slug,
        f.title,
        f.context || null,
        f.frontier_description || null,
        f.barriers || null,
        f.research_opportunities || null,
        f.impacts || null,
        f.cross_cutting_summary || null,
        f.tractability || null,
        f.framing_notes || null,
        JSON.stringify(f.key_questions || []),
        JSON.stringify(f.pushing_the_frontier || []),
        JSON.stringify(linkData?.data_gaps || []),
        f.avg_management_relevance ?? null,
        f.source_cluster_size ?? null,
        f.source_neighborhoods ?? null,
      ],
    )
    const frontierId: number = rows[0].id
    loaded++

    // Contributing neighborhoods
    if (cluster?.neighborhoods) {
      for (const n of cluster.neighborhoods) {
        await db.query(
          `INSERT INTO frontier_neighborhoods (frontier_id, neighborhood_id, statement_count)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [frontierId, n.id, n.statement_count || 1],
        )
        nbrLinks++
      }
    }

    // Linked entities (polymorphic)
    if (linkData?.linkable_entities) {
      const ENTITY_TYPE_MAP: Record<string, string> = {
        concepts: 'concept', protocols: 'protocol', datasets: 'dataset',
        publications: 'publication', authors: 'author', places: 'place',
        species: 'species', stakeholders: 'stakeholder', documents: 'document',
        projects: 'project',
      }
      for (const [arrKey, entityType] of Object.entries(ENTITY_TYPE_MAP)) {
        const arr: any[] = linkData.linkable_entities[arrKey] || []
        for (const e of arr) {
          if (typeof e.id !== 'number') continue
          await db.query(
            `INSERT INTO frontier_entities (frontier_id, entity_type, entity_id, weight)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [frontierId, entityType, e.id, e.weight || 0],
          )
          entityLinks++
        }
      }
    }

    // Source statements (audit trail)
    if (cluster?.member_statement_ids) {
      for (const sid of cluster.member_statement_ids) {
        const s = stmtById.get(sid)
        if (!s) continue
        await db.query(
          `INSERT INTO frontier_source_statements
            (frontier_id, neighborhood_id, statement_text, management_relevance, source_section, concepts, protocols, datasets_needed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            frontierId,
            s.neighborhood_id,
            s.statement,
            s.management_relevance ?? null,
            s.source_section || null,
            JSON.stringify(s.concepts || []),
            JSON.stringify(s.protocols || []),
            JSON.stringify(s.datasets_needed || []),
          ],
        )
        stmtRows++
      }
    }

    if (loaded % 10 === 0) process.stdout.write(`  ${loaded}/${syn.frontiers.length}... `)
  }
  console.log()

  console.log(`\nDone:`)
  console.log(`  ${loaded} frontiers`)
  console.log(`  ${nbrLinks} frontier↔neighborhood links`)
  console.log(`  ${entityLinks} frontier↔entity links`)
  console.log(`  ${stmtRows} source statements`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
