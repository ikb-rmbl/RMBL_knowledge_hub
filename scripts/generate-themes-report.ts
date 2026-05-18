/**
 * Generate the cross-lens Frontier Planning Themes report — the synthesis
 * artifact intended for RMBL board, leadership, and select-scientist
 * planning discussions. Output: scripts/output/frontier-planning-themes.md.
 *
 * Structure:
 *   1. What this is + how to use it (audience-facing intro)
 *   2. Methods note (transparent description of the 7-stage pipeline,
 *      with honest strengths and weaknesses)
 *   3. Themes ranked by aggregate leverage. Each theme card:
 *      - Title
 *      - Opportunity statement (invitational)
 *      - Summary
 *      - Planning anchors (concrete distilled items)
 *      - Considerations (honest tradeoffs/limits)
 *      - Cross-lens makeup (which clusters contribute)
 *      - Top contributing frontiers
 *
 * Usage:
 *   npx tsx scripts/generate-themes-report.ts
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import './lib/config.js'

const OUT_PATH = 'scripts/output/frontier-planning-themes.md'

interface ThemeRow {
  id: number
  title: string
  opportunity: string
  summary: string
  planning_anchors: string[]
  considerations: string
  cluster_count: number
  item_count: number
  frontier_count: number
  type_distribution: Record<string, number>
  leverage_score: number
  reach_summary: string | null
  long_reach_anchors: { anchor: string; reach: string }[]
}

interface LongReachOpportunity {
  rank: number
  title: string
  description: string
  reach_scope: string
  contributing_themes: { theme_title: string; theme_id: number | null }[]
}

interface ClusterRow {
  id: number
  item_type: string
  title: string
  item_count: number
}

interface FrontierContribution {
  frontier_title: string
  n: number
}

function formatDistribution(dist: Record<string, number>): string {
  return Object.entries(dist || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}${(v as number) > 1 ? 's' : ''}`)
    .join(' · ')
}

async function main() {
  console.log('Generate cross-lens themes report')
  console.log('=================================')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Corpus stats
  const { rows: [stats] } = await db.query(`
    SELECT
      (SELECT count(*) FROM frontiers)::int AS n_frontiers,
      (SELECT count(*) FROM frontier_planning_items)::int AS n_items,
      (SELECT count(*) FROM frontier_planning_clusters WHERE title IS NOT NULL)::int AS n_clusters,
      (SELECT count(*) FROM frontier_planning_themes WHERE title IS NOT NULL)::int AS n_themes
  `)

  // Themes ranked by leverage
  const { rows: themeRows } = await db.query(`
    SELECT id, title, opportunity, summary,
           planning_anchors::text AS anchors_str, considerations,
           cluster_count, item_count, frontier_count, type_distribution,
           leverage_score::float AS leverage_score,
           reach_summary, long_reach_anchors::text AS long_reach_str
    FROM frontier_planning_themes
    WHERE title IS NOT NULL
    ORDER BY leverage_score DESC
  `)
  const themes: ThemeRow[] = themeRows.map((r: any) => ({
    ...r,
    planning_anchors: typeof r.anchors_str === 'string' ? JSON.parse(r.anchors_str) : (r.planning_anchors || []),
    long_reach_anchors: typeof r.long_reach_str === 'string' ? JSON.parse(r.long_reach_str) : (r.long_reach_anchors || []),
  }))

  // Cross-theme long-reach opportunities (for top-of-report section)
  const { rows: oppRows } = await db.query(`
    SELECT rank, title, description, reach_scope, contributing_themes::text AS contribs_str
    FROM frontier_long_reach_opportunities
    ORDER BY rank
  `)
  const opportunities: LongReachOpportunity[] = oppRows.map((r: any) => ({
    rank: r.rank, title: r.title, description: r.description, reach_scope: r.reach_scope,
    contributing_themes: typeof r.contribs_str === 'string' ? JSON.parse(r.contribs_str) : (r.contributing_themes || []),
  }))

  const now = new Date().toISOString().slice(0, 10)
  const doc: string[] = []

  // ------------------------------- HEADER
  doc.push('# Frontier Planning Themes')
  doc.push('')
  doc.push(`*A cross-lens synthesis derived from the ${stats.n_frontiers} synthesized research frontiers in the RMBL Knowledge Fabric. Intended for RMBL board, leadership, and select-scientist planning conversations. Generated ${now}.*`)
  doc.push('')

  // ------------------------------- WHAT THIS IS
  doc.push('## What this is')
  doc.push('')
  doc.push(`This document presents **${stats.n_themes} cross-lens themes** synthesized from RMBL's planning corpus. Each theme groups together ~5-20 underlying clusters that, taken from different angles, describe the same substantive area RMBL could organize around. Each theme is presented as an invitation: a named opportunity, a framing paragraph, distilled planning anchors, and an honest set of considerations.`)
  doc.push('')
  doc.push('The themes are ranked by aggregate leverage — a rough indicator of how many frontiers a theme touches and how tactically tractable its underlying work is. The ranking is meant to support, not replace, deliberation. Smaller-leverage themes can still be the right strategic choice given fit, momentum, or external opportunity.')
  doc.push('')
  doc.push('**How to read this**: each card stands on its own. You can scan titles and opportunity statements to identify what to discuss, then go deeper into anchors and considerations for the themes that draw attention. The transparent methods note at the end of this section explains how the themes were derived and where the synthesis can fail.')
  doc.push('')

  // ------------------------------- METHODS NOTE
  doc.push('## How these themes were generated')
  doc.push('')
  doc.push('The synthesis is the output of a seven-stage pipeline. Each stage is automated, scripted, and re-runnable. Names of the underlying scripts are noted below for traceability.')
  doc.push('')
  doc.push('**Stage 1 — Frontier synthesis.** The pipeline starts from 98 research *Frontiers* already in the Knowledge Fabric. Each frontier was earlier LLM-synthesized from atomic gap-statements clustered out of the neighborhood primers (the upstream `extract-frontiers` → `cluster-frontiers` → `synthesize-frontiers` chain). Frontiers are narrative artifacts with both structured fields (key questions, pushing-the-frontier actions, data gaps) and prose fields (context, barriers, research opportunities, impacts, framing notes).')
  doc.push('')
  doc.push('**Stage 2 — Atomic-item extraction.** The pipeline flattens five planning-relevant signals out of each frontier into a single polymorphic table of atomic items. Three signals are direct JSONB unpacks (actions, data gaps, questions). Two signals — barriers and impacts — are LLM-extracted from each frontier\'s prose narrative into atomic statements by `extract-frontier-narratives.ts` using Claude Sonnet 4.6. Total: 3,288 items.')
  doc.push('')
  doc.push('**Stage 3 — Embedding.** Each atomic item is embedded as a 1024-dimensional vector via Voyage AI voyage-4 (`embed-frontier-planning-items.ts`). Only the item text is embedded — not its parent-frontier title — so clusters surface "same kind of thing across different frontiers" rather than "items that happen to share a parent."')
  doc.push('')
  doc.push('**Stage 4 — Cluster items by lens.** For each of the five item types independently, the pipeline builds an undirected cosine-similarity graph (edge threshold τ=0.65, weights = excess over threshold) and runs Louvain community detection at resolution 3.0 (`cluster-frontier-planning-items.ts`). Item types are clustered *separately* because their syntactic shape (interrogative for questions, imperative for actions, noun-phrase for data gaps and the others) causes them to self-segregate when mixed — clustering them apart preserves substantive structure rather than reifying syntactic structure. Result: 130 substantial clusters (≥5 items each) distributed across the five lenses.')
  doc.push('')
  doc.push('**Stage 5 — Describe each cluster.** Claude Opus 4.7 reads each cluster and produces a synthesized title, a 4-6 sentence summary, and 5-10 distilled key items (`describe-frontier-planning-clusters.ts`). Titles take the syntactic form of the source items (imperative for actions, etc.). Summaries explicitly link to 2-4 named frontiers that would be advanced by acting on the cluster.')
  doc.push('')
  doc.push('**Stage 6 — Cluster the clusters into themes.** The 130 cluster descriptions (title + summary, ~500 chars each) are re-embedded with voyage-4 and Louvain-clustered at τ=0.70, resolution=2.0 (`cluster-planning-themes.ts`). The descriptions, not the original items, are embedded — this produces *cross-lens themes* where, for instance, an action cluster about "build sensor networks" can group with a barrier cluster about "sparse observations" and a data-gap cluster about "long-term snowmelt records" because all three describe the same substantive area. Result: 12 themes.')
  doc.push('')
  doc.push('**Stage 7 — Synthesize each theme.** Claude Opus 4.7 reads each theme\'s constituent clusters and produces the planning-conversation outputs you see below: a noun-phrase title, an invitational "RMBL has a unique opportunity to..." statement, a framing summary, 5-8 concrete planning anchors, and a candid considerations paragraph (`describe-planning-themes.ts`). The prompt explicitly instructs the model to use invitational rather than directive language, to be honest about tradeoffs and limits, and to stay grounded in the constituent clusters.')
  doc.push('')
  doc.push('**Stage 8 — Reach analysis (per-theme).** A follow-on Opus pass reads each theme\'s synthesized content (opportunity statement, summary, planning anchors, considerations, constituent cluster titles) and produces a "Reach beyond the basin" paragraph plus 3-5 long-reach anchors with the mechanism of reach named explicitly (`analyze-theme-reach.ts`). The prompt instructs the model to be candidly honest when a theme is basin-local — not to manufacture reach.')
  doc.push('')
  doc.push('**Stage 9 — Cross-theme synthesis of long-reach opportunities.** A single Opus call reads all 12 themes\' reach analyses together and produces 5-8 distilled cross-cutting opportunities for the top-of-report "National-to-global opportunities at a glance" section (`synthesize-long-reach-opportunities.ts`). Each opportunity names a specific external influence pathway, identifies its scope (federal / multi-state / continental / global / mixed), and attributes itself to the contributing themes.')
  doc.push('')

  // ------------------------------- STRENGTHS / WEAKNESSES
  doc.push('### Strengths of this approach')
  doc.push('')
  doc.push('- **Surfaces convergences no single reader can hold in mind.** When a substantive area shows up as a top action cluster *and* a top barrier cluster *and* a top data-gap cluster, that convergence is itself a planning signal — and the pipeline brings it to the surface mechanically.')
  doc.push('- **Grounded.** Every theme traces back to concrete clusters, which trace back to concrete atomic items, which trace back to specific frontiers. Any claim can be checked.')
  doc.push('- **Regeneratable.** As the underlying Frontiers change (new ones added, existing ones revised), every stage can be re-run. Cluster IDs and theme IDs are not stable across reruns, but the substantive shape of the corpus comes through.')
  doc.push('- **Transparent.** Every stage is a single script with a stated prompt. There are no hidden human edits.')
  doc.push('- **Lens-aware.** Themes carry their cross-lens distribution explicitly — a theme dominated by impacts reads differently from one dominated by actions, and the synthesis adjusts framing accordingly.')
  doc.push('')
  doc.push('### Honest limitations')
  doc.push('')
  doc.push('- **Multi-stage LLM synthesis compounds biases.** Frontiers are themselves LLM syntheses, atomic items are extracted with LLM prompts (for barriers and impacts), cluster descriptions are LLM-generated, and theme descriptions are LLM-generated again. Each stage smooths and rephrases. A reader should treat the themes as well-organized starting points, not as authoritative claims.')
  doc.push('- **Clusters reflect the prompts that produced them.** Different prompts would surface different patterns. The same is true of every clustering threshold (τ, resolution) — different settings produce different theme structures. We picked settings that produce ~10-15 themes; another choice would produce a different planning surface.')
  doc.push('- **Leverage scoring rewards breadth.** Themes that touch many frontiers score higher than narrow, deep themes. This may favor coordination and synthesis work over focused scientific depth. Use the considerations paragraph to weigh whether a theme\'s shape is genuinely strategic or merely well-distributed.')
  doc.push('- **"Opportunity" framing reflects the corpus, not external demand.** The themes describe what the corpus says RMBL could do well. They do not directly survey what funders, agencies, or scientific communities most need — those signals would have to be brought in separately.')
  doc.push('- **No external validation.** Themes are patterns the pipeline detected, not patterns experts have confirmed. Some may be artifacts of how the corpus was assembled rather than real strategic categories. The cards are designed to surface the underlying clusters so this can be checked by anyone who recognizes the substantive areas.')
  doc.push('- **The pipeline is opinionated about what "planning" means.** It treats planning as the identification of high-leverage substantive areas. It does not address budgeting, hiring, governance, or sequencing — those are separate planning conversations the themes are meant to inform, not replace.')
  doc.push('')

  // ------------------------------- CORPUS STATS
  doc.push('### Corpus at a glance')
  doc.push('')
  doc.push(`- **Source frontiers**: ${stats.n_frontiers}`)
  doc.push(`- **Atomic planning items**: ${stats.n_items.toLocaleString()} (across five lenses: action, question, data gap, barrier, impact)`)
  doc.push(`- **Substantial clusters described**: ${stats.n_clusters}`)
  doc.push(`- **Cross-lens themes**: ${stats.n_themes}`)
  doc.push('')
  doc.push('See the companion inventory document — `frontier-planning-clusters.md` — for the per-lens cluster-level view that feeds into these themes.')
  doc.push('')
  doc.push('---')
  doc.push('')

  // ------------------------------- LONG-REACH OPPORTUNITIES (top-of-report)
  if (opportunities.length > 0) {
    doc.push('## National-to-global opportunities at a glance')
    doc.push('')
    doc.push('RMBL\'s home is the Gunnison Basin, but several themes in this report carry RMBL\'s work into state, national, and global science and policy. The opportunities below are distilled across themes: each names a specific external influence pathway and identifies which themes contribute to it. They are ranked by aggregate reach and cross-theme leverage. Each entry links to the underlying themes for the deeper conversation.')
    doc.push('')
    doc.push('*Per-theme "Reach beyond the basin" sections (in the theme cards below) provide the grounding evidence for each opportunity.*')
    doc.push('')
    for (const opp of opportunities) {
      doc.push(`### ${opp.rank}. ${opp.title}`)
      doc.push('')
      doc.push(`> *Scope: ${opp.reach_scope}* · *Cuts across ${opp.contributing_themes.length} theme${opp.contributing_themes.length !== 1 ? 's' : ''}*`)
      doc.push('')
      doc.push(opp.description)
      doc.push('')
      if (opp.contributing_themes.length > 0) {
        doc.push('**Contributing themes:**')
        doc.push('')
        for (const ct of opp.contributing_themes) {
          doc.push(`- *${ct.theme_title}*`)
        }
        doc.push('')
      }
    }
    doc.push('---')
    doc.push('')
  }

  // ------------------------------- TOC
  doc.push('## Themes')
  doc.push('')
  doc.push('Ranked by aggregate leverage (sum of constituent cluster institutional scores). Skim titles and opportunity statements first; go deeper into anchors and considerations for what draws attention.')
  doc.push('')
  let tocIdx = 0
  for (const t of themes) {
    tocIdx++
    doc.push(`${tocIdx}. **${t.title}** — ${t.cluster_count} clusters · ${t.frontier_count} frontiers · ${formatDistribution(t.type_distribution)}`)
  }
  doc.push('')
  doc.push('---')
  doc.push('')

  // ------------------------------- THEME CARDS
  for (let i = 0; i < themes.length; i++) {
    const t = themes[i]
    process.stdout.write(`  rendering theme ${i + 1}/${themes.length}: ${t.title.slice(0, 60)}\n`)

    doc.push(`## ${i + 1}. ${t.title}`)
    doc.push('')
    doc.push(`> ${t.opportunity}`)
    doc.push('')
    doc.push(`*${t.cluster_count} constituent clusters · ${t.item_count} atomic items · ${t.frontier_count} distinct frontiers · cross-lens makeup: ${formatDistribution(t.type_distribution)}*`)
    doc.push('')
    doc.push(t.summary)
    doc.push('')
    doc.push('**Planning anchors**')
    doc.push('')
    for (const a of t.planning_anchors) doc.push(`- ${a}`)
    doc.push('')
    doc.push('**Considerations**')
    doc.push('')
    doc.push(t.considerations)
    doc.push('')

    // Reach beyond the basin
    if (t.reach_summary) {
      doc.push('**Reach beyond the basin**')
      doc.push('')
      doc.push(t.reach_summary)
      doc.push('')
      if (t.long_reach_anchors && t.long_reach_anchors.length > 0) {
        doc.push('*Specific long-reach anchors:*')
        doc.push('')
        for (const a of t.long_reach_anchors) {
          doc.push(`- **${a.anchor}**`)
          doc.push(`  → ${a.reach}`)
        }
        doc.push('')
      }
    }

    // Constituent clusters (grouped by lens)
    const { rows: clusters } = await db.query<ClusterRow>(
      `SELECT id, item_type, title, item_count
       FROM frontier_planning_clusters
       WHERE theme_id = $1 AND title IS NOT NULL
       ORDER BY item_type, item_count DESC`,
      [t.id],
    )
    if (clusters.length > 0) {
      doc.push('<details>')
      doc.push('<summary><b>Constituent clusters (which underlying clusters group into this theme)</b></summary>')
      doc.push('')
      const byType = new Map<string, ClusterRow[]>()
      for (const c of clusters) {
        if (!byType.has(c.item_type)) byType.set(c.item_type, [])
        byType.get(c.item_type)!.push(c)
      }
      for (const [type, cls] of [...byType.entries()].sort()) {
        doc.push(`**${type}** (${cls.length})`)
        doc.push('')
        for (const c of cls) doc.push(`- *${c.title}* (${c.item_count} items)`)
        doc.push('')
      }
      doc.push('</details>')
      doc.push('')
    }

    // Top contributing frontiers
    const { rows: contribs } = await db.query<FrontierContribution>(
      `SELECT f.title AS frontier_title, count(*)::int AS n
       FROM frontier_planning_items i
       JOIN frontier_planning_clusters c ON c.id = i.cluster_id
       JOIN frontiers f ON f.id = i.frontier_id
       WHERE c.theme_id = $1
       GROUP BY f.title ORDER BY n DESC LIMIT 10`,
      [t.id],
    )
    if (contribs.length > 0) {
      doc.push('<details>')
      doc.push('<summary><b>Top contributing frontiers</b></summary>')
      doc.push('')
      for (const f of contribs) {
        doc.push(`- *${f.frontier_title}* (${f.n} items)`)
      }
      doc.push('</details>')
      doc.push('')
    }

    doc.push('---')
    doc.push('')
  }

  // ------------------------------- FOOTER
  doc.push('')
  doc.push(`*Report generated by \`scripts/generate-themes-report.ts\` on ${now}.*`)
  doc.push('')

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, doc.join('\n'))
  console.log(`\nWrote ${OUT_PATH} (${doc.length} lines)`)

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
