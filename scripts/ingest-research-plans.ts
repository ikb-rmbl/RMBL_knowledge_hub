/**
 * Ingest the complete RMBL research plan list (2022-2026 filings) into Projects.
 *
 * Source: scripts/data/research-plans-2022-2026.csv — a Salesforce export of
 * every research plan filed 2022-2026 (297 plans, start years 2014-2026, end
 * years 2021-2034). It supersedes the 2026 active-plan list that
 * update-projects-2026.ts loaded, which only ever covered currently-active work.
 *
 * Second source: scripts/data/research-plans-legacy-1996-2020.json — the
 * pre-Salesforce plan database from old.rmbl.org (1,051 filings, 1996–2020),
 * snapshotted by scrape-legacy-research-plans.ts. Both sources load in ONE run
 * so renewal chains span the 2022 cut-over (a 2009 legacy filing becomes the
 * root of the RS2022 plan that continues it). Running with only one source
 * would re-root those chains, so the legacy file is required.
 *   - plan_id = 'LEGACY-<ResearchPlanID>'
 *   - status is always 'completed': the legacy system is retired and anything
 *     still running was re-filed in Salesforce, which carries the live status.
 *   - institution, collaborators and study organisms have no columns, so they
 *     go in a short trailer on the description (searchable, displayed).
 *   - auto_discovery_enabled = false: no assign-projects items for now — its
 *     career-wide author matching is wrong for 25 years of filings; legacy plans
 *     wait for program-level paper linking.
 *
 * Model: ONE PROJECT ROW PER PLAN ID.
 *   - plan_id (RS2024-913) is the durable key. Re-ingests match on it first, so
 *     the reconciliation below only has to run once per newly-appearing plan.
 *   - A PI who re-files a continuing study under a new plan ID gets a second row.
 *     Those renewals are chained: every later plan in a chain carries
 *     renews_project_id = the earliest plan's id. Chains are detected within a PI
 *     by title trigram similarity >= CHAIN_THRESHOLD, which is conservative —
 *     below that, trigram similarity stops distinguishing a retitled renewal from
 *     a genuinely separate plan by the same prolific PI, so borderline renewals
 *     stay unchained rather than risk fusing two distinct studies.
 *   - renews_project_id is deliberately NOT parent_project_id: that one already
 *     means "belongs to this program/campaign" (11 plans use it that way).
 *
 * Reconciliation against the 165 projects already in the table:
 *   1. plan_id equality (idempotent re-runs)
 *   2. PI name + best title similarity >= MATCH_THRESHOLD, newest plan first, so
 *      when a chain's plans all match one existing row the CURRENT filing claims
 *      it and keeps that row's curated item assignments.
 *   3. anything left over is inserted.
 * Existing plans that match nothing (pre-2022 filings, non-plan projects) are
 * left untouched and listed in the report. Programs and campaigns are never
 * touched.
 *
 * Field writes are curation-aware (curatedSafe); plan_id and the derived status
 * are not curatable. description is only written when the CSV has an abstract —
 * 60 plans have none, and the existing text is better than nothing.
 *
 * Usage:
 *   npx tsx scripts/ingest-research-plans.ts [--dry-run] [--target=neon] [--csv=path] [--legacy=path]
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { readCsvFile } from './lib/csv.js'
import { curatedSafe } from './lib/curation.js'
import { cleanLegacyHtml, legacyValue } from './lib/legacy-text.js'
import { piKey } from './lib/person-names.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
const csvPath =
  args.find((a) => a.startsWith('--csv='))?.split('=')[1] ??
  join(import.meta.dirname, 'data', 'research-plans-2022-2026.csv')
const legacyPath =
  args.find((a) => a.startsWith('--legacy='))?.split('=')[1] ??
  join(import.meta.dirname, 'data', 'research-plans-legacy-1996-2020.json')

if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

/** Claim an existing project row for a plan at or above this title similarity. */
const MATCH_THRESHOLD = 0.4
/** Treat two of a PI's plans as the same continuing study at or above this. */
const CHAIN_THRESHOLD = 0.45

const TODAY = new Date()

// ---------------------------------------------------------------- text repair

/** Words that keep their capitals when a SHOUTING title is cased down. */
const KEEP_CAPS = new Set(['RMBL', 'GLORIA', 'SPLASH', 'SAIL', 'SFA', 'DNA', 'RNA', 'CO2', 'USA', 'NEON', 'SNOTEL', 'II', 'III', 'IV'])
const LOWER_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with'])

/**
 * The export's curly quotes and dashes were already replaced with "?" upstream,
 * so the original character is unrecoverable — but the two cases that matter are
 * inferable from context. Anything ambiguous (a "?" before whitespace, which may
 * be a real question mark or a lost closing quote) is left alone.
 */
function repairPunctuation(s: string): string {
  return s
    // contraction / possessive: don?t, Earth?s, we?ll
    .replace(/([A-Za-z])\?(t|s|re|ve|ll|d|m)\b/g, "$1'$2")
    // compound dash: plant?pathogen, traits?color
    .replace(/([a-z])\?([a-z])/g, '$1\u2013$2')
    .replace(/\u00a0/g, ' ')
    .replace(/_x000D_/g, '')
    // Salesforce escapes some punctuation on the way out: "Plant-Lichen \& Plant-…"
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function titleCase(s: string): string {
  return s
    .split(/(\s+)/)
    .map((tok, i) => {
      if (/^\s+$/.test(tok)) return tok
      const bare = tok.replace(/[^A-Za-z0-9]/g, '')
      if (KEEP_CAPS.has(bare)) return tok
      const lower = tok.toLowerCase()
      if (i > 0 && LOWER_WORDS.has(lower.replace(/[^a-z]/g, ''))) return lower
      return lower.replace(/^([^a-z]*)([a-z])/, (_m, p, c) => p + c.toUpperCase())
    })
    .join('')
}

/** Only de-shout genuine sentences; "SPLASH" and "GLORIA @ RMBL" are names. */
function fixShouting(s: string, minWords: number): string {
  if (s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s
  if (s.trim().split(/\s+/).length < minWords) return s
  return titleCase(s)
}

/** "Ian Breckheimer (community)" is a filing annotation, not part of the name. */
const cleanPi = (s: string) => fixShouting(repairPunctuation(s).replace(/\s*\([^()]*\)\s*$/, '').trim(), 2)

// ---------------------------------------------------------------------- model

interface Plan {
  planId: string
  pi: string
  name: string
  description: string | null
  fieldOfScience: string | null
  researchAreas: string | null
  startYear: number
  endYear: number
  endDate: Date
  status: 'active' | 'completed'
}

function parseDate(s: string): Date {
  const [m, d, y] = s.split('/').map(Number)
  return new Date(y, m - 1, d)
}

function loadPlans(): Plan[] {
  const rows = readCsvFile(csvPath, 'windows-1252')
  const plans = rows.map((r): Plan => {
    const start = parseDate(r['Start Date'])
    const end = parseDate(r['End Date'])
    const description = repairPunctuation(r['Non-Technical Abstract'] ?? '')
    return {
      planId: r['Plan ID'],
      pi: cleanPi(r['Research Plan: Owner Name']),
      name: fixShouting(repairPunctuation(r['Research Plan: Research Plan Name']), 4),
      description: description || null,
      fieldOfScience: r['Field of Science'] || null,
      researchAreas: r['Research Area'] || null,
      startYear: start.getFullYear(),
      endYear: end.getFullYear(),
      endDate: end,
      status: end >= TODAY ? 'active' : 'completed',
    }
  })
  return plans
}

/** Legacy Subject / Level values that have an equivalent in the Salesforce Research Area vocabulary. */
const LEGACY_AREAS: Record<string, string> = {
  'Climate Change': 'Climate change',
  'Long-Term': 'Long-term research',
  Phenology: 'Phenology',
  Pollination: 'Pollination',
  'Species Interaction': 'Species Interactions',
  Community: 'Community ecology',
}

/** Organisms answers that say nothing ("n", "N/A", "none"). */
const isPlaceholder = (s: string) => /^(n|na|n\/a|none|-+|\.+)?$/i.test(s.trim())

function loadLegacyPlans(): Plan[] {
  const rows = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Record<string, unknown>[]
  const text = (v: unknown) =>
    repairPunctuation(cleanLegacyHtml(legacyValue(v)))
      // the degree sign is the one lost character that is reliably inferable
      .replace(/(\d)\s?\?\s?([CF])\b/g, '$1 °$2')
  const person = (first: unknown, last: unknown) =>
    cleanPi(`${text(first)} ${text(last)}`.trim())

  // A handful of legacy filings have no title; there is nothing honest to call them.
  const untitled = rows.filter((r) => !text(r.ResearchPlanTitle))
  for (const r of untitled) {
    console.log(`  skipping untitled legacy plan ${r.ResearchPlanID} (${r.ResearchPlanYear}, ` +
      `${person(r.ResearchPlanFirstName, r.ResearchPlanLastName)})`)
  }

  return rows.filter((r) => !untitled.includes(r)).map((r): Plan => {
    const year = Number(r.ResearchPlanYear)
    const duration = Math.max(1, Number(legacyValue(r.ResearchPlanDuration)) || 1)
    const endYear = year + duration - 1

    const abstract = text(r.ResearchPlanAbstract)
    const institution = text(r.ResearchPlanInstitution)
    const collaborators = [
      person(r.ResearchPlanCollab1FirstName, r.ResearchPlanCollab1LastName),
      person(r.ResearchPlanCollab2FirstName, r.ResearchPlanCollab2LastName),
    ].filter(Boolean)
    const organisms = text(r.ResearchPlanOrganisms).replace(/^[):\s]+/, '')
    const trailer = [
      institution && `Institution: ${institution}`,
      collaborators.length > 0 && `Collaborators: ${collaborators.join(', ')}`,
      organisms && !isPlaceholder(organisms) && `Study organisms: ${organisms}`,
    ].filter(Boolean)
    const description = [abstract, trailer.join('\n')].filter(Boolean).join('\n\n')

    const areas = [...new Set([r.Subject, r.Level].map((v) => LEGACY_AREAS[legacyValue(v)]).filter(Boolean))]

    return {
      planId: `LEGACY-${r.ResearchPlanID}`,
      pi: person(r.ResearchPlanFirstName, r.ResearchPlanLastName),
      name: fixShouting(text(r.ResearchPlanTitle), 4),
      description: description || null,
      fieldOfScience: null,
      researchAreas: areas.length > 0 ? areas.join('; ') : null,
      startYear: year,
      endYear,
      endDate: new Date(endYear, 11, 31),
      status: 'completed',
    }
  })
}

function validate(plans: Plan[]): Plan[] {
  const seen = new Set<string>()
  for (const p of plans) {
    if (!p.planId) throw new Error(`Row with no Plan ID: ${p.name}`)
    if (seen.has(p.planId)) throw new Error(`Duplicate Plan ID: ${p.planId}`)
    if (!p.pi || !p.name) throw new Error(`Plan ${p.planId} is missing its PI or title`)
    if (!Number.isInteger(p.startYear)) throw new Error(`Plan ${p.planId} has no year`)
    seen.add(p.planId)
  }
  return plans
}

// ----------------------------------------------------------------------- main

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }

  const current = loadPlans()
  const legacy = loadLegacyPlans()
  const plans = validate([...current, ...legacy])
  console.log(
    `Target: ${target}${dryRun ? ' (dry-run)' : ''} — ${plans.length} plans: ` +
      `${current.length} from ${csvPath.split('/').pop()}, ${legacy.length} from ${legacyPath.split('/').pop()}\n` +
      `  ${plans.filter((p) => p.status === 'active').length} active, ` +
      `${plans.filter((p) => p.status === 'completed').length} completed, ` +
      `${plans.filter((p) => p.description).length} with abstracts`,
  )

  const db = new pg.Pool({ connectionString })
  try {
    /** pg_trgm similarity of `name` against each candidate, in one round trip. */
    const simAgainst = async (name: string, candidates: string[]): Promise<number[]> => {
      if (candidates.length === 0) return []
      const { rows } = await db.query(
        `SELECT similarity(lower($1), lower(c)) AS s
           FROM unnest($2::text[]) WITH ORDINALITY AS t(c, i) ORDER BY i`,
        [name, candidates],
      )
      return rows.map((r) => Number(r.s))
    }

    const { rows: existing } = await db.query<{
      id: number
      name: string
      pi: string | null
      status: string
      plan_id: string | null
    }>(`SELECT id, name, pi, status, plan_id FROM projects WHERE project_type = 'research_plan'`)
    console.log(`  ${existing.length} research_plan projects already in the table\n`)

    const byPlanId = new Map(existing.filter((e) => e.plan_id).map((e) => [e.plan_id!, e]))
    const byPi = new Map<string, typeof existing>()
    for (const e of existing) {
      const k = piKey(e.pi ?? '')
      if (!byPi.has(k)) byPi.set(k, [])
      byPi.get(k)!.push(e)
    }

    // --- reconcile: plan_id first, then PI + title, newest filing first ------
    const claimed = new Map<number, string>() // project id -> plan id
    const resolved = new Map<string, number | null>() // plan id -> project id
    const fuzzy: string[] = []
    const nearMisses: string[] = []

    for (const plan of plans) {
      const direct = byPlanId.get(plan.planId)
      if (direct) {
        claimed.set(direct.id, plan.planId)
        resolved.set(plan.planId, direct.id)
      }
    }

    for (const plan of [...plans].sort((a, b) => b.endDate.getTime() - a.endDate.getTime())) {
      if (resolved.has(plan.planId)) continue
      const candidates = (byPi.get(piKey(plan.pi)) ?? []).filter((c) => !claimed.has(c.id))
      const sims = await simAgainst(plan.name, candidates.map((c) => c.name))
      let bi = -1
      for (let i = 0; i < sims.length; i++) if (bi === -1 || sims[i] > sims[bi]) bi = i
      if (bi >= 0 && sims[bi] >= MATCH_THRESHOLD) {
        claimed.set(candidates[bi].id, plan.planId)
        resolved.set(plan.planId, candidates[bi].id)
        if (sims[bi] < 0.9) {
          fuzzy.push(
            `  ${sims[bi].toFixed(2)} ${plan.planId} [${plan.pi}] "${plan.name.slice(0, 44)}"` +
              ` -> #${candidates[bi].id} "${candidates[bi].name.slice(0, 44)}"`,
          )
        }
      } else {
        resolved.set(plan.planId, null)
        if (bi >= 0 && sims[bi] >= 0.2) {
          nearMisses.push(
            `  ${sims[bi].toFixed(2)} ${plan.planId} [${plan.pi}] "${plan.name.slice(0, 44)}"` +
              ` vs #${candidates[bi].id} "${candidates[bi].name.slice(0, 44)}"`,
          )
        }
      }
    }

    const updates = plans.filter((p) => resolved.get(p.planId) != null)
    const inserts = plans.filter((p) => resolved.get(p.planId) == null)
    const untouched = existing.filter((e) => !claimed.has(e.id))

    console.log(`Reconciliation: ${updates.length} matched existing rows, ${inserts.length} new`)
    if (fuzzy.length) {
      console.log(`\nFuzzy matches (below 0.9 — review these):`)
      fuzzy.forEach((f) => console.log(f))
    }
    if (nearMisses.length) {
      console.log(`\nNear misses inserted as new rows (best candidate was below ${MATCH_THRESHOLD}):`)
      nearMisses.forEach((n) => console.log(n))
    }
    if (untouched.length) {
      console.log(`\nExisting projects with no plan in the CSV (left untouched):`)
      untouched.forEach((u) => console.log(`  #${u.id} [${u.pi}] ${u.status} "${(u.name ?? '').slice(0, 55)}"`))
    }

    // --- write --------------------------------------------------------------
    if (!dryRun) {
      for (const plan of updates) {
        const id = resolved.get(plan.planId)!
        const sets = [
          curatedSafe('name', '$1'),
          curatedSafe('field_of_science', '$2'),
          curatedSafe('research_areas', '$3'),
          curatedSafe('pi', '$4'),
          curatedSafe('start_year', '$5'),
          curatedSafe('end_year', '$6'),
          curatedSafe('status', '$7'),
          `plan_id = $8`,
          'updated_at = NOW()',
        ]
        const params: unknown[] = [
          plan.name, plan.fieldOfScience, plan.researchAreas, plan.pi,
          plan.startYear, plan.endYear, plan.status, plan.planId,
        ]
        // Only overwrite the abstract when the export actually has one.
        if (plan.description) {
          params.push(plan.description)
          sets.splice(1, 0, curatedSafe('description', `$${params.length}`))
        }
        params.push(id)
        await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
      }

      for (const plan of inserts) {
        const { rows: [row] } = await db.query<{ id: number }>(
          `INSERT INTO projects
             (name, description, project_type, status, pi, pi_author_id, field_of_science,
              research_areas, start_year, end_year, plan_id, auto_discovery_enabled,
              curated_fields, created_at, updated_at)
           VALUES ($1, $2, 'research_plan', $3, $4, NULL, $5, $6, $7, $8, $9, $10, '[]'::jsonb, NOW(), NOW())
           RETURNING id`,
          [plan.name, plan.description, plan.status, plan.pi, plan.fieldOfScience,
           plan.researchAreas, plan.startYear, plan.endYear, plan.planId,
           // Legacy plans get no auto-discovered items: assign-projects attaches a
           // PI's whole career to every plan they filed (Ian, 2026-11-09). They wait
           // for program-level linking.
           !plan.planId.startsWith('LEGACY-')],
        )
        resolved.set(plan.planId, row.id)
      }

      // Keep assign-projects off legacy plans (see the insert above).
      const { rowCount: autoOff } = await db.query(
        `UPDATE projects SET auto_discovery_enabled = false WHERE plan_id LIKE 'LEGACY-%' AND auto_discovery_enabled`)
      if (autoOff) console.log(`Turned auto-discovery off on ${autoOff} legacy plans.`)

      // PI → author links need evidence beyond the name; link-plan-pis.ts makes them.
      console.log(`\nNext: npx tsx scripts/link-plan-pis.ts${target === 'neon' ? ' --target=neon' : ''} to link PIs to author pages.`)

      // Clean the _x000D_ artifacts the previous loader left behind on rows
      // whose CSV entry carries no replacement abstract.
      const { rowCount: descFixed } = await db.query(
        `UPDATE projects SET description = btrim(regexp_replace(description, '_x000D_', '', 'g'))
          WHERE description LIKE '%_x000D_%'`,
      )
      if (descFixed) console.log(`Stripped _x000D_ artifacts from ${descFixed} descriptions.`)
    }

    // --- renewal chains -----------------------------------------------------
    // Grouped on the cleaned CSV titles so the result does not depend on what
    // happened to already be in the table.
    const piGroups = new Map<string, Plan[]>()
    for (const p of plans) {
      const k = piKey(p.pi)
      if (!piGroups.has(k)) piGroups.set(k, [])
      piGroups.get(k)!.push(p)
    }

    const chains: Plan[][] = []
    for (const group of piGroups.values()) {
      if (group.length === 1) continue
      const built: Plan[][] = []
      for (const p of group) {
        let placed = false
        for (const chain of built) {
          const sims = await simAgainst(p.name, chain.map((q) => q.name))
          if (sims.some((s) => s >= CHAIN_THRESHOLD)) {
            chain.push(p)
            placed = true
            break
          }
        }
        if (!placed) built.push([p])
      }
      chains.push(...built.filter((c) => c.length > 1))
    }

    console.log(
      `\nRenewal chains: ${chains.length} chains covering ${chains.reduce((a, c) => a + c.length, 0)} plans` +
        ` (${plans.length - chains.reduce((a, c) => a + c.length, 0)} standalone).`,
    )
    for (const chain of chains) {
      const ordered = [...chain].sort((a, b) => a.startYear - b.startYear || a.planId.localeCompare(b.planId))
      console.log(
        `  [${ordered[0].pi}] ${ordered.map((p) => `${p.planId}(${p.startYear}-${p.endYear})`).join(' <- ')}` +
          `\n      root: "${ordered[0].name.slice(0, 60)}"`,
      )
      if (dryRun) continue
      const rootId = resolved.get(ordered[0].planId)
      if (!rootId) continue
      for (const p of ordered.slice(1)) {
        const id = resolved.get(p.planId)
        if (!id || id === rootId) continue
        await db.query(
          `UPDATE projects SET ${curatedSafe('renews_project_id', '$1', 'renewsProject')}, updated_at = NOW() WHERE id = $2`,
          [rootId, id],
        )
      }
      // The root of a chain never renews anything.
      await db.query(
        `UPDATE projects SET ${curatedSafe('renews_project_id', 'NULL', 'renewsProject')} WHERE id = $1 AND renews_project_id IS NOT NULL`,
        [rootId],
      )
    }
    if (!dryRun) {
      const { rows: [summary] } = await db.query(
        `SELECT count(*) FILTER (WHERE plan_id IS NOT NULL) AS with_plan_id,
                count(*) FILTER (WHERE status = 'active') AS active,
                count(*) FILTER (WHERE status = 'completed') AS completed,
                count(*) FILTER (WHERE renews_project_id IS NOT NULL) AS renewals,
                count(*) AS total
           FROM projects WHERE project_type = 'research_plan'`,
      )
      console.log(
        `\nResearch plans now: ${summary.total} total (${summary.with_plan_id} with a plan ID), ` +
          `${summary.active} active / ${summary.completed} completed, ${summary.renewals} chained renewals.`,
      )
    }
    console.log(`${dryRun ? '\n[dry-run] nothing written.' : '\nDone.'}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
