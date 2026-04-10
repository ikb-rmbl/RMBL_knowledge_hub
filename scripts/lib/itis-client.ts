/**
 * ITIS (Integrated Taxonomic Information System) API Client
 *
 * Resolves scientific names to canonical ITIS records with:
 *   - TSN (Taxonomic Serial Number) — stable external ID
 *   - Accepted/valid name (handles synonyms and taxonomic revisions)
 *   - Full hierarchy (Kingdom → Phylum → Class → Order → Family → Genus → Species)
 *
 * Free API, no key needed. Rate limited by us to ~5 req/sec.
 * Docs: https://www.itis.gov/web_service.html
 */

import { sleep } from './concurrency.js'

const ITIS_BASE = 'https://www.itis.gov/ITISWebService/jsonservice'
const REQUEST_DELAY_MS = 200

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ITISResult {
  tsn: number
  canonicalName: string       // the accepted/valid scientific name
  rank: string                // Species, Genus, Subspecies, etc.
  kingdom: string | null
  phylum: string | null
  className: string | null    // 'class' is reserved
  order: string | null
  family: string | null
  genus: string | null
  usage: string               // 'valid', 'invalid', 'accepted', etc.
  matchType: 'exact' | 'fuzzy' | 'genus_only'
  originalQuery: string
}

// ---------------------------------------------------------------------------
// Low-level API calls
// ---------------------------------------------------------------------------

async function itisGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${ITIS_BASE}/${endpoint}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`ITIS API error ${res.status}`)
  return res.json()
}

async function searchByName(name: string): Promise<any[]> {
  const data = await itisGet('searchByScientificName', { srchKey: name })
  return (data.scientificNames || []).filter((s: any) => s !== null)
}

async function getHierarchy(tsn: number): Promise<any[]> {
  const data = await itisGet('getFullHierarchyFromTSN', { tsn: String(tsn) })
  return (data.hierarchyList || []).filter((h: any) => h !== null)
}

async function getUsage(tsn: number): Promise<string> {
  const data = await itisGet('getTaxonomicUsageFromTSN', { tsn: String(tsn) })
  return data.taxonUsageRating || 'unknown'
}

async function getAcceptedNames(tsn: number): Promise<any[]> {
  const data = await itisGet('getAcceptedNamesFromTSN', { tsn: String(tsn) })
  return (data.acceptedNames || []).filter((a: any) => a !== null)
}

// ---------------------------------------------------------------------------
// Hierarchy parser
// ---------------------------------------------------------------------------

const MAJOR_RANKS = ['Kingdom', 'Phylum', 'Class', 'Order', 'Family', 'Genus', 'Species', 'Subspecies']

function parseHierarchy(hierarchy: any[]): {
  kingdom: string | null
  phylum: string | null
  className: string | null
  order: string | null
  family: string | null
  genus: string | null
  rank: string
  canonicalName: string
} {
  const byRank: Record<string, string> = {}
  let lastRank = 'unknown'
  let lastName = ''

  for (const h of hierarchy) {
    if (h.rankName && h.taxonName) {
      byRank[h.rankName] = h.taxonName
      if (MAJOR_RANKS.includes(h.rankName)) {
        lastRank = h.rankName
        lastName = h.taxonName
      }
    }
  }

  return {
    kingdom: byRank['Kingdom'] || null,
    phylum: byRank['Phylum'] || byRank['Division'] || null,
    className: byRank['Class'] || null,
    order: byRank['Order'] || null,
    family: byRank['Family'] || null,
    genus: byRank['Genus'] || null,
    rank: lastRank.toLowerCase(),
    canonicalName: lastName,
  }
}

// ---------------------------------------------------------------------------
// Trigram similarity (simple Jaccard on character trigrams)
// ---------------------------------------------------------------------------

function trigrams(s: string): Set<string> {
  const t = new Set<string>()
  const lower = s.toLowerCase()
  for (let i = 0; i <= lower.length - 3; i++) t.add(lower.slice(i, i + 3))
  return t
}

function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  const union = ta.size + tb.size - intersection
  return union === 0 ? 0 : intersection / union
}

// Levenshtein distance normalized to [0, 1] — better than trigrams for
// single-character insertions/deletions ("flaviventer" → "flaviventris")
function levenshteinSimilarity(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  const m = la.length
  const n = lb.length
  if (m === 0) return n === 0 ? 1 : 0
  if (n === 0) return 0
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = la[i - 1] === lb[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return 1 - dp[m][n] / Math.max(m, n)
}

// Combined similarity: max of trigram and Levenshtein
function nameSimilarity(a: string, b: string): number {
  return Math.max(trigramSimilarity(a, b), levenshteinSimilarity(a, b))
}

// ---------------------------------------------------------------------------
// Public API: resolve a scientific name via ITIS
// ---------------------------------------------------------------------------

// Known VLM errors where the genus is completely wrong or both genus + epithet
// are misspelled beyond what fuzzy matching can catch. Add entries here when
// the VLM consistently produces a specific wrong name.
const MANUAL_CORRECTIONS: Record<string, string> = {
  'pinus tremuloides': 'Populus tremuloides',         // wrong genus (Pinus → Populus)
  'hymenoxia hoopseii': 'Hymenoxys hoopesii',        // double misspelling
  'hymenoxia hoopesii': 'Hymenoxys hoopesii',        // genus misspelling
  'hymenoxys hoopseii': 'Hymenoxys hoopesii',        // epithet misspelling
  'gaylphytum racemosum': 'Gayophytum racemosum',     // genus misspelling
  'monta hemisphaerica': 'Claytonia megarhiza',       // VLM confusion (needs review)
  'fragaria anassa': 'Fragaria × ananassa',           // hybrid notation
}

export async function resolveSpeciesViaITIS(scientificName: string): Promise<ITISResult | null> {
  let name = scientificName.trim()
  if (!name) return null
  // Filter pseudo-entries that aren't real species
  if (/^not specified|^unknown |^multiple |^unidentified /i.test(name)) return null

  // Apply manual corrections before searching ITIS
  const corrected = MANUAL_CORRECTIONS[name.toLowerCase()]
  if (corrected) name = corrected

  // Strip "sp.", "spp.", "spp" suffixes for genus-level queries
  const cleanName = name.replace(/\s+sp\.?\s*$/, '').replace(/\s+spp\.?\s*$/, '').trim()
  const parts = cleanName.split(/\s+/)
  const genus = parts[0]
  const epithet = parts.slice(1).join(' ')

  // --- Strategy 1: exact search ---
  await sleep(REQUEST_DELAY_MS)
  const exactResults = await searchByName(cleanName)

  // Find exact match (case-insensitive)
  const exactMatch = exactResults.find(
    (r: any) => r.combinedName?.toLowerCase() === cleanName.toLowerCase(),
  )

  if (exactMatch) {
    const tsn = parseInt(exactMatch.tsn, 10)
    await sleep(REQUEST_DELAY_MS)
    const usage = await getUsage(tsn)

    // If invalid/not accepted, try to get the accepted name
    if (usage === 'invalid' || usage === 'not accepted') {
      await sleep(REQUEST_DELAY_MS)
      const accepted = await getAcceptedNames(tsn)
      if (accepted.length > 0 && accepted[0].acceptedTsn) {
        const acceptedTsn = parseInt(accepted[0].acceptedTsn, 10)
        await sleep(REQUEST_DELAY_MS)
        const hier = await getHierarchy(acceptedTsn)
        const parsed = parseHierarchy(hier)
        return {
          tsn: acceptedTsn,
          canonicalName: accepted[0].acceptedName || parsed.canonicalName,
          rank: parsed.rank,
          kingdom: parsed.kingdom,
          phylum: parsed.phylum,
          className: parsed.className,
          order: parsed.order,
          family: parsed.family,
          genus: parsed.genus,
          usage: 'valid (resolved from synonym)',
          matchType: 'exact',
          originalQuery: name,
        }
      }
    }

    // Valid/accepted — get hierarchy
    await sleep(REQUEST_DELAY_MS)
    const hier = await getHierarchy(tsn)
    const parsed = parseHierarchy(hier)
    return {
      tsn,
      canonicalName: exactMatch.combinedName || parsed.canonicalName,
      rank: parsed.rank,
      kingdom: parsed.kingdom || exactMatch.kingdom || null,
      phylum: parsed.phylum,
      className: parsed.className,
      order: parsed.order,
      family: parsed.family,
      genus: parsed.genus,
      usage,
      matchType: 'exact',
      originalQuery: name,
    }
  }

  // --- Strategy 2: genus-only search for misspellings ---
  if (epithet) {
    await sleep(REQUEST_DELAY_MS)
    const genusResults = await searchByName(genus)

    // Find closest epithet match within the genus
    let bestMatch: any = null
    let bestSim = 0

    for (const r of genusResults) {
      if (!r?.combinedName) continue
      const rParts = r.combinedName.split(/\s+/)
      if (rParts[0]?.toLowerCase() !== genus.toLowerCase()) continue
      const rEpithet = rParts.slice(1).join(' ')
      if (!rEpithet) continue

      const sim = nameSimilarity(epithet, rEpithet)
      if (sim > bestSim) {
        bestSim = sim
        bestMatch = r
      }
    }

    if (bestMatch && bestSim > 0.7) {
      const tsn = parseInt(bestMatch.tsn, 10)
      await sleep(REQUEST_DELAY_MS)
      const usage = await getUsage(tsn)

      // If it's a synonym, resolve to accepted
      if (usage === 'invalid' || usage === 'not accepted') {
        await sleep(REQUEST_DELAY_MS)
        const accepted = await getAcceptedNames(tsn)
        if (accepted.length > 0 && accepted[0].acceptedTsn) {
          const acceptedTsn = parseInt(accepted[0].acceptedTsn, 10)
          await sleep(REQUEST_DELAY_MS)
          const hier = await getHierarchy(acceptedTsn)
          const parsed = parseHierarchy(hier)
          return {
            tsn: acceptedTsn,
            canonicalName: accepted[0].acceptedName || parsed.canonicalName,
            rank: parsed.rank,
            kingdom: parsed.kingdom,
            phylum: parsed.phylum,
            className: parsed.className,
            order: parsed.order,
            family: parsed.family,
            genus: parsed.genus,
            usage: 'valid (fuzzy match, resolved from synonym)',
            matchType: 'fuzzy',
            originalQuery: name,
          }
        }
      }

      await sleep(REQUEST_DELAY_MS)
      const hier = await getHierarchy(tsn)
      const parsed = parseHierarchy(hier)
      return {
        tsn,
        canonicalName: bestMatch.combinedName || parsed.canonicalName,
        rank: parsed.rank,
        kingdom: parsed.kingdom,
        phylum: parsed.phylum,
        className: parsed.className,
        order: parsed.order,
        family: parsed.family,
        genus: parsed.genus,
        usage: usage + ` (fuzzy match, sim=${bestSim.toFixed(2)})`,
        matchType: 'fuzzy',
        originalQuery: name,
      }
    }
  }

  // --- Strategy 2b: epithet search + genus fuzzy match ---
  // When the genus is misspelled so badly that ITIS genus search returns nothing,
  // search by epithet alone and filter by kingdom, then fuzzy-match the genus.
  if (epithet) {
    await sleep(REQUEST_DELAY_MS)
    const epithetResults = await searchByName(epithet)
    // Filter to species with matching epithet (at the end of combinedName)
    const epithetMatches = epithetResults.filter((r: any) => {
      if (!r?.combinedName) return false
      const parts = r.combinedName.split(/\s+/)
      return parts.length >= 2 && parts[parts.length - 1].toLowerCase() === epithet.toLowerCase()
    })

    if (epithetMatches.length > 0) {
      // Find the best genus match — require high genus similarity to avoid
      // false positives when the epithet is common (e.g., "princeps" has 170+ matches)
      let bestMatch: any = null
      let bestSim = 0

      for (const r of epithetMatches) {
        const rGenus = r.combinedName.split(/\s+/)[0]
        const sim = nameSimilarity(genus, rGenus)
        if (sim > bestSim) {
          bestSim = sim
          bestMatch = r
        }
      }

      // Higher threshold (0.65) since we're searching broadly across all genera
      if (bestMatch && bestSim > 0.65) {
        const tsn = parseInt(bestMatch.tsn, 10)
        await sleep(REQUEST_DELAY_MS)
        const usage = await getUsage(tsn)

        if (usage === 'invalid' || usage === 'not accepted') {
          await sleep(REQUEST_DELAY_MS)
          const accepted = await getAcceptedNames(tsn)
          if (accepted.length > 0 && accepted[0].acceptedTsn) {
            const acceptedTsn = parseInt(accepted[0].acceptedTsn, 10)
            await sleep(REQUEST_DELAY_MS)
            const hier = await getHierarchy(acceptedTsn)
            const parsed = parseHierarchy(hier)
            return {
              tsn: acceptedTsn,
              canonicalName: accepted[0].acceptedName || parsed.canonicalName,
              rank: parsed.rank,
              kingdom: parsed.kingdom, phylum: parsed.phylum,
              className: parsed.className, order: parsed.order,
              family: parsed.family, genus: parsed.genus,
              usage: 'valid (epithet search, resolved from synonym)',
              matchType: 'fuzzy',
              originalQuery: name,
            }
          }
        }

        await sleep(REQUEST_DELAY_MS)
        const hier = await getHierarchy(tsn)
        const parsed = parseHierarchy(hier)
        return {
          tsn,
          canonicalName: bestMatch.combinedName || parsed.canonicalName,
          rank: parsed.rank,
          kingdom: parsed.kingdom, phylum: parsed.phylum,
          className: parsed.className, order: parsed.order,
          family: parsed.family, genus: parsed.genus,
          usage: usage + ` (epithet search, genus sim=${bestSim.toFixed(2)})`,
          matchType: 'fuzzy',
          originalQuery: name,
        }
      }
    }
  }

  // --- Strategy 3: genus-level only (for "Bombus", "Salix", etc.) ---
  if (!epithet) {
    // Already searched for genus above in exact search
    const genusMatch = exactResults.find(
      (r: any) => r?.combinedName?.toLowerCase() === genus.toLowerCase(),
    )
    if (genusMatch) {
      const tsn = parseInt(genusMatch.tsn, 10)
      await sleep(REQUEST_DELAY_MS)
      const hier = await getHierarchy(tsn)
      const parsed = parseHierarchy(hier)
      return {
        tsn,
        canonicalName: genusMatch.combinedName,
        rank: 'genus',
        kingdom: parsed.kingdom || genusMatch.kingdom || null,
        phylum: parsed.phylum,
        className: parsed.className,
        order: parsed.order,
        family: parsed.family,
        genus: parsed.genus || genusMatch.combinedName,
        usage: 'valid',
        matchType: 'genus_only',
        originalQuery: name,
      }
    }
  }

  return null
}
