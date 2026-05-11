/**
 * Enrich dataset metadata from source repositories.
 *
 * Three strategies based on repository source:
 *   1. DataCite API (DOI-based) — Dryad, Zenodo, USGS, NSIDC, Figshare, ARM, etc.
 *   2. EML via PASTA/DataONE API — EDI, DataONE, ESS-DIVE
 *   3. Direct XML fetch — RMBL SDP (QGIS-style metadata XML)
 *
 * Enriches datasets with: methods, keywords (→ full_text), geographic description,
 * temporal coverage, and spatial extent where available.
 *
 * Usage:
 *   npx tsx scripts/enrich-dataset-metadata.ts [--dry-run] [--limit=N] [--source=datacite|eml|rmbl-sdp|all]
 */

import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'
import { curatedSafe } from './lib/curation.js'
import { parseEml, xmlText, xmlTextAll } from './lib/eml-parser.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity
const sourceFilter = args.find((a) => a.startsWith('--source='))?.split('=')[1] || 'all'

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

type RepoSource = 'datacite' | 'eml' | 'rmbl-sdp' | 'unknown'

function detectSource(catalogUrl: string | null, doi: string | null): RepoSource {
  if (!catalogUrl && !doi) return 'unknown'
  const url = (catalogUrl || '').toLowerCase()

  // EML sources (DataONE, ESS-DIVE, EDI/PASTA)
  if (url.includes('pasta') || url.includes('edi')) return 'eml'
  if (url.includes('dataone') || url.includes('cn.dataone')) return 'eml'
  if (url.includes('ess-dive')) return 'eml'

  // RMBL SDP direct XML
  if (url.includes('rmbl-sdp') && url.includes('.xml')) return 'rmbl-sdp'

  // Everything with a DOI goes through DataCite
  if (doi) return 'datacite'

  return 'unknown'
}

// ---------------------------------------------------------------------------
// Strategy 1: DataCite API
// ---------------------------------------------------------------------------

interface EnrichedMetadata {
  methods: string | null
  keywords: string[]
  geoDescription: string | null
  geoCoordinates: { lat: number; lon: number } | null
  temporalStart: string | null
  temporalEnd: string | null
  abstract: string | null
  fullTextParts: string[]  // all text parts for building enriched full_text
}

async function fetchDataCite(doi: string): Promise<EnrichedMetadata | null> {
  const url = `https://api.datacite.org/dois/${encodeURIComponent(doi)}`
  const res = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } })
  if (!res.ok) return null

  const data = await res.json()
  const attrs = data?.data?.attributes
  if (!attrs) return null

  const descriptions = (attrs.descriptions || []) as { description: string; descriptionType: string }[]
  const abstract = descriptions.find((d) => d.descriptionType === 'Abstract')?.description || null
  const methods = descriptions.find((d) => d.descriptionType === 'Methods')?.description || null
  const otherDesc = descriptions
    .filter((d) => d.descriptionType !== 'Abstract' && d.descriptionType !== 'Methods')
    .map((d) => d.description)
    .join('\n\n')

  const keywords = (attrs.subjects || []).map((s: any) => s.subject).filter(Boolean)

  // Geographic coverage
  const geoLocs = attrs.geoLocations || []
  let geoDescription: string | null = null
  let geoCoordinates: { lat: number; lon: number } | null = null
  for (const geo of geoLocs) {
    if (geo.geoLocationPlace) geoDescription = geo.geoLocationPlace
    if (geo.geoLocationPoint) {
      geoCoordinates = {
        lat: parseFloat(geo.geoLocationPoint.pointLatitude),
        lon: parseFloat(geo.geoLocationPoint.pointLongitude),
      }
    }
  }

  // Temporal coverage
  const dates = attrs.dates || []
  const collected = dates.find((d: any) => d.dateType === 'Collected')
  let temporalStart: string | null = null
  let temporalEnd: string | null = null
  if (collected?.date) {
    const parts = collected.date.split('/')
    temporalStart = parts[0] || null
    temporalEnd = parts[1] || parts[0] || null
  }

  const fullTextParts = [abstract, methods, otherDesc, keywords.join(', '), geoDescription].filter(Boolean) as string[]

  return { methods, keywords, geoDescription, geoCoordinates, temporalStart, temporalEnd, abstract, fullTextParts }
}

// ---------------------------------------------------------------------------
// Strategy 2: EML via PASTA/DataONE API
// ---------------------------------------------------------------------------

function extractEdiPackageId(url: string): string | null {
  // https://portal.edirepository.org/nis/metadataviewer?packageid=edi.391.1
  const match = url.match(/packageid=([^&]+)/i)
  if (match) return match[1]
  // https://doi.org/10.6073/pasta/...
  const pastaMatch = url.match(/pasta\/([a-f0-9]+)/)
  if (pastaMatch) return null // Can't easily reverse PASTA hash to package ID
  return null
}

function extractDataOneId(url: string): string | null {
  // https://search.dataone.org/view/sha256%3A...
  // https://search.dataone.org/view/ess-dive-...
  const match = url.match(/\/view\/(.+?)(?:\?|$)/)
  if (match) return decodeURIComponent(match[1])
  return null
}

async function fetchEml(catalogUrl: string): Promise<EnrichedMetadata | null> {
  const url = catalogUrl.toLowerCase()

  let emlXml: string | null = null

  // EDI/PASTA — convert viewer URL to API URL
  if (url.includes('edi') || url.includes('pasta')) {
    const pkgId = extractEdiPackageId(catalogUrl)
    if (pkgId) {
      const parts = pkgId.split('.')
      if (parts.length === 3) {
        const apiUrl = `https://pasta.lternet.edu/package/metadata/eml/${parts[0]}/${parts[1]}/${parts[2]}`
        const res = await fetch(apiUrl)
        if (res.ok) emlXml = await res.text()
      }
    }
    // Also try PASTA DOI URLs
    if (!emlXml && url.includes('pasta/')) {
      const res = await fetch(catalogUrl.replace('doi.org/10.6073/', 'pasta.lternet.edu/package/doi/doi:10.6073/'))
      if (res.ok) {
        const body = await res.text()
        if (body.includes('<eml:eml') || body.includes('<eml ')) emlXml = body
      }
    }
  }

  // DataONE — fetch object metadata
  if (!emlXml && url.includes('dataone')) {
    const objId = extractDataOneId(catalogUrl)
    if (objId) {
      // Try multiple DataONE member nodes
      for (const baseUrl of [
        'https://cn.dataone.org/cn/v2/object/',
        'https://mn-unm-1.dataone.org/knb/d1/mn/v2/object/',
      ]) {
        const res = await fetch(`${baseUrl}${encodeURIComponent(objId)}`, {
          headers: { Accept: 'application/xml' },
        })
        if (res.ok) {
          const body = await res.text()
          if (body.includes('<eml:eml') || body.includes('<eml ') || body.includes('<dataset>')) {
            emlXml = body
            break
          }
        }
      }
    }
  }

  // ESS-DIVE — try DataONE member node
  if (!emlXml && url.includes('ess-dive')) {
    const doi = url.match(/doi[:%]([^&\s]+)/i)?.[1]
    if (doi) {
      const res = await fetch(`https://data.ess-dive.lbl.gov/catalog/d1/mn/v2/object/${encodeURIComponent('doi:' + doi)}`, {
        headers: { Accept: 'application/xml' },
      })
      if (res.ok) {
        const body = await res.text()
        if (body.includes('<eml') || body.includes('<dataset>')) emlXml = body
      }
    }
  }

  if (!emlXml) return null

  const parsed = parseEml(emlXml)
  return {
    methods: parsed.methods,
    keywords: parsed.keywords,
    geoDescription: parsed.geographicDescription,
    geoCoordinates: null,
    temporalStart: null,
    temporalEnd: null,
    abstract: parsed.abstract,
    fullTextParts: [parsed.abstract, parsed.methods, parsed.geographicDescription, parsed.keywords.join(', ')].filter(Boolean) as string[],
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: RMBL SDP direct XML (QGIS metadata format)
// ---------------------------------------------------------------------------

async function fetchRmblSdp(xmlUrl: string): Promise<EnrichedMetadata | null> {
  const res = await fetch(xmlUrl)
  if (!res.ok) return null
  const xml = await res.text()

  const abstract = xmlText(xml, 'abstract')
  const keywords = xmlTextAll(xml, 'keyword')
  const license = xmlText(xml, 'license')

  // QGIS metadata has extent info
  const spatialExtent = xmlText(xml, 'spatial')

  const fullTextParts = [abstract, keywords.join(', ')].filter(Boolean) as string[]

  return {
    methods: null,  // QGIS metadata doesn't typically include methods
    keywords,
    geoDescription: spatialExtent,
    geoCoordinates: null,
    temporalStart: null,
    temporalEnd: null,
    abstract,
    fullTextParts,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Enrich Dataset Metadata')
  console.log('=======================')
  if (dryRun) console.log('(DRY RUN)')
  console.log(`Source filter: ${sourceFilter}`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Load datasets that need enrichment (no methods)
    const { rows: datasets } = await db.query(`
      SELECT id, title, doi, external_catalog_url, methods,
             length(coalesce(full_text, '')) as text_len
      FROM datasets
      WHERE methods IS NULL
      ORDER BY id
    `)

    // Classify by source
    const classified = datasets.map((d) => ({
      ...d,
      source: detectSource(d.external_catalog_url, d.doi),
    }))

    const filtered = sourceFilter === 'all'
      ? classified.filter((d) => d.source !== 'unknown')
      : classified.filter((d) => d.source === sourceFilter)

    const toProcess = filtered.slice(0, limit)

    // Report
    const sourceCounts = new Map<string, number>()
    for (const d of classified) sourceCounts.set(d.source, (sourceCounts.get(d.source) || 0) + 1)
    console.log(`\nDatasets needing enrichment: ${datasets.length}`)
    for (const [src, cnt] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${src}: ${cnt}`)
    }
    console.log(`Processing: ${toProcess.length}`)

    let enriched = 0
    let failed = 0
    let skipped = 0
    const sourceStats = { datacite: 0, eml: 0, 'rmbl-sdp': 0 }

    for (let i = 0; i < toProcess.length; i++) {
      const ds = toProcess[i]
      if ((i + 1) % 25 === 0 || i === 0) {
        process.stdout.write(`\r  [${i + 1}/${toProcess.length}] enriched=${enriched} failed=${failed}`)
      }

      let meta: EnrichedMetadata | null = null
      try {
        if (ds.source === 'datacite') {
          meta = await fetchDataCite(ds.doi)
        } else if (ds.source === 'eml') {
          meta = await fetchEml(ds.external_catalog_url)
        } else if (ds.source === 'rmbl-sdp') {
          meta = await fetchRmblSdp(ds.external_catalog_url)
        }
      } catch (err: any) {
        failed++
        continue
      }

      await sleep(200) // polite rate limiting

      if (!meta || meta.fullTextParts.length === 0) {
        skipped++
        continue
      }

      if (dryRun) {
        console.log(`\n    ${ds.id}: [${ds.source}] methods=${meta.methods ? meta.methods.length + 'c' : 'no'} kw=${meta.keywords.length} geo=${meta.geoDescription ? 'yes' : 'no'}`)
        enriched++
        sourceStats[ds.source as keyof typeof sourceStats]++
        continue
      }

      // Update DB
      const updates: string[] = []
      const values: any[] = []
      let paramIdx = 1

      if (meta.methods) {
        updates.push(curatedSafe('methods', `$${paramIdx}`))
        values.push(meta.methods.slice(0, 10000))
        paramIdx++
      }

      // Enrich full_text if our fetched text is substantially richer
      const newFullText = meta.fullTextParts.join('\n\n')
      if (newFullText.length > ds.text_len + 100) {
        updates.push(`full_text = $${paramIdx}`)
        values.push(newFullText.slice(0, 50000))
        paramIdx++
      }

      if (meta.geoDescription && !ds.spatial_description) {
        updates.push(curatedSafe('spatial_description', `$${paramIdx}`))
        values.push(meta.geoDescription.slice(0, 500))
        paramIdx++
      }

      if (updates.length > 0) {
        await db.query(
          `UPDATE datasets SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          [...values, ds.id],
        )
        enriched++
        sourceStats[ds.source as keyof typeof sourceStats]++
      } else {
        skipped++
      }
    }

    console.log(`\r  [${toProcess.length}/${toProcess.length}] done`)
    console.log(`\n========== Summary ==========`)
    console.log(`  Processed:  ${toProcess.length}`)
    console.log(`  Enriched:   ${enriched}`)
    console.log(`  Skipped:    ${skipped}`)
    console.log(`  Failed:     ${failed}`)
    console.log(`  By source:`)
    for (const [src, cnt] of Object.entries(sourceStats)) {
      if (cnt > 0) console.log(`    ${src}: ${cnt}`)
    }

    // Update search vectors for enriched datasets
    if (enriched > 0 && !dryRun) {
      console.log('\nUpdating search vectors...')
      await db.query(`
        UPDATE datasets SET search_vector =
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(full_text, '')), 'B')
        WHERE methods IS NOT NULL
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
