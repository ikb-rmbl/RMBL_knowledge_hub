/**
 * Exact name/alias resolution of extracted entity names to EXISTING canonical
 * entities — additive, never creates or renumbers entities.
 *
 * Tiered: primary names first, then aliases (species: canonical →
 * scientific → common names). A primary name shared by several registry rows
 * (true duplicates, e.g. four "climate change" concepts) resolves to the
 * most-mentioned one; a shared alias or species common name is genuinely
 * ambiguous ("bumble bee" names 15 species) and stays unresolved.
 *
 * Used by load-story-extractions.ts and resolve-candidates-additive.ts.
 */

import type pg from 'pg'

export type EntityType = 'species' | 'place' | 'concept' | 'stakeholder'
export type Resolve = (name: unknown) => number | null

export const normName = (s: unknown) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().toLowerCase()

function nameIndex(rows: { id: number; name: string | null }[], pickTies: boolean, usage: Map<number, number>): Map<string, number> {
  const seen = new Map<string, Set<number>>()
  for (const r of rows) {
    const k = normName(r.name)
    if (!k) continue
    if (!seen.has(k)) seen.set(k, new Set())
    seen.get(k)!.add(r.id)
  }
  const out = new Map<string, number>()
  for (const [k, ids] of seen) {
    if (ids.size === 1) out.set(k, [...ids][0])
    else if (pickTies) out.set(k, [...ids].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0) || a - b)[0])
  }
  return out
}

const tiered = (...tiers: Map<string, number>[]): Resolve => (name) => {
  const k = normName(name)
  if (!k) return null
  for (const t of tiers) {
    const id = t.get(k)
    if (id != null) return id
  }
  return null
}

/** Build resolvers for the given entity types against this database. */
export async function buildResolvers(db: pg.Pool | pg.PoolClient, types: EntityType[]): Promise<Partial<Record<EntityType, Resolve>>> {
  const q = async (sql: string) => (await db.query(sql)).rows as { id: number; name: string | null }[]
  const usage = async (type: EntityType) => new Map<number, number>(
    (await db.query(`SELECT entity_id AS id, count(*)::int AS n FROM entity_mentions WHERE entity_type = $1 GROUP BY 1`, [type])).rows.map((r: any) => [r.id, r.n]),
  )
  const out: Partial<Record<EntityType, Resolve>> = {}
  for (const type of types) {
    const u = await usage(type)
    if (type === 'species') {
      out.species = tiered(
        nameIndex(await q('SELECT id, canonical_name AS name FROM species'), true, u),
        nameIndex(await q('SELECT id, scientific_name AS name FROM species'), true, u),
        nameIndex(await q('SELECT id, unnest(common_names) AS name FROM species'), false, u),
      )
    } else {
      const table = { place: 'places', concept: 'concepts', stakeholder: 'stakeholders' }[type]
      out[type] = tiered(
        nameIndex(await q(`SELECT id, name FROM ${table}`), true, u),
        nameIndex(await q(`SELECT id, unnest(aliases) AS name FROM ${table}`), false, u),
      )
    }
  }
  return out
}
