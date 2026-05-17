import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { ENTITY_SLUG_MAP } from '../../lib/graph-colors'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [f] } = await getDb().query(
    `SELECT title, cross_cutting_summary FROM frontiers WHERE id = $1`,
    [parseInt(id)],
  )
  if (!f) return { title: 'Frontier — RMBL Knowledge Fabric' }
  const desc = f.cross_cutting_summary?.slice(0, 200) || 'Research frontier in the RMBL Knowledge Fabric'
  return {
    title: `${f.title} — RMBL Knowledge Fabric`,
    description: desc,
    openGraph: {
      title: f.title,
      description: desc,
      url: `https://rmblknowledgefabric.org/frontiers/${id}`,
    },
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  data: 'Data', experiment: 'Experiment', model: 'Model', synthesis: 'Synthesis',
  framework: 'Framework', infrastructure: 'Infrastructure', collaboration: 'Collaboration',
  other: 'Other',
}
const CATEGORY_ORDER = ['data', 'experiment', 'model', 'synthesis', 'framework', 'infrastructure', 'collaboration', 'other']

const EFFORT_COLORS: Record<string, string> = {
  'near-term': '#5a7a4a',
  'ambitious': '#7a6a3a',
  'major': '#a8693f',
  'consortium': '#a8423f',
}

function mgmtBadge(score: number | null): { label: string; color: string } | null {
  if (score == null) return null
  if (score >= 2.7) return { label: 'Regulatory leverage', color: '#a8423f' }
  if (score >= 2.0) return { label: 'Direct mgmt', color: '#a8693f' }
  if (score >= 1.0) return { label: 'Indirect mgmt', color: '#7a7a4a' }
  return { label: 'Basic science', color: '#5a6a7a' }
}

interface FrontierRow {
  id: number
  cluster_id: number
  slug: string
  title: string
  context: string | null
  frontier_description: string | null
  barriers: string | null
  research_opportunities: string | null
  impacts: string | null
  cross_cutting_summary: string | null
  tractability: string | null
  framing_notes: string | null
  key_questions: string[]
  pushing_the_frontier: { category: string; effort: string; action: string }[]
  data_gaps: string[]
  avg_management_relevance: number | null
  source_cluster_size: number
  source_neighborhoods: number
}

async function fetchLinkedEntities(db: any, frontierId: number) {
  // entities table is polymorphic; resolve names per entity type
  const { rows: links } = await db.query(
    `SELECT entity_type, entity_id, weight FROM frontier_entities WHERE frontier_id = $1 ORDER BY weight DESC`,
    [frontierId],
  )
  const byType: Record<string, { id: number; weight: number }[]> = {}
  for (const l of links) {
    (byType[l.entity_type] ||= []).push({ id: l.entity_id, weight: Number(l.weight) })
  }
  const resolved: Record<string, { id: number; name: string; weight: number }[]> = {}
  const tableMap: Record<string, [string, string]> = {
    concept: ['concepts', 'name'], protocol: ['protocols', 'name'],
    species: ['species', 'canonical_name'], place: ['places', 'name'],
    stakeholder: ['stakeholders', 'name'], author: ['authors', 'display_name'],
    publication: ['publications', 'title'], dataset: ['datasets', 'title'],
    document: ['documents', 'title'], project: ['projects', 'name'],
  }
  for (const [etype, items] of Object.entries(byType)) {
    const [table, col] = tableMap[etype] || []
    if (!table) continue
    const ids = items.map((i) => i.id)
    const wMap = new Map(items.map((i) => [i.id, i.weight]))
    const { rows } = await db.query(`SELECT id, ${col} AS name FROM ${table} WHERE id = ANY($1)`, [ids])
    resolved[etype] = rows
      .map((r: any) => ({ id: r.id, name: r.name, weight: wMap.get(r.id) || 0 }))
      .sort((a: any, b: any) => b.weight - a.weight)
  }
  return resolved
}

async function fetchSources(db: any, frontierId: number) {
  const { rows: stmts } = await db.query(
    `SELECT fss.id, fss.neighborhood_id, fss.statement_text, fss.management_relevance,
            n.title AS neighborhood_title
     FROM frontier_source_statements fss
     JOIN neighborhoods n ON n.id = fss.neighborhood_id
     WHERE fss.frontier_id = $1
     ORDER BY n.id, fss.id`,
    [frontierId],
  )
  // Group by neighborhood
  const byNbr = new Map<number, { title: string; statements: any[] }>()
  for (const s of stmts) {
    if (!byNbr.has(s.neighborhood_id)) byNbr.set(s.neighborhood_id, { title: s.neighborhood_title, statements: [] })
    byNbr.get(s.neighborhood_id)!.statements.push(s)
  }
  return [...byNbr.entries()]
    .map(([id, info]) => ({ id, title: info.title, statements: info.statements }))
    .sort((a, b) => b.statements.length - a.statements.length)
}

export default async function FrontierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const fid = parseInt(id)
  if (isNaN(fid)) notFound()

  const db = getDb()
  const { rows: [f] } = await db.query(
    `SELECT * FROM frontiers WHERE id = $1`,
    [fid],
  )
  if (!f) notFound()

  const frontier = f as FrontierRow
  const [entities, sources] = await Promise.all([
    fetchLinkedEntities(db, fid),
    fetchSources(db, fid),
  ])
  const badge = mgmtBadge(frontier.avg_management_relevance != null ? Number(frontier.avg_management_relevance) : null)

  // Group pushing_the_frontier by category
  const actionsByCategory = new Map<string, typeof frontier.pushing_the_frontier>()
  for (const a of frontier.pushing_the_frontier || []) {
    const cat = a.category || 'other'
    if (!actionsByCategory.has(cat)) actionsByCategory.set(cat, [])
    actionsByCategory.get(cat)!.push(a)
  }

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <Link href="/frontiers" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; All frontiers</Link>

      <div style={{ marginTop: '12px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {badge && (
            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: badge.color, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {badge.label}
            </span>
          )}
          {frontier.source_neighborhoods >= 6 && (
            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: '#3a6b7b', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Cross-cutting
            </span>
          )}
          {frontier.tractability && (
            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              {frontier.tractability} tractability
            </span>
          )}
        </div>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 10px', lineHeight: 1.25 }}>
          {frontier.title}
        </h1>
        {frontier.cross_cutting_summary && (
          <p style={{ fontSize: '15px', lineHeight: 1.5, color: 'var(--color-text-secondary)', fontStyle: 'italic', maxWidth: '70ch', margin: 0 }}>
            {frontier.cross_cutting_summary}
          </p>
        )}
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
          Built from {frontier.source_cluster_size} statements across {frontier.source_neighborhoods} neighborhood{frontier.source_neighborhoods !== 1 ? 's' : ''}
        </div>
      </div>

      {frontier.context && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Context</h2>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--color-text-primary)', maxWidth: '70ch', margin: 0 }}>
            {frontier.context}
          </p>
        </section>
      )}

      {frontier.frontier_description && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Frontier</h2>
          {frontier.frontier_description.split(/\n\n+/).map((para, i) => (
            <p key={i} style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--color-text-primary)', maxWidth: '70ch', margin: '0 0 12px' }}>{para}</p>
          ))}
        </section>
      )}

      {(frontier.key_questions?.length || 0) > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Key questions</h2>
          <ul style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text-primary)', maxWidth: '70ch', paddingLeft: '20px', margin: 0 }}>
            {frontier.key_questions.map((q, i) => (<li key={i} style={{ marginBottom: '6px' }}>{q}</li>))}
          </ul>
        </section>
      )}

      {frontier.barriers && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Barriers</h2>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--color-text-primary)', maxWidth: '70ch', margin: 0 }}>{frontier.barriers}</p>
        </section>
      )}

      {frontier.research_opportunities && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Research opportunities</h2>
          {frontier.research_opportunities.split(/\n\n+/).map((para, i) => (
            <p key={i} style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--color-text-primary)', maxWidth: '70ch', margin: '0 0 12px' }}>{para}</p>
          ))}
        </section>
      )}

      {actionsByCategory.size > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>Pushing the frontier</h2>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            Concrete, fundable actions categorized by kind of work and effort tier
            (<em>near-term</em> = single lab; <em>ambitious</em> = focused multi-year program;{' '}
            <em>major</em> = multi-institutional; <em>consortium</em> = agency-program scale).
          </p>
          {CATEGORY_ORDER.filter((c) => actionsByCategory.has(c)).map((cat) => (
            <div key={cat} style={{ marginBottom: '14px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 6px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {CATEGORY_LABELS[cat]}
              </h3>
              <ul style={{ fontSize: '14px', lineHeight: 1.55, color: 'var(--color-text-primary)', maxWidth: '74ch', paddingLeft: '20px', margin: 0 }}>
                {actionsByCategory.get(cat)!.map((a, i) => (
                  <li key={i} style={{ marginBottom: '8px' }}>
                    <span style={{
                      display: 'inline-block', fontSize: '10px', padding: '1px 6px',
                      borderRadius: '3px', background: EFFORT_COLORS[a.effort] || '#888',
                      color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em',
                      marginRight: '6px', verticalAlign: '1px',
                    }}>{a.effort}</span>
                    {a.action}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {(frontier.data_gaps?.length || 0) > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Data gaps surfaced in source statements</h2>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
            Descriptions of needed data (not existing datasets), drawn directly from the atomic
            statements feeding this frontier.
          </p>
          <ul style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-secondary)', maxWidth: '74ch', paddingLeft: '20px', margin: 0 }}>
            {frontier.data_gaps.slice(0, 30).map((g, i) => (<li key={i} style={{ marginBottom: '4px' }}>{g}</li>))}
          </ul>
        </section>
      )}

      {frontier.impacts && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Impacts</h2>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--color-text-primary)', maxWidth: '70ch', margin: 0 }}>{frontier.impacts}</p>
        </section>
      )}

      {Object.keys(entities).length > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>Linked entities</h2>
          {['concept', 'protocol', 'species', 'place', 'stakeholder', 'author', 'publication', 'dataset', 'document', 'project'].filter((t) => entities[t]?.length > 0).map((etype) => {
            const items = entities[etype]
            const slug = ENTITY_SLUG_MAP[etype] || `${etype}s`
            return (
              <div key={etype} style={{ marginBottom: '12px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: 600, margin: '0 0 6px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {etype}s ({items.length})
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {items.slice(0, 12).map((e) => (
                    <Link
                      key={e.id}
                      href={`/${slug}/${e.id}`}
                      style={{
                        fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                        color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap',
                        maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                      title={e.name}
                    >
                      {e.name.length > 50 ? e.name.slice(0, 48) + '…' : e.name}
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {sources.length > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px' }}>Sources</h2>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            Every claim in the synthesis above derives from the source atomic statements below,
            grouped by their research neighborhood of origin. Click a neighborhood to follow its
            primer and full citation chain.
          </p>
          {sources.map((src) => (
            <details key={src.id} style={{ marginBottom: '10px', padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                <Link href={`/neighborhoods/${src.id}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
                  {src.title}
                </Link>
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: '6px' }}>
                  — {src.statements.length} statement{src.statements.length !== 1 ? 's' : ''}
                </span>
              </summary>
              <ul style={{ fontSize: '13px', lineHeight: 1.55, color: 'var(--color-text-secondary)', paddingLeft: '20px', margin: '8px 0 0' }}>
                {src.statements.map((s: any) => (
                  <li key={s.id} style={{ marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginRight: '4px' }}>
                      (mgmt={s.management_relevance ?? '?'})
                    </span>
                    {s.statement_text}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}

      {frontier.framing_notes && (
        <section style={{ marginTop: '24px', padding: '12px 16px', borderRadius: 'var(--radius)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: 0 }}>
            <strong>Framing notes:</strong> {frontier.framing_notes}
          </p>
        </section>
      )}
    </div>
  )
}
