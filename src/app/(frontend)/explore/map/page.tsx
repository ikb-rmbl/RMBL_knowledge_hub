import Link from 'next/link'
import { getDb } from '../../lib/db'
import LazyMap from '../../components/LazyMap'

export const dynamic = 'force-dynamic'

export default async function ExploreMapPage() {
  const db = getDb()

  // Get places with coordinates in the Colorado/Gunnison Basin region
  // Exclude obvious bad coordinates and too-general places
  const { rows: places } = await db.query(`
    SELECT id, name, place_type, lat, lon, elevation_m, mention_count
    FROM places
    WHERE lat IS NOT NULL AND lon IS NOT NULL
      AND lat BETWEEN 36.5 AND 41.5
      AND lon BETWEEN -109.5 AND -104.5
      AND mention_count > 0
      AND (place_type IS NULL OR place_type NOT IN ('country', 'state', 'region', 'bioregion'))
    ORDER BY mention_count DESC
  `)

  const mapPlaces = places.map((p: any) => ({
    id: p.id,
    name: p.name,
    placeType: p.place_type,
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon),
    elevationM: p.elevation_m ? parseInt(p.elevation_m) : null,
    mentionCount: parseInt(p.mention_count),
  }))

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <Link href="/places" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>&larr; Places</Link>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Explore Places Map</h1>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {mapPlaces.length} places with coordinates
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Geographic distribution of research sites, study areas, and landmarks across the Colorado and Gunnison Basin region.
        Point size reflects the number of entity mentions. Click a point to view the place detail page.
      </p>
      <LazyMap
        places={mapPlaces}
        center={[38.96, -107.0]}
        zoom={10}
      />
    </div>
  )
}
