import { describe, it, expect } from 'vitest'
import {
  sdpFileStem,
  normalizeTitle,
  mapStacLicense,
  bboxToSpatialExtent,
  normalizeStacCollection,
  publicationYearFor,
  stacBrowserUrl,
  type StacCollection,
} from '../lib/sdp-stac.js'

describe('sdpFileStem', () => {
  it('strips extension and version from COG URLs', () => {
    expect(
      sdpFileStem('https://rmbl-sdp.s3.us-east-2.amazonaws.com/data_products/released/release1/UER_dem_1m_v2.tif'),
    ).toBe('uer_dem_1m')
  })

  it('strips _metadata suffix from XML URLs', () => {
    expect(
      sdpFileStem('https://rmbl-sdp.s3.us-east-2.amazonaws.com/data_products/released/release1/UER_dem_1m_v2_metadata.xml'),
    ).toBe('uer_dem_1m')
  })

  it('handles time-series download_links.html pages', () => {
    expect(
      sdpFileStem('https://rmbl-sdp.s3.us-east-2.amazonaws.com/data_products/released/release4/UG_snow_length_yearly_27m_v1/download_links.html'),
    ).toBe('ug_snow_length_yearly_27m')
  })

  it('returns null for non-file URLs and empty input', () => {
    expect(sdpFileStem('https://example.org/page')).toBeNull()
    expect(sdpFileStem(null)).toBeNull()
    expect(sdpFileStem(undefined)).toBeNull()
  })
})

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Snow-free Growing Degree-days (Late Season)')).toBe(
      'snowfree growing degreedays late season',
    )
  })
})

describe('mapStacLicense', () => {
  it('maps SPDX ids to license enum values', () => {
    expect(mapStacLicense('CC-BY-4.0')).toBe('cc_by_4')
    expect(mapStacLicense('CC0-1.0')).toBe('cc0')
  })
  it('falls back to other', () => {
    expect(mapStacLicense('proprietary')).toBe('other')
    expect(mapStacLicense(undefined)).toBe('other')
  })
})

describe('bboxToSpatialExtent', () => {
  it('converts [w,s,e,n] to the Payload shape', () => {
    expect(bboxToSpatialExtent([-107.1, 38.8, -106.9, 39.0])).toEqual({
      westBoundLongitude: -107.1,
      southBoundLatitude: 38.8,
      eastBoundLongitude: -106.9,
      northBoundLatitude: 39.0,
    })
  })
  it('rejects malformed bboxes', () => {
    expect(bboxToSpatialExtent(undefined)).toBeNull()
    expect(bboxToSpatialExtent([1, 2])).toBeNull()
    expect(bboxToSpatialExtent([NaN, 1, 2, 3])).toBeNull()
  })
})

const COLLECTION: StacCollection = {
  type: 'Collection',
  id: 'gt-dem',
  title: '5 cm DEM for the Gothic Townsite',
  description: 'A DEM.',
  license: 'CC-BY-4.0',
  links: [],
  extent: {
    spatial: { bbox: [[-107.0, 38.95, -106.98, 38.97]] },
    temporal: { interval: [['2021-05-01T00:00:00Z', '2021-11-01T00:00:00Z']] },
  },
  deprecated: true,
  'rmbl:catalog_id': 'R6D004',
  'rmbl:new_version_id': 'R7D007',
}

describe('normalizeStacCollection', () => {
  it('flattens a STAC collection into an SdpStacRecord', () => {
    const rec = normalizeStacCollection(COLLECTION, 'rmbl-sdp-gt', 'https://x/collection.json', 'https://x/a.tif', 1)
    expect(rec).toMatchObject({
      catalogId: 'R6D004',
      deprecated: true,
      newVersionId: 'R7D007',
      license: 'cc_by_4',
      temporalStart: '2021-05-01T00:00:00Z',
      nItems: 1,
    })
    expect(rec!.spatialExtent!.westBoundLongitude).toBe(-107.0)
  })

  it('returns null without a catalog_id', () => {
    const bare = { ...COLLECTION, 'rmbl:catalog_id': undefined }
    expect(normalizeStacCollection(bare, 'rmbl-sdp-gt', 'u', null, 0)).toBeNull()
  })
})

describe('publicationYearFor', () => {
  it('uses the SDP release year from the catalog id (R6 → 2025)', () => {
    const rec = normalizeStacCollection(COLLECTION, 'rmbl-sdp-gt', 'u', null, 1)!
    expect(publicationYearFor(rec)).toBe(2025)
  })

  it('falls back to temporal start for ids outside the release pattern', () => {
    const rec = normalizeStacCollection(
      { ...COLLECTION, 'rmbl:catalog_id': 'XX999' }, 'rmbl-sdp-gt', 'u', null, 1,
    )!
    expect(publicationYearFor(rec)).toBe(2021)
  })

  it('dates basemaps to 2021', () => {
    const rec = normalizeStacCollection(
      { ...COLLECTION, 'rmbl:catalog_id': 'BM008' }, 'rmbl-sdp-gt', 'u', null, 1,
    )!
    expect(publicationYearFor(rec)).toBe(2021)
  })
})

describe('stacBrowserUrl', () => {
  it('wraps the collection URL in the Radiant Earth browser', () => {
    expect(stacBrowserUrl('https://rmbl-sdp.s3.us-east-2.amazonaws.com/stac/v1/x/collection.json')).toBe(
      'https://radiantearth.github.io/stac-browser/#/external/rmbl-sdp.s3.us-east-2.amazonaws.com/stac/v1/x/collection.json',
    )
  })
})
