import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'
import { GRAPH_COLORS } from '../lib/graph-colors'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Research Frontiers — RMBL Knowledge Fabric',
  description:
    'Synthesized boundaries between what scientists know and what they don\'t, with identifiable paths to push the boundary forward. Drawn from the research neighborhoods of the Rocky Mountain Biological Laboratory and the Gunnison Basin.',
}

const SORT_OPTIONS = [
  { value: 'breadth', label: 'Cross-cutting breadth' },
  { value: 'leverage', label: 'Management leverage' },
  { value: 'size', label: 'Cluster size' },
  { value: 'title', label: 'Title (A-Z)' },
]

function orderBy(sort: string): string {
  switch (sort) {
    case 'leverage': return 'avg_management_relevance DESC NULLS LAST, source_neighborhoods DESC NULLS LAST'
    case 'size': return 'source_cluster_size DESC NULLS LAST'
    case 'title': return 'title ASC'
    default: return 'source_neighborhoods DESC NULLS LAST, avg_management_relevance DESC NULLS LAST'
  }
}

/**
 * Position-on-axis bar — locates a frontier between two qualitative endpoints
 * (e.g. basic↔applied, narrow↔broad). Honest continuous encoding instead of
 * arbitrary bucketing. The marker position reflects value / max linearly.
 */
function AxisBar({
  value, max, leftLabel, rightLabel, valueLabel, scale = 'linear',
}: {
  value: number; max: number; leftLabel: string; rightLabel: string
  valueLabel: string; scale?: 'linear' | 'log'
}) {
  // Log scaling keeps the cluster of low-count frontiers from collapsing
  // against the left edge when the distribution has a long tail.
  const raw = scale === 'log'
    ? Math.log(Math.max(1, value)) / Math.log(Math.max(2, max))
    : value / max
  const pct = Math.max(0, Math.min(1, raw)) * 100
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
      <span style={{ fontStyle: 'italic' }}>{leftLabel}</span>
      <span style={{
        position: 'relative', display: 'inline-block', width: '90px', height: '4px',
        background: 'var(--color-border)', borderRadius: '2px',
      }}>
        <span style={{
          position: 'absolute', left: `${pct.toFixed(0)}%`, top: '50%',
          width: '8px', height: '8px', marginLeft: '-4px', marginTop: '-4px',
          background: 'var(--color-accent)', borderRadius: '50%',
        }} />
      </span>
      <span style={{ fontStyle: 'italic' }}>{rightLabel}</span>
      <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', marginLeft: '2px' }}>
        {valueLabel}
      </span>
    </span>
  )
}

// Inline rollup: a frontier "is in" a top-level topic if ≥3 of its linked
// publications/datasets/documents are tagged with a descendant of that topic.
// The recursive lineage walks the topic.parent_id chain to the true top-level
// ancestor (the tree has 3 levels — GCMD-imported mid-topics nest under the
// 36 canonical top-level topics). Depth-limited at 6 because two legacy
// 2-cycles exist in the data (1125↔9925, 1131↔10178); the limit keeps the
// recursion bounded without needing CYCLE detection.
//
// Materialize as a real table if this gets slow on a larger corpus.
const FRONTIER_TOPICS_CTE = `
  topic_lineage AS (
    SELECT id AS leaf_id, id AS current_id, parent_id, 0 AS depth FROM topics
    UNION ALL
    SELECT tl.leaf_id, p.id, p.parent_id, tl.depth + 1
    FROM topic_lineage tl
    JOIN topics p ON p.id = tl.parent_id
    WHERE tl.parent_id IS NOT NULL AND tl.depth < 6
  ),
  topic_top AS (
    -- For each leaf, prefer the row that reached a true top (parent_id IS NULL);
    -- otherwise the deepest row reached before the safety limit cut us off.
    SELECT DISTINCT ON (leaf_id) leaf_id, current_id AS top_id
    FROM topic_lineage
    ORDER BY leaf_id, (parent_id IS NULL) DESC, depth DESC
  ),
  frontier_entity_topics AS (
    SELECT fe.frontier_id, fe.entity_type, fe.entity_id, pr.topics_id FROM frontier_entities fe
     JOIN publications_rels pr ON pr.parent_id = fe.entity_id
     WHERE fe.entity_type = 'publication' AND pr.topics_id IS NOT NULL
    UNION ALL
    SELECT fe.frontier_id, fe.entity_type, fe.entity_id, dr.topics_id FROM frontier_entities fe
     JOIN datasets_rels dr ON dr.parent_id = fe.entity_id
     WHERE fe.entity_type = 'dataset' AND dr.topics_id IS NOT NULL
    UNION ALL
    SELECT fe.frontier_id, fe.entity_type, fe.entity_id, docr.topics_id FROM frontier_entities fe
     JOIN documents_rels docr ON docr.parent_id = fe.entity_id
     WHERE fe.entity_type = 'document' AND docr.topics_id IS NOT NULL
  ),
  topic_supports AS (
    SELECT fet.frontier_id, tt.top_id,
           count(DISTINCT (fet.entity_type, fet.entity_id)) AS n
    FROM frontier_entity_topics fet
    JOIN topic_top tt ON tt.leaf_id = fet.topics_id
    GROUP BY fet.frontier_id, tt.top_id
  ),
  frontier_top_topics AS (
    -- Two-part dominance test: must clear an absolute noise floor (≥3 supporting
    -- entities) AND be at least 30% as represented as the frontier's strongest
    -- topic. The relative cutoff adapts to frontier size — a small frontier
    -- whose strongest topic has 4 entities won't let in tail topics with 1-2,
    -- while a large frontier's tertiary topics need real support to count.
    SELECT frontier_id, top_id AS top_topic_id
    FROM (
      SELECT *, max(n) OVER (PARTITION BY frontier_id) AS max_n
      FROM topic_supports
    ) s
    WHERE n >= 3 AND n >= 0.30 * max_n
  )
`

export default async function FrontiersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; mgmt?: string; reach?: string; topic?: string; q?: string }>
}) {
  const params = await searchParams
  const sort = params.sort || 'breadth'
  const mgmtFilter = params.mgmt || ''
  const reachFilter = params.reach || ''
  const topicFilter = parseInt(params.topic || '') || null
  const query = (params.q || '').trim().slice(0, 200)

  const db = getDb()

  // Quartile thresholds computed from the corpus — the filter labels
  // ("Most basic", "Most applied", etc.) stay meaningful as the
  // distribution shifts on pipeline re-runs. percentile_cont on the
  // numeric mgmt column (interpolated), percentile_disc on the integer
  // breadth column (returns an actual data value, so threshold compares
  // cleanly with integer source_neighborhoods).
  const { rows: [pct] } = await db.query(`
    SELECT
      percentile_cont(0.25) WITHIN GROUP (ORDER BY avg_management_relevance) AS m25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY avg_management_relevance) AS m50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY avg_management_relevance) AS m75,
      percentile_disc(0.25) WITHIN GROUP (ORDER BY source_neighborhoods)     AS r25,
      percentile_disc(0.50) WITHIN GROUP (ORDER BY source_neighborhoods)     AS r50,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY source_neighborhoods)     AS r75,
      max(source_neighborhoods)                                              AS max_reach
    FROM frontiers
  `)
  const m25 = Number(pct.m25) || 0
  const m50 = Number(pct.m50) || 0
  const m75 = Number(pct.m75) || 0
  const r25 = Number(pct.r25) || 0
  const r50 = Number(pct.r50) || 0
  const r75 = Number(pct.r75) || 0
  const maxReach = Number(pct.max_reach) || 1

  function mgmtClause(filter: string): string {
    switch (filter) {
      case 'mgmt-q1': return `avg_management_relevance < ${m25}`
      case 'mgmt-q2': return `avg_management_relevance >= ${m25} AND avg_management_relevance < ${m50}`
      case 'mgmt-q3': return `avg_management_relevance >= ${m50} AND avg_management_relevance < ${m75}`
      case 'mgmt-q4': return `avg_management_relevance >= ${m75}`
      default: return 'TRUE'
    }
  }
  function reachClause(filter: string): string {
    switch (filter) {
      case 'reach-q1': return `source_neighborhoods <= ${r25}`
      case 'reach-q2': return `source_neighborhoods > ${r25} AND source_neighborhoods <= ${r50}`
      case 'reach-q3': return `source_neighborhoods > ${r50} AND source_neighborhoods <= ${r75}`
      case 'reach-q4': return `source_neighborhoods > ${r75}`
      default: return 'TRUE'
    }
  }

  // Filter labels: thematic name + numeric cutoff range (so users know
  // exactly what they're slicing — quartile labels alone would be opaque)
  const MGMT_OPTIONS = [
    { value: 'mgmt-q1', label: `Most basic (<${m25.toFixed(2)})` },
    { value: 'mgmt-q2', label: `Leans basic (${m25.toFixed(2)}–${m50.toFixed(2)})` },
    { value: 'mgmt-q3', label: `Leans applied (${m50.toFixed(2)}–${m75.toFixed(2)})` },
    { value: 'mgmt-q4', label: `Most applied (≥${m75.toFixed(2)})` },
  ]
  const REACH_OPTIONS = [
    { value: 'reach-q1', label: `Most focused (≤${r25} nbr${r25 !== 1 ? 's' : ''})` },
    { value: 'reach-q2', label: r25 === r50 ? `Leans focused (=${r50})` : `Leans focused (${r25 + 1}–${r50})` },
    { value: 'reach-q3', label: r50 === r75 ? `Leans cross-cutting (=${r75})` : `Leans cross-cutting (${r50 + 1}–${r75})` },
    { value: 'reach-q4', label: `Most cross-cutting (>${r75} nbrs)` },
  ]

  const topicClause = topicFilter
    ? `id IN (SELECT frontier_id FROM frontier_top_topics WHERE top_topic_id = ${topicFilter})`
    : 'TRUE'
  // ILIKE across the human-written narrative fields. Corpus is small (<200
  // rows) so no tsvector indexing needed; the $1 binding handles escaping.
  const searchClause = query
    ? `(title ILIKE $1 OR cross_cutting_summary ILIKE $1 OR frontier_description ILIKE $1 OR context ILIKE $1)`
    : 'TRUE'
  const searchValues = query ? [`%${query}%`] : []

  const { rows } = await db.query(
    `WITH RECURSIVE ${FRONTIER_TOPICS_CTE}
     SELECT id, slug, title, cross_cutting_summary,
            source_cluster_size, source_neighborhoods, avg_management_relevance,
            jsonb_array_length(coalesce(pushing_the_frontier, '[]'::jsonb)) AS action_count,
            jsonb_array_length(coalesce(key_questions, '[]'::jsonb)) AS question_count
     FROM frontiers
     WHERE ${mgmtClause(mgmtFilter)} AND ${reachClause(reachFilter)} AND ${topicClause} AND ${searchClause}
     ORDER BY ${orderBy(sort)}`,
    searchValues,
  )
  const { rows: [{ total }] } = await db.query(`SELECT count(*)::int AS total FROM frontiers`)

  // Strongest-link highlights: up to 5 chips per frontier from the thematic
  // entity types only (species/concept/place/protocol). Authors, stakeholders,
  // publications, datasets, and documents are provenance signals — they tell
  // you who's involved with the frontier but not what it's *about*. Excluded
  // here; they remain visible on the detail page's Linked Entities section.
  //
  // Within the thematic pool, we rank each entity within its type by weight
  // (since cross-type weights aren't comparable — species median 848 vs
  // concept median 1), then take top-5 by per-type rank with weight DESC as
  // tiebreaker. A species-heavy frontier ends up with multiple species chips;
  // a balanced frontier gets one of each type.
  type Highlight = { type: string; id: number; name: string }
  const ENTITY_TABLE_MAP: Record<string, [string, string]> = {
    species: ['species', 'canonical_name'],
    concept: ['concepts', 'name'],
    place: ['places', 'name'],
    protocol: ['protocols', 'name'],
  }
  const highlightsByFrontier = new Map<number, Highlight[]>()
  if (rows.length > 0) {
    const frontierIds = rows.map((r: any) => r.id)
    const { rows: topEntities } = await db.query(
      `WITH ranked AS (
         SELECT frontier_id, entity_type, entity_id, weight,
                row_number() OVER (PARTITION BY frontier_id, entity_type ORDER BY weight DESC, entity_id ASC) AS type_rn
         FROM frontier_entities
         WHERE frontier_id = ANY($1) AND entity_type = ANY($2)
       ),
       overall AS (
         SELECT *,
                row_number() OVER (PARTITION BY frontier_id ORDER BY type_rn ASC, weight DESC, entity_type ASC) AS overall_rn
         FROM ranked WHERE type_rn <= 5
       )
       SELECT frontier_id, entity_type, entity_id, overall_rn
       FROM overall WHERE overall_rn <= 5
       ORDER BY frontier_id, overall_rn ASC`,
      [frontierIds, Object.keys(ENTITY_TABLE_MAP)],
    )
    const idsByType = new Map<string, Set<number>>()
    for (const tp of topEntities) {
      if (!idsByType.has(tp.entity_type)) idsByType.set(tp.entity_type, new Set())
      idsByType.get(tp.entity_type)!.add(tp.entity_id)
    }
    const namesByTypeAndId = new Map<string, Map<number, string>>()
    await Promise.all(
      Array.from(idsByType.entries()).map(async ([type, ids]) => {
        const [table, col] = ENTITY_TABLE_MAP[type]
        const { rows: nameRows } = await db.query(
          `SELECT id, ${col} AS name FROM ${table} WHERE id = ANY($1)`,
          [Array.from(ids)],
        )
        const m = new Map<number, string>()
        for (const r of nameRows) m.set(r.id, r.name)
        namesByTypeAndId.set(type, m)
      }),
    )
    for (const tp of topEntities) {
      const name = namesByTypeAndId.get(tp.entity_type)?.get(tp.entity_id)
      if (!name || /^(unknown|other|n\/a)$/i.test(name)) continue
      const list = highlightsByFrontier.get(tp.frontier_id) || []
      list.push({ type: tp.entity_type, id: tp.entity_id, name })
      highlightsByFrontier.set(tp.frontier_id, list)
    }
  }

  // Per-topic counts for the sidebar (full corpus — independent of mgmt/reach filters
  // so the user sees the absolute size of each domain). "Other" (id=9) is a
  // catch-all not a real domain; excluded from the filter list.
  const { rows: topicRows } = await db.query(`
    WITH RECURSIVE ${FRONTIER_TOPICS_CTE}
    SELECT t.id, t.name, count(DISTINCT ftt.frontier_id)::int AS n
    FROM topics t
    LEFT JOIN frontier_top_topics ftt ON ftt.top_topic_id = t.id
    WHERE t.parent_id IS NULL AND t.id <> 9
    GROUP BY t.id, t.name
    HAVING count(DISTINCT ftt.frontier_id) > 0
    ORDER BY n DESC, t.name`)

  // Per-filter counts for the sidebar (computed against the full corpus
  // so the same quartile boundaries show their unconditional size, not
  // a count narrowed by the other axis's current filter)
  const { rows: filterCounts } = await db.query(`
    SELECT
      count(*) FILTER (WHERE avg_management_relevance < $1) AS mgmt_q1,
      count(*) FILTER (WHERE avg_management_relevance >= $1 AND avg_management_relevance < $2) AS mgmt_q2,
      count(*) FILTER (WHERE avg_management_relevance >= $2 AND avg_management_relevance < $3) AS mgmt_q3,
      count(*) FILTER (WHERE avg_management_relevance >= $3) AS mgmt_q4,
      count(*) FILTER (WHERE source_neighborhoods <= $4) AS reach_q1,
      count(*) FILTER (WHERE source_neighborhoods > $4 AND source_neighborhoods <= $5) AS reach_q2,
      count(*) FILTER (WHERE source_neighborhoods > $5 AND source_neighborhoods <= $6) AS reach_q3,
      count(*) FILTER (WHERE source_neighborhoods > $6) AS reach_q4
    FROM frontiers`, [m25, m50, m75, r25, r50, r75])
  const counts: Record<string, number> = {
    'mgmt-q1': filterCounts[0].mgmt_q1,
    'mgmt-q2': filterCounts[0].mgmt_q2,
    'mgmt-q3': filterCounts[0].mgmt_q3,
    'mgmt-q4': filterCounts[0].mgmt_q4,
    'reach-q1': filterCounts[0].reach_q1,
    'reach-q2': filterCounts[0].reach_q2,
    'reach-q3': filterCounts[0].reach_q3,
    'reach-q4': filterCounts[0].reach_q4,
  }

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (sort !== 'breadth') next.set('sort', sort)
    if (mgmtFilter) next.set('mgmt', mgmtFilter)
    if (reachFilter) next.set('reach', reachFilter)
    if (topicFilter) next.set('topic', String(topicFilter))
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === '') next.delete(k)
      else next.set(k, v)
    }
    const s = next.toString()
    return s ? `/frontiers?${s}` : '/frontiers'
  }

  const activeTopicName = topicFilter ? topicRows.find((t: any) => t.id === topicFilter)?.name : null
  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>Research Frontiers</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          Synthesized boundaries between what scientists know and what they don't, with identifiable
          paths to push the boundary forward. Each frontier is built from atomic gap-statements
          extracted across the research neighborhoods of the RMBL Knowledge Fabric, then clustered
          by semantic similarity and synthesized into a coherent narrative.
        </p>
        <form className="search-form" action="/frontiers" method="GET">
          <label htmlFor="fr-q" className="sr-only">Search frontiers</label>
          <input id="fr-q" className="search-input" type="text" name="q" aria-label="Search frontiers" defaultValue={query} placeholder="Search frontiers..." />
          {sort !== 'breadth' && <input type="hidden" name="sort" value={sort} />}
          {mgmtFilter && <input type="hidden" name="mgmt" value={mgmtFilter} />}
          {reachFilter && <input type="hidden" name="reach" value={reachFilter} />}
          {topicFilter && <input type="hidden" name="topic" value={String(topicFilter)} />}
          <button className="search-button" type="submit">Search</button>
        </form>
        <p className="results-count" aria-live="polite">
          {rows.length.toLocaleString()} of {total.toLocaleString()} frontiers
          {query ? ` matching "${query}"` : ''}
          {activeTopicName ? ` · ${activeTopicName}` : ''}
        </p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h4>Sort By</h4>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link href={buildUrl({ sort: opt.value })} style={sort === opt.value ? activeStyle : inactiveStyle}>
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Basic ↔ Applied</h4>
            <label>
              <Link href={buildUrl({ mgmt: undefined })} style={!mgmtFilter ? activeStyle : inactiveStyle}>
                All ({total})
              </Link>
            </label>
            {MGMT_OPTIONS.filter((opt) => (counts[opt.value] || 0) > 0).map((opt) => (
              <label key={opt.value}>
                <Link href={buildUrl({ mgmt: opt.value })} style={mgmtFilter === opt.value ? activeStyle : inactiveStyle}>
                  {opt.label} ({counts[opt.value]})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Focused ↔ Cross-cutting</h4>
            <label>
              <Link href={buildUrl({ reach: undefined })} style={!reachFilter ? activeStyle : inactiveStyle}>
                All ({total})
              </Link>
            </label>
            {REACH_OPTIONS.filter((opt) => (counts[opt.value] || 0) > 0).map((opt) => (
              <label key={opt.value}>
                <Link href={buildUrl({ reach: opt.value })} style={reachFilter === opt.value ? activeStyle : inactiveStyle}>
                  {opt.label} ({counts[opt.value]})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Research domain</h4>
            <label>
              <Link href={buildUrl({ topic: undefined })} style={!topicFilter ? activeStyle : inactiveStyle}>
                All ({total})
              </Link>
            </label>
            {topicRows.map((t: any) => (
              <label key={t.id}>
                <Link href={buildUrl({ topic: String(t.id) })} style={topicFilter === t.id ? activeStyle : inactiveStyle}>
                  {t.name} ({t.n})
                </Link>
              </label>
            ))}
          </div>
        </aside>

        <div className="result-cards">
          {rows.map((f: any) => {
            const mgmt = f.avg_management_relevance != null ? Number(f.avg_management_relevance) : null
            const nbrs = f.source_neighborhoods || 0
            return (
              <Link key={f.id} href={`/frontiers/${f.id}`} className="result-card">
                <div className="result-card-header" style={{ marginBottom: '6px' }}>
                  <h3 className="result-card-title">{f.title}</h3>
                </div>
                {f.cross_cutting_summary && (
                  <p className="result-card-snippet">{f.cross_cutting_summary}</p>
                )}
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '20px', rowGap: '6px', marginTop: '10px' }}>
                  {mgmt != null && (
                    <span title={`Average management relevance across ${f.source_cluster_size} source statements (0 = pure basic science; 3 = regulatory/legal decision waiting)`}>
                      <AxisBar
                        value={mgmt}
                        max={3}
                        leftLabel="basic"
                        rightLabel="applied"
                        valueLabel={mgmt.toFixed(2)}
                      />
                    </span>
                  )}
                  <span title={`Number of distinct research neighborhoods this frontier draws statements from (1 = focused on one community; ${maxReach} = corpus-wide maximum, log scale)`}>
                    <AxisBar
                      value={nbrs}
                      max={maxReach}
                      leftLabel="focused"
                      rightLabel="cross-cutting"
                      valueLabel={`${nbrs} of ${maxReach}`}
                      scale="log"
                    />
                  </span>
                </div>
                <div className="result-card-meta" style={{ marginTop: '8px' }}>
                  <span>{f.source_cluster_size} statement{f.source_cluster_size !== 1 ? 's' : ''}</span>
                  <span>{f.question_count} questions</span>
                  <span>{f.action_count} actions</span>
                </div>
                {(highlightsByFrontier.get(f.id) || []).length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '10px' }}>
                    {highlightsByFrontier.get(f.id)!.slice(0, 5).map((h, i) => (
                      <span key={i} style={{
                        padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
                        background: GRAPH_COLORS[h.type] || '#999', color: '#fff',
                        whiteSpace: 'nowrap',
                      }}>
                        {h.name.length > 30 ? h.name.slice(0, 28) + '…' : h.name}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            )
          })}
          {rows.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>
              No frontiers match the current filters. <Link href="/frontiers" style={{ color: 'var(--color-accent)' }}>Clear filters</Link>.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
