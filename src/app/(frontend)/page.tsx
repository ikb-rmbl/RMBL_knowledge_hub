import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from './lib/badges'
import ExpandableTopics from './components/ExpandableTopics'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config })

  // Fetch counts for each collection
  const [docCount, pubCount, dataCount] = await Promise.all([
    payload.count({ collection: 'documents' }),
    payload.count({ collection: 'publications' }),
    payload.count({ collection: 'datasets' }),
  ])

  // Fetch parent topics individually by name (scales with 9,000+ topics)
  const PARENT_TOPIC_NAMES = [
    'Water & Hydrology', 'Ecology & Biology', 'Climate & Atmosphere',
    'Soil & Geology', 'Chemistry & Biogeochemistry', 'Remote Sensing & GIS',
    'Mining & Energy', 'Land Use & Community', 'Methods & Data Management',
    'Places & Projects', 'Other',
  ]

  const topicCounts: { name: string; id: string; count: number }[] = []
  for (const name of PARENT_TOPIC_NAMES) {
    const result = await payload.find({
      collection: 'topics',
      where: { name: { equals: name } },
      limit: 1,
    })
    const parent = result.docs[0]
    if (!parent) continue

    // Get first 20 children sorted by ID (original spec topics have low IDs)
    const children = await payload.find({
      collection: 'topics',
      where: { parent: { equals: parent.id } },
      limit: 20,
      sort: 'id',
    })
    const idsToCheck = [String(parent.id), ...children.docs.map((c) => String(c.id))]

    let total = 0
    for (const id of idsToCheck) {
      const [d, p, ds] = await Promise.all([
        payload.count({ collection: 'documents', where: { categories: { equals: id } } }),
        payload.count({ collection: 'publications', where: { researchTopics: { equals: id } } }),
        payload.count({ collection: 'datasets', where: { tags: { equals: id } } }),
      ])
      total += d.totalDocs + p.totalDocs + ds.totalDocs
    }

    if (total > 0) {
      topicCounts.push({ name: parent.name, id: String(parent.id), count: total })
    }
  }
  topicCounts.sort((a, b) => b.count - a.count)

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
          Search across {totalCount.toLocaleString()} documents, publications, and datasets from the
          Gunnison Basin.
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
        </div>
      </div>

      {topicCounts.length > 0 && (
        <section className="section">
          <h2 className="section-title">Browse by Topic</h2>
          <ExpandableTopics topics={topicCounts} />
        </section>
      )}

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
