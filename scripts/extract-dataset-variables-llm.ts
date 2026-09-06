/**
 * LLM extraction of measured variables from dataset metadata, auto-matched
 * to the NASA GCMD Science Keywords taxonomy.
 *
 * REPLACES the mechanical dd.csv variable harvest (formerly Part 3 of
 * backfill-dataset-attributes.ts). Per dataset, Claude reads title +
 * description + methods + existing keywords/variables and returns measured
 * variables with canonical lowercase names plus a GCMD path each, chosen
 * VERBATIM from the pruned taxonomy in scripts/data/gcmd-science-keywords.json
 * (2,303 paths, Variable_Level_2 depth, RMBL-relevant topics). Paths are
 * validated against the taxonomy set — an invented path is dropped to null.
 *
 * Writes:
 *   datasets.variables       text[]  — canonical names (the /datasets facet)
 *   datasets.variable_units  text[]  — units, position-aligned ('' = unstated);
 *                                      only units the metadata explicitly states
 *   datasets.gcmd_variables  text[]  — GCMD paths, position-aligned with names
 *                                      (null entries become the string '')
 * gcmd_variables IS NULL marks unprocessed rows, so re-runs resume where the
 * last run stopped; --force reprocesses everything. Empty extraction → '{}'.
 *
 * The taxonomy rides in a prompt-cached content block; the first call warms
 * the cache, then extraction runs 4-way concurrent. Pilot: 69/69 valid GCMD
 * matches, $0.19/12 datasets → ~$25 full corpus on opus-5.
 *
 * --sync-neon copies local results to Neon (matched by doi, then lower(title))
 * instead of re-running the extraction there.
 *
 * Usage:
 *   npx tsx scripts/extract-dataset-variables-llm.ts [--dry-run] [--limit=N] [--force] [--report] [--model=...]
 *   npx tsx scripts/extract-dataset-variables-llm.ts --sync-neon
 */

import fs from 'fs'
import pg from 'pg'
import './lib/config.js'
import { callClaude } from './lib/claude-api.js'
import { runConcurrent } from './lib/concurrency.js'

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')
const syncNeon = process.argv.includes('--sync-neon')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const report = process.argv.includes('--report')
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-opus-5'
const CONCURRENCY = 4
const reportRows: { id: number; title: string; repository: string; vars: any[] }[] = []

const taxonomy = JSON.parse(fs.readFileSync('scripts/data/gcmd-science-keywords.json', 'utf8'))
const gcmdPaths: string[] = taxonomy.paths
const gcmdSet = new Set(gcmdPaths)

const TAXONOMY_BLOCK = `You match environmental dataset variables to the NASA GCMD Science Keywords taxonomy (version ${taxonomy.version}, truncated to Variable_Level_2). The COMPLETE list of allowed paths follows — a match must be copied verbatim from this list, never invented or abbreviated:

${gcmdPaths.join('\n')}`

function buildTask(d: {
  title: string
  description: string | null
  methods: string | null
  keywords: string[] | null
  variables: string[] | null
  repository: string
  sdp_catalog_id: string | null
}): string {
  const parts = [
    `TITLE: ${d.title}`,
    `REPOSITORY: ${d.repository}${d.sdp_catalog_id ? ` (SDP product ${d.sdp_catalog_id})` : ''}`,
    d.description ? `DESCRIPTION: ${d.description.slice(0, 4000)}` : null,
    d.methods ? `METHODS: ${d.methods.slice(0, 2000)}` : null,
    d.keywords?.length ? `EXISTING KEYWORDS (EML harvest): ${d.keywords.join(', ')}` : null,
    d.variables?.length ? `EXISTING VARIABLES (dd.csv harvest): ${d.variables.join(', ')}` : null,
  ].filter(Boolean)

  return `Extract the MEASURED VARIABLES from this dataset's metadata.

${parts.join('\n')}

Rules:
- A variable is a quantity or attribute the dataset actually records (e.g. snow depth, stem density, dissolved organic carbon, canopy height) — NOT bookkeeping columns (dates, site IDs, sample names) and NOT the study topic.
- Use short lowercase canonical names ("soil moisture", not "volumetric soil moisture content at 10cm (VWC_10)"). Do not include units in the name.
- Report the unit ONLY when the metadata explicitly states it (in the description, methods, keywords, or a column name like "depth [m]"). Never infer a conventional unit — if no unit is stated, use null. For each stated unit, quote the exact metadata fragment that states it in "unit_evidence".
- For each variable pick the single best GCMD path COPIED VERBATIM from the taxonomy above. If nothing in the list is a reasonable fit, use null — do not force a match.
- Typically 1-10 variables per dataset. If the metadata is too thin to identify any, return an empty list.

Respond with ONLY a JSON object: {"variables": [{"name": "...", "unit": "..." | null, "unit_evidence": "..." | null, "gcmd": "TOPIC > TERM > ..." | null}]}`
}

async function syncToNeon() {
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL })
  try {
    const { rows } = await local.query(
      `SELECT doi, title, variables, variable_units, gcmd_variables FROM datasets WHERE gcmd_variables IS NOT NULL`,
    )
    console.log(`Syncing ${rows.length} extracted rows to Neon`)
    let byDoi = 0, byTitle = 0, missed = 0
    for (const r of rows) {
      let res = { rowCount: 0 } as { rowCount: number | null }
      if (r.doi) {
        res = await neon.query(
          `UPDATE datasets SET variables = $1, variable_units = $2, gcmd_variables = $3, updated_at = NOW() WHERE lower(doi) = lower($4)`,
          [r.variables, r.variable_units, r.gcmd_variables, r.doi],
        )
      }
      if (res.rowCount) { byDoi++; continue }
      res = await neon.query(
        `UPDATE datasets SET variables = $1, variable_units = $2, gcmd_variables = $3, updated_at = NOW() WHERE lower(title) = lower($4)`,
        [r.variables, r.variable_units, r.gcmd_variables, r.title],
      )
      if (res.rowCount) byTitle++
      else missed++
    }
    console.log(`Done: ${byDoi} matched by DOI, ${byTitle} by title, ${missed} unmatched on Neon`)
  } finally {
    await local.end()
    await neon.end()
  }
}

async function main() {
  if (syncNeon) return syncToNeon()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const { rows: candidates } = await db.query(`
      SELECT id, title, description, methods, keywords, variables, repository, sdp_catalog_id
      FROM datasets
      ${force ? '' : 'WHERE gcmd_variables IS NULL'}
      ORDER BY id ${limit ? `LIMIT ${limit}` : ''}
    `)
    console.log(`${candidates.length} datasets to process, model ${MODEL}${dryRun ? ' (dry-run)' : ''}`)
    if (candidates.length === 0) return

    let totalCost = 0
    let extracted = 0
    let empty = 0
    let invalidPaths = 0

    const processOne = async (d: any) => {
      const res = await callClaude({
        apiKey,
        model: MODEL,
        maxTokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              // Taxonomy first + cache_control: identical cached prefix across all calls
              { type: 'text', text: TAXONOMY_BLOCK, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: buildTask(d) },
            ],
          },
        ],
      })
      totalCost += res.cost
      let vars: { name: string; unit?: string | null; unit_evidence?: string | null; gcmd: string | null }[] = []
      try {
        const m = res.text.match(/\{[\s\S]*\}/)
        vars = JSON.parse(m ? m[0] : res.text).variables ?? []
      } catch {
        throw new Error(`unparseable response for dataset ${d.id}`)
      }
      const names: string[] = []
      const units: string[] = []
      const gcmds: string[] = []
      for (const v of vars) {
        const name = v.name?.trim().toLowerCase()
        if (!name || name.length > 60) continue
        names.push(name)
        // a unit without evidence is treated as inferred and dropped
        units.push(v.unit && v.unit_evidence ? v.unit.trim() : '')
        if (v.gcmd && !gcmdSet.has(v.gcmd)) invalidPaths++
        gcmds.push(v.gcmd && gcmdSet.has(v.gcmd) ? v.gcmd : '')
      }
      if (names.length) extracted++
      else empty++
      if (report) reportRows.push({ id: d.id, title: d.title, repository: d.repository, vars })
      if (!dryRun) {
        await db.query(
          `UPDATE datasets SET variables = $1, variable_units = $2, gcmd_variables = $3, updated_at = NOW() WHERE id = $4`,
          [names, units, gcmds, d.id],
        )
      }
    }

    // Warm the prompt cache with a single call before fanning out
    await processOne(candidates[0])
    const { errors } = await runConcurrent(candidates.slice(1), CONCURRENCY, processOne, 'extract')

    console.log(
      `Done: ${extracted} datasets with variables, ${empty} empty, ${errors} errors, ` +
        `${invalidPaths} hallucinated GCMD paths dropped`,
    )
    console.log(`Cost: $${totalCost.toFixed(2)}`)
    if (report) {
      const lines = [`# Unit extraction pilot — ${MODEL}`, '']
      for (const r of reportRows.sort((a, b) => a.id - b.id)) {
        lines.push(`## [${r.repository}] ${r.title}`, '')
        if (!r.vars.length) lines.push('_(no variables)_')
        for (const v of r.vars) {
          lines.push(`- **${v.name}** — unit: ${v.unit ?? '—'}${v.unit_evidence ? ` · evidence: "${v.unit_evidence}"` : ''}`)
          lines.push(`  - gcmd: ${v.gcmd ?? '—'}`)
        }
        lines.push('')
      }
      fs.mkdirSync('scripts/output/variable-extraction-prototype', { recursive: true })
      fs.writeFileSync('scripts/output/variable-extraction-prototype/units-report.md', lines.join('\n'))
      console.log('Report: scripts/output/variable-extraction-prototype/units-report.md')
    }
  } finally {
    await db.end()
  }
}

main()
