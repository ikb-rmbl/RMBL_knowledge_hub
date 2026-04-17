import pg from 'pg'
import './lib/config.js'

async function main() {
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, ssl: { rejectUnauthorized: false } })
  const { rows } = await neon.query(`
    SELECT COUNT(*) as total,
      COUNT(*) FILTER (WHERE lat IS NOT NULL) as with_coords,
      COUNT(*) FILTER (WHERE lat BETWEEN 37 AND 40 AND lon BETWEEN -108.5 AND -105.5) as gunnison_area
    FROM places
  `)
  console.log('Neon places:', rows[0])

  const { rows: sample } = await neon.query(`
    SELECT name, place_type, lat, lon, elevation_m
    FROM places WHERE lat BETWEEN 38 AND 40 AND lon BETWEEN -108 AND -106
    ORDER BY name LIMIT 20
  `)
  console.log('\nSample near RMBL:')
  for (const r of sample) console.log(`  ${r.name} (${r.place_type}) ${r.lat}, ${r.lon} ${r.elevation_m || ''}m`)

  await neon.end()
}
main()
