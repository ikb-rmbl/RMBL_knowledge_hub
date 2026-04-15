import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from './lib/badges'
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

  // Graph stats for explore cards (read from pre-computed JSON files)
  const graphStats: { type: string; label: string; href: string; nodes: number; edges: number; description: string }[] = []
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const graphConfigs = [
    { type: 'species', label: 'Species', href: '/explore/species', file: 'species.json', description: 'Co-occurrence in publications and datasets, colored by kingdom' },
    { type: 'concepts', label: 'Concepts', href: '/explore/concepts', file: 'concepts.json', description: 'Co-occurrence in publications and datasets, colored by research scope' },
    { type: 'protocols', label: 'Protocols', href: '/explore/protocols', file: 'protocols.json', description: 'Co-occurrence, embedding similarity, and shared study species' },
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

  // Cross-discipline bridges: species linked to earth science concepts
  const { rows: bridges } = await db.query(`
    SELECT s.canonical_name as species, c.name as concept, c.scope,
      COUNT(DISTINCT em1.item_id) as shared_items
    FROM entity_mentions em1
    JOIN entity_mentions em2 ON em2.item_id = em1.item_id AND em2.collection = em1.collection
      AND em2.entity_type = 'concept'
    JOIN species s ON s.id = em1.entity_id
    JOIN concepts c ON c.id = em2.entity_id
    WHERE em1.entity_type = 'species'
      AND c.scope IN ('hydrology', 'biogeochemistry', 'climate', 'landscape')
      AND s.publication_count >= 10
    GROUP BY s.id, s.canonical_name, c.id, c.name, c.scope
    HAVING COUNT(DISTINCT em1.item_id) >= 8
    ORDER BY ln(COUNT(DISTINCT em1.item_id) + 1) * (0.3 + 0.7 * random()) DESC
    LIMIT 40
  `)

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

  // Fetch recently published from each collection (by content date, not ingestion date)
  const [recentDocs, recentPubs, recentData] = await Promise.all([
    payload.find({ collection: 'documents', limit: 3, sort: '-dateOriginal' }),
    payload.find({ collection: 'publications', limit: 3, sort: '-year' }),
    payload.find({ collection: 'datasets', limit: 3, sort: '-publicationYear' }),
  ])

  // Combine and sort by year descending
  type RecentItem = {
    collection: 'document' | 'publication' | 'dataset'
    subtype: string | null
    title: string
    id: string
    slug: string
    year: number
    meta: string
  }
  const recentItems: RecentItem[] = []

  for (const doc of recentDocs.docs) {
    const year = (doc.dateOriginal as string)?.slice(0, 4)
    recentItems.push({
      collection: 'document',
      subtype: null,
      title: doc.title,
      id: String(doc.id),
      slug: 'documents',
      year: year ? parseInt(year) : 0,
      meta: year || '',
    })
  }
  for (const pub of recentPubs.docs) {
    recentItems.push({
      collection: 'publication',
      subtype: pub.publicationType || null,
      title: pub.title,
      id: String(pub.id),
      slug: 'publications',
      year: pub.year || 0,
      meta: pub.year ? String(pub.year) : '',
    })
  }
  for (const ds of recentData.docs) {
    recentItems.push({
      collection: 'dataset',
      subtype: ds.resourceType || null,
      title: ds.title,
      id: String(ds.id),
      slug: 'datasets',
      year: ds.publicationYear || 0,
      meta: ds.publicationYear ? String(ds.publicationYear) : '',
    })
  }

  // Sort combined list by year descending
  recentItems.sort((a, b) => b.year - a.year)

  const totalCount = docCount.totalDocs + pubCount.totalDocs + dataCount.totalDocs

  return (
    <>
      <div className="hero">
        <h1>Explore Western Colorado's Environmental Knowledge</h1>
        <p>
          Search across {totalCount.toLocaleString()} documents, publications, and datasets
          from {authorCount.totalDocs.toLocaleString()} researchers — connected by{' '}
          {parseInt(entityStats.cross_links).toLocaleString()} entity links,{' '}
          {parseInt(entityStats.citations).toLocaleString()} citation connections, and{' '}
          {parseInt(crossStats.shared_entities).toLocaleString()} entities shared across collections.
        </p>

        <form className="search-form" action="/search" method="GET">
          <input
            className="search-input"
            type="text"
            name="q"
            placeholder="Search documents, publications, and datasets..."
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

      {bridges.length > 0 && (
        <section className="section">
          <h2 className="section-title">Species &times; Climate &amp; Landscape</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
            Species linked to climate, hydrology, and landscape research across the knowledge hub.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(() => {
              // Diversify: pick the top bridge per unique concept, then fill
              const seenConcepts = new Set<string>()
              const diverse: typeof bridges = []
              for (const b of bridges) {
                if (!seenConcepts.has(b.concept as string)) {
                  seenConcepts.add(b.concept as string)
                  diverse.push(b)
                }
                if (diverse.length >= 8) break
              }
              // If we have fewer than 8 concepts, fill with top remaining
              if (diverse.length < 8) {
                for (const b of bridges) {
                  if (!diverse.find((d) => d.species === b.species && d.concept === b.concept)) {
                    diverse.push(b)
                    if (diverse.length >= 8) break
                  }
                }
              }
              return diverse
            })().map((b, i) => (
              <Link key={i} href={`/search?q=${encodeURIComponent(b.species)}`}
                style={{
                  padding: '8px 14px', borderRadius: 'var(--radius)',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  textDecoration: 'none', fontSize: '13px', display: 'flex', gap: '6px', alignItems: 'center',
                }}>
                <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{(b.species as string).split(' ').slice(0, 2).join(' ')}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>+</span>
                <span>{b.concept}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>({b.shared_items})</span>
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
        <h2 className="section-title">Recent Works</h2>
        <div className="result-list">
          {recentItems.slice(0, 6).map((item) => (
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
