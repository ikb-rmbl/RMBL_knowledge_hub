/**
 * Load the species checklists rescued from the legacy rmbl.org website into
 * checklists / checklist_editions / checklist_entries, and resolve each entry
 * to a species (scripts/sql/z-2026-11-18-01-checklists.sql).
 *
 * Input: scripts/data/rescue/rmbl-legacy-checklists.json — the parsed tables
 * from ~/code/RMBL_metadata_rescue (data/parsed/species_lists.parquet +
 * floristic_records.parquet, canonical Taylor copy only). List titles,
 * compilers, legends and edition rules are in lib/checklists.ts.
 *
 * Name resolution (GBIF backbone; ITIS hangs and is thin on fungi). The test
 * for "same taxon" is GBIF's accepted species key, which a name shares with its
 * synonyms and infraspecific taxa:
 *   1. exact match to an existing species' canonical or scientific name;
 *   2. strict GBIF match → an existing species with the same accepted species
 *      key (existing species are mapped through GBIF too, cached), or named
 *      as the accepted species → linked (a historical synonym links, it does
 *      not create);
 *   3. otherwise a new species is created under the accepted name, with the
 *      checklist's spelling kept as a synonym (Ian, 2026-11-18: create new
 *      species unless they are synonyms of existing taxa);
 *   4. bird lists give common names only: GBIF vernacular names within Aves
 *      (exactly one species), then steps 2–3 (existing species' own common
 *      names are LLM-extracted and too unreliable to match on);
 *   5. MANUAL_NAMES (lib/checklists.ts) settles reviewed misspellings,
 *      namesakes and splits;
 *   6. anything else stays unresolved and is shown as written; GBIF's fuzzy
 *      guess goes to scripts/output/checklists/unresolved.csv for review.
 * Varieties and subspecies link to their species; the entry keeps the name as
 * written. Checklist links are NOT written to entity_mentions (they would
 * swamp the co-occurrence graph).
 *
 * Idempotent: lists/editions upsert, entries are replaced per edition, GBIF
 * responses are cached in scripts/output/checklists/gbif-cache.json. A
 * --target=neon run resolves against Neon's own species table.
 *
 * Usage:
 *   npx tsx scripts/load-checklists.ts [--dry-run] [--target=neon] [--no-create]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import {
  AUTHORITIES_FOR, AUTHORITIES_LIST, LISTS, MANUAL_NAMES, type RescueRow, binomialOf, keyTaxon, spellingVariants, decodeStatus, groupEditions, sourceIdOf,
} from './lib/checklists.js'
import { GBIF_CLASS, type GbifMatch, gbifByVernacular, gbifFuzzy, gbifMatch, gbifSpecies } from './lib/gbif-client.js'
import { runConcurrent } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const noCreate = args.includes('--no-create')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

const INPUT = join(import.meta.dirname, 'data', 'rescue', 'rmbl-legacy-checklists.json')
const OUT = join(import.meta.dirname, 'output', 'checklists')
const CACHE_FILE = join(OUT, 'gbif-cache.json')

// ------------------------------------------------------------------ GBIF cache
let cache: Record<string, any> = {}
let dirty = 0
const saveCache = () => { if (dirty) { writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0 } }
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (key in cache) return cache[key]
  const v = await fn()
  cache[key] = v ?? null
  if (++dirty % 50 === 0) saveCache()
  return v
}
const match = (name: string, kingdom: string) => cached<GbifMatch | null>(`m|${kingdom}|${name}`, () => gbifMatch(name, kingdom))
const fuzzy = (name: string, kingdom: string) => cached<GbifMatch | null>(`f|${kingdom}|${name}`, () => gbifFuzzy(name, kingdom))
const vernacular = (name: string, cls: number) => cached<GbifMatch[]>(`v|${cls}|${name.toLowerCase()}`, () => gbifByVernacular(name, cls))
const byKey = (key: number) => cached<GbifMatch | null>(`k|${key}`, () => gbifSpecies(key))

// ------------------------------------------------------------------ types
interface Entry {
  edition: string // `${listId}|${label}`
  listId: string
  line_no: number
  higher_group: string | null
  family: string | null
  group_heading: string | null
  verbatim_name: string
  authority: string | null
  common_name: string | null
  status_codes: string | null
  remarks: string | null
  details: Record<string, unknown>
  species_id?: number | null
  match_method?: string
  match_detail?: Record<string, unknown>
}

interface Species {
  id: number
  canonical_name: string
  scientific_name: string | null
  synonyms: string[] | null
  common_names: string[] | null
  kingdom: string | null
  rank: string
  mention_count: number
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

function toEntries(listId: string, label: string, rows: RescueRow[], authorities: Map<string, string>): Entry[] {
  return rows.map((r) => {
    const taylor = listId === 'plants-taylor-ngb'
    const binom = binomialOf(r.scientific_name)
    const authority = r.authority ?? (binom ? authorities.get(norm(binom)) ?? null : null)
    const details: Record<string, unknown> = {}
    if (taylor) {
      Object.assign(details, {
        species_authority: r.species_authority ?? null, synonymy: r.synonymy ?? [], regions: r.regions ?? [],
        vegetation: r.vegetation ?? [], counties: r.counties ?? [], elev_min_ft: r.elev_min_ft ?? null,
        elev_max_ft: r.elev_max_ft ?? null, n_collections: r.n_collections ?? null,
      })
    } else if (r.raw_line) details.raw_line = r.raw_line
    if (LISTS[listId].kind === 'identification_key') details.page_source_id = sourceIdOf(r.urlkey)
    const codes = (taylor ? r.flags : r.status_codes) || null
    const status = decodeStatus(listId, codes)
    if (status.length) details.status = status
    return {
      edition: `${listId}|${label}`,
      listId,
      line_no: r.line_no,
      higher_group: r.higher_group ?? null,
      family: (taylor ? r.family : r.listed_family) ?? null,
      group_heading: r.group_heading ?? null,
      verbatim_name: (r.scientific_name || r.common_name || '').trim(),
      authority,
      common_name: r.common_name ?? null,
      status_codes: codes,
      remarks: r.remarks ?? null,
      details,
    }
  }).filter((e) => e.verbatim_name)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) : {}
  const data = JSON.parse(readFileSync(INPUT, 'utf-8'))
  const rows: RescueRow[] = [
    ...data.species_lists,
    ...data.floristic_records.map((r: RescueRow) => ({ ...r, list_id: 'plants-taylor-ngb', edition: null })),
  ]

  // The stonefly key isn't in the handoff file: one row per key page naming a
  // taxon, read from the target database's rescued documents.
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const keyDb = new pg.Pool({ connectionString: url })
  const { rows: keyPages } = await keyDb.query<{ title: string; source_id: string; ts: string | null }>(
    `SELECT title, provenance->>'sourceId' AS source_id, provenance->>'captureTimestamp' AS ts FROM documents
      WHERE provenance->>'discoveryMethod' = 'wayback_rescue' AND document_type = 'identification_key'
        AND title !~* 'salix' ORDER BY title`)
  await keyDb.end()
  const keyRows: RescueRow[] = []
  for (const p of keyPages) {
    const k = keyTaxon(p.title)
    if (!k) continue
    keyRows.push({ list_id: 'plecoptera-key-gunnison', list_key: p.source_id, urlkey: p.source_id.replace(/^rmbl-wayback:/, ''),
      capture_ts: p.ts ?? '', edition: null, line_no: keyRows.length + 1, scientific_name: k.taxon, authority: null,
      remarks: k.qualifier === 'introduction' ? 'introduction' : k.qualifier ? `key to ${k.qualifier}` : null, raw_line: p.title })
  }
  rows.push(...keyRows)
  const keyFrontMatter = keyPages.filter((p) => !keyTaxon(p.title)).map((p) => p.source_id)

  // Buck & Frase's authorities page fills the 1993 edition's authorities.
  const authRows = rows.filter((r) => r.list_id === AUTHORITIES_LIST)
  const authorities = new Map<string, string>()
  for (const r of authRows) { const b = binomialOf(r.scientific_name); if (b && r.authority) authorities.set(norm(b), r.authority) }
  const authSourceIds = [...new Set(authRows.map((r) => sourceIdOf(r.urlkey)))]

  const editions: { listId: string; label: string; year: number | null; taxonomy: string | null; sourceIds: string[]; entriesSourceId: string; entries: Entry[] }[] = []
  for (const listId of Object.keys(LISTS)) {
    for (const ed of groupEditions(listId, rows)) {
      const isAuthEdition = listId === AUTHORITIES_FOR.list && ed.spec.label === AUTHORITIES_FOR.edition
      editions.push({
        listId, label: ed.spec.label, year: ed.spec.year, taxonomy: ed.spec.taxonomy ?? null,
        sourceIds: [...new Set([...ed.sourceIds, ...(isAuthEdition ? authSourceIds : []), ...(LISTS[listId].extraCopies ?? []).map(sourceIdOf),
          ...(LISTS[listId].kind === 'identification_key' ? keyFrontMatter : [])])],
        entriesSourceId: ed.entriesSourceId,
        entries: toEntries(listId, ed.spec.label, ed.rows, isAuthEdition ? authorities : new Map()),
      })
    }
  }
  const allEntries = editions.flatMap((e) => e.entries)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  for (const e of editions) console.log(`  ${e.listId.padEnd(26)} ${e.label.padEnd(30)} ${String(e.entries.length).padStart(4)} entries, ${e.sourceIds.length} copies`)

  const db = new pg.Pool({ connectionString: url })
  try {
    // ---------------------------------------------------------- existing species
    const { rows: species } = await db.query<Species>(
      `SELECT id, canonical_name, scientific_name, synonyms, common_names, kingdom, rank, coalesce(mention_count, 0) AS mention_count FROM species`)
    const byName = new Map<string, Species[]>()
    const add = (m: Map<string, Species[]>, k: string | null | undefined, s: Species) => {
      if (!k) return
      const key = norm(k)
      if (!m.has(key)) m.set(key, [])
      if (!m.get(key)!.includes(s)) m.get(key)!.push(s)
    }
    // Scientific names only. Existing synonyms and common names came from LLM
    // extraction and are unreliable ("gray jay" is attached to three different
    // species), so birds resolve through GBIF's vernacular names instead, and
    // real synonymy is caught by the GBIF species key.
    for (const s of species) { add(byName, s.canonical_name, s); add(byName, s.scientific_name, s) }
    // Orthographic variants of one name ("rhexifolia" / "rhexiifolia") are the same taxon.
    const ortho = (n: string) => norm(n).replace(/ii/g, 'i')
    const byOrtho = new Map<string, Species[]>()
    for (const s of species) add(byOrtho, ortho(s.canonical_name), s)
    const best = (list: Species[], kingdom: string) => {
      const ok = list.filter((s) => !s.kingdom || s.kingdom === kingdom)
      return ok.sort((a, b) => b.mention_count - a.mention_count)[0] ?? null
    }

    // Existing species → GBIF accepted species key (cached). Only binomials in
    // the kingdoms the lists cover.
    const mappable = species.filter((s) => ['Plantae', 'Animalia', 'Fungi'].includes(s.kingdom ?? '') && binomialOf(s.canonical_name))
    const uncached = mappable.filter((s) => !(`m|${s.kingdom}|${binomialOf(s.canonical_name)}` in cache)).length
    console.log(`\nMapping ${mappable.length} existing species to GBIF species keys (${uncached} not cached)...`)
    const existingByKey = new Map<number, Species[]>()
    await runConcurrent(mappable, 4, async (s) => {
      const m = await match(binomialOf(s.canonical_name)!, s.kingdom!)
      if (m?.matchType === 'EXACT' && m.speciesKey) {
        if (!existingByKey.has(m.speciesKey)) existingByKey.set(m.speciesKey, [])
        existingByKey.get(m.speciesKey)!.push(s)
      }
    }, 'existing species')
    saveCache()

    // ---------------------------------------------------------- resolve
    const toCreate = new Map<number, { accepted: GbifMatch; verbatim: Set<string>; common: Set<string> }>()
    const unresolved: { list: string; name: string; reason: string; suggestion: string }[] = []
    const resolveOne = async (e: Entry) => {
      const list = LISTS[e.listId]
      const kingdom = list.kingdom
      let m: GbifMatch | null = null
      const manual = MANUAL_NAMES[e.verbatim_name.trim()]
      let corrected: string | null = null
      if (manual) {
        m = await match(manual, kingdom)
        if (!m || m.matchType !== 'EXACT' || !m.speciesKey) {
          unresolved.push({ list: e.listId, name: e.verbatim_name, reason: `manual name ${manual} not matched in GBIF`, suggestion: '' })
          return Object.assign(e, { species_id: null, match_method: 'unresolved', match_detail: { manual } })
        }
      } else if (list.commonNamesOnly) {
        const found = await vernacular(e.verbatim_name, GBIF_CLASS.Aves)
        const keys = [...new Set(found.map((f) => f.speciesKey))]
        if (keys.length !== 1) {
          unresolved.push({ list: e.listId, name: e.verbatim_name, reason: keys.length ? `${keys.length} species share this common name` : 'no species with this common name', suggestion: found.map((f) => f.species ?? f.canonicalName).join('; ') })
          return Object.assign(e, { species_id: null, match_method: 'unresolved', match_detail: { reason: 'common name' } })
        }
        m = await byKey(keys[0]!)
        if (m) m = { ...m, speciesKey: keys[0]!, species: m.canonicalName }
      } else {
        const binom = binomialOf(e.verbatim_name)
        if (!binom) {
          unresolved.push({ list: e.listId, name: e.verbatim_name, reason: 'not a species name', suggestion: '' })
          return Object.assign(e, { species_id: null, match_method: 'unresolved', match_detail: { reason: 'not a species name' } })
        }
        const exact = best(byName.get(norm(binom)) ?? [], kingdom)
        if (exact) return Object.assign(e, { species_id: exact.id, match_method: 'exact', match_detail: { binomial: binom } })
        m = await match(binom, kingdom)
        if (!m || m.matchType !== 'EXACT' || !m.speciesKey) {
          for (const v of spellingVariants(binom)) {
            const mv = await match(v, kingdom)
            if (mv?.matchType === 'EXACT' && mv.speciesKey) { m = mv; corrected = v; break }
          }
        }
        if (!m || m.matchType !== 'EXACT' || !m.speciesKey) {
          const f = await fuzzy(binom, kingdom)
          unresolved.push({ list: e.listId, name: e.verbatim_name, reason: m ? `GBIF ${m.matchType} match only` : 'not in GBIF', suggestion: f ? `${f.species ?? f.canonicalName} (${f.matchType}, ${f.status})` : '' })
          return Object.assign(e, { species_id: null, match_method: 'unresolved', match_detail: { binomial: binom, gbif_guess: f ? f.species ?? f.canonicalName : null } })
        }
      }
      if (!m?.speciesKey || !m.species) return Object.assign(e, { species_id: null, match_method: 'unresolved', match_detail: {} })
      const synonymOf = norm(m.species) !== norm(binomialOf(e.verbatim_name) ?? m.species)
      const sameKey = existingByKey.get(m.speciesKey)
      const existing = (sameKey && best(sameKey, kingdom)) ?? best(byName.get(norm(m.species)) ?? [], kingdom)
        ?? best(byOrtho.get(ortho(m.species)) ?? [], kingdom)
      const detail = { gbif_species_key: m.speciesKey, accepted: m.species, gbif_status: m.status, ...(manual ? { manual } : {}), ...(corrected ? { spelling: corrected } : {}) }
      if (existing) {
        const method = manual ? 'manual' : list.commonNamesOnly ? 'gbif_common_name' : synonymOf ? 'gbif_synonym' : 'gbif_accepted'
        return Object.assign(e, { species_id: existing.id, match_method: method, match_detail: detail })
      }
      if (!toCreate.has(m.speciesKey)) toCreate.set(m.speciesKey, { accepted: m, verbatim: new Set(), common: new Set() })
      const c = toCreate.get(m.speciesKey)!
      // Keep real historical names as synonyms, not OCR errors or misspellings.
      const vb = corrected ?? manual ?? binomialOf(e.verbatim_name)
      if (vb && norm(vb) !== norm(m.species) && !list.commonNamesOnly) c.verbatim.add(vb)
      if (e.common_name) c.common.add(e.common_name)
      if (list.commonNamesOnly) c.common.add(e.verbatim_name)
      return Object.assign(e, { species_id: null, match_method: 'created', match_detail: { ...detail, created_key: m.speciesKey } })
    }
    console.log(`Resolving ${allEntries.length} entries...`)
    await runConcurrent(allEntries, 4, async (e) => { await resolveOne(e) }, 'entries')
    saveCache()
    // runConcurrent swallows errors: a failed lookup leaves the entry unresolved (re-run to retry).
    for (const e of allEntries) {
      if (e.match_method) continue
      Object.assign(e, { species_id: null, match_method: 'unresolved', match_detail: { reason: 'lookup error' } })
      unresolved.push({ list: e.listId, name: e.verbatim_name, reason: 'lookup error (re-run)', suggestion: '' })
    }

    // ---------------------------------------------------------- report
    const counts = new Map<string, Map<string, number>>()
    for (const e of allEntries) {
      const k = e.listId
      if (!counts.has(k)) counts.set(k, new Map())
      counts.get(k)!.set(e.match_method!, (counts.get(k)!.get(e.match_method!) ?? 0) + 1)
    }
    const methods = ['exact', 'gbif_accepted', 'gbif_synonym', 'gbif_common_name', 'manual', 'created', 'unresolved']
    console.log(`\n${'list'.padEnd(26)} ${methods.map((m) => m.slice(0, 11).padStart(12)).join('')}`)
    for (const [k, c] of counts) console.log(`${k.padEnd(26)} ${methods.map((m) => String(c.get(m) ?? 0).padStart(12)).join('')}`)
    console.log(`New species to create: ${toCreate.size}${noCreate ? ' (--no-create: left unresolved)' : ''}; distinct unresolved names: ${new Set(unresolved.map((u) => u.list + u.name)).size}`)
    const csv = (rows: Record<string, unknown>[]) => rows.length
      ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))].join('\n') + '\n' : ''
    const uniq = [...new Map(unresolved.map((u) => [u.list + '|' + u.name, u])).values()]
    writeFileSync(join(OUT, `unresolved-${target}.csv`), csv(uniq))
    writeFileSync(join(OUT, `created-${target}.csv`), csv([...toCreate.values()].map((c) => ({
      accepted: c.accepted.species, gbif_species_key: c.accepted.speciesKey, kingdom: c.accepted.kingdom, family: c.accepted.family,
      as_written: [...c.verbatim].join('; '), common: [...c.common].join('; '),
    }))))
    console.log(`Review files → ${OUT}/{unresolved,created}-${target}.csv`)
    if (dryRun) return

    // ---------------------------------------------------------- write
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const createdIds = new Map<number, number>()
      if (!noCreate) {
        for (const [key, c] of toCreate) {
          const acc = (await byKey(key)) ?? c.accepted
          const { rows: [row] } = await client.query<{ id: number }>(
            `INSERT INTO species (canonical_name, rank, scientific_name, authority, common_names, synonyms, kingdom, phylum,
                                  class_name, order_name, family, external_ids, curated_fields, created_at, updated_at)
             VALUES ($1, 'species', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]'::jsonb, NOW(), NOW()) RETURNING id`,
            [c.accepted.species, acc.authority, [...c.common], [...c.verbatim], acc.kingdom, acc.phylum, acc.className, acc.order, acc.family,
             JSON.stringify({ gbif: String(key), source: 'rmbl-legacy-checklists' })])
          createdIds.set(key, row.id)
        }
      }
      for (const e of allEntries) {
        if (e.match_method === 'created') {
          const id = createdIds.get(e.match_detail!.created_key as number)
          if (id) e.species_id = id
          else { e.match_method = 'unresolved'; e.species_id = null }
        }
      }
      for (const ed of editions) {
        const list = LISTS[ed.listId]
        const { rows: [cl] } = await client.query<{ id: number }>(
          `INSERT INTO checklists (list_key, slug, title, taxon_group, compiler, area, description, legend, kind, sort_order, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $9, $10, $8, NOW())
           ON CONFLICT (list_key) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, taxon_group = EXCLUDED.taxon_group,
             compiler = EXCLUDED.compiler, area = EXCLUDED.area, description = EXCLUDED.description, legend = EXCLUDED.legend, kind = EXCLUDED.kind,
             sort_order = EXCLUDED.sort_order, updated_at = NOW()
           RETURNING id`,
          [ed.listId, list.slug, list.title, list.taxonGroup, list.compiler, list.area, list.description, list.sortOrder, JSON.stringify(list.legend), list.kind ?? 'checklist'])
        const { rows: [edRow] } = await client.query<{ id: number }>(
          `INSERT INTO checklist_editions (checklist_id, label, year, taxonomy, source_ids, entries_source_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (checklist_id, label) DO UPDATE SET year = EXCLUDED.year, taxonomy = EXCLUDED.taxonomy,
             source_ids = EXCLUDED.source_ids, entries_source_id = EXCLUDED.entries_source_id
           RETURNING id`,
          [cl.id, ed.label, ed.year, ed.taxonomy, ed.sourceIds, ed.entriesSourceId])
        await client.query(`DELETE FROM checklist_entries WHERE edition_id = $1`, [edRow.id])
        for (const [i, e] of ed.entries.entries()) {
          await client.query(
            `INSERT INTO checklist_entries (edition_id, position, line_no, higher_group, family, group_heading, verbatim_name, authority,
                                            common_name, status_codes, remarks, details, species_id, match_method, match_detail)
             VALUES ($1, $15, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [edRow.id, e.line_no, e.higher_group, e.family, e.group_heading, e.verbatim_name, e.authority, e.common_name,
             e.status_codes, e.remarks, JSON.stringify(e.details), e.species_id ?? null, e.match_method, JSON.stringify(e.match_detail ?? {}), i + 1])
        }
      }
      await client.query('COMMIT')
      const { rows: [n] } = await db.query(`SELECT count(*)::int AS entries, count(species_id)::int AS linked FROM checklist_entries`)
      console.log(`\nCreated ${createdIds.size} species; ${n.entries} entries, ${n.linked} linked to a species.`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  } finally {
    saveCache()
    await db.end()
  }
}

main().catch((err) => {
  saveCache()
  console.error(err)
  process.exit(1)
})
