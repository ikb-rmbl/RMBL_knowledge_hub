/**
 * SDP STAC catalog → Knowledge Commons datasets sync
 *
 * Walks the RMBL Spatial Data Platform's static STAC v1 catalog on S3 and
 * upserts one dataset row per STAC Collection, keyed on `sdp_catalog_id`
 * (the stable rmbl:catalog_id product code, e.g. R6D004). Replaces the SDP
 * portion of the retired RMBL Data Catalog feed (scrape-catalog.ts).
 *
 * Behavior:
 *   - Update in place when a row with the catalog_id exists (preserves row
 *     ids, and therefore entity mentions, author/project links, embeddings).
 *   - Legacy adoption: rows loaded from the old data catalog have no
 *     catalog_id — matched once by COG file stem, then exact title, and
 *     stamped with sdp_catalog_id so future runs key directly.
 *   - Deprecated collections with a successor are skipped (the successor is
 *     its own collection); deprecated without successor get a note.
 *   - Admin-curated cells (curated_fields) and duplicate_tombstones are
 *     honored. Rows are never deleted; vanished products are reported only.
 *   - Whole run is skipped when the root catalog's rmbl:catalog_version
 *     matches the previous run (state in scripts/output/; --force overrides).
 *
 * Usage:
 *   npx tsx scripts/sync-sdp-stac.ts [--dry-run] [--force] [--target=neon]
 *
 * Writes directly to local PostgreSQL by default — no dev server needed.
 * --target=neon runs the same upsert against production (NEON_DIRECT_URL),
 * the sync:safe pattern: needed after catalog updates because title-keyed
 * db-to-db sync can't pair rows whose titles the catalog rewrote. Follow
 * local runs with generate-embeddings.ts (new rows) and the normal sync.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import pg from 'pg'
import { OUTPUT_DIR } from './lib/config.js'
import { runConcurrent } from './lib/concurrency.js'
import { extractKeys, matchesAnyTombstone, type TombstoneKeys } from './lib/dedup-keys.js'
import { curatedSafe } from './lib/curation.js'
import {
  SDP_STAC_ROOT_URL,
  DOMAIN_PLACE_NAMES,
  normalizeStacCollection,
  publicationYearFor,
  sdpFileStem,
  normalizeTitle,
  stacBrowserUrl,
  type SdpStacRecord,
  type StacCollection,
  type StacLink,
} from './lib/sdp-stac.js'

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const STATE_FILE = `${OUTPUT_DIR}/sdp-stac-state${target === 'neon' ? '-neon' : ''}.json`
const CACHE_FILE = `${OUTPUT_DIR}/sdp-stac-catalog.json`

const SDP_CREATOR = 'Ian Breckheimer'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`)
  return (await res.json()) as T
}

function resolveHref(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString()
}

// ---------------------------------------------------------------------------
// Catalog walk
// ---------------------------------------------------------------------------

interface RootCatalog {
  links: StacLink[]
  'rmbl:catalog_version'?: string
}

async function walkCatalog(): Promise<{ version: string | null; records: SdpStacRecord[] }> {
  const root = await fetchJson<RootCatalog>(SDP_STAC_ROOT_URL)
  const version = root['rmbl:catalog_version'] ?? null

  const domainUrls = root.links
    .filter((l) => l.rel === 'child')
    .map((l) => resolveHref(SDP_STAC_ROOT_URL, l.href))

  const collectionRefs: { domain: string; url: string }[] = []
  for (const durl of domainUrls) {
    const dcat = await fetchJson<{ id: string; links: StacLink[] }>(durl)
    for (const l of dcat.links) {
      if (l.rel === 'child') collectionRefs.push({ domain: dcat.id, url: resolveHref(durl, l.href) })
    }
  }
  console.log(`  ${domainUrls.length} domains, ${collectionRefs.length} collections`)

  const records: SdpStacRecord[] = []
  await runConcurrent(
    collectionRefs,
    8,
    async (ref) => {
      const c = await fetchJson<StacCollection>(ref.url)
      const itemLinks = c.links.filter((l) => l.rel === 'item')
      // Sample the first item's data asset as a representative download URL.
      // Only single-item collections get a direct download_url — for time
      // series the SDP Browser / STAC Browser links are the entry points.
      let sampleAssetUrl: string | null = null
      if (itemLinks.length > 0) {
        try {
          const item = await fetchJson<{ assets?: Record<string, { href: string; type?: string }> }>(
            resolveHref(ref.url, itemLinks[0].href),
          )
          const asset = Object.values(item.assets ?? {}).find((a) =>
            (a.type ?? '').startsWith('image/tiff'),
          )
          sampleAssetUrl = asset?.href ?? null
        } catch {
          // Missing item JSON shouldn't sink the collection record.
        }
      }
      const rec = normalizeStacCollection(c, ref.domain, ref.url, sampleAssetUrl, itemLinks.length)
      if (rec) records.push(rec)
      else console.warn(`  ! skipping ${ref.url} — no rmbl:catalog_id or title`)
    },
    'STAC collections',
  )
  return { version, records }
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

interface DbRow {
  id: number
  title: string
  download_url: string | null
  external_catalog_url: string | null
  sdp_catalog_id: string | null
  publication_year: string | number | null
}

async function main() {
  const prevVersion = existsSync(STATE_FILE)
    ? (JSON.parse(readFileSync(STATE_FILE, 'utf-8')).catalogVersion as string | null)
    : null

  console.log('Walking SDP STAC catalog...')
  const { version, records } = await walkCatalog()
  console.log(`  catalog version: ${version ?? '(unversioned)'}`)
  writeFileSync(CACHE_FILE, JSON.stringify({ version, records }, null, 2))

  if (!force && version && prevVersion === version) {
    console.log(`Catalog version unchanged since last sync (${version}) — nothing to do. Use --force to sync anyway.`)
    return
  }

  // Dedupe on catalog_id — the source catalog occasionally repeats a child
  // link (e.g. R3D009 listed twice in the UG sub-catalog as of 2026-08).
  const seenIds = new Set<string>()
  const active = records.filter((r) => {
    if (r.deprecated && r.newVersionId) return false
    if (seenIds.has(r.catalogId)) return false
    seenIds.add(r.catalogId)
    return true
  })
  const skippedDeprecated = records.filter((r) => r.deprecated && r.newVersionId).length
  console.log(
    `  ${records.length} collections (${skippedDeprecated} deprecated-with-successor skipped, ` +
      `${records.length - active.length - skippedDeprecated} duplicate ids skipped)`,
  )

  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }
  console.log(`Target: ${target}`)
  const db = new pg.Pool({ connectionString })
  try {
    const tombstones: TombstoneKeys[] = (
      await db.query(`SELECT keys FROM duplicate_tombstones WHERE collection = 'datasets'`)
    ).rows.map((r) => r.keys)

    const existing: DbRow[] = (
      await db.query(
        `SELECT id, title, download_url, external_catalog_url, sdp_catalog_id, publication_year
         FROM datasets
         WHERE sdp_catalog_id IS NOT NULL
            OR external_catalog_url ILIKE '%rmbl-sdp%'
            OR download_url ILIKE '%rmbl-sdp%'`,
      )
    ).rows

    const byCatalogId = new Map<string, DbRow>()
    const legacyByStem = new Map<string, DbRow>()
    const legacyByTitle = new Map<string, DbRow>()
    for (const row of existing) {
      if (row.sdp_catalog_id) {
        byCatalogId.set(row.sdp_catalog_id, row)
      } else {
        const stem = sdpFileStem(row.download_url) ?? sdpFileStem(row.external_catalog_url)
        if (stem && !legacyByStem.has(stem)) legacyByStem.set(stem, row)
        legacyByTitle.set(normalizeTitle(row.title), row)
      }
    }

    let updated = 0
    let adopted = 0
    let inserted = 0
    let tombstoned = 0
    const claimed = new Set<number>()

    for (const rec of active) {
      let row = byCatalogId.get(rec.catalogId) ?? null
      let isAdoption = false
      if (!row) {
        const stem = sdpFileStem(rec.sampleAssetUrl)
        const candidate =
          (stem ? legacyByStem.get(stem) : undefined) ?? legacyByTitle.get(normalizeTitle(rec.title))
        if (candidate && !claimed.has(candidate.id)) {
          row = candidate
          isAdoption = true
        }
      }

      const description = rec.deprecated
        ? `[Deprecated in the SDP catalog — no successor released yet.]\n\n${rec.description}`
        : rec.description
      const downloadUrl = rec.nItems === 1 ? rec.sampleAssetUrl : null
      const catalogUrl = stacBrowserUrl(rec.collectionJsonUrl)
      const place = DOMAIN_PLACE_NAMES[rec.domain] ?? null

      if (row) {
        claimed.add(row.id)
        if (dryRun) {
          console.log(`  [dry-run] ${isAdoption ? 'ADOPT' : 'UPDATE'} ${rec.catalogId} -> row ${row.id} (${rec.title.slice(0, 60)})`)
        } else {
          // publication_year is preserved for existing rows (old catalog
          // values are release-vintage and better than our derived guess).
          const sets = [
            curatedSafe('title', '$1'),
            curatedSafe('description', '$2'),
            curatedSafe('license', '$3'),
            curatedSafe('download_url', '$4'),
            curatedSafe('external_catalog_url', '$5'),
            curatedSafe('spatial_description', '$6'),
            'sdp_catalog_id = $7',
            'spatial_extent = $8',
            'temporal_extent_start = $9',
            'temporal_extent_end = $10',
            'repository = \'s3\'',
            'full_text = $12',
            'gsd = $13',
            'updated_at = NOW()',
          ]
          await db.query(
            `UPDATE datasets SET ${sets.join(', ')} WHERE id = $11`,
            [
              rec.title,
              description,
              rec.license,
              downloadUrl,
              catalogUrl,
              place,
              rec.catalogId,
              rec.spatialExtent ? JSON.stringify(rec.spatialExtent) : null,
              rec.temporalStart,
              rec.temporalEnd,
              row.id,
              description,
              rec.gsd,
            ],
          )
        }
        if (isAdoption) adopted++
        else updated++
      } else {
        const keys = extractKeys('datasets', { doi: null, title: rec.title })
        if (matchesAnyTombstone(keys, tombstones)) {
          console.log(`  ~ skipping ${rec.catalogId} (${rec.title.slice(0, 50)}) — matches a tombstone`)
          tombstoned++
          continue
        }
        if (dryRun) {
          console.log(`  [dry-run] INSERT ${rec.catalogId} (${rec.title.slice(0, 60)})`)
        } else {
          const res = await db.query(
            `INSERT INTO datasets (
               title, description, publication_year, spatial_extent,
               temporal_extent_start, temporal_extent_end, download_url,
               repository, external_catalog_url, spatial_description, license,
               resource_type, data_publisher, full_text, sdp_catalog_id, gsd,
               created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,'s3',$8,$9,$10,'dataset','RMBL',$12,$11,$13,NOW(),NOW())
             RETURNING id`,
            [
              rec.title,
              description,
              publicationYearFor(rec),
              rec.spatialExtent ? JSON.stringify(rec.spatialExtent) : null,
              rec.temporalStart,
              rec.temporalEnd,
              downloadUrl,
              catalogUrl,
              place,
              rec.license,
              rec.catalogId,
              description,
              rec.gsd,
            ],
          )
          const newId = res.rows[0].id
          await db.query(
            `INSERT INTO datasets_creators (_order, _parent_id, id, name)
             VALUES (1, $1, gen_random_uuid()::text, $2)`,
            [newId, SDP_CREATOR],
          )
          await db.query(
            `INSERT INTO datasets_data_format (parent_id, "order", value)
             VALUES ($1, 1, 'geotiff')`,
            [newId],
          )
        }
        inserted++
      }
    }

    // Report (never delete) SDP rows no longer present in the catalog.
    const currentIds = new Set(active.map((r) => r.catalogId))
    const vanished = existing.filter(
      (r) => !claimed.has(r.id) && (!r.sdp_catalog_id || !currentIds.has(r.sdp_catalog_id)),
    )
    if (vanished.length > 0) {
      console.log(`\n  ${vanished.length} SDP rows not matched to any current STAC collection (left untouched):`)
      for (const r of vanished) console.log(`    [${r.id}] ${r.sdp_catalog_id ?? '—'} ${r.title.slice(0, 70)}`)
    }

    console.log(
      `\n${dryRun ? '[dry-run] ' : ''}Done: ${updated} updated, ${adopted} legacy rows adopted, ` +
        `${inserted} inserted, ${tombstoned} tombstone-skipped, ${vanished.length} unmatched.`,
    )

    if (!dryRun) {
      writeFileSync(STATE_FILE, JSON.stringify({ catalogVersion: version, syncedAt: new Date().toISOString() }, null, 2))
      if (inserted > 0) {
        console.log(`\nNext for the ${inserted} new rows (or run the pipeline, which covers both):`)
        console.log(`  npx tsx scripts/generate-embeddings.ts                (no embedding yet)`)
        console.log(`  npx tsx scripts/extract-dataset-variables-llm.ts      (no variables/years yet; incremental)`)
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
