/**
 * Payload CMS Data Loader
 *
 * Loads all three collections into Payload via the REST API:
 *   1. Seeds Topics taxonomy
 *   2. Loads Documents (Sustainable Library)
 *   3. Loads Publications
 *   4. Loads Datasets (Data Catalog)
 *
 * Usage:
 *   # Start the dev server first: npm run dev
 *   npx tsx scripts/load-to-payload.ts [--collection=topics|documents|publications|datasets|all]
 *
 * The script creates an admin user on first run, then authenticates for all API calls.
 * It is idempotent: records are matched by _sourceId/title and skipped if they already exist.
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { runBatch } from './lib/concurrency.js'
import {
  ensureAuth,
  authHeaders,
  createRecord,
  findByField,
  getCount,
  checkServer,
  getAllPaginated,
} from './lib/payload-client.js'
import { OUTPUT_DIR, PAYLOAD_API, CONCURRENCY } from './lib/config.js'

const WRITE_CONCURRENCY = CONCURRENCY.PAYLOAD_WRITES

const collectionArg =
  process.argv.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const topicIdCache = new Map<string, string>()

async function resolveTopicIds(names: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const name of names) {
    if (topicIdCache.has(name)) {
      ids.push(topicIdCache.get(name)!)
    } else {
      const id = await findByField('topics', 'name', name)
      if (id) {
        topicIdCache.set(name, id)
        ids.push(id)
      }
    }
  }
  return ids
}

async function seedTopics() {
  console.log('\n--- Seeding Topics ---')
  const existing = await getCount('topics')
  if (existing > 0) {
    console.log(`  ${existing} topics already exist, loading IDs...`)
    // Load all existing topics into cache
    const allTopics = await getAllPaginated('topics')
    for (const doc of allTopics) {
      topicIdCache.set(doc.name, doc.id)
    }
    console.log(`  Cached ${topicIdCache.size} topic IDs`)
    return
  }

  const topics: { name: string; parent: string | null }[] = JSON.parse(
    readFileSync(`${OUTPUT_DIR}/topics-seed.json`, 'utf-8'),
  )

  // Create parent topics first
  const parents = topics.filter((t) => !t.parent)
  for (const topic of parents) {
    const result = await createRecord('topics', { name: topic.name })
    if (result) topicIdCache.set(topic.name, result.id)
  }
  console.log(`  Created ${parents.length} parent topics`)

  // Then children
  const children = topics.filter((t) => t.parent)
  for (const topic of children) {
    const parentId = topicIdCache.get(topic.parent!)
    const result = await createRecord('topics', { name: topic.name, parent: parentId })
    if (result) topicIdCache.set(topic.name, result.id)
  }
  console.log(`  Created ${children.length} child topics`)
  console.log(`  Total: ${topicIdCache.size} topics`)
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

async function loadDocuments() {
  console.log('\n--- Loading Documents ---')
  const existing = await getCount('documents')
  if (existing > 0) {
    console.log(`  ${existing} documents already exist, skipping. Delete collection to reimport.`)
    return
  }

  const docs: any[] = JSON.parse(
    readFileSync(`${OUTPUT_DIR}/sustainable-library-normalized.json`, 'utf-8'),
  )

  await runBatch(
    docs,
    WRITE_CONCURRENCY,
    async (doc) => {
      const categoryIds = await resolveTopicIds(doc.categories)

      const result = await createRecord('documents', {
        title: doc.title,
        summary: doc.summary || undefined,
        categories: categoryIds.length > 0 ? categoryIds : undefined,
        dateOriginal: doc.dateOriginal || undefined,
        geographicScope: doc.geographicScope?.length > 0 ? doc.geographicScope : undefined,
        pdfLink: doc.sourceFile || undefined,
        sourceUrl: doc.sourceUrl || undefined,
        ingestionDate: doc.ingestionDate || undefined,
      })
      return result ? 'success' : 'skipped'
    },
    'Documents',
  )
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

async function loadPublications() {
  console.log('\n--- Loading Publications ---')
  const existingCount = await getCount('publications')

  let pubs: any[]

  if (existingCount === 0) {
    // Fresh load: main file + discovered
    pubs = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))
    const discoveredFiles = readdirSync(OUTPUT_DIR).filter(
      (f) => f.startsWith('publications-discovered-') && f.endsWith('.json'),
    )
    for (const file of discoveredFiles) {
      const discovered = JSON.parse(readFileSync(`${OUTPUT_DIR}/${file}`, 'utf-8'))
      pubs.push(...discovered)
      console.log(`  Merged ${discovered.length} from ${file}`)
    }
  } else {
    // Incremental: load new from main file + discovered files, dedup against existing
    console.log(`  ${existingCount} publications already exist, loading new only...`)
    pubs = []

    // Build dedup index from existing publications
    console.log('  Building dedup index from existing publications...')
    const existingPubs = await getAllPaginated('publications')
    const existingDois = new Set<string>()
    const existingByTitleYear = new Map<string, number[]>() // title_lower → [years]
    for (const p of existingPubs) {
      if (p.doi) existingDois.add((p.doi as string).toLowerCase())
      if (p.title) {
        const key = (p.title as string).toLowerCase()
        if (!existingByTitleYear.has(key)) existingByTitleYear.set(key, [])
        existingByTitleYear.get(key)!.push(p.year as number || 0)
      }
    }
    console.log(`  Dedup index: ${existingDois.size} DOIs, ${existingByTitleYear.size} unique titles`)

    // Check main normalized file for new RMBL publications
    const mainFile = `${OUTPUT_DIR}/publications-normalized.json`
    if (existsSync(mainFile)) {
      const mainPubs = JSON.parse(readFileSync(mainFile, 'utf-8'))
      let added = 0
      let dupes = 0
      for (const pub of mainPubs) {
        if (pub.doi && existingDois.has(pub.doi.toLowerCase())) { dupes++; continue }
        if (pub.title) {
          const titleKey = pub.title.toLowerCase()
          const existingYears = existingByTitleYear.get(titleKey)
          if (existingYears) {
            const yearMatch = existingYears.some((y: number) => !pub.year || !y || Math.abs(pub.year - y) <= 1)
            if (yearMatch) { dupes++; continue }
          }
        }
        pubs.push(pub)
        if (pub.doi) existingDois.add(pub.doi.toLowerCase())
        if (pub.title) {
          const key = pub.title.toLowerCase()
          if (!existingByTitleYear.has(key)) existingByTitleYear.set(key, [])
          existingByTitleYear.get(key)!.push(pub.year || 0)
        }
        added++
      }
      console.log(`  publications-normalized.json: ${added} new, ${dupes} duplicates (of ${mainPubs.length})`)
    }

    // Check discovered files
    const discoveredFiles = readdirSync(OUTPUT_DIR).filter(
      (f) => f.startsWith('publications-discovered-') && f.endsWith('.json'),
    )
    for (const file of discoveredFiles) {
      const discovered = JSON.parse(readFileSync(`${OUTPUT_DIR}/${file}`, 'utf-8'))
      let added = 0
      let doiDup = 0
      let titleDup = 0
      for (const pub of discovered) {
        // Tier 1: DOI match
        if (pub.doi && existingDois.has(pub.doi.toLowerCase())) { doiDup++; continue }

        // Tier 2: Exact title + close year (±1)
        if (pub.title) {
          const titleKey = pub.title.toLowerCase()
          const existingYears = existingByTitleYear.get(titleKey)
          if (existingYears) {
            const yearMatch = existingYears.some((y: number) => !pub.year || !y || Math.abs(pub.year - y) <= 1)
            if (yearMatch) { titleDup++; continue }
          }
        }

        pubs.push(pub)
        // Add to index so later items in the file don't duplicate earlier ones
        if (pub.doi) existingDois.add(pub.doi.toLowerCase())
        if (pub.title) {
          const key = pub.title.toLowerCase()
          if (!existingByTitleYear.has(key)) existingByTitleYear.set(key, [])
          existingByTitleYear.get(key)!.push(pub.year || 0)
        }
        added++
      }
      console.log(`  ${file}: ${added} new, ${doiDup} DOI dupes, ${titleDup} title dupes (of ${discovered.length})`)
    }
    console.log(`  ${pubs.length} new publications to load`)
    if (pubs.length === 0) return
  }

  await runBatch(
    pubs,
    WRITE_CONCURRENCY,
    async (pub) => {
      const result = await createRecord('publications', {
        title: pub.title,
        authors:
          pub.authors?.length > 0
            ? pub.authors.map((a: any) => ({ given: a.given || '', family: a.family || '' }))
            : [{ given: '', family: 'Unknown' }],
        year: pub.year || 0,
        publicationType: pub.publicationType || 'other',
        journal: pub.journal || undefined,
        volume: pub.volume || undefined,
        issue: pub.issue || undefined,
        pages: pub.pages || undefined,
        doi: pub.doi || undefined,
        publisher: pub.publisher || undefined,
        abstract: pub.abstract || undefined,
        keywords:
          pub.keywords?.length > 0
            ? pub.keywords
            : undefined,
        pdfLink: pub.pdfLink || undefined,
        externalUrl: pub.externalUrl || undefined,
        editors:
          pub.editors?.length > 0
            ? pub.editors.map((e: any) => ({ given: e.given || '', family: e.family || '' }))
            : undefined,
        dataSource: pub._source || 'rmbl_database',
        discoveryMethod: pub._discoveryMethod || 'rmbl_api',
      })
      return result ? 'success' : 'skipped'
    },
    'Publications',
  )
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

async function loadDatasets() {
  console.log('\n--- Loading Datasets ---')
  const existingCount = await getCount('datasets')

  let datasets: any[]

  if (existingCount === 0) {
    // Fresh load
    datasets = JSON.parse(readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'))
  } else {
    // Incremental: only load discovered datasets, dedup against existing
    console.log(`  ${existingCount} datasets already exist, loading discovered only...`)
    datasets = []
    const discoveredFiles = readdirSync(OUTPUT_DIR).filter(
      (f) => f.startsWith('datasets-discovered') && f.endsWith('.json'),
    )
    if (discoveredFiles.length === 0) {
      console.log(`  No discovered dataset files found. Nothing to add.`)
      return
    }

    // Build dedup index
    console.log('  Building dedup index from existing datasets...')
    const existingDs = await getAllPaginated('datasets')
    const existingDois = new Set<string>()
    const existingTitles = new Set<string>()
    for (const d of existingDs) {
      if (d.doi) existingDois.add((d.doi as string).toLowerCase())
      if (d.title) existingTitles.add((d.title as string).toLowerCase())
    }
    console.log(`  Dedup index: ${existingDois.size} DOIs, ${existingTitles.size} titles`)

    for (const file of discoveredFiles) {
      const discovered = JSON.parse(readFileSync(`${OUTPUT_DIR}/${file}`, 'utf-8'))
      let added = 0
      let dupes = 0
      for (const ds of discovered) {
        if (ds.doi && existingDois.has(ds.doi.toLowerCase())) { dupes++; continue }
        if (ds.title && existingTitles.has(ds.title.toLowerCase())) { dupes++; continue }
        datasets.push(ds)
        if (ds.doi) existingDois.add(ds.doi.toLowerCase())
        if (ds.title) existingTitles.add(ds.title.toLowerCase())
        added++
      }
      console.log(`  ${file}: ${added} new, ${dupes} duplicates (of ${discovered.length})`)
    }
    console.log(`  ${datasets.length} new datasets to load`)
    if (datasets.length === 0) return
  }

  // Dataset tags are freeform — create any new topics as needed
  const allTags = new Set<string>()
  for (const ds of datasets) {
    for (const tag of ds.tags || []) {
      if (tag && !topicIdCache.has(tag)) allTags.add(tag)
    }
  }
  if (allTags.size > 0) {
    console.log(`  Creating ${allTags.size} new topics from dataset tags...`)
    for (const tag of allTags) {
      const result = await createRecord('topics', { name: tag })
      if (result) topicIdCache.set(tag, result.id)
    }
  }

  await runBatch(
    datasets,
    WRITE_CONCURRENCY,
    async (ds) => {
      const tagIds = await resolveTopicIds(ds.tags || [])

      const result = await createRecord('datasets', {
        title: ds.title,
        description: ds.description || undefined,
        creators:
          ds.creators?.length > 0
            ? ds.creators.map((c: any) => ({
                name: c.name,
                orcid: c.orcid || undefined,
                affiliation: c.affiliation || undefined,
              }))
            : [{ name: 'RMBL' }],
        publicationYear: ds.publicationYear || 0,
        doi: ds.doi || undefined,
        downloadUrl: ds.downloadUrl || undefined,
        repository: ds.repository || undefined,
        externalCatalogUrl: ds.externalCatalogUrl || undefined,
        spatialDescription: ds.spatialDescription || undefined,
        spatialExtent: ds.spatialExtent || undefined,
        temporalExtent: ds.temporalExtent || undefined,
        tags: tagIds.length > 0 ? tagIds : undefined,
        license: ds.license || undefined,
        resourceType: ds.resourceType || 'dataset',
        dataPublisher: ds.dataPublisher || 'RMBL',
        methods: ds._methods || undefined,
        fullText: ds._metadataFullText || undefined,
      })
      return result ? 'success' : 'skipped'
    },
    'Datasets',
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Payload CMS Data Loader')
  console.log('=======================')

  // Check server is running
  const serverUp = await checkServer()
  if (!serverUp) {
    console.error('ERROR: Payload dev server not running. Start it with: npm run dev')
    process.exit(1)
  }

  console.log('\nStep 0: Authenticating...')
  await ensureAuth()

  const collections =
    collectionArg === 'all'
      ? ['topics', 'documents', 'publications', 'datasets']
      : [collectionArg]

  for (const collection of collections) {
    switch (collection) {
      case 'topics':
        await seedTopics()
        break
      case 'documents':
        if (topicIdCache.size === 0) await seedTopics()
        await loadDocuments()
        break
      case 'publications':
        await loadPublications()
        break
      case 'datasets':
        if (topicIdCache.size === 0) await seedTopics()
        await loadDatasets()
        break
      default:
        console.error(`Unknown collection: ${collection}`)
        process.exit(1)
    }
  }

  // Final counts
  console.log('\n========== Final Counts ==========')
  for (const col of ['topics', 'documents', 'publications', 'datasets']) {
    const count = await getCount(col)
    console.log(`  ${col}: ${count}`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
