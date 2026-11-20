/**
 * Identification keys and published floras/faunas for /checklists
 * ("Checklists & ID Keys"): works already in the Commons that have no parsed
 * taxon entries. A reviewed seed list (Ian, 2026-11-20: no admin-editable
 * collection for now). Items are resolved by normalised title + year at query
 * time, because publication and document ids can differ between local and
 * Neon; an item that doesn't resolve is simply not shown.
 *
 * Scope: Gothic, the Gunnison Basin and the Elk Mountains. Statewide and
 * continental works (Birds of North America, Colorado mammal checklists) are
 * left out.
 */

import type { Pool } from 'pg'

export type ResourceKind = 'key' | 'flora_fauna'

export interface FieldResource {
  kind: ResourceKind
  group: string
  collection: 'publications' | 'documents'
  title: string
  year?: number
  /** Shown on that parsed checklist's page too: as its published edition, or as related. */
  checklist?: string
  relation?: 'edition' | 'related'
}

export const FIELD_RESOURCES: FieldResource[] = [
  // ---- identification keys
  { kind: 'key', group: 'Aquatic insects', collection: 'publications', year: 1982, title: 'A Key to the aquatic insects of the streams in the vacinity of the rocky mountain biolociacl lab' },
  { kind: 'key', group: 'Aquatic insects', collection: 'publications', year: 1985, title: 'A key to the aquatic insects of streams in the vicinity of the Rocky Mountain Biological Lab' },
  { kind: 'key', group: 'Aquatic insects', collection: 'publications', year: 1985, title: 'An Artificial Key to the Aquatic Insects of Gunnison County, Colorado Streams above 2750 Elevation' },
  { kind: 'key', group: 'Aquatic insects', collection: 'publications', year: 1985, title: 'A Key to the Chironomid Larve of Gunnison County, Colorado Streams ans Ponds Above 3000m Elevation' },
  { kind: 'key', group: 'Plants', collection: 'publications', year: 1971, title: 'Key to the Ranunculaceae (Buttercup) family in the Gunnison Basin' },
  { kind: 'key', group: 'Plants', collection: 'publications', year: 2009, title: 'Dichotomous key to the members of the onagraceae family found in the gothic area' },
  { kind: 'key', group: 'Plants', collection: 'publications', year: 2009, title: 'Dichotomous key of the onagraceae family' },
  { kind: 'key', group: 'Plants', collection: 'documents', title: 'Salix Veg Key' },

  // ---- published floras and faunas
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1946, title: 'A floristic study of the <i>Festuca</i> meadows in the Gunnison National Forest of Colorado' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1955, title: 'Flora of the Crested Butte Quadrangle, Colorado' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1969, title: 'Flora of the Gunnison basin: a study in the distribution of plants' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1972, title: 'A study of the flora of a sub-alpine meadow near Gothic' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1987, title: 'ALPINE VASCULAR FLORA OF THE RUBY RANGE, WEST ELK MOUNTAINS, COLORADO' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1993, title: 'Vascular Plants of the Gothic Area', checklist: 'plants-gothic', relation: 'edition' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1998, title: 'Alpine vascular flora of Hasley Basin, Elk Mountains, Colorado, USA' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 1999, title: 'Floristic Inventory of the Northern Gunnison Basin', checklist: 'plants-northern-gunnison-basin', relation: 'edition' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 2018, title: 'Floristic inventory of private and public lands in southwestern Gunnison County, Colorado, A; and a' },
  { kind: 'flora_fauna', group: 'Plants', collection: 'publications', year: 2024, title: 'Vascular Flora of the Powderhorn & La Garita Wilderness Areas and Adjacent Lands' },
  { kind: 'flora_fauna', group: 'Birds', collection: 'publications', year: 1916, title: 'Notes on the Birds of the Elk Mountain Region, Gunnison County, Colorado' },
  { kind: 'flora_fauna', group: 'Birds', collection: 'publications', year: 1928, title: 'Additional Notes on the Birds of the Elk Mountain Region, Colorado' },
  { kind: 'flora_fauna', group: 'Birds', collection: 'publications', year: 1944, title: 'Summer birds of the Gothic area, Gunnison County, Colorado' },
  { kind: 'flora_fauna', group: 'Birds', collection: 'publications', year: 1973, title: 'Bird fauna of the vicinity of the Rocky Mountain Biological Laboratory' },
  { kind: 'flora_fauna', group: 'Birds', collection: 'publications', year: 1982, title: 'Birds of the Rocky Mountain Biological Laboratory and Vicinity', checklist: 'birds-gothic', relation: 'related' },
  { kind: 'flora_fauna', group: 'Mammals', collection: 'publications', year: 1953, title: 'Notes on the mammals of the Gothic region, Gunnison County, Colorado' },
  { kind: 'flora_fauna', group: 'Aquatic invertebrates', collection: 'publications', year: 1966, title: 'A comparative study of the macroscopic fauna of small subalpine lakes at Mexican Cut, Colorado' },
  { kind: 'flora_fauna', group: 'Aquatic invertebrates', collection: 'publications', year: 2005, title: 'Stoneflies (Plecoptera) of the Gunnison Basin: A Geographical Study of Current Versus Historical Dis', checklist: 'stonefly-key-gunnison-county', relation: 'related' },
]

export interface ResolvedResource extends FieldResource {
  id: number
  href: string
  displayTitle: string
  displayYear: number | null
  hasPdf: boolean
}

/** Letters and digits only, lowercased: survives case, punctuation and markup differences. */
const NORM_SQL = (col: string) => `regexp_replace(lower(regexp_replace(${col}, '<[^>]+>', '', 'g')), '[^a-z0-9]', '', 'g')`
const norm = (s: string) => s.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The seed list resolved against this database. A title in the seed list may
 * be a prefix of the stored title (long titles are truncated in the list).
 */
export async function resolveFieldResources(db: Pool, filter?: { checklist?: string }): Promise<ResolvedResource[]> {
  const items = FIELD_RESOURCES.filter((r) => !filter?.checklist || r.checklist === filter.checklist)
  const out: ResolvedResource[] = []
  for (const r of items) {
    const key = norm(r.title)
    if (r.collection === 'publications') {
      const { rows: [p] } = await db.query(
        `SELECT id, title, year, (pdf_link IS NOT NULL AND NOT coalesce(pdf_restricted, false)) AS has_pdf FROM publications
          WHERE left(${NORM_SQL('title')}, $2) = $1 AND ($3::int IS NULL OR year = $3::int)
          ORDER BY (pdf_link IS NOT NULL) DESC, id LIMIT 1`, [key, key.length, r.year ?? null])
      if (p) out.push({ ...r, id: p.id, href: `/publications/${p.id}`, displayTitle: p.title.replace(/<[^>]+>/g, ''), displayYear: p.year, hasPdf: p.has_pdf })
    } else {
      const { rows: [d] } = await db.query(
        `SELECT id, title, extract(year FROM date_original)::int AS year, (pdf_link IS NOT NULL AND NOT coalesce(pdf_restricted, false)) AS has_pdf
           FROM documents WHERE left(${NORM_SQL('title')}, $2) = $1 ORDER BY id LIMIT 1`, [key, key.length])
      if (d) out.push({ ...r, id: d.id, href: `/documents/${d.id}`, displayTitle: d.title, displayYear: d.year, hasPdf: d.has_pdf })
    }
  }
  return out
}
