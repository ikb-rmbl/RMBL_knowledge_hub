/**
 * Link Species + Places Candidates to Canonical Records
 *
 * Unlike protocols/concepts (which need embedding-based clustering because
 * names vary wildly), species and places have relatively stable canonical
 * names. This script uses deterministic matching:
 *
 *   Species: group by lowercase(scientificName), create one record per unique
 *            species with the richest taxonomy from any member. Handles
 *            abbreviations via synonymsUsed ("M. flaviventris" → "Marmota
 *            flaviventris"). Uses composite scoring (centrality not applicable,
 *            so detail 50% + recency 50%) to pick the canonical description.
 *
 *   Places:  group by lowercase(name), create one record per unique place
 *            with the richest coordinates/elevation/habitat from any member.
 *            Builds parent-child hierarchy by resolving parentName references.
 *
 * Usage:
 *   npx tsx scripts/link-species-places.ts [--dry-run] [--type=species|places|all]
 */

import pg from 'pg'
import './lib/config.js'
import { resolveSpeciesViaITIS, type ITISResult } from './lib/itis-client.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const typeFilter = args.find((a) => a.startsWith('--type='))?.split('=')[1] || 'all'

// ---------------------------------------------------------------------------
// Species linking
// ---------------------------------------------------------------------------

async function linkSpecies(db: pg.Pool): Promise<void> {
  console.log('\n--- Species ---')

  const { rows: candidates } = await db.query(`
    SELECT ec.id, ec.raw_name, ec.raw_attributes, ec.source_item_id, p.year as pub_year
    FROM entity_candidates ec
    LEFT JOIN publications p ON p.id = ec.source_item_id
    WHERE ec.entity_type = 'species' AND ec.resolved_entity_id IS NULL
    ORDER BY ec.id
  `)
  console.log(`  ${candidates.length} unresolved species candidates`)
  if (candidates.length === 0) return

  // Group by canonical scientific name (lowercase, trimmed)
  // Also index by synonyms so "M. flaviventris" resolves to the full-name group
  const groups = new Map<string, typeof candidates>()
  const synonymIndex = new Map<string, string>() // synonym → canonical key

  for (const c of candidates) {
    const name = (c.raw_attributes.scientificName || c.raw_name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)

    // Index abbreviations from synonymsUsed
    for (const syn of c.raw_attributes.synonymsUsed || []) {
      const synKey = syn.trim().toLowerCase()
      if (synKey && synKey !== key) {
        synonymIndex.set(synKey, key)
      }
    }
  }

  // Merge abbreviation groups into full-name groups
  for (const [synKey, canonKey] of synonymIndex) {
    if (groups.has(synKey) && groups.has(canonKey) && synKey !== canonKey) {
      groups.get(canonKey)!.push(...groups.get(synKey)!)
      groups.delete(synKey)
    }
  }

  console.log(`  ${groups.size} unique species after initial grouping`)

  // --- ITIS Resolution: validate and canonicalize each name ---
  console.log('  Resolving names via ITIS...')
  const itisCache = new Map<string, ITISResult | null>()
  let itisExact = 0, itisFuzzy = 0, itisNotFound = 0

  for (const [key] of groups) {
    // Use the first member's scientificName for the lookup
    const firstMember = groups.get(key)![0]
    const lookupName = firstMember.raw_attributes.scientificName || firstMember.raw_name
    const result = await resolveSpeciesViaITIS(lookupName)
    itisCache.set(key, result)
    if (result) {
      if (result.matchType === 'exact' || result.matchType === 'genus_only') itisExact++
      else itisFuzzy++
    } else {
      itisNotFound++
    }
    if ((itisExact + itisFuzzy + itisNotFound) % 25 === 0) {
      process.stdout.write(`\r    ${itisExact + itisFuzzy + itisNotFound}/${groups.size} resolved (${itisExact} exact, ${itisFuzzy} fuzzy, ${itisNotFound} not found)`)
    }
  }
  console.log(`\r    ${itisExact + itisFuzzy + itisNotFound}/${groups.size} resolved (${itisExact} exact, ${itisFuzzy} fuzzy, ${itisNotFound} not found)`)

  // Re-merge groups that resolved to the same ITIS canonical name
  const mergedGroups = new Map<string, { members: typeof candidates; itis: ITISResult | null; originalKeys: string[] }>()
  for (const [key, members] of groups) {
    const itis = itisCache.get(key)
    const canonKey = itis ? itis.canonicalName.toLowerCase() : key
    if (!mergedGroups.has(canonKey)) {
      mergedGroups.set(canonKey, { members: [], itis: itis ?? null, originalKeys: [] })
    }
    mergedGroups.get(canonKey)!.members.push(...members)
    mergedGroups.get(canonKey)!.originalKeys.push(key)
    // Prefer non-null ITIS result
    if (itis && !mergedGroups.get(canonKey)!.itis) {
      mergedGroups.get(canonKey)!.itis = itis
    }
  }

  const mergesPerformed = groups.size - mergedGroups.size
  console.log(`  ${mergedGroups.size} unique species after ITIS merge (${mergesPerformed} names merged)`)

  if (dryRun) {
    console.log('\n  Top species:')
    const topGroups = [...mergedGroups.entries()].sort((a, b) => b[1].members.length - a[1].members.length).slice(0, 15)
    for (const [name, group] of topGroups) {
      const itis = group.itis
      const itisInfo = itis ? ` [ITIS:${itis.tsn} ${itis.matchType}]` : ' [no ITIS]'
      const merged = group.originalKeys.length > 1 ? ` (merged from: ${group.originalKeys.join(', ')})` : ''
      console.log(`    ${group.members.length}x  "${name}"${itisInfo}${merged}`)
    }
    console.log(`  (DRY RUN) Would create ${mergedGroups.size} species records`)
    return
  }

  // Clear previous for re-run safety
  await db.query("DELETE FROM entity_mentions WHERE entity_type = 'species'")
  await db.query('DELETE FROM species')
  await db.query("UPDATE entity_candidates SET resolved_entity_id = NULL WHERE entity_type = 'species'")

  let created = 0
  let mentions = 0

  for (const [, group] of mergedGroups) {
    const members = group.members
    const itis = group.itis

    // Pick the richest VLM member for fields ITIS doesn't provide (authority, common name, roles)
    const scored = members.map((m) => {
      const a = m.raw_attributes
      const taxFields = [a.kingdom, a.phylum, a.class, a.order, a.family].filter(Boolean).length
      const taxScore = taxFields / 5
      const hasAuth = a.authority ? 1 : 0
      const hasCommon = a.commonName ? 1 : 0
      const detail = (taxScore * 0.6 + hasAuth * 0.2 + hasCommon * 0.2)
      const years = members.map((mm) => mm.pub_year || 2000)
      const minY = Math.min(...years)
      const maxY = Math.max(...years)
      const recency = maxY > minY ? ((m.pub_year || 2000) - minY) / (maxY - minY) : 0.5
      return { member: m, score: detail * 0.6 + recency * 0.4 }
    })
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0].member.raw_attributes

    // Aggregate ecological roles and synonyms across all members
    const allRoles = new Set<string>()
    const allSynonyms = new Set<string>()
    const allCommonNames = new Set<string>()
    for (const m of members) {
      if (m.raw_attributes.role) allRoles.add(m.raw_attributes.role)
      for (const s of m.raw_attributes.synonymsUsed || []) allSynonyms.add(s)
      if (m.raw_attributes.commonName) allCommonNames.add(m.raw_attributes.commonName)
    }

    // Use ITIS data for taxonomy (authoritative), VLM for the rest
    const canonicalName = itis?.canonicalName || best.scientificName || members[0].raw_name
    const rank = itis?.rank || 'species'
    const kingdom = itis?.kingdom || best.kingdom || null
    const phylum = itis?.phylum || best.phylum || null
    const className = itis?.className || best.class || null
    const order = itis?.order || best.order || null
    const family = itis?.family || best.family || null
    const commonNames = [...allCommonNames]

    // Build external_ids with ITIS TSN
    const externalIds = itis ? { itis: String(itis.tsn) } : null

    const { rows: [sp] } = await db.query(
      `INSERT INTO species
       (canonical_name, rank, scientific_name, authority, common_names, synonyms,
        kingdom, phylum, class_name, order_name, family,
        conservation_status, native_to_rmbl, ecological_roles, external_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        canonicalName,
        rank,
        best.scientificName || null,
        best.authority || null,
        commonNames,
        [...allSynonyms],
        kingdom,
        phylum,
        className,
        order,
        family,
        best.conservationStatus || null,
        best.nativeStatus || null,
        [...allRoles],
        externalIds ? JSON.stringify(externalIds) : null,
      ],
    )
    created++

    // Link all members
    for (const m of members) {
      await db.query('UPDATE entity_candidates SET resolved_entity_id = $1 WHERE id = $2', [sp.id, m.id])
      await db.query(
        `INSERT INTO entity_mentions
         (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
         VALUES ('species', $1, 'publications', $2, $3, 1.0, 'vlm')
         ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING`,
        [sp.id, m.source_item_id, (m.raw_attributes.role || 'mentioned').slice(0, 30)],
      )
      mentions++
    }
  }

  // Update counts
  await db.query(`
    UPDATE species SET
      mention_count = (SELECT count(*) FROM entity_mentions WHERE entity_type = 'species' AND entity_id = species.id),
      publication_count = (SELECT count(DISTINCT item_id) FROM entity_mentions WHERE entity_type = 'species' AND entity_id = species.id AND collection = 'publications')
  `)

  console.log(`  Created ${created} species records, ${mentions} entity_mentions`)
  const { rows: [stats] } = await db.query(`
    SELECT count(*) as total, count(*) FILTER (WHERE publication_count > 1) as multi_pub
    FROM species
  `)
  console.log(`  Multi-publication species: ${stats.multi_pub}`)
}

// ---------------------------------------------------------------------------
// Places linking
// ---------------------------------------------------------------------------

async function linkPlaces(db: pg.Pool): Promise<void> {
  console.log('\n--- Places ---')

  const { rows: candidates } = await db.query(`
    SELECT ec.id, ec.raw_name, ec.raw_attributes, ec.source_item_id, p.year as pub_year
    FROM entity_candidates ec
    LEFT JOIN publications p ON p.id = ec.source_item_id
    WHERE ec.entity_type = 'place' AND ec.resolved_entity_id IS NULL
    ORDER BY ec.id
  `)
  console.log(`  ${candidates.length} unresolved place candidates`)
  if (candidates.length === 0) return

  // Group by lowercase name (place names are relatively stable across papers)
  const groups = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const name = (c.raw_name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  console.log(`  ${groups.size} unique places after grouping`)

  if (dryRun) {
    const topGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15)
    for (const [name, members] of topGroups) {
      const best = members.sort((a, b) => {
        const aFields = Object.values(a.raw_attributes).filter((v) => v != null && v !== '').length
        const bFields = Object.values(b.raw_attributes).filter((v) => v != null && v !== '').length
        return bFields - aFields
      })[0]
      const coords = best.raw_attributes.coordinates || 'no coords'
      console.log(`    ${members.length}x  "${name}" (${best.raw_attributes.type || '?'}) — ${coords}`)
    }
    console.log(`  (DRY RUN) Would create ${groups.size} place records`)
    return
  }

  // Clear previous for re-run safety
  await db.query("DELETE FROM entity_mentions WHERE entity_type = 'place'")
  await db.query('DELETE FROM places')
  await db.query("UPDATE entity_candidates SET resolved_entity_id = NULL WHERE entity_type = 'place'")

  let created = 0
  let mentions = 0

  // First pass: create all place records (without parent references)
  const placeIdByName = new Map<string, number>()

  for (const [key, members] of groups) {
    // Pick the member with the most populated fields
    const scored = members.map((m) => {
      const a = m.raw_attributes
      const fieldCount = [a.coordinates, a.elevation, a.elevationRange, a.habitat, a.parentName, a.scale].filter(Boolean).length
      const recency = m.pub_year || 2000
      return { member: m, fieldCount, recency }
    })
    scored.sort((a, b) => b.fieldCount - a.fieldCount || b.recency - a.recency)
    const best = scored[0].member.raw_attributes

    // Parse coordinates if present
    let lat: number | null = null
    let lon: number | null = null
    if (best.coordinates) {
      const parts = best.coordinates.split(',').map((s: string) => parseFloat(s.trim()))
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0]
        lon = parts[1]
      }
    }

    // Parse elevation (handle both string "2900 m" and number 2900)
    let elevM: number | null = null
    let elevMinM: number | null = null
    let elevMaxM: number | null = null
    const elevStr = best.elevation != null ? String(best.elevation) : null
    if (elevStr) {
      const m = elevStr.match(/(\d[\d,.]*)\s*m?/)
      if (m) elevM = parseInt(m[1].replace(',', ''), 10)
    }
    const rangeStr = best.elevationRange != null ? String(best.elevationRange) : null
    if (rangeStr) {
      const range = rangeStr.match(/([\d,.]+)\s*[-–to]+\s*([\d,.]+)\s*m?/)
      if (range) {
        elevMinM = parseInt(range[1].replace(',', ''), 10)
        elevMaxM = parseInt(range[2].replace(',', ''), 10)
      }
    }

    // Aggregate habitat types and aliases across members
    const habitats = new Set<string>()
    const aliases = new Set<string>()
    for (const m of members) {
      if (m.raw_attributes.habitat) habitats.add(m.raw_attributes.habitat)
    }

    const canonicalName = best.name || members[0].raw_name

    const { rows: [pl] } = await db.query(
      `INSERT INTO places
       (name, place_type, scale, lat, lon, elevation_m, elevation_min_m, elevation_max_m,
        habitat_types, aliases, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
       RETURNING id`,
      [
        canonicalName,
        best.type || null,
        best.scale || null,
        lat,
        lon,
        elevM,
        elevMinM,
        elevMaxM,
        [...habitats],
        [...aliases],
      ],
    )
    placeIdByName.set(key, pl.id)
    created++

    // Link all members
    for (const m of members) {
      await db.query('UPDATE entity_candidates SET resolved_entity_id = $1 WHERE id = $2', [pl.id, m.id])
      await db.query(
        `INSERT INTO entity_mentions
         (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
         VALUES ('place', $1, 'publications', $2, $3, 1.0, 'vlm')
         ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING`,
        [pl.id, m.source_item_id, (m.raw_attributes.role || 'mentioned').slice(0, 30)],
      )
      mentions++
    }
  }

  // Second pass: resolve parent_place_id from parentName references
  console.log('  Resolving parent-child hierarchy...')
  let parentsResolved = 0
  for (const [key, members] of groups) {
    const best = members.sort((a, b) => {
      const aFields = Object.values(a.raw_attributes).filter((v) => v != null && v !== '').length
      const bFields = Object.values(b.raw_attributes).filter((v) => v != null && v !== '').length
      return bFields - aFields
    })[0]
    const parentName = best.raw_attributes.parentName
    if (!parentName) continue

    const parentKey = parentName.trim().toLowerCase()
    const parentId = placeIdByName.get(parentKey)
    const childId = placeIdByName.get(key)
    if (parentId && childId && parentId !== childId) {
      await db.query('UPDATE places SET parent_place_id = $1 WHERE id = $2', [parentId, childId])
      parentsResolved++
    }
  }
  console.log(`  ${parentsResolved} parent-child links resolved`)

  // Update counts
  await db.query(`
    UPDATE places SET
      mention_count = (SELECT count(*) FROM entity_mentions WHERE entity_type = 'place' AND entity_id = places.id),
      publication_count = (SELECT count(DISTINCT item_id) FROM entity_mentions WHERE entity_type = 'place' AND entity_id = places.id AND collection = 'publications')
  `)

  console.log(`  Created ${created} place records, ${mentions} entity_mentions`)
  const { rows: [stats] } = await db.query(`
    SELECT count(*) as total,
           count(*) FILTER (WHERE publication_count > 1) as multi_pub,
           count(*) FILTER (WHERE lat IS NOT NULL) as with_coords,
           count(*) FILTER (WHERE parent_place_id IS NOT NULL) as with_parent
    FROM places
  `)
  console.log(`  Multi-publication: ${stats.multi_pub} | With coordinates: ${stats.with_coords} | With parent: ${stats.with_parent}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Link Species + Places Candidates')
  console.log('================================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    if (typeFilter === 'species' || typeFilter === 'all') await linkSpecies(db)
    if (typeFilter === 'places' || typeFilter === 'all') await linkPlaces(db)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
