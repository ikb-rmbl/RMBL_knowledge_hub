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

  // Featured research connections: entities bridging publications and datasets
  const { rows: connectionCards } = await db.query(`
    WITH cross_entities AS (
      SELECT em.entity_type, em.entity_id,
        COUNT(DISTINCT em.item_id) FILTER (WHERE em.collection = 'publications') as pubs,
        COUNT(DISTINCT em.item_id) FILTER (WHERE em.collection = 'datasets') as datasets,
        COUNT(DISTINCT em.item_id) as total
      FROM entity_mentions em
      GROUP BY em.entity_type, em.entity_id
      HAVING COUNT(DISTINCT em.collection) >= 2
    )
    SELECT ce.entity_type, ce.entity_id, ce.pubs, ce.datasets, ce.total,
      CASE ce.entity_type
        WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = ce.entity_id)
        WHEN 'place' THEN (SELECT name FROM places WHERE id = ce.entity_id)
        WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = ce.entity_id)
        WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = ce.entity_id)
      END as name,
      CASE ce.entity_type
        WHEN 'place' THEN (SELECT place_type FROM places WHERE id = ce.entity_id)
        WHEN 'species' THEN (SELECT family FROM species WHERE id = ce.entity_id)
        WHEN 'concept' THEN (SELECT scope FROM concepts WHERE id = ce.entity_id)
        WHEN 'protocol' THEN (SELECT category FROM protocols WHERE id = ce.entity_id)
      END as detail
    FROM cross_entities ce
    WHERE ce.pubs >= 5 AND ce.datasets >= 3
    ORDER BY ln(ce.total + 1) * (0.3 + 0.7 * random()) DESC
    LIMIT 20
  `)

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

      {connectionCards.length > 0 && (
        <section className="section">
          <h2 className="section-title">Research Connections</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
            Entities that bridge publications and datasets — showing where research and data meet.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(() => {
              // Pick a diverse set: one per entity type, then fill remaining slots
              const byType = new Map<string, typeof connectionCards>()
              for (const c of connectionCards) {
                if (!byType.has(c.entity_type)) byType.set(c.entity_type, [])
                byType.get(c.entity_type)!.push(c)
              }
              const picks: typeof connectionCards = []
              for (const [, items] of byType) {
                if (picks.length < 6 && items.length > 0) picks.push(items.shift()!)
              }
              // Fill remaining from highest-total
              for (const c of connectionCards) {
                if (picks.length >= 6) break
                if (!picks.find((p) => p.entity_id === c.entity_id && p.entity_type === c.entity_type)) picks.push(c)
              }
              return picks.map((c) => {
                const type = c.entity_type
                const href = `/${type === 'species' ? 'species' : type === 'place' ? 'places' : type === 'protocol' ? 'protocols' : 'concepts'}/${c.entity_id}`
                const badgeClass = type === 'species' ? 'badge-species' : type === 'place' ? 'badge-place' : type === 'protocol' ? 'badge-protocol' : 'badge-concept'
                return (
                  <Link key={`${type}-${c.entity_id}`} className="result-card" href={href}
                    style={{ flex: '1 1 280px', maxWidth: '400px', borderLeft: '3px solid var(--color-accent)' }}>
                    <div className="result-card-header">
                      <span className={`badge ${badgeClass}`}>{type}</span>
                      <h3 className="result-card-title" style={type === 'species' ? { fontStyle: 'italic' } : undefined}>
                        {c.name}
                      </h3>
                    </div>
                    <div className="result-card-meta">
                      {c.detail && <span>{(c.detail as string).replace(/_/g, ' ')}</span>}
                      <span>{`${c.pubs} publications`}</span>
                      <span>{`${c.datasets} datasets`}</span>
                    </div>
                  </Link>
                )
              })
            })()}
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
