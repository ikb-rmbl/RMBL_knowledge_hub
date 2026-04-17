import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from './lib/badges'
import { GRAPH_COLORS } from './lib/graph-colors'
import { getDb } from './lib/db'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config })
  const db = getDb()

  // Fetch counts for each collection
  const [docCount, pubCount, dataCount, authorCount] = await Promise.all([
    payload.count({ collection: 'documents' }),
    payload.count({ collection: 'publications' }),
    payload.count({ collection: 'datasets' }),
    payload.count({ collection: 'authors' }),
  ])

  // Fetch entity + cross-link counts from custom tables
  const { rows: [entityStats] } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM species WHERE publication_count > 0) as species,
      (SELECT COUNT(*) FROM places WHERE publication_count > 0) as places,
      (SELECT COUNT(*) FROM protocols) as protocols,
      (SELECT COUNT(*) FROM concepts WHERE publication_count > 0) as concepts,
      (SELECT COUNT(*) FROM projects) as projects,
      (SELECT COUNT(*) FROM entity_mentions) as cross_links,
      (SELECT COUNT(*) FROM references_cited WHERE link_type = 'internal') as citations
  `)

  // Load pre-computed data files
  const { readFileSync } = await import('fs')
  const { join } = await import('path')

  // Communities (knowledge neighborhoods) — from DB, with fallback to JSON file
  let communities: any[] = []
  try {
    const { rows } = await db.query('SELECT id, title, summary, size, type_counts, top_by_type, themes FROM neighborhoods ORDER BY size DESC')
    communities = rows.map((r: any) => ({ ...r, topByType: r.top_by_type, typeCounts: r.type_counts }))
  } catch {
    try {
      const commData = JSON.parse(readFileSync(join(process.cwd(), 'public/graph/communities.json'), 'utf-8'))
      communities = commData.communities || []
    } catch {}
  }

  // Graph stats for explore cards
  const graphStats: { type: string; label: string; href: string; nodes: number; edges: number; description: string }[] = []
  const graphConfigs = [
    { type: 'species', label: 'Species', href: '/explore/species', file: 'species.json', description: 'Co-occurrence in publications and datasets, colored by kingdom' },
    { type: 'concepts', label: 'Concepts', href: '/explore/concepts', file: 'concepts.json', description: 'Co-occurrence in publications and datasets, colored by research scope' },
    { type: 'protocols', label: 'Protocols', href: '/explore/protocols', file: 'protocols.json', description: 'Co-occurrence, embedding similarity, and shared study species' },
    { type: 'places', label: 'Places', href: '/explore/places', file: 'places.json', description: 'Co-occurrence in publications, colored by place type (sites, watersheds, towns)' },
    { type: 'authors', label: 'Authors', href: '/explore/authors', file: 'authors.json', description: 'Co-authorship on 2+ shared publications, colored by research area' },
    { type: 'publications', label: 'Publications', href: '/explore/publications', file: 'publications.json', description: 'Internal citations and shared authorship, sized by citation count' },
    { type: 'datasets', label: 'Datasets', href: '/explore/datasets', file: 'datasets.json', description: 'Shared entities and shared authors, colored by research area' },
  ]
  for (const gc of graphConfigs) {
    try {
      const data = JSON.parse(readFileSync(join(process.cwd(), 'public/graph', gc.file), 'utf-8'))
      graphStats.push({ ...gc, nodes: data.meta.nodeCount, edges: data.meta.edgeCount })
    } catch { /* graph not built yet */ }
  }

  // Cross-collection stats for hero
  const { rows: [crossStats] } = await db.query(`
    SELECT
      (SELECT COUNT(DISTINCT entity_id) FROM (
        SELECT entity_type, entity_id FROM entity_mentions WHERE collection = 'publications'
        INTERSECT
        SELECT entity_type, entity_id FROM entity_mentions WHERE collection = 'datasets'
      ) x) as shared_entities,
      (SELECT COUNT(DISTINCT item_id) FROM entity_mentions WHERE collection = 'publications') as pubs_linked,
      (SELECT COUNT(DISTINCT item_id) FROM entity_mentions WHERE collection = 'datasets') as datasets_linked
  `)

  // Topic groups for Browse by Topic section
  const TOPIC_GROUPS = [
    { group: 'Life Sciences', topics: ['Flowering & Pollination', 'Wildlife Behavior', 'Alpine & Subalpine Ecology', 'Forest Ecology', 'Freshwater Ecology', 'Plant Biology', 'Insect Ecology', 'Vertebrate Biology', 'Microbial Ecology', 'Genetics & Evolution', 'Biodiversity & Conservation', 'Invasive Species & Disturbance'] },
    { group: 'Earth & Water Sciences', topics: ['Hydrology & Watersheds', 'Snow & Ice', 'Groundwater', 'Water Quality', 'Geology & Tectonics', 'Soil Science', 'Geochemistry & Isotopes', 'Paleontology & Paleoecology'] },
    { group: 'Climate & Environment', topics: ['Climate Change Impacts', 'Weather & Atmospheric Science', 'Biogeochemical Cycling', 'Environmental Contamination'] },
    { group: 'Human Dimensions', topics: ['Mining & Mineral Resources', 'Land & Water Management', 'Archaeology & Cultural History', 'Community Planning', 'Energy Development', 'Recreation & Tourism'] },
    { group: 'Technology & Data', topics: ['Remote Sensing & Imagery', 'Geospatial Analysis', 'Field Methods & Monitoring', 'Data Science & Modeling'] },
    { group: 'Places & Programs', topics: ['RMBL & Gothic', 'Gunnison Basin', 'Western Colorado Landscapes', 'Research Programs'] },
    { group: 'Education & Training', topics: ['Science Education & Pedagogy', 'Mentoring & Research Training'] },
  ]

  // Recent highly connected works: publications and datasets from recent years
  // ranked by combined connectivity (citations + entity mentions + co-authors)
  type RecentItem = {
    collection: 'document' | 'publication' | 'dataset'
    subtype: string | null
    title: string
    id: string
    slug: string
    year: number
    meta: string
    connectivity: number
  }

  const { rows: connectedPubs } = await db.query(`
    SELECT p.id, p.title, p.year, p.publication_type, p.journal,
      coalesce(p.external_citation_count, 0) as citations,
      em_cnt.cnt as entity_links,
      ref_cnt.cnt as citation_links
    FROM publications p
    LEFT JOIN LATERAL (SELECT count(*)::int as cnt FROM entity_mentions em WHERE em.item_id = p.id AND em.collection = 'publications') em_cnt ON true
    LEFT JOIN LATERAL (SELECT count(*)::int as cnt FROM references_cited r WHERE r.source_publication_id = p.id OR r.target_publication_id = p.id) ref_cnt ON true
    WHERE p.year >= 2020
    ORDER BY (coalesce(p.external_citation_count, 0) * 2 + em_cnt.cnt + ref_cnt.cnt * 3) DESC
    LIMIT 5
  `)

  const { rows: connectedDatasets } = await db.query(`
    SELECT DISTINCT ON (d.title) d.id, d.title, d.publication_year, d.resource_type,
      em_cnt.cnt as entity_links,
      em_cnt.cnt * 2 + cr_cnt.cnt as score
    FROM datasets d
    LEFT JOIN LATERAL (SELECT count(*)::int as cnt FROM entity_mentions em WHERE em.item_id = d.id AND em.collection = 'datasets') em_cnt ON true
    LEFT JOIN LATERAL (SELECT count(*)::int as cnt FROM datasets_rels dr WHERE dr.parent_id = d.id AND dr.path = 'creators') cr_cnt ON true
    WHERE d.publication_year >= 2020
    ORDER BY d.title, score DESC
  `)
  connectedDatasets.sort((a: any, b: any) => parseInt(b.score) - parseInt(a.score))
  connectedDatasets.splice(3)

  const recentItems: RecentItem[] = []
  for (const p of connectedPubs) {
    const connections = parseInt(p.citations) + parseInt(p.entity_links) + parseInt(p.citation_links)
    recentItems.push({
      collection: 'publication', subtype: p.publication_type || null,
      title: p.title, id: String(p.id), slug: 'publications',
      year: p.year || 0,
      meta: [p.year, p.journal, `${connections} connections`].filter(Boolean).join(' · '),
      connectivity: connections,
    })
  }
  for (const d of connectedDatasets) {
    const connections = parseInt(d.entity_links) + parseInt(d.author_count)
    recentItems.push({
      collection: 'dataset', subtype: d.resource_type || null,
      title: d.title, id: String(d.id), slug: 'datasets',
      year: d.publication_year || 0,
      meta: [d.publication_year, `${connections} connections`].filter(Boolean).join(' · '),
      connectivity: connections,
    })
  }
  recentItems.sort((a, b) => b.connectivity - a.connectivity)

  const totalCount = docCount.totalDocs + pubCount.totalDocs + dataCount.totalDocs

  return (
    <>
      <div className="hero">
        <h1>Explore Environmental Knowledge at Rocky Mountain Biological Laboratory</h1>
        <p>
          The Knowledge Hub brings together {totalCount.toLocaleString()} scientific publications,
          datasets, and other documents from one of the best-studied ecosystems in the world,
          connected in a dense knowledge network.
        </p>

        <form className="search-form" action="/search" method="GET">
          <input
            className="search-input"
            type="text"
            name="q"
            placeholder="Search publications, datasets, and more..."
          />
          <button className="search-button" type="submit">
            Search
          </button>
        </form>

        <div className="type-chips">
          <Link className="type-chip active" href="/search">All</Link>
          <Link className="type-chip" href="/search?type=documents">Documents ({docCount.totalDocs.toLocaleString()})</Link>
          <Link className="type-chip" href="/search?type=publications">Publications ({pubCount.totalDocs.toLocaleString()})</Link>
          <Link className="type-chip" href="/search?type=datasets">Datasets ({dataCount.totalDocs.toLocaleString()})</Link>
          <Link className="type-chip" href="/species">Species ({parseInt(entityStats.species).toLocaleString()})</Link>
          <Link className="type-chip" href="/places">Places ({parseInt(entityStats.places).toLocaleString()})</Link>
          <Link className="type-chip" href="/protocols">Protocols ({parseInt(entityStats.protocols).toLocaleString()})</Link>
          <Link className="type-chip" href="/concepts">Concepts ({parseInt(entityStats.concepts).toLocaleString()})</Link>
          <Link className="type-chip" href="/authors">Authors ({authorCount.totalDocs.toLocaleString()})</Link>
          <Link className="type-chip" href="/projects">Projects ({parseInt(entityStats.projects).toLocaleString()})</Link>
        </div>
      </div>

      {communities.length > 0 && (
        <section className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '4px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Knowledge Neighborhoods</h2>
            <Link href="/neighborhoods" style={{
              padding: '6px 14px', fontSize: '13px', borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)', color: '#fff', textDecoration: 'none',
            }}>Browse All</Link>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
            {communities.length} research communities detected by analyzing connections between species, concepts, protocols, places, authors, and publications.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
            {communities.slice(0, 6).map((c: any) => <CommunityCard key={c.id} c={c} />)}
          </div>
          {communities.length > 6 && (
            <details style={{ marginTop: '12px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 500 }}>
                Show all {communities.length} neighborhoods
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px', marginTop: '12px' }}>
                {communities.slice(6).map((c: any) => <CommunityCard key={c.id} c={c} />)}
              </div>
            </details>
          )}
        </section>
      )}

      {graphStats.length > 0 && (
        <section className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Explore Knowledge Graphs</h2>
            <Link href="/explore/unified" style={{
              padding: '6px 14px', fontSize: '13px', borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)', color: '#fff', textDecoration: 'none',
            }}>Explore Unified Graph</Link>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
            Interactive network visualizations connecting species, concepts, protocols, authors, publications, and datasets.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
            {graphStats.map((gs) => (
              <Link key={gs.type} className="result-card" href={gs.href}
                style={{ borderLeft: '3px solid var(--color-accent)' }}>
                <h3 className="result-card-title">{gs.label} Graph</h3>
                <p className="result-card-snippet" style={{ fontSize: '12px' }}>{gs.description}</p>
                <div className="result-card-meta">
                  <span>{gs.nodes.toLocaleString()} nodes</span>
                  <span>{gs.edges.toLocaleString()} connections</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Browse by Topic</h2>
        <div className="topic-groups">
          {TOPIC_GROUPS.map((g) => (
            <div key={g.group} className="topic-group">
              <h3 className="topic-group-title">{g.group}</h3>
              <div className="topic-group-list">
                {g.topics.map((name) => (
                  <Link
                    key={name}
                    className="topic-link"
                    href={`/search?topic=${encodeURIComponent(name)}`}
                  >
                    {name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Recent Highly Connected Works</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
          Recent publications and datasets with the most connections across citations, co-author networks, and entity mentions.
        </p>
        <div className="result-list">
          {recentItems.slice(0, 8).map((item) => (
            <Link
              key={`${item.slug}-${item.id}`}
              className="result-card"
              href={`/${item.slug}/${item.id}`}
            >
              <div className="result-card-header">
                <span className={getBadgeClass(item.collection)}>
                  {getBadgeLabel(item.collection, item.subtype)}
                </span>
                <h3 className="result-card-title">{item.title}</h3>
              </div>
              {item.meta && <div className="result-card-meta">{item.meta}</div>}
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}

function CommunityCard({ c }: { c: any }) {
  const highlights: { type: string; name: string; slug: string }[] = []
  for (const type of ['concept', 'species', 'protocol', 'place']) {
    const items = c.topByType?.[type] || []
    if (items.length > 0) highlights.push({ type, name: items[0].name, slug: items[0].slug })
    if (highlights.length >= 4) break
  }
  const typeDesc = c.description || Object.entries(c.typeCounts || {})
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([t, n]) => `${n} ${t}${(n as number) > 1 ? 's' : ''}`)
    .join(', ')
  return (
    <Link href={`/neighborhoods/${c.id}`} className="result-card" style={{ borderLeft: '3px solid var(--color-accent)', textDecoration: 'none', color: 'inherit' }}>
      <h3 className="result-card-title" style={{ fontSize: '14px' }}>{c.title || c.label}</h3>
      {c.summary && (
        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '4px 0 6px', lineHeight: 1.4 }}>
          {c.summary}
        </p>
      )}
      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
        {c.size} items · {typeDesc}
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {highlights.map((h, i) => (
          <span key={i} style={{
            padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
            background: GRAPH_COLORS[h.type] || '#999', color: '#fff',
            whiteSpace: 'nowrap',
          }}>
            {h.name.slice(0, 30)}{h.name.length > 30 ? '...' : ''}
          </span>
        ))}
      </div>
    </Link>
  )
}
