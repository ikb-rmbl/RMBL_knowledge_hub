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
import { buildResolvers, type EntityType } from './lib/entity-name-match.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

const RESULTS_PATH = 'scripts/output/story-entity-extraction.json'

interface Candidate { type: EntityType; storyId: number; rawName: string; attrs: object; role: string; entityId: number | null }

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const results: any[] = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''} — ${results.length} extracted stories`)
  const db = new pg.Pool({ connectionString: url, max: 2 })

  try {
    // Canonical lookups for this database (tiered exact name/alias; see lib/entity-name-match).
    const r = await buildResolvers(db, ['species', 'place', 'concept', 'stakeholder'])
    const species = r.species!, places = r.place!, concepts = r.concept!, stakeholders = r.stakeholder!
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
