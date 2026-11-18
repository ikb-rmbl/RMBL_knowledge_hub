/**
 * GBIF backbone taxonomy lookups (no key needed). Used where ITIS is
 * unreliable (it hangs) or thin (fungi): load-checklists.ts resolves every
 * name to GBIF's accepted *species* key, which is the same for a name, its
 * synonyms and its infraspecific taxa — the test for "same taxon".
 */

import { sleep } from './concurrency.js'

const GBIF = 'https://api.gbif.org/v1'
const BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'

export interface GbifMatch {
  usageKey: number
  canonicalName: string
  status: string // ACCEPTED | SYNONYM | DOUBTFUL | …
  rank: string
  matchType: string // EXACT | FUZZY | HIGHERRANK | NONE
  speciesKey: number | null
  species: string | null // accepted species binomial
  authority: string | null
  kingdom: string | null
  phylum: string | null
  className: string | null
  order: string | null
  family: string | null
}

async function get(path: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    try {
      const res = await fetch(`${GBIF}${path}`, { signal: ctrl.signal })
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue }
      if (!res.ok) throw new Error(`GBIF ${res.status} ${path}`)
      return await res.json()
    } catch (err) {
      if (attempt === 2) throw err
      await sleep(1000 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
}

function toMatch(d: any): GbifMatch | null {
  if (!d || !d.usageKey) return null
  const authority = typeof d.scientificName === 'string' && d.canonicalName
    ? d.scientificName.slice(d.canonicalName.length).trim() || null
    : null
  return {
    usageKey: d.usageKey,
    canonicalName: d.canonicalName,
    status: d.status ?? d.taxonomicStatus,
    rank: d.rank,
    matchType: d.matchType ?? 'EXACT',
    speciesKey: d.speciesKey ?? null,
    species: d.species ?? null,
    authority,
    kingdom: d.kingdom ?? null,
    phylum: d.phylum ?? null,
    className: d.class ?? null,
    order: d.order ?? null,
    family: d.family ?? null,
  }
}

/** Strict name match against the backbone (EXACT or nothing useful). */
export async function gbifMatch(name: string, kingdom?: string | null): Promise<GbifMatch | null> {
  const q = new URLSearchParams({ name, strict: 'true' })
  if (kingdom) q.set('kingdom', kingdom)
  return toMatch(await get(`/species/match?${q}`))
}

/** Best non-strict match, for the review list only (never linked). */
export async function gbifFuzzy(name: string, kingdom?: string | null): Promise<GbifMatch | null> {
  const q = new URLSearchParams({ name })
  if (kingdom) q.set('kingdom', kingdom)
  return toMatch(await get(`/species/match?${q}`))
}

/**
 * Species whose English vernacular name equals `common` exactly, within a
 * higher taxon (e.g. Aves = 212). Returns accepted species keys found.
 */
export async function gbifByVernacular(common: string, higherTaxonKey: number): Promise<GbifMatch[]> {
  const q = new URLSearchParams({
    q: common, qField: 'VERNACULAR', rank: 'SPECIES', highertaxonKey: String(higherTaxonKey),
    datasetKey: BACKBONE, limit: '20',
  })
  const d = await get(`/species/search?${q}`)
  const want = common.toLowerCase().replace(/\s+/g, ' ').trim()
  const out: GbifMatch[] = []
  for (const r of d?.results ?? []) {
    const names = (r.vernacularNames ?? [])
      .filter((v: any) => !v.language || v.language === 'eng')
      .map((v: any) => String(v.vernacularName).toLowerCase().replace(/\s+/g, ' ').trim())
    if (!names.includes(want)) continue
    // Collapse to the species: the search also returns subspecies and synonyms.
    const key = r.speciesKey ?? (r.taxonomicStatus === 'ACCEPTED' ? r.key : (r.acceptedKey ?? r.key))
    out.push({
      usageKey: r.key, canonicalName: r.canonicalName, status: r.taxonomicStatus, rank: r.rank,
      matchType: 'EXACT', speciesKey: key, species: r.species ?? (r.taxonomicStatus === 'ACCEPTED' ? r.canonicalName : (r.accepted ?? null)),
      authority: r.authorship || null, kingdom: r.kingdom ?? null, phylum: r.phylum ?? null,
      className: r.class ?? null, order: r.order ?? null, family: r.family ?? null,
    })
  }
  return out
}

/** A backbone usage by key (the accepted species record, for authority and hierarchy). */
export async function gbifSpecies(key: number): Promise<GbifMatch | null> {
  const d = await get(`/species/${key}`)
  if (!d?.key) return null
  return toMatch({ ...d, usageKey: d.key, status: d.taxonomicStatus, matchType: 'EXACT', scientificName: d.scientificName })
}

export const GBIF_CLASS = { Aves: 212 } as const
