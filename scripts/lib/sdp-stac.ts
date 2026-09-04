/**
 * SDP STAC catalog helpers — pure functions used by sync-sdp-stac.ts.
 *
 * The SDP publishes a static STAC v1.1 catalog on S3. Each dataset is a STAC
 * Collection carrying rmbl:* extension fields (catalog_id, domain, type,
 * release) plus deprecation/successor links. Collections are the unit we map
 * onto Knowledge Commons dataset records; items (per-date COGs) are only
 * sampled for a representative download URL.
 */

export const SDP_STAC_ROOT_URL =
  'https://rmbl-sdp.s3.us-east-2.amazonaws.com/stac/v1/catalog.json'

export const SDP_BROWSER_URL = 'https://sdpbrowser.org'

/** Human-readable STAC Browser view of a collection.json URL. */
export function stacBrowserUrl(collectionJsonUrl: string): string {
  return `https://radiantearth.github.io/stac-browser/#/external/${collectionJsonUrl.replace(/^https?:\/\//, '')}`
}

export interface StacLink {
  rel: string
  href: string
  title?: string
  type?: string
}

export interface StacCollection {
  type: string
  id: string
  title?: string
  description?: string
  license?: string
  links: StacLink[]
  extent?: {
    spatial?: { bbox?: number[][] }
    temporal?: { interval?: (string | null)[][] }
  }
  deprecated?: boolean
  summaries?: { gsd?: number[] }
  'rmbl:catalog_id'?: string
  'rmbl:domain'?: string
  'rmbl:type'?: string
  'rmbl:release'?: string
  'rmbl:new_version_id'?: string
}

/** Domain sub-catalog id → human-readable place name for spatial_description. */
export const DOMAIN_PLACE_NAMES: Record<string, string> = {
  'rmbl-sdp-gt': 'Gothic Townsite / Gunnison Basin, Colorado',
  'rmbl-sdp-uer': 'Upper East River / Gunnison Basin, Colorado',
  'rmbl-sdp-ug': 'Upper Gunnison Basin, Colorado',
  'rmbl-sdp-gmug': 'GMUG National Forest, Colorado',
}

const LICENSE_MAP: Record<string, string> = {
  'cc-by-4.0': 'cc_by_4',
  'cc-by-sa-4.0': 'cc_by_sa_4',
  'cc-by-nc-4.0': 'cc_by_nc_4',
  'cc0-1.0': 'cc0',
  cc0: 'cc0',
  mit: 'mit',
}

export function mapStacLicense(license: string | undefined): string {
  if (!license) return 'other'
  return LICENSE_MAP[license.toLowerCase()] ?? 'other'
}

/**
 * Normalize an SDP file URL to a comparison stem: basename minus extension,
 * `_metadata` suffix, and `_vN` version suffix, lowercased. Used to adopt
 * legacy data-catalog rows (which point at per-file COG/XML URLs) into their
 * STAC collection when no sdp_catalog_id is set yet. Handles both direct
 * file URLs and time-series `.../<stem>_vN/download_links.html` pages.
 */
export function sdpFileStem(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/([^/]+?)(?:_metadata)?\.(?:tif|tiff|xml)$/i)
    ?? url.match(/\/([^/]+?)\/download_links\.html$/i)
  if (!m) return null
  return m[1].toLowerCase().replace(/_v\d+$/, '')
}

export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

/** Payload-shaped spatial extent used by existing dataset rows. */
export interface SpatialExtent {
  westBoundLongitude: number
  eastBoundLongitude: number
  southBoundLatitude: number
  northBoundLatitude: number
}

export function bboxToSpatialExtent(bbox: number[] | undefined): SpatialExtent | null {
  if (!bbox || bbox.length < 4 || !bbox.every((v) => Number.isFinite(v))) return null
  const [west, south, east, north] = bbox
  return {
    westBoundLongitude: west,
    eastBoundLongitude: east,
    southBoundLatitude: south,
    northBoundLatitude: north,
  }
}

/** Flat record produced by the catalog walk, consumed by the upsert step. */
export interface SdpStacRecord {
  catalogId: string
  collectionId: string
  domain: string
  title: string
  description: string
  license: string
  deprecated: boolean
  newVersionId: string | null
  spatialExtent: SpatialExtent | null
  temporalStart: string | null
  temporalEnd: string | null
  /** Representative data-asset URL (single-item collections only). */
  sampleAssetUrl: string | null
  nItems: number
  collectionJsonUrl: string
  /** Ground sample distance in meters (STAC summaries.gsd). */
  gsd: number | null
}

export function normalizeStacCollection(
  c: StacCollection,
  domain: string,
  collectionJsonUrl: string,
  sampleAssetUrl: string | null,
  nItems: number,
): SdpStacRecord | null {
  const catalogId = c['rmbl:catalog_id']
  if (!catalogId || !c.title) return null
  const interval = c.extent?.temporal?.interval?.[0] ?? []
  return {
    catalogId,
    collectionId: c.id,
    domain,
    title: c.title,
    description: c.description ?? '',
    license: mapStacLicense(c.license),
    deprecated: c.deprecated === true,
    newVersionId: c['rmbl:new_version_id'] ?? null,
    spatialExtent: bboxToSpatialExtent(c.extent?.spatial?.bbox?.[0]),
    temporalStart: interval[0] ?? null,
    temporalEnd: interval[1] ?? null,
    sampleAssetUrl,
    nItems,
    collectionJsonUrl,
    gsd: typeof c.summaries?.gsd?.[0] === 'number' ? c.summaries.gsd[0] : null,
  }
}

/**
 * Publication year for a new record: the SDP RELEASE year, not data vintage —
 * a 2026-released canopy product spanning 2021–2026 was published in 2026.
 * Release years derived from S3 object dates (2026-09): R1→2020, R2/R3→2021,
 * R4→2023, R5/R6→2025, R7→2026, basemaps→2021. Falls back to temporal start,
 * then the current year, for ids outside the known pattern.
 */
const RELEASE_YEARS: Record<string, number> = { '1': 2020, '2': 2021, '3': 2021, '4': 2023, '5': 2025, '6': 2025, '7': 2026 }

export function publicationYearFor(rec: SdpStacRecord): number {
  const m = rec.catalogId.match(/^R(\d)/)
  if (m && RELEASE_YEARS[m[1]]) return RELEASE_YEARS[m[1]]
  if (rec.catalogId.startsWith('BM')) return 2021
  const y = rec.temporalStart ? new Date(rec.temporalStart).getUTCFullYear() : NaN
  return Number.isFinite(y) ? y : new Date().getUTCFullYear()
}
