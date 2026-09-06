/**
 * Dataset provenance scoring — is this RMBL/Gunnison-Basin-produced data or an
 * external reference dataset RMBL researchers use (Daymet, MODIS, USGS…)?
 *
 * Mirrors the score-rmbl-research pattern: deterministic explainable signals →
 * rmbl_origin_score; --apply also assigns the tri-state rmbl_origin flag at
 * conservative thresholds (score ≥ 3 → 'yes', ≤ 0 → 'no', else NULL = admin
 * triage queue, sorted by score in the admin sidebar).
 *
 * Signals:
 *   +3  SDP product (sdp_catalog_id) — RMBL spatial infrastructure
 *   +2  ESS-DIVE (East River Watershed Function SFA corpus)
 *   +2  basin place markers in title/description (East River, Gothic, …)
 *   +3  ≥half the creators are RMBL-research authors (+1 if any)
 *   -4  global-product markers (MODIS, Daymet, PRISM, WorldClim, global/
 *       continental-scale titles, software packages)
 *
 * Curation-aware: --apply never overwrites a curated rmbl_origin cell and only
 * fills flag values that are currently NULL (re-runs refresh scores freely,
 * flags conservatively). --force reassigns non-curated flags too.
 *
 * Usage:
 *   npx tsx scripts/score-dataset-origin.ts [--apply] [--force] [--target=neon]
 */

import pg from 'pg'
import './lib/config.js'
import { curatedSafe } from './lib/curation.js'

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'

const PLACE_RE =
  /east river|gothic|gunnison|crested butte|rocky mountain biological|\brmbl\b|mexican cut|copper creek|washington gulch|snodgrass|cement creek|almont|slate river|coal creek basin|judd falls|deer creek.{0,20}colorado/i

const GLOBAL_RE =
  /\b(modis|daymet|prism climate|worldclim|chelsa|landsat collection|sentinel-2|gbif|global assessment|north america|conterminous|contiguous united states|national land cover|nlcd|water data for the nation|dataRetrieval|terraclim|era5|gridmet)\b/i

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${apply ? ' (apply)' : ' (score only)'}`)
  const db = new pg.Pool({ connectionString })
  try {
    // creator fraction vs RMBL-research authors — computed on LOCAL data
    // shapes that exist on both DBs (authors_rels + publications are synced)
    const { rows: fracRows } = await db.query(`
      WITH rmbl_authors AS (
        SELECT DISTINCT ar.parent_id FROM authors_rels ar
        JOIN publications p ON p.id = ar.publications_id AND p.rmbl_research = 'yes'
      )
      SELECT ar.datasets_id AS id,
             count(*) AS creators,
             count(*) FILTER (WHERE ar.parent_id IN (SELECT parent_id FROM rmbl_authors)) AS rmbl_creators
      FROM authors_rels ar WHERE ar.datasets_id IS NOT NULL
      GROUP BY ar.datasets_id
    `)
    const creatorFrac = new Map<number, number>()
    for (const r of fracRows) creatorFrac.set(r.id, r.creators > 0 ? r.rmbl_creators / r.creators : 0)

    const { rows: datasets } = await db.query(
      `SELECT id, title, description, repository, sdp_catalog_id, data_publisher FROM datasets`,
    )
    let yes = 0, no = 0, triage = 0
    for (const d of datasets) {
      const text = `${d.title} ${d.description ?? ''} ${d.data_publisher ?? ''}`
      let score = 0
      if (d.sdp_catalog_id) score += 3
      if (d.repository === 'ess_dive') score += 2
      if (PLACE_RE.test(text)) score += 2
      const frac = creatorFrac.get(d.id) ?? 0
      if (frac >= 0.5) score += 3
      else if (frac > 0) score += 1
      if (GLOBAL_RE.test(text)) score -= 4

      const flag = score >= 3 ? 'yes' : score <= 0 ? 'no' : null
      if (flag === 'yes') yes++
      else if (flag === 'no') no++
      else triage++

      if (apply) {
        await db.query(
          `UPDATE datasets SET rmbl_origin_score = $1,
             ${curatedSafe('rmbl_origin', force ? '$2' : 'COALESCE(rmbl_origin, $2)')}
           WHERE id = $3`,
          [score, flag, d.id],
        )
      }
    }
    console.log(`Scored ${datasets.length}: ${yes} yes, ${no} no, ${triage} triage (NULL)`)
    if (apply) {
      const { rows: [s] } = await db.query(
        `SELECT count(*) FILTER (WHERE rmbl_origin = 'yes') AS yes,
                count(*) FILTER (WHERE rmbl_origin = 'no') AS no,
                count(*) FILTER (WHERE rmbl_origin IS NULL) AS unreviewed FROM datasets`,
      )
      console.log(`Applied: ${s.yes} yes / ${s.no} no / ${s.unreviewed} unreviewed in DB`)
    }
  } finally {
    await db.end()
  }
}

main()
