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
import { readFileSync, writeFileSync, existsSync } from 'fs'
import './lib/config.js'
import { OUTPUT_DIR } from './lib/config.js'
import { resolveSpeciesViaITIS, type ITISResult } from './lib/itis-client.js'
import { runConcurrent } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const typeFilter = args.find((a) => a.startsWith('--type='))?.split('=')[1] || 'all'
const forceItis = args.includes('--force-itis')
const itisConcurrency = parseInt(args.find((a) => a.startsWith('--itis-concurrency='))?.split('=')[1] || '3', 10)

// ---------------------------------------------------------------------------
// ITIS disk cache — persists between runs so we don't re-query known names
// ---------------------------------------------------------------------------

const ITIS_CACHE_PATH = `${OUTPUT_DIR}/itis-cache.json`

function loadItisCache(): Map<string, ITISResult | null> {
  if (forceItis || !existsSync(ITIS_CACHE_PATH)) return new Map()
  try {
    const data = JSON.parse(readFileSync(ITIS_CACHE_PATH, 'utf-8'))
    const cache = new Map<string, ITISResult | null>()
    for (const [key, val] of Object.entries(data)) cache.set(key, val as ITISResult | null)
    return cache
  } catch {
    return new Map()
  }
}

function saveItisCache(cache: Map<string, ITISResult | null>): void {
  const obj = Object.fromEntries(cache)
  writeFileSync(ITIS_CACHE_PATH, JSON.stringify(obj, null, 2))
}

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
  // Uses disk cache (Fix 2) + parallel requests (Fix 3) for scale
  const itisCache = loadItisCache()
  const cachedCount = itisCache.size
  console.log(`  ITIS cache: ${cachedCount} cached entries loaded`)

  // Identify names that need ITIS resolution (not in cache)
  const groupKeys = [...groups.keys()]
  const uncachedKeys = groupKeys.filter((key) => !itisCache.has(key))
  console.log(`  ${uncachedKeys.length} names need ITIS resolution (${groupKeys.length - uncachedKeys.length} cached)`)

  let itisExact = 0, itisFuzzy = 0, itisNotFound = 0
  let resolved = 0

  if (uncachedKeys.length > 0) {
    console.log(`  Resolving via ITIS (concurrency=${itisConcurrency})...`)

    // Build lookup name for each key
    const keyToLookup = new Map<string, string>()
    for (const key of uncachedKeys) {
      const firstMember = groups.get(key)![0]
      keyToLookup.set(key, firstMember.raw_attributes.scientificName || firstMember.raw_name)
    }

    await runConcurrent(
      uncachedKeys,
      itisConcurrency,
      async (key) => {
        const lookupName = keyToLookup.get(key)!
        const result = await resolveSpeciesViaITIS(lookupName)
        itisCache.set(key, result)
        resolved++
        if (resolved % 25 === 0) {
          process.stdout.write(`\r    ${resolved}/${uncachedKeys.length} resolved`)
        }
      },
      'ITIS resolution',
    )
    console.log(`\r    ${resolved}/${uncachedKeys.length} resolved`)
  }

  // Count match types across ALL cached results (including previously cached)
  for (const key of groupKeys) {
    const result = itisCache.get(key)
    if (result) {
      if (result.matchType === 'exact' || result.matchType === 'genus_only') itisExact++
      else itisFuzzy++
    } else {
      itisNotFound++
    }
  }
  console.log(`  ITIS totals: ${itisExact} exact, ${itisFuzzy} fuzzy, ${itisNotFound} not found`)

  // Persist cache for future runs
  saveItisCache(itisCache)
  console.log(`  ITIS cache saved (${itisCache.size} entries)`)

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

  // Collect all candidate→entity links and entity_mentions for batch write
  const allCandidateIds: number[] = []
  const allResolvedIds: number[] = []
  const allMentionEntityIds: number[] = []
  const allMentionItemIds: number[] = []
  const allMentionRoles: string[] = []

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
    // Infer rank: trust ITIS if available; otherwise detect genus-only names (single word, no epithet)
    const inferredName = itis?.canonicalName || best.scientificName || members[0].raw_name
    const rank = itis?.rank || (inferredName.trim().split(/\s+/).length === 1 ? 'genus' : 'species')
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
       ON CONFLICT (canonical_name, rank) DO UPDATE SET
         common_names = CASE WHEN array_length(EXCLUDED.common_names, 1) > coalesce(array_length(species.common_names, 1), 0) THEN EXCLUDED.common_names ELSE species.common_names END,
         synonyms = CASE WHEN array_length(EXCLUDED.synonyms, 1) > coalesce(array_length(species.synonyms, 1), 0) THEN EXCLUDED.synonyms ELSE species.synonyms END,
         external_ids = COALESCE(EXCLUDED.external_ids, species.external_ids)
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

    // Collect batch data for all members
    for (const m of members) {
      allCandidateIds.push(m.id)
      allResolvedIds.push(sp.id)
      allMentionEntityIds.push(sp.id)
      allMentionItemIds.push(m.source_item_id)
      allMentionRoles.push((m.raw_attributes.role || 'mentioned').slice(0, 30))
    }
  }

  // Batch UPDATE entity_candidates.resolved_entity_id
  if (allCandidateIds.length > 0) {
    await db.query(`
      UPDATE entity_candidates ec SET resolved_entity_id = t.resolved_id
      FROM unnest($1::int[], $2::int[]) AS t(cand_id, resolved_id)
      WHERE ec.id = t.cand_id
    `, [allCandidateIds, allResolvedIds])
  }

  // Batch INSERT entity_mentions
  if (allMentionEntityIds.length > 0) {
    await db.query(`
      INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
      SELECT 'species', unnest($1::int[]), 'publications', unnest($2::int[]), unnest($3::varchar[]), 1.0, 'vlm'
      ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING
    `, [allMentionEntityIds, allMentionItemIds, allMentionRoles])
  }

  const mentions = allMentionEntityIds.length

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

  // First pass: create all place records (without parent references)
  const placeIdByName = new Map<string, number>()
  const placeCandidateIds: number[] = []
  const placeResolvedIds: number[] = []
  const placeMentionEntityIds: number[] = []
  const placeMentionItemIds: number[] = []
  const placeMentionRoles: string[] = []

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

    // Collect batch data for all members
    for (const m of members) {
      placeCandidateIds.push(m.id)
      placeResolvedIds.push(pl.id)
      placeMentionEntityIds.push(pl.id)
      placeMentionItemIds.push(m.source_item_id)
      placeMentionRoles.push((m.raw_attributes.role || 'mentioned').slice(0, 30))
    }
  }

  // Batch UPDATE entity_candidates.resolved_entity_id
  if (placeCandidateIds.length > 0) {
    await db.query(`
      UPDATE entity_candidates ec SET resolved_entity_id = t.resolved_id
      FROM unnest($1::int[], $2::int[]) AS t(cand_id, resolved_id)
      WHERE ec.id = t.cand_id
    `, [placeCandidateIds, placeResolvedIds])
  }

  // Batch INSERT entity_mentions
  if (placeMentionEntityIds.length > 0) {
    await db.query(`
      INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
      SELECT 'place', unnest($1::int[]), 'publications', unnest($2::int[]), unnest($3::varchar[]), 1.0, 'vlm'
      ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING
    `, [placeMentionEntityIds, placeMentionItemIds, placeMentionRoles])
  }

  const mentions = placeMentionEntityIds.length

  // Second pass: resolve parent_place_id from parentName references (Fix 7: batch UPDATE)
  console.log('  Resolving parent-child hierarchy...')
  const childIds: number[] = []
  const parentIds: number[] = []
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
      childIds.push(childId)
      parentIds.push(parentId)
    }
  }
  if (childIds.length > 0) {
    await db.query(`
      UPDATE places p SET parent_place_id = t.parent_id
      FROM unnest($1::int[], $2::int[]) AS t(child_id, parent_id)
      WHERE p.id = t.child_id
    `, [childIds, parentIds])
  }
  console.log(`  ${childIds.length} parent-child links resolved`)

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
