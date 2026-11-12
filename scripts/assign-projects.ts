/**
 * Auto-Discover and Assign Items to Projects
 *
 * Uses three signals to find items related to each project:
 *   1. Embedding similarity — project description vs item abstracts
 *   2. Author matching — PI's publications/datasets
 *   3. Text mentions — project name, PI name, keywords in titles/abstracts
 *
 * Usage:
 *   npx tsx scripts/assign-projects.ts [--dry-run] [--limit=N] [--project=NAME] [--plan-prefix=LEGACY-]
 *
 * --plan-prefix restricts the run to research plans whose plan_id starts with it.
 * --dry-run writes a per-project review CSV to scripts/output/assign-projects-dry-run.csv,
 * including how many matched papers fall outside the plan's own years (author
 * matching is year-blind, so a PI's 1999 plan picks up their 2024 papers).
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import { sleep } from './lib/concurrency.js'
import { VOYAGE_API_KEY, VOYAGE_MODEL, EMBEDDING_DIMENSIONS } from './lib/config.js'
import { ensureAuth, getAllPaginated, patchRecord, checkServer } from './lib/payload-client.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const projectFilter = args.find((a) => a.startsWith('--project='))?.split('=')[1]
const planPrefix = args.find((a) => a.startsWith('--plan-prefix='))?.split('=')[1]
const REPORT_PATH = join(import.meta.dirname, 'output', 'assign-projects-dry-run.csv')

const SIMILARITY_THRESHOLD = 0.55
const AUTHOR_MATCH_SCORE = 0.8
const TEXT_MATCH_SCORE = 0.5
const MIN_COMPOSITE_SCORE = 0.3

// ---------------------------------------------------------------------------
// Embed project description via Voyage AI
// ---------------------------------------------------------------------------

async function embedText(text: string): Promise<number[] | null> {
  if (!VOYAGE_API_KEY) return null
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: [text],
        model: VOYAGE_MODEL,
        input_type: 'document',
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Discovery signals
// ---------------------------------------------------------------------------

interface Candidate {
  collection: 'publications' | 'datasets' | 'documents'
  id: number
  score: number
  signals: string[]
}

async function findByEmbedding(
  db: pg.Pool,
  projectEmbedding: number[],
  threshold: number,
): Promise<Candidate[]> {
  const embStr = `[${projectEmbedding.join(',')}]`
  const candidates: Candidate[] = []

  for (const table of ['publications', 'datasets', 'documents'] as const) {
    const { rows } = await db.query(
      `SELECT id, 1 - (embedding <=> $1::vector) as sim
       FROM ${table}
       WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1::vector) > $2 ${table === 'publications' ? RMBL_ONLY : ''}
       ORDER BY embedding <=> $1::vector
       LIMIT 50`,
      [embStr, threshold],
    )
    for (const row of rows) {
      candidates.push({
        collection: table,
        id: row.id,
        score: parseFloat(row.sim) * 0.4, // 40% weight
        signals: [`embedding:${parseFloat(row.sim).toFixed(2)}`],
      })
    }
  }

  return candidates
}

// Project pages list RMBL research; discovered papers that are unreviewed or
// reviewed "no" (and PI-surname collisions among them) must not attach (2026-09-28).
const RMBL_ONLY = "AND rmbl_research = 'yes'"

/** "Dan Blumstein, Kenneth Armitage" → [{D, Blumstein}, {K, Armitage}]. */
export function parsePis(pi: string | null | undefined): { initial: string; family: string }[] {
  return (pi || '')
    .split(/,|;|\s+and\s+|\s*&\s*/i)
    .map((n) => n.trim().split(/\s+/).filter(Boolean))
    .filter((w) => w.length >= 2 && w[w.length - 1].length >= 2)
    .map((w) => ({ initial: w[0][0].toUpperCase(), family: w[w.length - 1] }))
}

async function findByAuthor(
  db: pg.Pool,
  pi: { initial: string; family: string },
): Promise<Candidate[]> {
  const candidates: Candidate[] = []

  // Surname AND first initial: surname alone gave "Rick Williams" every paper by
  // Ken Williams (Watershed SFA).
  const { rows: pubs } = await db.query(
    `SELECT DISTINCT p.id FROM publications p
     JOIN publications_authors pa ON pa.\"_parent_id\" = p.id
     WHERE pa.family ILIKE $1 AND upper(left(pa.given, 1)) = $2 ${RMBL_ONLY.replace('rmbl_research', 'p.rmbl_research')}
     LIMIT 200`,
    [pi.family, pi.initial],
  )
  for (const row of pubs) {
    candidates.push({
      collection: 'publications',
      id: row.id,
      score: AUTHOR_MATCH_SCORE * 0.4,
      signals: ['author_match'],
    })
  }

  return candidates
}

async function findByTextMention(
  db: pg.Pool,
  searchTerms: string[],
): Promise<Candidate[]> {
  const candidates: Candidate[] = []
  const seen = new Set<string>()

  for (const term of searchTerms) {
    if (!term || term.length < 3) continue
    const tsQuery = term.split(/\s+/).filter(Boolean).join(' & ')
    if (!tsQuery) continue

    for (const table of ['publications', 'datasets', 'documents'] as const) {
      try {
        const { rows } = await db.query(
          `SELECT id FROM ${table}
           WHERE search_vector @@ to_tsquery('english', $1) ${table === 'publications' ? RMBL_ONLY : ''}
           LIMIT 30`,
          [tsQuery],
        )
        for (const row of rows) {
          const key = `${table}:${row.id}`
          if (seen.has(key)) continue
          seen.add(key)
          candidates.push({
            collection: table,
            id: row.id,
            score: TEXT_MATCH_SCORE * 0.2,
            signals: [`text:"${term}"`],
          })
        }
      } catch {
        // tsquery parse errors are fine — skip
      }
    }
  }

  return candidates
}

// ---------------------------------------------------------------------------
// Merge and score candidates
// ---------------------------------------------------------------------------

function mergeCandidates(allCandidates: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>()

  for (const c of allCandidates) {
    const key = `${c.collection}:${c.id}`
    const existing = merged.get(key)
    if (existing) {
      existing.score += c.score
      existing.signals.push(...c.signals)
    } else {
      merged.set(key, { ...c })
    }
  }

  return [...merged.values()]
    .filter((c) => c.score >= MIN_COMPOSITE_SCORE)
    .sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Auto-Discover and Assign Items to Projects')
  console.log('==========================================')
  if (dryRun) console.log('(DRY RUN)')

  const serverUp = await checkServer()
  if (!serverUp) {
    console.error('Payload server not running.')
    process.exit(1)
  }
  await ensureAuth()

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
  })

  // Load all projects
  let projects = await getAllPaginated('projects')
  if (projectFilter) {
    projects = projects.filter((p: any) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
  }
  if (planPrefix) {
    projects = projects.filter((p: any) => typeof p.planId === 'string' && p.planId.startsWith(planPrefix))
  }
  projects = projects.slice(0, limit)
  console.log(`\nProcessing ${projects.length} projects`)

  let totalPubs = 0
  let totalDs = 0
  let totalDocs = 0
  const report: Record<string, string | number>[] = []

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    if (!project.autoDiscoveryEnabled && !projectFilter) continue

    const allCandidates: Candidate[] = []

    // Signal 1: Embedding similarity
    let projectEmbedding: number[] | null = null
    const descText = `${project.name}. ${project.description || ''}`
    if (descText.length > 20 && VOYAGE_API_KEY) {
      // Check if project already has embedding
      const { rows: [embRow] } = await db.query('SELECT embedding FROM projects WHERE id = $1', [project.id])
      if (embRow?.embedding) {
        // pgvector returns the stored vector as its text form "[0.1,...]"
        const e = embRow.embedding
        projectEmbedding = Array.isArray(e)
          ? e
          : String(e).replace(/^\[|\]$/g, '').split(',').map(Number)
      } else {
        projectEmbedding = await embedText(descText)
        if (projectEmbedding && !dryRun) {
          const embStr = `[${projectEmbedding.join(',')}]`
          await db.query('UPDATE projects SET embedding = $1::vector WHERE id = $2', [embStr, project.id])
        }
        await sleep(200)
      }
      if (projectEmbedding) {
        const embCandidates = await findByEmbedding(db, projectEmbedding, SIMILARITY_THRESHOLD)
        allCandidates.push(...embCandidates)
      }
    }

    // Signal 2: Author matching
    // Every listed PI, not just the last word of the field
    // (one author signal per paper — scores are summed, and two PIs co-authoring must not double it)
    const byAuthor = new Map<number, Candidate>()
    for (const pi of parsePis(project.pi)) {
      for (const c of await findByAuthor(db, pi)) byAuthor.set(c.id, c)
    }
    allCandidates.push(...byAuthor.values())

    // Signal 3: Text mentions
    const searchTerms = [
      project.name,
      project.pi,
      ...(project.discoveryKeywords?.split('\n').filter(Boolean) || []),
    ].filter(Boolean)
    const textCandidates = await findByTextMention(db, searchTerms)
    allCandidates.push(...textCandidates)

    // Merge and filter
    const merged = mergeCandidates(allCandidates)
    const pubIds = merged.filter((c) => c.collection === 'publications').map((c) => c.id)
    const dsIds = merged.filter((c) => c.collection === 'datasets').map((c) => c.id)
    const docIds = merged.filter((c) => c.collection === 'documents').map((c) => c.id)

    if (dryRun) report.push(await reportRow(db, project, merged, pubIds, dsIds.length, docIds.length))

    totalPubs += pubIds.length
    totalDs += dsIds.length
    totalDocs += docIds.length

    // Update project — but never clobber item lists an admin hand-curated
    // (curated_fields is set by the curation hook when a project's
    // publications/datasets/documents are edited in the admin UI).
    const curated = new Set<string>(Array.isArray(project.curatedFields) ? project.curatedFields : [])
    if (!dryRun && (pubIds.length > 0 || dsIds.length > 0 || docIds.length > 0)) {
      const patch: Record<string, number[] | undefined> = {
        publications: !curated.has('publications') && pubIds.length > 0 ? pubIds : undefined,
        datasets: !curated.has('datasets') && dsIds.length > 0 ? dsIds : undefined,
        documents: !curated.has('documents') && docIds.length > 0 ? docIds : undefined,
      }
      if (Object.values(patch).some((v) => v !== undefined)) {
        await patchRecord('projects', String(project.id), patch, { pipeline: true })
      }
      const skippedFields = ['publications', 'datasets', 'documents'].filter((f) => curated.has(f))
      if (skippedFields.length > 0) {
        console.log(`\n  ~ ${project.name}: admin-curated ${skippedFields.join('+')} left untouched`)
      }
    }

    if ((i + 1) % 10 === 0 || i + 1 === projects.length) {
      process.stdout.write(`\r  ${i + 1}/${projects.length} projects processed`)
    }
  }

  console.log(`\r  ${projects.length} projects processed`)
  console.log(`\n========== Summary ==========`)
  console.log(`Total item assignments:`)
  console.log(`  Publications: ${totalPubs}`)
  console.log(`  Datasets:     ${totalDs}`)
  console.log(`  Documents:    ${totalDocs}`)

  if (dryRun && report.length > 0) {
    writeReport(report)
    summarizeReport(report)
  }

  // Show top projects by item count
  const { rows: topProjects } = await db.query(`
    SELECT p.name, p.pi, p.project_type,
      (SELECT count(*) FROM projects_rels r WHERE r.parent_id = p.id AND r.path = 'publications') as pubs,
      (SELECT count(*) FROM projects_rels r WHERE r.parent_id = p.id AND r.path = 'datasets') as ds,
      (SELECT count(*) FROM projects_rels r WHERE r.parent_id = p.id AND r.path = 'documents') as docs
    FROM projects p
    ORDER BY (SELECT count(*) FROM projects_rels r WHERE r.parent_id = p.id) DESC
    LIMIT 10
  `)

  if (topProjects.length > 0) {
    console.log('\nTop projects by items:')
    for (const p of topProjects) {
      const total = parseInt(p.pubs) + parseInt(p.ds) + parseInt(p.docs)
      if (total > 0) console.log(`  ${p.name} (${p.pi || '?'}): ${p.pubs}p/${p.ds}d/${p.docs}doc`)
    }
  }

  await db.end()
}

// ---------------------------------------------------------------------------
// Dry-run review report
// ---------------------------------------------------------------------------

async function reportRow(
  db: pg.Pool,
  project: any,
  merged: Candidate[],
  pubIds: number[],
  dsCount: number,
  docCount: number,
): Promise<Record<string, string | number>> {
  const pubs = merged.filter((c) => c.collection === 'publications')
  const has = (c: Candidate, prefix: string) => c.signals.some((s) => s.startsWith(prefix))
  const start: number | null = project.startYear ?? null
  const end: number | null = project.endYear ?? start

  const { rows } = pubIds.length
    ? await db.query<{ id: number; year: number | null; title: string }>(
        'SELECT id, year::int AS year, title FROM publications WHERE id = ANY($1::int[])',
        [pubIds],
      )
    : { rows: [] }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const years = rows.map((r) => r.year).filter((y): y is number => y != null)
  // A paper can reasonably appear up to ~5 years after a plan's field seasons end.
  const outside = start == null ? 0 : years.filter((y) => y < start || y > (end ?? start) + 5).length

  return {
    id: project.id,
    plan_id: project.planId ?? '',
    start_year: start ?? '',
    end_year: end ?? '',
    pi: project.pi ?? '',
    name: project.name,
    pubs: pubIds.length,
    pubs_author_only: pubs.filter((c) => c.signals.length === 1 && has(c, 'author_match')).length,
    pubs_with_embedding: pubs.filter((c) => has(c, 'embedding')).length,
    pubs_with_text: pubs.filter((c) => has(c, 'text')).length,
    pubs_outside_plan_years: outside,
    pub_year_range: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : '',
    datasets: dsCount,
    documents: docCount,
    top_pubs: pubs
      .slice(0, 3)
      .map((c) => {
        const r = byId.get(c.id)
        return `${r?.year ?? '?'} ${(r?.title ?? '').slice(0, 70)} [${c.score.toFixed(2)}: ${c.signals.join(' ')}]`
      })
      .join(' | '),
  }
}

function writeReport(rows: Record<string, string | number>[]) {
  const cols = Object.keys(rows[0])
  const cell = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  mkdirSync(join(import.meta.dirname, 'output'), { recursive: true })
  writeFileSync(REPORT_PATH, [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n')
  console.log(`\nWrote per-project review to ${REPORT_PATH}`)
}

function summarizeReport(rows: Record<string, string | number>[]) {
  const n = (r: Record<string, string | number>, k: string) => Number(r[k])
  const pubs = rows.reduce((a, r) => a + n(r, 'pubs'), 0)
  const authorOnly = rows.reduce((a, r) => a + n(r, 'pubs_author_only'), 0)
  const outside = rows.reduce((a, r) => a + n(r, 'pubs_outside_plan_years'), 0)
  const counts = rows.map((r) => n(r, 'pubs')).sort((a, b) => a - b)
  const pct = (q: number) => counts[Math.min(counts.length - 1, Math.floor(q * counts.length))]
  console.log(`\nDry-run review (${rows.length} projects):`)
  console.log(`  projects with 0 pubs: ${counts.filter((c) => c === 0).length}`)
  console.log(`  pubs per project: median ${pct(0.5)}, p90 ${pct(0.9)}, max ${counts[counts.length - 1]}`)
  console.log(`  pub assignments: ${pubs} — ${authorOnly} on the author signal alone, ` +
    `${outside} published outside the plan's years (start .. end+5)`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
