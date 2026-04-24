/**
 * Dynamic sitemap for the RMBL Knowledge Hub.
 *
 * Next.js App Router automatically serves this at /sitemap.xml.
 * Queries the database for all public detail pages.
 */

import type { MetadataRoute } from 'next'
import { getDb } from './(frontend)/lib/db'

const BASE_URL = 'https://rmblknowledgehub.org'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb()
  const entries: MetadataRoute.Sitemap = []

  // Static pages
  const staticPages = [
    '/', '/search', '/authors',
    '/species', '/concepts', '/protocols', '/places',
    '/neighborhoods', '/projects',
    '/explore/unified', '/explore/neighborhoods', '/explore/map',
    '/explore/species', '/explore/concepts', '/explore/protocols',
    '/explore/places', '/explore/authors', '/explore/publications', '/explore/datasets',
  ]
  for (const path of staticPages) {
    entries.push({ url: `${BASE_URL}${path}`, changeFrequency: 'weekly', priority: path === '/' ? 1.0 : 0.6 })
  }

  // Publications
  const { rows: pubs } = await db.query(
    "SELECT id, updated_at FROM publications ORDER BY id",
  )
  for (const p of pubs) {
    entries.push({
      url: `${BASE_URL}/publications/${p.id}`,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }

  // Datasets
  const { rows: datasets } = await db.query(
    "SELECT id, updated_at FROM datasets ORDER BY id",
  )
  for (const d of datasets) {
    entries.push({
      url: `${BASE_URL}/datasets/${d.id}`,
      lastModified: d.updated_at ? new Date(d.updated_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  // Documents
  const { rows: docs } = await db.query(
    "SELECT id, updated_at FROM documents ORDER BY id",
  )
  for (const d of docs) {
    entries.push({
      url: `${BASE_URL}/documents/${d.id}`,
      lastModified: d.updated_at ? new Date(d.updated_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.5,
    })
  }

  // Authors (only those with works)
  const { rows: authors } = await db.query(
    "SELECT id, updated_at FROM authors WHERE work_count > 0 ORDER BY id",
  )
  for (const a of authors) {
    entries.push({
      url: `${BASE_URL}/authors/${a.id}`,
      lastModified: a.updated_at ? new Date(a.updated_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.5,
    })
  }

  // Species (only those with publications)
  const { rows: species } = await db.query(
    "SELECT id FROM species WHERE publication_count > 0 ORDER BY id",
  )
  for (const s of species) {
    entries.push({ url: `${BASE_URL}/species/${s.id}`, changeFrequency: 'monthly', priority: 0.5 })
  }

  // Concepts, protocols, places
  for (const [table, path] of [['concepts', 'concepts'], ['protocols', 'protocols'], ['places', 'places']] as const) {
    const { rows } = await db.query(
      `SELECT id FROM ${table} WHERE publication_count > 0 ORDER BY id`,
    )
    for (const r of rows) {
      entries.push({ url: `${BASE_URL}/${path}/${r.id}`, changeFrequency: 'monthly', priority: 0.4 })
    }
  }

  // Neighborhoods
  const { rows: neighborhoods } = await db.query(
    "SELECT id, updated_at FROM neighborhoods ORDER BY id",
  )
  for (const n of neighborhoods) {
    entries.push({
      url: `${BASE_URL}/neighborhoods/${n.id}`,
      lastModified: n.updated_at ? new Date(n.updated_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  return entries
}
