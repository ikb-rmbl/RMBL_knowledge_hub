/**
 * PROTOTYPE — LLM extraction of measured variables from dataset metadata,
 * auto-matched to the GCMD Science Keywords taxonomy.
 *
 * Compares against the current mechanical sources (dd.csv harvest → variables,
 * EML <keyword> harvest → keywords). Per dataset, Claude reads title +
 * description + methods + existing keywords/variables and returns:
 *   - measured variables (canonical name + unit when stated)
 *   - a GCMD path for each, chosen VERBATIM from the pruned taxonomy in
 *     scripts/data/gcmd-science-keywords.json (2,303 paths, truncated to
 *     Variable_Level_2, RMBL-relevant topics only)
 *
 * The taxonomy rides in a prompt-cached content block, so per-dataset cost
 * after the first call is dominated by the (small) metadata + output.
 *
 * NO DATABASE WRITES — results land in scripts/output/variable-extraction-prototype/
 * (results.json + report.md) for eyeball review.
 *
 * Usage:
 *   npx tsx scripts/extract-dataset-variables-llm.ts [--limit=N] [--model=...]
 */

import fs from 'fs'
import path from 'path'
import pg from 'pg'
import './lib/config.js'
import { callClaude } from './lib/claude-api.js'

const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const SAMPLE_PER_STRATUM = limitArg ? Math.ceil(parseInt(limitArg) / 3) : 4
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-opus-5'
const OUT_DIR = 'scripts/output/variable-extraction-prototype'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

const taxonomy = JSON.parse(fs.readFileSync('scripts/data/gcmd-science-keywords.json', 'utf8'))
const gcmdPaths: string[] = taxonomy.paths
const gcmdSet = new Set(gcmdPaths)

interface ExtractedVariable {
  name: string
  unit: string | null
  gcmd: string | null
  gcmd_valid?: boolean
}

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
- Use short lowercase canonical names ("soil moisture", not "volumetric soil moisture content at 10cm (VWC_10)"). Include the unit when the metadata states one.
- For each variable pick the single best GCMD path COPIED VERBATIM from the taxonomy above. If nothing in the list is a reasonable fit, use null — do not force a match.
- Typically 1-10 variables per dataset. If the metadata is too thin to identify any, return an empty list.

Respond with ONLY a JSON object: {"variables": [{"name": "...", "unit": "..." | null, "gcmd": "TOPIC > TERM > ..." | null}]}`
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // Stratified sample: SDP rasters / ESS-DIVE with dd.csv variables / everything else
    const strata = [
      [`sdp_catalog_id IS NOT NULL`, 'sdp'],
      [`repository = 'ess_dive' AND array_length(variables, 1) > 0`, 'ess_dive+ddcsv'],
      [`sdp_catalog_id IS NULL AND repository <> 'ess_dive' AND description IS NOT NULL AND length(description) > 200`, 'other'],
    ] as const
    const sample: any[] = []
    for (const [where, label] of strata) {
      const { rows } = await db.query(`
        SELECT id, title, description, methods, keywords, variables, repository, sdp_catalog_id
        FROM datasets WHERE ${where}
        ORDER BY md5(id::text) LIMIT ${SAMPLE_PER_STRATUM}
      `)
      rows.forEach((r) => sample.push({ ...r, stratum: label }))
    }
    console.log(`Sampled ${sample.length} datasets (${SAMPLE_PER_STRATUM} per stratum), model ${MODEL}`)

    fs.mkdirSync(OUT_DIR, { recursive: true })
    const results: any[] = []
    let totalCost = 0

    for (const d of sample) {
      const res = await callClaude({
        apiKey,
        model: MODEL,
        maxTokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              // Taxonomy first + cache_control: identical prefix across all calls
              { type: 'text', text: TAXONOMY_BLOCK, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: buildTask(d) },
            ],
          },
        ],
      })
      totalCost += res.cost
      let variables: ExtractedVariable[] = []
      let parseError: string | null = null
      try {
        const m = res.text.match(/\{[\s\S]*\}/)
        variables = JSON.parse(m ? m[0] : res.text).variables ?? []
      } catch (e: any) {
        parseError = e.message
      }
      for (const v of variables) if (v.gcmd) v.gcmd_valid = gcmdSet.has(v.gcmd)
      results.push({
        id: d.id, stratum: d.stratum, repository: d.repository, title: d.title,
        existing_keywords: d.keywords, existing_variables: d.variables,
        llm_variables: variables, parseError,
      })
      const bad = variables.filter((v) => v.gcmd && !v.gcmd_valid).length
      console.log(`  [${d.stratum}] #${d.id} "${d.title.slice(0, 55)}" → ${variables.length} vars${bad ? ` (${bad} INVALID gcmd)` : ''}${parseError ? ' PARSE ERROR' : ''}`)
    }

    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ model: MODEL, cost: totalCost, results }, null, 1))

    // Markdown report for eyeballing
    const lines = [`# Variable extraction prototype — ${MODEL}`, '', `${sample.length} datasets, cost $${totalCost.toFixed(2)}`, '']
    for (const r of results) {
      lines.push(`## [${r.stratum}] ${r.title}`)
      if (r.existing_variables?.length) lines.push(`*dd.csv harvest:* ${r.existing_variables.join(', ')}`)
      if (r.existing_keywords?.length) lines.push(`*EML keywords:* ${r.existing_keywords.slice(0, 12).join(', ')}`)
      lines.push('')
      if (!r.llm_variables.length) lines.push('_(no variables extracted)_')
      for (const v of r.llm_variables) {
        const flag = v.gcmd && !v.gcmd_valid ? ' ⚠️ NOT IN TAXONOMY' : ''
        lines.push(`- **${v.name}**${v.unit ? ` (${v.unit})` : ''} → ${v.gcmd ?? '—'}${flag}`)
      }
      lines.push('')
    }
    fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n'))

    const all = results.flatMap((r) => r.llm_variables as ExtractedVariable[])
    const matched = all.filter((v) => v.gcmd_valid)
    const invalid = all.filter((v) => v.gcmd && !v.gcmd_valid)
    console.log(`\nTotal: ${all.length} variables, ${matched.length} valid GCMD matches, ${invalid.length} hallucinated paths, ${all.length - matched.length - invalid.length} unmatched`)
    console.log(`Cost: $${totalCost.toFixed(2)} — report at ${OUT_DIR}/report.md`)
  } finally {
    await db.end()
  }
}

main()
