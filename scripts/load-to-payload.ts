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

import { readFileSync } from 'fs'

const BASE_URL = 'http://localhost:3000'
const API = `${BASE_URL}/api`
const ADMIN_EMAIL = 'admin@rmbl.org'
const ADMIN_PASSWORD = 'dev-password-change-me'
const CONCURRENCY = 5

const OUTPUT_DIR = new URL('./output', import.meta.url).pathname

const collectionArg =
  process.argv.find((a) => a.startsWith('--collection='))?.split('=')[1] || 'all'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

let authToken: string | null = null

async function ensureAdmin(): Promise<void> {
  // Try to log in first
  const loginRes = await fetch(`${API}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })

  if (loginRes.ok) {
    const data = await loginRes.json()
    authToken = data.token
    console.log('  Logged in as existing admin')
    return
  }

  // Create admin user (first-run)
  const createRes = await fetch(`${API}/users/first-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })

  if (createRes.ok) {
    const data = await createRes.json()
    authToken = data.token
    console.log('  Created admin user and logged in')
    return
  }

  // Try the regular create endpoint (Payload v3 varies)
  const regRes = await fetch(`${API}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })

  if (regRes.ok) {
    // Now log in
    const loginRes2 = await fetch(`${API}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    })
    if (loginRes2.ok) {
      const data = await loginRes2.json()
      authToken = data.token
      console.log('  Created admin user and logged in')
      return
    }
  }

  throw new Error('Could not create or log in as admin user. Is the dev server running?')
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `JWT ${authToken}` } : {}),
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function createRecord(
  collection: string,
  data: Record<string, unknown>,
): Promise<{ id: string } | null> {
  const res = await fetch(`${API}/${collection}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const body = await res.text()
    // Unique constraint = already exists, skip
    if (res.status === 400 && body.includes('unique')) return null
    throw new Error(`POST /${collection} failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const result = await res.json()
  return { id: result.doc?.id || result.id }
}

async function findByField(
  collection: string,
  field: string,
  value: string,
): Promise<string | null> {
  const res = await fetch(
    `${API}/${collection}?where[${field}][equals]=${encodeURIComponent(value)}&limit=1`,
    { headers: authHeaders() },
  )
  if (!res.ok) return null
  const data = await res.json()
  if (data.docs?.length > 0) return data.docs[0].id
  return null
}

async function getCount(collection: string): Promise<number> {
  const res = await fetch(`${API}/${collection}?limit=0`, { headers: authHeaders() })
  if (!res.ok) return 0
  const data = await res.json()
  return data.totalDocs || 0
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  label: string,
): Promise<{ success: number; skipped: number; errors: number }> {
  let completed = 0
  let success = 0
  let skipped = 0
  let errors = 0
  const total = items.length

  async function worker(queue: T[]) {
    while (queue.length > 0) {
      const item = queue.shift()!
      try {
        await fn(item)
        success++
      } catch (err: any) {
        if (err?.message?.includes('unique') || err?.message?.includes('already')) {
          skipped++
        } else {
          errors++
          if (errors <= 5) console.error(`\n  ERROR: ${err?.message?.slice(0, 120)}`)
        }
      }
      completed++
      if (completed % 50 === 0 || completed === total) {
        process.stdout.write(`\r  ${label}: ${completed}/${total} (${success} ok, ${skipped} skip, ${errors} err)`)
      }
    }
  }

  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)),
  )
  console.log()
  return { success, skipped, errors }
}

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
    const res = await fetch(`${API}/topics?limit=100`, { headers: authHeaders() })
    const data = await res.json()
    for (const doc of data.docs) {
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
    CONCURRENCY,
    async (doc) => {
      const categoryIds = await resolveTopicIds(doc.categories)

      await createRecord('documents', {
        title: doc.title,
        summary: doc.summary || undefined,
        categories: categoryIds.length > 0 ? categoryIds : undefined,
        dateOriginal: doc.dateOriginal || undefined,
        geographicScope: doc.geographicScope?.length > 0 ? doc.geographicScope : undefined,
        pdfLink: doc.sourceFile || undefined,
        sourceUrl: doc.sourceUrl || undefined,
        ingestionDate: doc.ingestionDate || undefined,
      })
    },
    'Documents',
  )
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

async function loadPublications() {
  console.log('\n--- Loading Publications ---')
  const existing = await getCount('publications')
  if (existing > 0) {
    console.log(`  ${existing} publications already exist, skipping. Delete collection to reimport.`)
    return
  }

  const pubs: any[] = JSON.parse(
    readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'),
  )

  await runBatch(
    pubs,
    CONCURRENCY,
    async (pub) => {
      await createRecord('publications', {
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
      })
    },
    'Publications',
  )
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

async function loadDatasets() {
  console.log('\n--- Loading Datasets ---')
  const existing = await getCount('datasets')
  if (existing > 0) {
    console.log(`  ${existing} datasets already exist, skipping. Delete collection to reimport.`)
    return
  }

  const datasets: any[] = JSON.parse(
    readFileSync(`${OUTPUT_DIR}/data-catalog-normalized.json`, 'utf-8'),
  )

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
    CONCURRENCY,
    async (ds) => {
      const tagIds = await resolveTopicIds(ds.tags || [])

      await createRecord('datasets', {
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
  try {
    const res = await fetch(`${BASE_URL}/admin`, { redirect: 'manual' })
    if (!res.ok && res.status !== 302 && res.status !== 301) throw new Error()
  } catch {
    console.error('ERROR: Payload dev server not running. Start it with: npm run dev')
    process.exit(1)
  }

  console.log('\nStep 0: Authenticating...')
  await ensureAdmin()

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
