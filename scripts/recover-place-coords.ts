/**
 * Recover place coordinates from Neon database.
 * After link-species-places.ts re-created places, GNIS coordinates were lost.
 * This script matches Neon places (which still have GNIS coords) to local
 * places by name and copies lat/lon/elevation.
 */
import pg from 'pg'
import './lib/config.js'

async function main() {
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub' })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, ssl: { rejectUnauthorized: false } })

  // Get Neon places with coordinates
  const { rows: neonPlaces } = await neon.query(`
    SELECT name, lat, lon, elevation_m, place_type
    FROM places WHERE lat IS NOT NULL AND lon IS NOT NULL
  `)
  console.log(`Neon places with coordinates: ${neonPlaces.length}`)

  // Build lookup by normalized name
  const coordMap = new Map<string, typeof neonPlaces[0]>()
  for (const p of neonPlaces) {
    coordMap.set(p.name.toLowerCase().trim(), p)
  }

  // Get local places without coordinates
  const { rows: localPlaces } = await local.query(`
    SELECT id, name FROM places WHERE lat IS NULL OR lon IS NULL
  `)
  console.log(`Local places without coordinates: ${localPlaces.length}`)

  let updated = 0
  for (const lp of localPlaces) {
    const match = coordMap.get(lp.name.toLowerCase().trim())
    if (match) {
      await local.query(
        'UPDATE places SET lat = $1, lon = $2, elevation_m = COALESCE(elevation_m, $3) WHERE id = $4',
        [match.lat, match.lon, match.elevation_m, lp.id],
      )
      updated++
    }
  }

  console.log(`Updated ${updated} places with recovered coordinates`)

  // Verify
  const { rows: [{ count }] } = await local.query('SELECT COUNT(*) FROM places WHERE lat IS NOT NULL')
  console.log(`Total places with coordinates: ${count}`)

  await local.end()
  await neon.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
