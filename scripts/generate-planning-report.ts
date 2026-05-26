/**
 * Generate the Frontier Planning Clusters report as a single Markdown
 * document at scripts/output/frontier-planning-clusters.md.
 *
 * Pulls described clusters across all five item types (action, question,
 * data_gap, barrier, impact) and renders one section per type. Actions
 * appear twice — ranked by institutional leverage (what RMBL can fund
 * directly) and by partnership leverage (what needs external alignment).
 * Other types appear once each, ranked by institutional score (which for
 * non-action types reduces to 0.7 × item_count × frontier_count, i.e.
 * size × breadth).
 *
 * Each cluster card shows: title, scores, distributions (for actions),
 * summary, 5-10 distilled key items, and top contributing frontiers.
 *
 * Usage:
 *   npx tsx scripts/generate-planning-report.ts
 *   npx tsx scripts/generate-planning-report.ts --top=15 --min-items=5
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import './lib/config.js'

const args = process.argv.slice(2)
const TOP_N = parseInt(args.find((a) => a.startsWith('--top='))?.split('=')[1] || '15', 10)
const MIN_ITEMS = parseInt(args.find((a) => a.startsWith('--min-items='))?.split('=')[1] || '5', 10)
const OUT_PATH = 'scripts/output/frontier-planning-clusters.md'

interface ClusterRow {
  id: number
  item_type: string
  title: string
  summary: string
  key_items: string[]
  item_count: number
  frontier_count: number
  institutional_score: number
  partnership_score: number
  effort_distribution: Record<string, number>
  category_distribution: Record<string, number>
}

interface FrontierContribution {
  cluster_id: number
  frontier_title: string
  n: number
}

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

const SECTIONS = [
  {
    key: 'action-inst',
    title: 'Actions — Institutional Opportunities',
    blurb: 'These clusters surface what kinds of work RMBL could fund directly, where modest near-term or single-lab investments would push many frontiers. Ranked by institutional leverage (sum of tactical weight × distinct frontier count). Near-term and ambitious actions weight higher than major or consortium-scale work, which appears in the next subsection.',
    where: `item_type = 'action'`,
    orderBy: 'institutional_score DESC',
  },
  {
    key: 'action-partner',
    title: 'Actions — Partnership Opportunities',
    blurb: 'These clusters surface what kinds of work require external alignment — multi-institutional consortia, agency partnerships, or program-scale coordination. Ranked by partnership leverage. These are valuable but cannot be sustained on RMBL\'s own footing alone; their realization depends on cultivating the right alliances.',
    where: `item_type = 'action'`,
    orderBy: 'partnership_score DESC',
  },
  {
    key: 'question',
    title: 'Research Questions to Organize Around',
    blurb: 'These clusters surface the highest-leverage scientific questions across the corpus — the inquiries that, if answered, would advance the most frontiers at once. Ranked by size × breadth (number of items × distinct frontiers).',
    where: `item_type = 'question'`,
    orderBy: 'institutional_score DESC',
  },
  {
    key: 'data_gap',
    title: 'Data Gaps to Close',
    blurb: 'These clusters surface the highest-leverage data infrastructure investments — the data products, time series, and curation efforts that, if put in place, would underwrite the most frontiers. Ranked by size × breadth.',
    where: `item_type = 'data_gap'`,
    orderBy: 'institutional_score DESC',
  },
  {
    key: 'barrier',
    title: 'Systemic Barriers',
    blurb: 'These clusters surface the most-cited obstacles to progress across frontiers — the institutional, methodological, and coordination failures whose removal would unlock the most research. Ranked by size × breadth. Useful as a "what is the system stuck on?" lens, complementary to the action sections.',
    where: `item_type = 'barrier'`,
    orderBy: 'institutional_score DESC',
  },
  {
    key: 'impact',
    title: 'Management Decisions Waiting on Research',
    blurb: 'These clusters surface the management decisions, regulatory processes, and stakeholders most frequently identified as downstream beneficiaries of frontier resolution. Ranked by size × breadth. Useful for prioritizing the partnerships and audiences that would amplify impact.',
    where: `item_type = 'impact'`,
    orderBy: 'institutional_score DESC',
  },
] as const

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function distString(dist: Record<string, number>): string {
  return Object.entries(dist || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

function renderCluster(c: ClusterRow, contribs: FrontierContribution[]): string {
  const lines: string[] = []
  lines.push(`### ${c.title}`)
  lines.push('')
  // Metadata line
  const meta: string[] = []
  meta.push(`**${c.item_count}** items across **${c.frontier_count}** frontiers`)
  meta.push(`institutional=${Math.round(c.institutional_score)}, partnership=${Math.round(c.partnership_score)}`)
  if (c.item_type === 'action') {
    const eff = distString(c.effort_distribution)
    const cat = distString(c.category_distribution)
    if (eff) meta.push(`effort: ${eff}`)
    if (cat) meta.push(`category: ${cat}`)
  }
  lines.push(`> ${meta.join(' · ')}`)
  lines.push('')
  lines.push(c.summary)
  lines.push('')
  lines.push('**Key items:**')
  lines.push('')
  for (const item of c.key_items) lines.push(`- ${item}`)
  lines.push('')
  lines.push('**Top contributing frontiers:**')
  lines.push('')
  for (const f of contribs.slice(0, 6)) {
    lines.push(`- *${f.frontier_title}* (${f.n} item${f.n !== 1 ? 's' : ''})`)
  }
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Generate frontier planning report')
  console.log('=================================')
  console.log(`  top=${TOP_N}  min-items=${MIN_ITEMS}  out=${OUT_PATH}`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Corpus-level stats for the intro
  const { rows: [stats] } = await db.query(`
    SELECT
      (SELECT count(*) FROM frontiers)::int AS n_frontiers,
      (SELECT count(*) FROM frontier_planning_items)::int AS n_items,
      (SELECT count(*) FROM frontier_planning_clusters WHERE title IS NOT NULL)::int AS n_clusters_described,
      (SELECT count(*) FROM frontier_planning_clusters)::int AS n_clusters_total
  `)
  const { rows: typeStats } = await db.query(`
    SELECT item_type,
           count(*) FILTER (WHERE title IS NOT NULL) AS described,
           count(*) AS total,
           sum(item_count) AS items
    FROM frontier_planning_clusters GROUP BY item_type ORDER BY item_type
  `)

  // Document header
  const now = new Date().toISOString().slice(0, 10)
  const doc: string[] = []
  doc.push('# Frontier Planning Clusters')
  doc.push('')
  doc.push(`*A planning-oriented synthesis derived from the ${stats.n_frontiers} synthesized research frontiers in the RMBL Knowledge Commons. Generated ${now}.*`)
  doc.push('')

  doc.push('## What This Is')
  doc.push('')
  doc.push(`Each of the ${stats.n_frontiers} Frontiers in the Knowledge Commons exposes five kinds of structured planning content: concrete **actions** (what to do), key **questions** (what to answer), **data gaps** (what records are missing), **barriers** (what is blocking progress), and **impacts** (what management decisions depend on the work). This report flattens all five into atomic items (${stats.n_items.toLocaleString()} total), embeds them, clusters each type independently by Louvain community detection on a cosine-similarity graph, and uses an LLM to synthesize a representative title plus 5-10 distilled key items for each substantial cluster. The five sections below rank clusters by leverage — size × breadth × tactical weight — to surface what kinds of investment, scientific organization, data infrastructure, institutional unblocking, and stakeholder alignment would push the most frontiers forward at once.`)
  doc.push('')

  // Methods note
  doc.push('## Methods Note')
  doc.push('')
  doc.push('- **Items**: actions, data gaps, and questions are extracted directly from each frontier\'s structured JSONB fields. Barriers and impacts are LLM-extracted (Claude Sonnet 4.6) from each frontier\'s prose narrative into atomic statements.')
  doc.push('- **Embedding**: Voyage AI voyage-4 (1024 dimensions).')
  doc.push('- **Clustering**: Louvain on an undirected cosine-similarity graph (edge threshold τ=0.65; modularity resolution 3.0; edge weights = excess over threshold). Each item type is clustered independently because syntactic shape causes types to self-segregate when mixed.')
  doc.push('- **Descriptions**: Claude Opus 4.7 produces a synthesized title, narrative summary, and 5-10 distilled key items per cluster. Titles take the syntactic form of the source items (imperative for actions, interrogative for questions, noun-phrase for the other three).')
  doc.push(`- **Leverage scores**: \`institutional_score = sum(tactical_weight) × distinct_frontier_count\`; \`partnership_score = sum(1 - tactical_weight) × distinct_frontier_count\`. Tactical weight per action: near-term=1.0, ambitious=0.7, major=0.3, consortium=0.1. Non-action items default to 0.7. Only clusters with ≥${MIN_ITEMS} items are shown.`)
  doc.push('')
  doc.push('## Corpus at a Glance')
  doc.push('')
  doc.push('| Item type | Items | Clusters described / total |')
  doc.push('|---|---:|---:|')
  for (const t of typeStats) {
    doc.push(`| ${t.item_type} | ${Number(t.items).toLocaleString()} | ${t.described} / ${t.total} |`)
  }
  doc.push('')
  doc.push('---')
  doc.push('')

  // Toc
  doc.push('## Contents')
  doc.push('')
  let sectionIdx = 0
  for (const sec of SECTIONS) {
    sectionIdx++
    doc.push(`${sectionIdx}. [${sec.title}](#${sec.title.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '')})`)
  }
  doc.push('')

  // Render each section
  for (const sec of SECTIONS) {
    console.log(`  rendering: ${sec.title}`)
    doc.push(`## ${sec.title}`)
    doc.push('')
    doc.push(sec.blurb)
    doc.push('')

    const { rows: clusters } = await db.query<ClusterRow>(
      `SELECT id, item_type, title, summary, key_items::text AS key_items_str,
              item_count, frontier_count,
              institutional_score::float AS institutional_score,
              partnership_score::float AS partnership_score,
              effort_distribution, category_distribution
       FROM frontier_planning_clusters
       WHERE ${sec.where} AND title IS NOT NULL AND item_count >= $1
       ORDER BY ${sec.orderBy}
       LIMIT $2`,
      [MIN_ITEMS, TOP_N],
    )
    // Coerce key_items_str (jsonb arrives as string in some drivers / typing)
    const parsed = clusters.map((c: any) => ({
      ...c,
      key_items: typeof c.key_items_str === 'string' ? JSON.parse(c.key_items_str) : (c.key_items || []),
    }))

    // Fetch contributors in one query
    const ids = parsed.map((c) => c.id)
    const contribByCluster = new Map<number, FrontierContribution[]>()
    if (ids.length > 0) {
      const { rows: contribs } = await db.query(
        `SELECT i.cluster_id, f.title AS frontier_title, count(*)::int AS n
         FROM frontier_planning_items i
         JOIN frontiers f ON f.id = i.frontier_id
         WHERE i.cluster_id = ANY($1)
         GROUP BY i.cluster_id, f.title
         ORDER BY i.cluster_id, n DESC`,
        [ids],
      )
      for (const r of contribs) {
        const cid = r.cluster_id
        if (!contribByCluster.has(cid)) contribByCluster.set(cid, [])
        contribByCluster.get(cid)!.push({ cluster_id: cid, frontier_title: r.frontier_title, n: r.n })
      }
    }

    let rankIdx = 0
    for (const c of parsed) {
      rankIdx++
      doc.push(`#### ${rankIdx}. ${c.title}`)
      doc.push('')
      // Use a slightly different metadata line than renderCluster (drop the title h3)
      const meta: string[] = []
      meta.push(`**${c.item_count}** items across **${c.frontier_count}** frontiers`)
      meta.push(`institutional=${Math.round(c.institutional_score)}, partnership=${Math.round(c.partnership_score)}`)
      if (c.item_type === 'action') {
        const eff = distString(c.effort_distribution)
        const cat = distString(c.category_distribution)
        if (eff) meta.push(`effort: ${eff}`)
        if (cat) meta.push(`category: ${cat}`)
      }
      doc.push(`> ${meta.join(' · ')}`)
      doc.push('')
      doc.push(c.summary)
      doc.push('')
      doc.push('**Key items:**')
      doc.push('')
      for (const item of c.key_items) doc.push(`- ${item}`)
      doc.push('')
      doc.push('**Top contributing frontiers:**')
      doc.push('')
      const contribs = contribByCluster.get(c.id) || []
      for (const f of contribs.slice(0, 6)) {
        doc.push(`- *${f.frontier_title}* (${f.n} item${f.n !== 1 ? 's' : ''})`)
      }
      doc.push('')
    }

    doc.push('---')
    doc.push('')
  }

  // Footer
  doc.push('')
  doc.push(`*Report generated by \`scripts/generate-planning-report.ts\` on ${now}. Top ${TOP_N} clusters per ranking, minimum ${MIN_ITEMS} items per cluster.*`)
  doc.push('')

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, doc.join('\n'))
  console.log(`\nWrote ${OUT_PATH} (${doc.length} lines)`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
