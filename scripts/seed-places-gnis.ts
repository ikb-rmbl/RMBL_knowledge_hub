/**
 * Seed Places from GNIS (Geographic Names Information System)
 *
 * Imports authoritative place data from the RMBL-enhanced GNIS CSV and uses
 * it to:
 *   1. Merge with existing VLM-extracted places where names match
 *   2. Update coordinates, elevation, and place_type from authoritative source
 *   3. Optionally import new GNIS places that weren't VLM-extracted (for future use)
 *
 * The GNIS CSV has 668 places with verified lat/lon and elevation in the
 * Upper Gunnison region.
 *
 * Usage:
 *   npx tsx scripts/seed-places-gnis.ts [--csv=path] [--import-new] [--dry-run]
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const importNew = args.includes('--import-new')
const csvArg = args.find((a) => a.startsWith('--csv='))?.split('=')[1] || '/tmp/gnis_places.csv'

// ---------------------------------------------------------------------------
// GNIS feature class → our place_type mapping
// ---------------------------------------------------------------------------

const FEATURE_CLASS_MAP: Record<string, string> = {
  'Summit': 'peak',
  'Stream': 'stream',
  'Lake': 'lake',
  'Reservoir': 'lake',
  'Valley': 'valley',
  'Basin': 'valley',
  'Flat': 'meadow',
  'Park': 'meadow',         // in GNIS, "Park" often means a meadow/flat area
  'Gap': 'named_point',
  'Spring': 'named_point',
  'Falls': 'named_point',
  'Populated Place': 'town',
  'Civil': 'county',
  'Locale': 'named_point',
  'Mine': 'named_point',
  'Trail': 'trail',
  'Canal': 'stream',
  'Building': 'named_point',
  'Church': 'named_point',
  'School': 'named_point',
  'Cemetery': 'named_point',
  'Tower': 'named_point',
  'Pillar': 'peak',
  'Cliff': 'peak',
  'Ridge': 'peak',
  'Cape': 'named_point',
  'Bench': 'named_point',
  'Crossing': 'named_point',
  'Dam': 'named_point',
  'Gut': 'stream',
  'Hospital': 'named_point',
  'Lava': 'named_point',
  'Oilfield': 'named_point',
  'Post Office': 'named_point',
  'Range': 'region',
  'Swamp': 'meadow',
  'Well': 'named_point',
  'Woods': 'named_point',
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

interface GNISPlace {
  featureId: string
  name: string
  featureClass: string
  county: string
  lat: number
  lon: number
  elevationM: number | null
  mapName: string
}

function loadGNIS(csvPath: string): GNISPlace[] {
  const csv = readFileSync(csvPath, 'utf-8')
  const lines = csv.split('\n').filter((l) => l.trim())
  const header = parseCsvLine(lines[0])
  const idx = (name: string) => header.indexOf(name)

  const places: GNISPlace[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const lat = parseFloat(fields[idx('PRIM_LAT_DEC')])
    const lon = parseFloat(fields[idx('PRIM_LONG_DEC')])
    if (isNaN(lat) || isNaN(lon)) continue

    places.push({
      featureId: fields[idx('FEATURE_ID')]?.trim() || '',
      name: fields[idx('FEATURE_NAME')]?.trim() || '',
      featureClass: fields[idx('FEATURE_CLASS')]?.trim() || '',
      county: fields[idx('COUNTY_NAME')]?.trim() || '',
      lat,
      lon,
      elevationM: fields[idx('ELEV_IN_M')] ? parseInt(fields[idx('ELEV_IN_M')].replace(/"/g, ''), 10) || null : null,
      mapName: fields[idx('MAP_NAME')]?.trim() || '',
    })
  }
  return places
}

// Simple trigram similarity for fuzzy matching
function trigramSim(a: string, b: string): number {
  const ta = new Set<string>()
  const tb = new Set<string>()
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  for (let i = 0; i <= la.length - 3; i++) ta.add(la.slice(i, i + 3))
  for (let i = 0; i <= lb.length - 3; i++) tb.add(lb.slice(i, i + 3))
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  const union = ta.size + tb.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seed Places from GNIS')
  console.log('=====================')
  if (dryRun) console.log('(DRY RUN)')
  console.log(`CSV: ${csvArg}`)
  console.log(`Import new GNIS places: ${importNew}`)
  console.log()

  const gnisPlaces = loadGNIS(csvArg)
  console.log(`Loaded ${gnisPlaces.length} GNIS places`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Load existing places
    const { rows: existingPlaces } = await db.query('SELECT id, name, place_type, lat, lon, elevation_m FROM places ORDER BY id')
    console.log(`Existing VLM places: ${existingPlaces.length}`)

    // Build lookup index for existing places
    const byExactName = new Map<string, typeof existingPlaces[0]>()
    for (const p of existingPlaces) {
      byExactName.set(p.name.toLowerCase(), p)
    }

    let exactMatches = 0
    let fuzzyMatches = 0
    let coordsUpdated = 0
    let elevUpdated = 0
    let typeUpdated = 0
    let gnisIdAdded = 0
    let newImported = 0

    for (const gnis of gnisPlaces) {
      const gnisKey = gnis.name.toLowerCase()
      const placeType = FEATURE_CLASS_MAP[gnis.featureClass] || 'named_point'

      // Strategy 1: exact name match
      let match = byExactName.get(gnisKey)
      let matchType = 'exact'

      // Strategy 2: fuzzy name match (threshold 0.7)
      if (!match) {
        let bestSim = 0
        let bestMatch: typeof existingPlaces[0] | null = null
        for (const p of existingPlaces) {
          const sim = trigramSim(gnis.name, p.name)
          if (sim > bestSim && sim > 0.7) {
            bestSim = sim
            bestMatch = p
          }
        }
        if (bestMatch) {
          match = bestMatch
          matchType = `fuzzy (${bestSim.toFixed(2)})`
        }
      }

      if (match) {
        if (matchType === 'exact') exactMatches++
        else fuzzyMatches++

        if (dryRun) {
          if (matchType !== 'exact') {
            console.log(`  FUZZY: "${gnis.name}" → "${match.name}" (${matchType})`)
          }
          continue
        }

        // Always prefer GNIS coordinates (authoritative) over VLM-extracted ones
        if (gnis.lat && gnis.lon) {
          await db.query('UPDATE places SET lat = $1, lon = $2 WHERE id = $3', [gnis.lat, gnis.lon, match.id])
          coordsUpdated++
        }

        // Update elevation if GNIS has it and existing doesn't or existing is clearly wrong
        // (anything > 5000m in Colorado is likely feet-not-meters from VLM)
        const existingElevWrong = match.elevation_m && match.elevation_m > 5000
        if (gnis.elevationM && (!match.elevation_m || existingElevWrong)) {
          await db.query('UPDATE places SET elevation_m = $1 WHERE id = $2', [gnis.elevationM, match.id])
          elevUpdated++
        }

        // Add GNIS feature ID to external_ids
        await db.query(`
          UPDATE places SET external_ids = COALESCE(external_ids, '{}'::jsonb) || $1::jsonb WHERE id = $2
        `, [JSON.stringify({ gnis: gnis.featureId }), match.id])
        gnisIdAdded++

      } else if (importNew) {
        // Import as new place (not VLM-extracted, but available for future matching)
        if (!dryRun) {
          await db.query(
            `INSERT INTO places (name, place_type, scale, lat, lon, elevation_m, external_ids, description)
             VALUES ($1, $2, 'local', $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [
              gnis.name,
              placeType,
              gnis.lat,
              gnis.lon,
              gnis.elevationM,
              JSON.stringify({ gnis: gnis.featureId }),
              `GNIS ${gnis.featureClass} in ${gnis.county} County (${gnis.mapName} quad)`,
            ],
          )
        }
        newImported++
      }
    }

    console.log('\n========== Summary ==========')
    console.log(`GNIS places processed: ${gnisPlaces.length}`)
    console.log(`Matched to existing VLM places:`)
    console.log(`  Exact: ${exactMatches}`)
    console.log(`  Fuzzy: ${fuzzyMatches}`)
    console.log(`  Total: ${exactMatches + fuzzyMatches} of ${existingPlaces.length} VLM places`)
    if (!dryRun) {
      console.log(`Updates applied:`)
      console.log(`  Coordinates updated: ${coordsUpdated}`)
      console.log(`  Elevation updated: ${elevUpdated}`)
      console.log(`  GNIS ID added: ${gnisIdAdded}`)
      if (importNew) console.log(`  New places imported: ${newImported}`)
    } else {
      console.log(`(DRY RUN — no updates applied)`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
