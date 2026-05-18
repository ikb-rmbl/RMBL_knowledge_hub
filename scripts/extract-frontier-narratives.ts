/**
 * Per-frontier LLM extraction of atomic statements from narrative prose
 * fields (barriers, impacts) into frontier_planning_items.
 *
 * Unlike pushing_the_frontier / data_gaps / key_questions (already
 * structured JSONB), barriers and impacts are free narrative prose. This
 * script asks Claude to atomize each frontier's prose into 3-7 statements
 * suitable for downstream clustering.
 *
 * Field → item_type mapping:
 *   --field=barriers  → item_type='barrier'
 *   --field=impacts   → item_type='impact'
 *
 * Resume-able: by default skips frontiers that already have items of the
 * target type. Use --force to delete + re-extract.
 *
 * Usage:
 *   npx tsx scripts/extract-frontier-narratives.ts --field=barriers
 *   npx tsx scripts/extract-frontier-narratives.ts --field=impacts
 *   npx tsx scripts/extract-frontier-narratives.ts --field=barriers --force --limit=3
 */

import pg from 'pg'
import { callClaudeJson } from './lib/claude-api.js'
import './lib/config.js'

const args = process.argv.slice(2)
const fieldArg = args.find((a) => a.startsWith('--field='))?.split('=')[1] || ''
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10)
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-sonnet-4-6'

const FIELD_MAP: Record<string, { dbField: string; itemType: string; label: string }> = {
  barriers: { dbField: 'barriers', itemType: 'barrier', label: 'barrier' },
  impacts:  { dbField: 'impacts',  itemType: 'impact',  label: 'impact'  },
}

if (!FIELD_MAP[fieldArg]) {
  console.error(`--field is required and must be one of: ${Object.keys(FIELD_MAP).join(', ')}`)
  process.exit(1)
}
const cfg = FIELD_MAP[fieldArg]

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const BARRIERS_PROMPT = `You are atomizing the "barriers" narrative from a single research frontier for the Rocky Mountain Biological Laboratory's planning corpus.

A frontier "barrier" is a concrete obstacle currently blocking progress on the frontier — typically a data gap, methodological limitation, coordination failure, regulatory misalignment, funding constraint, lack of expertise, or institutional friction. Downstream we will cluster barrier statements across many frontiers to surface systemic blockers.

For the given barriers narrative, extract 3-7 atomic barrier statements that meet ALL of these criteria:
- ATOMIC: one barrier per statement.
- CONCRETE: a specific obstacle, not a vague "more work needed" complaint.
- SELF-CONTAINED: a reader who hasn't seen the source frontier can grasp what is blocked and why.
- GROUNDED: the narrative actually supports the statement; do not invent.
- 12-30 words per statement; written as a noun-phrase or short descriptive sentence describing the obstacle (not an action).

Skip statements that are merely re-statements of the frontier's overall topic. Skip statements that are aspirations or future work — those are not barriers.

Return JSON: { "barriers": ["barrier statement 1", "barrier statement 2", ...] }`

const IMPACTS_PROMPT = `You are atomizing the "impacts" narrative from a single research frontier for the Rocky Mountain Biological Laboratory's planning corpus.

A frontier "impact" is a concrete management decision, stakeholder, regulatory process, or applied use case that depends on or would be influenced by the frontier's resolution. Examples: "Bureau of Reclamation Aspinall Unit operations and the 24-Month Study," "BLM Resource Management Plan revisions in the Gunnison Field Office," "FERC relicensing on the Taylor and Gunnison Rivers," "Upper Colorado River Endangered Fish Recovery Program flow decisions." Downstream we will cluster impact statements across many frontiers to surface the management decisions most-frequently waiting on research.

For the given impacts narrative, extract 3-7 atomic impact statements that meet ALL of these criteria:
- ATOMIC: one impact per statement (one decision, one stakeholder, one process).
- CONCRETE: name a specific agency, program, decision, or regulatory artifact when present in the narrative.
- SELF-CONTAINED: a reader who hasn't seen the source frontier can grasp what management decision or use would be served.
- GROUNDED: the narrative actually supports the statement; do not invent decisions or stakeholders.
- 8-25 words per statement; written as a noun-phrase describing the management decision, stakeholder, or applied use case.

Skip generic claims of "scientific advancement" without a named user or decision. Skip purely scientific impacts on adjacent research fields — focus on management, regulatory, and applied use.

Return JSON: { "impacts": ["impact statement 1", "impact statement 2", ...] }`

function buildPrompt(field: string, narrative: string): { prompt: string; content: string } {
  const prompt = field === 'barriers' ? BARRIERS_PROMPT : IMPACTS_PROMPT
  const content = `Frontier ${cfg.label}s narrative:\n\n${narrative}`
  return { prompt, content }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Extract atomic ${cfg.label}s from frontier narratives`)
  console.log('='.repeat(60))
  console.log(`  field=${fieldArg}  itemType=${cfg.itemType}  model=${model}${limit ? `  limit=${limit}` : ''}${force ? '  (--force)' : ''}${dryRun ? '  (DRY RUN)' : ''}`)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing from .env')
    process.exit(1)
  }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Pick frontiers to extract. Skip those already extracted unless --force.
  const whereParts = [`f.${cfg.dbField} IS NOT NULL`, `coalesce(length(f.${cfg.dbField}), 0) > 50`]
  if (!force) {
    whereParts.push(`NOT EXISTS (SELECT 1 FROM frontier_planning_items i WHERE i.frontier_id = f.id AND i.item_type = '${cfg.itemType}')`)
  }
  const limitSql = limit > 0 ? `LIMIT ${limit}` : ''

  const { rows: frontiers } = await db.query(
    `SELECT f.id, f.title, f.${cfg.dbField} AS narrative
     FROM frontiers f
     WHERE ${whereParts.join(' AND ')}
     ORDER BY f.id ${limitSql}`,
  )

  console.log(`\n  ${frontiers.length} frontiers to extract${force ? ' (--force)' : ''}`)
  if (frontiers.length === 0) { await db.end(); return }

  if (force && !dryRun) {
    console.log(`  Clearing existing ${cfg.itemType} items + cluster assignments...`)
    // Delete only this type's clusters + items; embeddings on other types stay intact.
    await db.query(`DELETE FROM frontier_planning_clusters WHERE item_type = $1`, [cfg.itemType])
    await db.query(`DELETE FROM frontier_planning_items WHERE item_type = $1`, [cfg.itemType])
  }

  let totalCost = 0
  let totalExtracted = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < frontiers.length; i++) {
    const f = frontiers[i]
    process.stdout.write(`\n[${i + 1}/${frontiers.length}] frontier ${f.id} ("${f.title.slice(0, 50)}...")  `)

    const { prompt, content } = buildPrompt(fieldArg, f.narrative)

    if (dryRun) {
      console.log('(dry run)')
      if (i === 0) {
        console.log('\n=== sample prompt (first frontier) ===')
        console.log(prompt)
        console.log('\n=== sample content ===')
        console.log(content.slice(0, 1000))
      }
      continue
    }

    try {
      const { data, response } = await callClaudeJson<Record<string, string[]>>({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model,
        prompt,
        content,
        maxTokens: 1500,
      })
      totalCost += response.cost

      const statements: string[] | undefined = data?.[fieldArg]
      if (!Array.isArray(statements) || statements.length === 0) {
        console.log(`FAILED (no parseable ${fieldArg} array)`)
        failed++
        continue
      }
      const cleaned = statements
        .filter((s) => typeof s === 'string' && s.trim().length > 5)
        .map((s) => s.trim())

      // Insert into frontier_planning_items
      for (const stmt of cleaned) {
        await db.query(
          `INSERT INTO frontier_planning_items (frontier_id, item_type, text) VALUES ($1, $2, $3)`,
          [f.id, cfg.itemType, stmt],
        )
      }
      succeeded++
      totalExtracted += cleaned.length
      process.stdout.write(`OK ($${response.cost.toFixed(4)}, ${cleaned.length} ${cfg.label}s)`)
    } catch (err: any) {
      console.log(`FAILED: ${err.message?.slice(0, 100)}`)
      failed++
    }
  }

  console.log(`\n\nDone: ${succeeded} frontiers extracted, ${failed} failed, ${totalExtracted} ${cfg.label}s total, cost $${totalCost.toFixed(2)}`)
  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
