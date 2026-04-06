import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from './lib/badges'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config })

  // Fetch counts for each collection
  const [docCount, pubCount, dataCount, authorCount] = await Promise.all([
    payload.count({ collection: 'documents' }),
    payload.count({ collection: 'publications' }),
    payload.count({ collection: 'datasets' }),
    payload.count({ collection: 'authors' }),
  ])

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
          from {authorCount.totalDocs.toLocaleString()} researchers in the Gunnison Basin.
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
          <Link className="type-chip active" href="/search">
            All Resources
          </Link>
          <Link className="type-chip" href="/search?type=documents">
            Documents ({docCount.totalDocs.toLocaleString()})
          </Link>
          <Link className="type-chip" href="/search?type=publications">
            Publications ({pubCount.totalDocs.toLocaleString()})
          </Link>
          <Link className="type-chip" href="/search?type=datasets">
            Datasets ({dataCount.totalDocs.toLocaleString()})
          </Link>
          <Link className="type-chip" href="/authors">
            Authors ({authorCount.totalDocs.toLocaleString()})
          </Link>
        </div>
      </div>

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
