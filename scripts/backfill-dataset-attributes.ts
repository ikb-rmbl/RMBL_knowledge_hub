/**
 * Dataset attribute backfill (datasets browse Tier 2)
 *
 * 1. FORMATS → datasets_data_format (only 47/1,555 rows had any):
 *    - SDP products (sdp_catalog_id set) → geotiff
 *    - download_url extension inference (.tif → geotiff, .csv, .nc, …)
 *    - EML physical formatName when an EML doc is fetched anyway
 *
 * 2. KEYWORDS → datasets.keywords text[] (facet on /datasets):
 *    EML attributeList attributeName values for ESS-DIVE / DataONE-hosted
 *    datasets, fetched via the DataONE object API (same route
 *    enrich-dataset-metadata.ts uses). Names are normalized (lowercased,
 *    underscores → spaces) and boilerplate columns (date, site, id, notes…)
 *    are dropped so the facet stays about *measurements*.
 *
 * Idempotent: skips rows that already have formats / variables (--force to
 * recompute variables).
 *
 * Usage:
 *   npx tsx scripts/backfill-dataset-attributes.ts [--dry-run] [--limit=N] [--force] [--target=neon]
 */

import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const EXT_FORMAT: Record<string, string> = {
  tif: 'geotiff', tiff: 'geotiff', csv: 'csv', nc: 'netcdf', geojson: 'geojson',
  json: 'json', xlsx: 'excel', xls: 'excel', h5: 'hdf5', hdf5: 'hdf5', shp: 'shapefile', zip: 'other',
}

// Boilerplate attribute names that would pollute a measurements facet
const VARIABLE_STOPLIST = new Set([
  'date', 'time', 'datetime', 'timestamp', 'year', 'month', 'day', 'doy',
  'site', 'site id', 'site name', 'plot', 'plot id', 'location', 'station',
  'id', 'sample id', 'sample', 'record', 'row', 'index', 'observation',
  'latitude', 'longitude', 'lat', 'lon', 'long', 'elevation', 'northing', 'easting',
  'notes', 'comments', 'comment', 'flag', 'qc flag', 'quality flag', 'method', 'source', 'file name', 'filename',
])

function normalizeVariable(name: string): string | null {
  const v = name.trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ')
  if (v.length < 3 || v.length > 45) return null
  if (/^\d+$/.test(v)) return null
  if (VARIABLE_STOPLIST.has(v)) return null
  // repository boilerplate, not science vocabulary
  if (/reporting format|file level metadata|^ess-dive|data package|^data$/.test(v)) return null
  return v
}

function parseKeywords(eml: string): string[] {
  const names = new Set<string>()
  // EML <keyword> elements are the reliable vocabulary on ESS-DIVE;
  // attributeList names are harvested too but are rarely present.
  for (const m of eml.matchAll(/<keyword[^>]*>([^<]{1,80})<\/keyword>|<attributeName>([^<]{1,100})<\/attributeName>/g)) {
    const v = normalizeVariable(m[1] ?? m[2])
    if (v) names.add(v)
  }
  return [...names].slice(0, 40)
}

function parseEmlFormats(eml: string): string[] {
  const out = new Set<string>()
  for (const m of eml.matchAll(/<formatName>([^<]{1,80})<\/formatName>|<objectName>([^<]{1,120})<\/objectName>/g)) {
    const s = (m[1] ?? m[2] ?? '').toLowerCase()
    if (s.includes('csv') || s.endsWith('.csv')) out.add('csv')
    else if (s.includes('tif')) out.add('geotiff')
    else if (s.includes('netcdf') || s.endsWith('.nc')) out.add('netcdf')
    else if (s.includes('shapefile') || s.endsWith('.shp')) out.add('shapefile')
    else if (s.endsWith('.xlsx') || s.includes('excel')) out.add('excel')
    else if (s.includes('hdf')) out.add('hdf5')
  }
  return [...out]
}

async function fetchEml(catalogUrl: string): Promise<string | null> {
  const m = catalogUrl.match(/\/view\/(.+?)(?:\?|$)/)
  if (!m) return null
  const pid = decodeURIComponent(m[1])
  try {
    const res = await fetch(`https://cn.dataone.org/cn/v2/object/${encodeURIComponent(pid)}`, {
      headers: { Accept: 'application/xml' },
    })
    if (!res.ok) return null
    const body = await res.text()
    return body.includes('<eml') ? body : null
  } catch {
    return null
  }
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  const db = new pg.Pool({ connectionString })
  try {
    // --- 1. Formats from SDP + download_url extensions (cheap, all rows) ---
    const { rows: noFormat } = await db.query(`
      SELECT id, sdp_catalog_id, download_url FROM datasets d
      WHERE NOT EXISTS (SELECT 1 FROM datasets_data_format f WHERE f.parent_id = d.id)
    `)
    let fmtAdded = 0
    for (const r of noFormat) {
      let fmt: string | null = null
      if (r.sdp_catalog_id) fmt = 'geotiff'
      else if (r.download_url) {
        const ext = r.download_url.toLowerCase().match(/\.([a-z0-9]{2,6})(?:\?|$)/)?.[1]
        fmt = ext ? EXT_FORMAT[ext] ?? null : null
      }
      if (!fmt) continue
      if (!dryRun) {
        await db.query(`INSERT INTO datasets_data_format (parent_id, "order", value) VALUES ($1, 1, $2)`, [r.id, fmt])
      }
      fmtAdded++
    }
    console.log(`Formats: ${fmtAdded} datasets inferred from SDP/extension (${noFormat.length - fmtAdded} still unknown)`)

    // --- 2. Variables (and EML formats) for DataONE-resolvable datasets ---
    const { rows: candidates } = await db.query(`
      SELECT id, external_catalog_url FROM datasets d
      WHERE external_catalog_url ~* '/view/'
        ${force ? '' : 'AND keywords IS NULL'}
      ORDER BY id ${limit ? `LIMIT ${limit}` : ''}
    `)
    console.log(`Variables: ${candidates.length} DataONE-resolvable datasets to process`)
    let varSet = 0
    let emlMiss = 0
    let done = 0
    for (const r of candidates) {
      const eml = await fetchEml(r.external_catalog_url)
      await sleep(150)
      done++
      if (done % 50 === 0) process.stdout.write(`\r  ${done}/${candidates.length}`)
      if (!eml) {
        emlMiss++
        continue
      }
      const vars = parseKeywords(eml)
      const emlFormats = parseEmlFormats(eml)
      if (dryRun) {
        if (vars.length) varSet++
        continue
      }
      if (vars.length > 0) {
        await db.query(`UPDATE datasets SET keywords = $1, updated_at = NOW() WHERE id = $2`, [vars, r.id])
        varSet++
      } else {
        // mark as processed (empty array) so re-runs skip it
        await db.query(`UPDATE datasets SET keywords = '{}' WHERE id = $1`, [r.id])
      }
      for (const f of emlFormats) {
        await db.query(
          `INSERT INTO datasets_data_format (parent_id, "order", value)
           SELECT $1, coalesce((SELECT max("order") FROM datasets_data_format WHERE parent_id = $1), 0) + 1, $2
           WHERE NOT EXISTS (SELECT 1 FROM datasets_data_format WHERE parent_id = $1 AND value = $2)`,
          [r.id, f],
        )
      }
    }
    console.log(`\r  ${done}/${candidates.length}`)
    console.log(`Variables: ${varSet} datasets populated, ${emlMiss} without fetchable EML`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
