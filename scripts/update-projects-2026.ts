/**
 * Update the Projects collection from the 2026 Active Research Plan list
 * (scripts/data/research-plans-2026.json, from "Research Plan List for
 * web_2026_06_09.xlsx").
 *
 * Reconciliation, per 2026 plan:
 *   - match an existing research_plan project by PI name + best plan-name
 *     trigram similarity (a PI can hold several plans, and plan titles
 *     evolve year over year)
 *   - matched   → update in place (name/description/field/areas curation-
 *     aware; status back to 'active'; fills descriptions the 2024 seed
 *     lacked)
 *   - unmatched → insert as a new active research_plan (start_year 2026)
 *
 * Existing research_plan projects with no 2026 counterpart are marked
 * status='completed' (the active list is authoritative for what's active).
 * Programs and campaigns are never touched. pi_author_id is (re)resolved by
 * author display name where possible.
 *
 * Usage:
 *   npx tsx scripts/update-projects-2026.ts [--dry-run] [--target=neon]
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import './lib/config.js'
import { curatedSafe } from './lib/curation.js'

const dryRun = process.argv.includes('--dry-run')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const MATCH_THRESHOLD = 0.45

interface Plan {
  pi: string
  institution: string | null
  position: string | null
  name: string
  description: string | null
  fieldOfScience: string | null
  researchAreas: string | null
}

const normPi = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

async function main() {
  const plans: Plan[] = JSON.parse(
    readFileSync(join(import.meta.dirname, 'data', 'research-plans-2026.json'), 'utf-8'),
  )
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''} — ${plans.length} active 2026 plans`)
  const db = new pg.Pool({ connectionString })
  try {
    const { rows: existing } = await db.query(
      `SELECT id, name, pi, status FROM projects WHERE project_type = 'research_plan'`,
    )
    const byPi = new Map<string, typeof existing>()
    for (const p of existing) {
      const k = normPi(p.pi ?? '')
      if (!byPi.has(k)) byPi.set(k, [])
      byPi.get(k)!.push(p)
    }

    const claimed = new Set<number>()
    let updated = 0
    let inserted = 0
    for (const plan of plans) {
      const candidates = (byPi.get(normPi(plan.pi)) ?? []).filter((c) => !claimed.has(c.id))
      let best: { id: number; name: string } | null = null
      let bestSim = 0
      for (const c of candidates) {
        const { rows: [{ sim }] } = await db.query(`SELECT similarity(lower($1), lower($2)) AS sim`, [plan.name, c.name])
        if (sim > bestSim) {
          bestSim = sim
          best = c
        }
      }
      if (best && bestSim >= MATCH_THRESHOLD) {
        claimed.add(best.id)
        if (dryRun) {
          if (bestSim < 0.95) console.log(`  MATCH (${bestSim.toFixed(2)}) ${plan.pi}: "${best.name.slice(0, 45)}" <- "${plan.name.slice(0, 45)}"`)
        } else {
          const sets = [
            curatedSafe('name', '$1'),
            curatedSafe('description', '$2'),
            curatedSafe('field_of_science', '$3'),
            curatedSafe('research_areas', '$4'),
            curatedSafe('status', `'active'`),
            'updated_at = NOW()',
          ]
          await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $5`, [
            plan.name,
            plan.description,
            plan.fieldOfScience,
            plan.researchAreas,
            best.id,
          ])
        }
        updated++
      } else {
        if (dryRun) {
          console.log(`  NEW ${plan.pi}: ${plan.name.slice(0, 60)}`)
        } else {
          await db.query(
            `INSERT INTO projects
               (name, description, project_type, status, pi, pi_author_id, field_of_science,
                research_areas, start_year, auto_discovery_enabled, curated_fields, created_at, updated_at)
             VALUES ($1, $2, 'research_plan', 'active', $3,
                     (SELECT id FROM authors WHERE lower(display_name) = lower($6) ORDER BY work_count DESC NULLS LAST LIMIT 1),
                     $4, $5, 2026, true, '[]'::jsonb, NOW(), NOW())`,
            [plan.name, plan.description, plan.pi, plan.fieldOfScience, plan.researchAreas, plan.pi],
          )
        }
        inserted++
      }
    }

    const stale = existing.filter((p) => !claimed.has(p.id) && p.status === 'active')
    if (!dryRun && stale.length > 0) {
      await db.query(
        `UPDATE projects SET ${curatedSafe('status', `'completed'`)}, updated_at = NOW()
         WHERE id = ANY($1)`,
        [stale.map((s) => s.id)],
      )
    }
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Done: ${updated} updated, ${inserted} inserted, ` +
        `${stale.length} no-longer-active plans marked completed.`,
    )
    if (dryRun && stale.length > 0) {
      console.log(`  Would mark completed:`)
      for (const s of stale.slice(0, 15)) console.log(`    ${s.pi}: ${s.name.slice(0, 60)}`)
      if (stale.length > 15) console.log(`    … and ${stale.length - 15} more`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
