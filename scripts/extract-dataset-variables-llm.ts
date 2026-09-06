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
 *   datasets.temporal_extent_start/end — filled ONLY where NULL, from stated
 *                                      data-collection years (never pub dates)
 *   datasets.data_ongoing    bool    — collection explicitly continuing
 *   datasets.temporal_resolution text — sub-daily … one-time
 *   datasets.cited_references jsonb  — companion papers [{doi, citation, evidence}]
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
const reportRows: { id: number; title: string; repository: string; vars: any[]; data_years?: any; resolution?: string | null; cited?: any[] }[] = []

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
  doi?: string | null
}): string {
  const parts = [
    `TITLE: ${d.title}`,
    `REPOSITORY: ${d.repository}${d.sdp_catalog_id ? ` (SDP product ${d.sdp_catalog_id})` : ''}`,
    d.doi ? `THIS DATASET'S OWN DOI (never a cited publication): ${d.doi}` : null,
    d.description ? `DESCRIPTION: ${d.description.slice(0, 4000)}` : null,
    d.methods ? `METHODS: ${d.methods.slice(0, 2000)}` : null,
    d.keywords?.length ? `EXISTING KEYWORDS (EML harvest): ${d.keywords.join(', ')}` : null,
    d.variables?.length ? `EXISTING VARIABLES (dd.csv harvest): ${d.variables.slice(0, 30).join(', ')}` : null,
  ].filter(Boolean)

  return `Extract the MEASURED VARIABLES from this dataset's metadata.

${parts.join('\n')}

Rules:
- A variable is a quantity or attribute the dataset actually records (e.g. snow depth, stem density, dissolved organic carbon, canopy height) — NOT bookkeeping columns (dates, site IDs, sample names) and NOT the study topic.
- Use short lowercase canonical names ("soil moisture", not "volumetric soil moisture content at 10cm (VWC_10)"). Do not include units in the name.
- Report the unit ONLY when the metadata explicitly states it (in the description, methods, keywords, or a column name like "depth [m]"). Never infer a conventional unit — if no unit is stated, use null. For each stated unit, quote the exact metadata fragment that states it in "unit_evidence".
- For each variable pick the single best GCMD path COPIED VERBATIM from the taxonomy above. If nothing in the list is a reasonable fit, use null — do not force a match.
- Typically 1-10 variables per dataset, NEVER more than 15 — for large data dictionaries, consolidate to the principal measured quantities. If the metadata is too thin to identify any, return an empty list.

Also extract, from the SAME metadata:
- data_years: the years the DATA WERE COLLECTED, only when the metadata states them (title year ranges like "(2002 - 2021)" count). NEVER use the publication or release date as a collection year. "ongoing" is true only when collection is explicitly described as continuing ("and continuing", "ongoing", "long-term monitoring ... to present").
- temporal_resolution: how often observations were made, only when stated or unambiguous from the design. One of: "sub-daily", "daily", "weekly", "monthly", "annual", "multi-year", "one-time". A single survey/campaign or a static map layer is "one-time". Use null when unclear.
- cited_publications: companion or source papers this dataset accompanies or derives from ("Data from Smith et al. 2024...", an explicitly cited paper DOI). Include the DOI when present (bare form, e.g. "10.1234/abc"), and the citation string as written. Quote the metadata fragment in "evidence". Do NOT list the dataset's own DOI. Empty list if none.

Respond with ONLY a JSON object:
{"variables": [{"name": "...", "unit": "..." | null, "unit_evidence": "..." | null, "gcmd": "TOPIC > TERM > ..." | null}],
 "data_years": {"start": YYYY | null, "end": YYYY | null, "ongoing": true | false | null},
 "temporal_resolution": "..." | null,
 "cited_publications": [{"doi": "..." | null, "citation": "...", "evidence": "..."}]}`
}

async function syncToNeon() {
  if (!process.env.NEON_DIRECT_URL) throw new Error('NEON_DIRECT_URL is not set')
  const local = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const neon = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL })
  try {
    const { rows } = await local.query(
      `SELECT doi, title, variables, variable_units, gcmd_variables,
              temporal_extent_start, temporal_extent_end, data_ongoing, temporal_resolution, cited_references,
              embedding::text AS embedding
       FROM datasets WHERE gcmd_variables IS NOT NULL`,
    )
    console.log(`Syncing ${rows.length} extracted rows to Neon`)
    let byDoi = 0, byTitle = 0, missed = 0
    for (const r of rows) {
      let res = { rowCount: 0 } as { rowCount: number | null }
      if (r.doi) {
        res = await neon.query(
          `UPDATE datasets SET variables = $1, variable_units = $2, gcmd_variables = $3,
               temporal_extent_start = COALESCE(temporal_extent_start, $4),
               temporal_extent_end = COALESCE(temporal_extent_end, $5),
               data_ongoing = $6, temporal_resolution = $7, cited_references = $8,
               embedding = COALESCE($9::vector, embedding),
               updated_at = NOW() WHERE lower(doi) = lower($10)`,
          [r.variables, r.variable_units, r.gcmd_variables, r.temporal_extent_start, r.temporal_extent_end,
           r.data_ongoing, r.temporal_resolution, JSON.stringify(r.cited_references), r.embedding, r.doi],
        )
      }
      if (res.rowCount) { byDoi++; continue }
      res = await neon.query(
        `UPDATE datasets SET variables = $1, variable_units = $2, gcmd_variables = $3,
               temporal_extent_start = COALESCE(temporal_extent_start, $4),
               temporal_extent_end = COALESCE(temporal_extent_end, $5),
               data_ongoing = $6, temporal_resolution = $7, cited_references = $8,
               embedding = COALESCE($9::vector, embedding),
               updated_at = NOW() WHERE lower(title) = lower($10)`,
        [r.variables, r.variable_units, r.gcmd_variables, r.temporal_extent_start, r.temporal_extent_end,
         r.data_ongoing, r.temporal_resolution, JSON.stringify(r.cited_references), r.embedding, r.title],
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
      SELECT id, title, description, methods, keywords, variables, repository, sdp_catalog_id,
             doi, temporal_extent_start
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
    let yearsFilled = 0
    let withCitedRefs = 0

    const processOne = async (d: any) => {
      const res = await callClaude({
        apiKey,
        model: MODEL,
        maxTokens: 8000,
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
      let parsed: any = {}
      if (!res.text.trim()) {
        // safety-classifier refusal (e.g. bio category on disease-evolution
        // datasets) — record as processed-empty rather than erroring forever
        console.error(`
  [${d.id}] empty response (likely refusal) — marking processed-empty`)
        empty++
        if (!dryRun) await db.query(`UPDATE datasets SET gcmd_variables = '{}' WHERE id = $1`, [d.id])
        return
      }
      try {
        const m = res.text.match(/\{[\s\S]*\}/)
        parsed = JSON.parse(m ? m[0] : res.text)
        vars = parsed.variables ?? []
      } catch {
        console.error(`
  [${d.id}] RESPONSE HEAD: ${res.text.slice(0, 200)}`)
        console.error(`  [${d.id}] RESPONSE TAIL: ${res.text.slice(-200)}`)
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

      // --- three companion extractions ---
      const yrs = parsed.data_years ?? {}
      const yearOk = (y: any) => Number.isInteger(y) && y >= 1900 && y <= 2027
      const start = yearOk(yrs.start) ? yrs.start : null
      const end = yearOk(yrs.end) ? yrs.end : start
      const RESOLUTIONS = new Set(['sub-daily', 'daily', 'weekly', 'monthly', 'annual', 'multi-year', 'one-time'])
      const resolution = RESOLUTIONS.has(parsed.temporal_resolution) ? parsed.temporal_resolution : null
      const selfDoi = d.doi?.toLowerCase().replace(/^https?:\/\/doi\.org\//, '')
      const cited = (parsed.cited_publications ?? [])
        .filter((c: any) => c?.citation && c.evidence)
        .map((c: any) => ({
          doi: c.doi ? String(c.doi).toLowerCase().replace(/^https?:\/\/doi\.org\//, '') : null,
          citation: String(c.citation).slice(0, 500),
          evidence: String(c.evidence).slice(0, 300),
        }))
        .filter((c: any) => !c.doi || c.doi !== selfDoi)
        .slice(0, 10)
      if (start) yearsFilled++
      if (cited.length) withCitedRefs++

      if (report) reportRows.push({ id: d.id, title: d.title, repository: d.repository, vars, data_years: { start, end, ongoing: yrs.ongoing ?? null }, resolution, cited })
      if (!dryRun) {
        await db.query(
          `UPDATE datasets SET
             variables = $1, variable_units = $2, gcmd_variables = $3,
             temporal_extent_start = CASE WHEN temporal_extent_start IS NULL AND $4::int IS NOT NULL
                                          THEN make_timestamptz($4::int, 1, 1, 0, 0, 0) ELSE temporal_extent_start END,
             temporal_extent_end   = CASE WHEN temporal_extent_end IS NULL AND $5::int IS NOT NULL
                                          THEN make_timestamptz($5::int, 12, 31, 0, 0, 0) ELSE temporal_extent_end END,
             data_ongoing = $6, temporal_resolution = $7, cited_references = $8,
             updated_at = NOW()
           WHERE id = $9`,
          [names, units, gcmds, start, end, yrs.ongoing ?? null, resolution, JSON.stringify(cited), d.id],
        )
      }
    }

    // Warm the prompt cache with a single call before fanning out
    let warmErrors = 0
    try {
      await processOne(candidates[0])
    } catch (e: any) {
      console.error(`  warm call failed (${e.message}) — continuing`)
      warmErrors = 1
    }
    const { errors: runErrors } = await runConcurrent(candidates.slice(1), CONCURRENCY, processOne, 'extract')
    const errors = runErrors + warmErrors

    console.log(
      `Done: ${extracted} datasets with variables, ${empty} empty, ${errors} errors, ` +
        `${invalidPaths} hallucinated GCMD paths dropped`,
    )
    console.log(`Extras: ${yearsFilled} with data years, ${withCitedRefs} with cited publications`)
    console.log(`Cost: $${totalCost.toFixed(2)}`)
    if (report) {
      const lines = [`# Unit extraction pilot — ${MODEL}`, '']
      for (const r of reportRows.sort((a, b) => a.id - b.id)) {
        lines.push(`## [${r.repository}] ${r.title}`, '')
        if (r.data_years?.start) lines.push(`*data years:* ${r.data_years.start}–${r.data_years.end}${r.data_years.ongoing ? ' (ongoing)' : ''}`)
        if (r.resolution) lines.push(`*resolution:* ${r.resolution}`)
        for (const c of r.cited ?? []) lines.push(`*cites:* ${c.citation}${c.doi ? ` [${c.doi}]` : ''} · "${c.evidence}"`)
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
