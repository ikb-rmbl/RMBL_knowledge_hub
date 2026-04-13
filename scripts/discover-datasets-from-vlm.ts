/**
 * Discover new datasets from VLM-extracted data repository links.
 *
 * Resolves DOIs via DataCite API to fetch structured metadata (title,
 * description, creators, keywords, dates) and adds them as new dataset
 * records linked to their source publications.
 *
 * Usage:
 *   npx tsx scripts/discover-datasets-from-vlm.ts [--dry-run] [--limit=N]
 */

import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

const DATACITE_API = 'https://api.datacite.org/dois'

interface DataCiteMetadata {
  doi: string
  title: string
  description: string | null
  creators: { name: string; affiliation?: string; orcid?: string }[]
  keywords: string[]
  publicationYear: number | null
  resourceType: string
  publisher: string | null
  downloadUrl: string | null
  catalogUrl: string
}

async function resolveDoiViaDataCite(doi: string): Promise<DataCiteMetadata | null> {
  const url = `${DATACITE_API}/${encodeURIComponent(doi)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.api+json' },
  })

  if (!res.ok) {
    if (res.status === 404) return null
    // Retry once on 5xx
    if (res.status >= 500) {
      await sleep(2000)
      const retry = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } })
      if (!retry.ok) return null
      const data = await retry.json()
      return parseDataCiteResponse(doi, data)
    }
    return null
  }

  const data = await res.json()
  return parseDataCiteResponse(doi, data)
}

function parseDataCiteResponse(doi: string, data: any): DataCiteMetadata | null {
  const attrs = data?.data?.attributes
  if (!attrs) return null

  const titles = attrs.titles || []
  const title = titles[0]?.title || ''
  if (!title) return null

  const descriptions = attrs.descriptions || []
  const description = descriptions
    .map((d: any) => d.description)
    .filter(Boolean)
    .join('\n\n') || null

  const creators = (attrs.creators || []).map((c: any) => ({
    name: c.name || [c.familyName, c.givenName].filter(Boolean).join(', '),
    affiliation: c.affiliation?.[0]?.name || undefined,
    orcid: c.nameIdentifiers?.find((n: any) => n.nameIdentifierScheme === 'ORCID')?.nameIdentifier || undefined,
  }))

  const keywords = (attrs.subjects || [])
    .map((s: any) => s.subject)
    .filter(Boolean)

  const publicationYear = attrs.publicationYear || null

  const resourceType = attrs.types?.resourceTypeGeneral?.toLowerCase() || 'dataset'

  const publisher = attrs.publisher?.name || attrs.publisher || null

  // Find a download/landing URL
  const relatedIds = attrs.relatedIdentifiers || []
  const downloadUrl = relatedIds
    .find((r: any) => r.relationType === 'IsSupplementTo' || r.relationType === 'IsPartOf')
    ?.relatedIdentifier || null

  return {
    doi,
    title,
    description,
    creators,
    keywords,
    publicationYear,
    resourceType,
    publisher,
    downloadUrl,
    catalogUrl: `https://doi.org/${doi}`,
  }
}

async function resolveDoiViaCrossRef(doi: string): Promise<DataCiteMetadata | null> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RMBLKnowledgeHub/1.0 (mailto:ikb@rmbl.org)' },
  })
  if (!res.ok) return null

  const data = await res.json()
  const item = data?.message
  if (!item) return null

  const title = item.title?.[0] || ''
  if (!title) return null

  const description = item.abstract?.replace(/<[^>]+>/g, '') || null

  const creators = (item.author || []).map((a: any) => ({
    name: a.family ? `${a.family}, ${a.given || ''}`.trim() : a.name || '',
    affiliation: a.affiliation?.[0]?.name || undefined,
    orcid: a.ORCID || undefined,
  }))

  const keywords = item.subject || []
  const publicationYear = item.published?.['date-parts']?.[0]?.[0] ||
    item['published-online']?.['date-parts']?.[0]?.[0] || null

  const resourceType = item.type || 'dataset'

  return {
    doi,
    title,
    description,
    creators,
    keywords,
    publicationYear,
    resourceType,
    publisher: item.publisher || null,
    downloadUrl: item.resource?.primary?.URL || null,
    catalogUrl: `https://doi.org/${doi}`,
  }
}

async function resolveDoi(doi: string): Promise<DataCiteMetadata | null> {
  // Try DataCite first, then CrossRef as fallback
  const dc = await resolveDoiViaDataCite(doi)
  if (dc) return dc
  return resolveDoiViaCrossRef(doi)
}

async function main() {
  console.log('Discover Datasets from VLM-Extracted Links')
  console.log('===========================================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Find unlinked data repos with DOIs not already in datasets
    const { rows: candidates } = await db.query(`
      SELECT dr.id, dr.external_doi, dr.platform, dr.description as vlm_description,
             dr.publication_id, dr.url
      FROM data_repositories dr
      WHERE dr.linked_dataset_id IS NULL
        AND dr.external_doi IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM datasets d WHERE d.doi = dr.external_doi)
      ORDER BY dr.id
    `)

    const toProcess = candidates.slice(0, limit)
    console.log(`\n${candidates.length} unlinked data repos with DOIs (processing ${toProcess.length})`)

    let resolved = 0
    let added = 0
    let failed = 0
    let skipped = 0

    for (let i = 0; i < toProcess.length; i++) {
      const repo = toProcess[i]
      process.stdout.write(`\r  [${i + 1}/${toProcess.length}] Resolving ${repo.external_doi}...`)

      const meta = await resolveDoi(repo.external_doi)
      await sleep(200) // polite rate limiting

      if (!meta) {
        // DOI not in DataCite — might be a non-dataset DOI (journal article, etc.)
        failed++
        continue
      }

      // Skip if it looks like a publication, not a dataset
      const pubTypes = ['text', 'journal-article', 'book-chapter', 'book', 'proceedings-article', 'dissertation', 'posted-content', 'peer-review']
      if (pubTypes.includes(meta.resourceType)) {
        skipped++
        continue
      }

      resolved++

      if (dryRun) {
        console.log(`\n    → "${meta.title.slice(0, 70)}" (${meta.publicationYear || '?'}) [${meta.resourceType}]`)
        continue
      }

      // Insert into datasets collection via SQL (matches Payload schema)
      // Check if DOI already exists (no unique index, so can't use ON CONFLICT)
      const { rows: existing } = await db.query('SELECT id FROM datasets WHERE doi = $1', [meta.doi])
      let datasetId: number
      if (existing.length > 0) {
        datasetId = existing[0].id
      } else {
        const { rows: [inserted] } = await db.query(`
          INSERT INTO datasets (title, doi, description, resource_type, publication_year,
                                download_url, external_catalog_url, updated_at, created_at)
          VALUES ($1, $2, $3, 'dataset'::enum_datasets_resource_type, $4, $5, $6, NOW(), NOW())
          RETURNING id
        `, [
          meta.title,
          meta.doi,
          meta.description ? JSON.stringify([{ children: [{ text: meta.description }] }]) : null,
          meta.publicationYear,
          meta.downloadUrl || repo.url,
          meta.catalogUrl,
        ])
        datasetId = inserted.id
      }

      // Link the data_repository to the new dataset
      await db.query(
        'UPDATE data_repositories SET linked_dataset_id = $1 WHERE id = $2',
        [datasetId, repo.id],
      )

      if (existing.length > 0) { added++; continue } // already existed, just linked

      // Store methods/keywords as full_text for search indexing
      const fullTextParts = [meta.description || '', meta.keywords.join(', ')].filter(Boolean)
      if (fullTextParts.length > 0) {
        await db.query('UPDATE datasets SET full_text = $1 WHERE id = $2 AND full_text IS NULL',
          [fullTextParts.join('\n\n'), datasetId])
      }

      added++
    }

    console.log(`\n\n========== Summary ==========`)
    console.log(`  Candidates:  ${toProcess.length}`)
    console.log(`  Resolved:    ${resolved}`)
    console.log(`  Added:       ${added}`)
    console.log(`  Not in DataCite: ${failed}`)
    console.log(`  Skipped (non-dataset): ${skipped}`)

    // Update search vectors for new datasets
    if (added > 0 && !dryRun) {
      console.log(`\nUpdating search vectors...`)
      await db.query(`
        UPDATE datasets SET search_vector =
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(full_text, '')), 'B')
        WHERE search_vector IS NULL
      `)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
