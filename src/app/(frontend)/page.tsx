import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getBadgeLabel, getBadgeClass } from './lib/badges'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config })

  // Fetch counts for each collection
  const [docCount, pubCount, dataCount] = await Promise.all([
    payload.count({ collection: 'documents' }),
    payload.count({ collection: 'publications' }),
    payload.count({ collection: 'datasets' }),
  ])

  // Fetch parent topics with counts
  const topics = await payload.find({
    collection: 'topics',
    where: { parent: { exists: false } },
    limit: 20,
    sort: 'name',
  })

  // Count resources per topic (documents + publications with that topic)
  const topicCounts: { name: string; id: string; count: number }[] = []
  for (const topic of topics.docs) {
    const [docs, pubs, dsets] = await Promise.all([
      payload.count({ collection: 'documents', where: { categories: { equals: topic.id } } }),
      payload.count({ collection: 'publications', where: { researchTopics: { equals: topic.id } } }),
      payload.count({ collection: 'datasets', where: { tags: { equals: topic.id } } }),
    ])
    const total = docs.totalDocs + pubs.totalDocs + dsets.totalDocs
    if (total > 0) {
      topicCounts.push({ name: topic.name, id: String(topic.id), count: total })
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
          <div className="topic-grid">
            {topicCounts.slice(0, 8).map((topic) => (
              <Link
                key={topic.id}
                className="topic-card"
                href={`/search?topic=${encodeURIComponent(topic.name)}`}
              >
                <div className="topic-card-name">{topic.name}</div>
                <div className="topic-card-count">
                  {topic.count} resource{topic.count !== 1 ? 's' : ''}
                </div>
              </Link>
            ))}
          </div>
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
