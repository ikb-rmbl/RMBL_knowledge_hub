/**
 * Load story entity extractions (story-entity-extraction.json) into the graph.
 *
 * Every extracted reference is recorded in entity_candidates
 * (source_collection='stories'), resolved or not, and resolved candidates
 * become entity_mentions (extraction_method='llm'). Writing the candidates is
 * what makes this durable: the September 2026 entity rebuild deleted all
 * story mentions, and — unlike publications/documents — there were no raw
 * candidates to recover them from (the old loader wrote mentions only).
 *
 * Resolution is exact name/alias against THIS database's canonical tables
 * (species/places/concepts/stakeholders), tiered: primary names first (ties
 * between duplicate registry entries go to the most-mentioned), then aliases /
 * species common names only when unique — "bumble bee" names 15 species and
 * stays unresolved rather than guessed. No new entities are
 * created — unresolved candidates stay in entity_candidates for a later,
 * deliberate pass (embedding match or new-entity clustering).
 *
 *   species      scientificName / commonName → canonical_name, scientific_name,
 *                common_names (a common name only when unique)
 *   places       name → name, aliases
 *   concepts     name → name, aliases
 *   agencies     name → stakeholders name, aliases
 *
 * Also sets story_type from the LLM classification where it is still the
 * default 'news_article'. (Researcher/project linking was dropped: it wrote
 * to authors_rels/projects_rels columns that don't exist, and linking every
 * researcher a story mentions as its "author" was the wrong relation anyway.)
 *
 * Idempotent: story candidates and story 'llm' mentions are replaced on each
 * run, in one transaction; other story mentions (text_match) are untouched.
 * Run once per database — resolution uses that database's own entity ids.
 *
 * Usage:
 *   npx tsx scripts/load-story-extractions.ts [--dry-run] [--target=neon]
 */

import { readFileSync } from 'fs'
import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

const RESULTS_PATH = 'scripts/output/story-entity-extraction.json'

type EntityType = 'species' | 'place' | 'concept' | 'stakeholder'
interface Candidate { type: EntityType; storyId: number; rawName: string; attrs: object; role: string; entityId: number | null }

const norm = (s: unknown) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * name → id. `pickTies` resolves a name shared by several entities to the
 * most-mentioned one — right for PRIMARY names, where the registry holds true
 * duplicates (e.g. four separate "climate change" concepts). For aliases and
 * species common names, a shared name is genuinely ambiguous ("bumble bee"
 * names 15 species) and is left unresolved.
 */
function nameIndex(rows: { id: number; name: string | null }[], pickTies: boolean, usage: Map<number, number>): Map<string, number> {
  const seen = new Map<string, Set<number>>()
  for (const r of rows) {
    const k = norm(r.name)
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

/** Primary-name tier first, then the alias tier. */
const tiered = (...tiers: Map<string, number>[]) => (name: unknown): number | null => {
  const k = norm(name)
  if (!k) return null
  for (const t of tiers) { const id = t.get(k); if (id != null) return id }
  return null
}

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const results: any[] = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''} — ${results.length} extracted stories`)
  const db = new pg.Pool({ connectionString: url, max: 2 })

  try {
    // Canonical lookups for this database. Scientific/canonical names win over
    // common names; common names count only when they name a single species.
    const q = async (sql: string) => (await db.query(sql)).rows as { id: number; name: string | null }[]
    const usageOf = async (type: string) => new Map(
      (await db.query(`SELECT entity_id AS id, count(*)::int AS n FROM entity_mentions WHERE entity_type = $1 GROUP BY 1`, [type])).rows.map((r) => [r.id, r.n]),
    )
    const [uSpecies, uPlace, uConcept, uStake] = await Promise.all(['species', 'place', 'concept', 'stakeholder'].map(usageOf))
    const species = tiered(
      nameIndex(await q('SELECT id, canonical_name AS name FROM species'), true, uSpecies),
      nameIndex(await q('SELECT id, scientific_name AS name FROM species'), true, uSpecies),
      nameIndex(await q('SELECT id, unnest(common_names) AS name FROM species'), false, uSpecies),
    )
    const places = tiered(
      nameIndex(await q('SELECT id, name FROM places'), true, uPlace),
      nameIndex(await q('SELECT id, unnest(aliases) AS name FROM places'), false, uPlace),
    )
    const concepts = tiered(
      nameIndex(await q('SELECT id, name FROM concepts'), true, uConcept),
      nameIndex(await q('SELECT id, unnest(aliases) AS name FROM concepts'), false, uConcept),
    )
    const stakeholders = tiered(
      nameIndex(await q('SELECT id, name FROM stakeholders'), true, uStake),
      nameIndex(await q('SELECT id, unnest(aliases) AS name FROM stakeholders'), false, uStake),
    )
    const { rows: storyRows } = await db.query<{ id: number }>('SELECT id FROM stories')
    const storyIds = new Set(storyRows.map((r) => r.id))

    const cands: Candidate[] = []
    const types = new Map<number, string>()
    let missingStories = 0
    for (const r of results) {
      if (!storyIds.has(r.id)) { missingStories++; continue }
      if (r.storyType) types.set(r.id, r.storyType)
      for (const s of r.species ?? []) {
        const raw = s.scientificName || s.commonName
        if (!raw) continue
        const id = species(s.scientificName) ?? species(s.commonName)
        cands.push({ type: 'species', storyId: r.id, rawName: raw, attrs: s, role: s.role || 'mentioned', entityId: id })
      }
      for (const p of r.places ?? []) {
        if (!p.name) continue
        cands.push({ type: 'place', storyId: r.id, rawName: p.name, attrs: p, role: p.role || 'mentioned', entityId: places(p.name) })
      }
      for (const c of r.concepts ?? []) {
        if (!c.name) continue
        cands.push({ type: 'concept', storyId: r.id, rawName: c.name, attrs: c, role: c.role || 'mentioned', entityId: concepts(c.name) })
      }
      for (const a of r.agencies ?? []) {
        const name = typeof a === 'string' ? a : a?.name
        if (!name) continue
        cands.push({ type: 'stakeholder', storyId: r.id, rawName: name, attrs: typeof a === 'string' ? { name: a } : a, role: 'mentioned', entityId: stakeholders(name) })
      }
    }

    const byType = new Map<EntityType, { total: number; resolved: number }>()
    for (const c of cands) {
      const t = byType.get(c.type) ?? { total: 0, resolved: 0 }
      t.total++
      if (c.entityId != null) t.resolved++
      byType.set(c.type, t)
    }
    for (const [t, v] of byType) console.log(`  ${t.padEnd(12)} ${v.resolved}/${v.total} resolved (${Math.round((100 * v.resolved) / v.total)}%)`)
    if (missingStories) console.log(`  ${missingStories} extracted stories no longer exist here — skipped`)

    // Mentions: one per (type, entity, story, role) — the table's unique key.
    const mentionKeys = new Set<string>()
    const mentions = cands.filter((c) => {
      if (c.entityId == null) return false
      const k = `${c.type}|${c.entityId}|${c.storyId}|${c.role}`
      if (mentionKeys.has(k)) return false
      mentionKeys.add(k)
      return true
    })
    console.log(`  → ${cands.length} candidates, ${mentions.length} distinct mentions across ${new Set(mentions.map((m) => m.storyId)).size} stories`)

    if (dryRun) { console.log('\n[dry-run] nothing written.'); return }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const delC = await client.query(`DELETE FROM entity_candidates WHERE source_collection = 'stories'`)
      const delM = await client.query(`DELETE FROM entity_mentions WHERE collection = 'stories' AND extraction_method = 'llm'`)
      const CHUNK = 2000
      for (let i = 0; i < cands.length; i += CHUNK) {
        const part = cands.slice(i, i + CHUNK)
        await client.query(
          `INSERT INTO entity_candidates (entity_type, raw_name, raw_attributes, source_collection, source_item_id, resolved_entity_id, confidence, created_at)
           SELECT t, n, a::jsonb, 'stories', s, e, 0.9, NOW()
             FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[]) AS x(t, n, a, s, e)`,
          [part.map((c) => c.type), part.map((c) => c.rawName), part.map((c) => JSON.stringify(c.attrs)), part.map((c) => c.storyId), part.map((c) => c.entityId)],
        )
      }
      for (let i = 0; i < mentions.length; i += CHUNK) {
        const part = mentions.slice(i, i + CHUNK)
        await client.query(
          `INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
           SELECT t, e, 'stories', s, r, 0.9, 'llm'
             FROM unnest($1::text[], $2::int[], $3::int[], $4::text[]) AS x(t, e, s, r)
           ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING`,
          [part.map((m) => m.type), part.map((m) => m.entityId), part.map((m) => m.storyId), part.map((m) => m.role)],
        )
      }
      let typed = 0
      for (const [id, t] of types) {
        const res = await client.query(`UPDATE stories SET story_type = $1 WHERE id = $2 AND story_type = 'news_article'`, [t, id])
        typed += res.rowCount ?? 0
      }
      await client.query('COMMIT')
      console.log(`\nReplaced ${delC.rowCount} old story candidates and ${delM.rowCount} old 'llm' mentions; story_type set on ${typed}.`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const { rows: [s] } = await db.query(
      `SELECT count(*) FILTER (WHERE extraction_method = 'llm')::int AS llm, count(*)::int AS total,
              count(DISTINCT item_id)::int AS stories FROM entity_mentions WHERE collection = 'stories'`,
    )
    console.log(`Story mentions now: ${s.total} (${s.llm} from LLM extraction) across ${s.stories} stories.`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
