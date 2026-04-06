/**
 * Auto-Discover and Assign Items to Projects
 *
 * Uses three signals to find items related to each project:
 *   1. Embedding similarity — project description vs item abstracts
 *   2. Author matching — PI's publications/datasets
 *   3. Text mentions — project name, PI name, keywords in titles/abstracts
 *
 * Usage:
 *   npx tsx scripts/assign-projects.ts [--dry-run] [--limit=N] [--project=NAME]
 */

import pg from 'pg'
import { sleep } from './lib/concurrency.js'
import { VOYAGE_API_KEY, VOYAGE_MODEL, EMBEDDING_DIMENSIONS } from './lib/config.js'
import { ensureAuth, getAllPaginated, patchRecord, checkServer } from './lib/payload-client.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const projectFilter = args.find((a) => a.startsWith('--project='))?.split('=')[1]

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
       WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1::vector) > $2
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

async function findByAuthor(
  db: pg.Pool,
  piFamilyName: string,
): Promise<Candidate[]> {
  if (!piFamilyName || piFamilyName.length < 2) return []

  const candidates: Candidate[] = []

  // Find publications where PI is an author
  const { rows: pubs } = await db.query(
    `SELECT DISTINCT p.id FROM publications p
     JOIN publications_authors pa ON pa.\"_parent_id\" = p.id
     WHERE pa.family ILIKE $1
     LIMIT 200`,
    [piFamilyName],
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
           WHERE search_vector @@ to_tsquery('english', $1)
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
  projects = projects.slice(0, limit)
  console.log(`\nProcessing ${projects.length} projects`)

  let totalPubs = 0
  let totalDs = 0
  let totalDocs = 0

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
        projectEmbedding = embRow.embedding as any
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
    const piFamilyName = project.pi?.split(/\s+/).pop() || ''
    if (piFamilyName.length >= 2) {
      const authorCandidates = await findByAuthor(db, piFamilyName)
      allCandidates.push(...authorCandidates)
    }

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

    totalPubs += pubIds.length
    totalDs += dsIds.length
    totalDocs += docIds.length

    // Update project
    if (!dryRun && (pubIds.length > 0 || dsIds.length > 0 || docIds.length > 0)) {
      await patchRecord('projects', String(project.id), {
        publications: pubIds.length > 0 ? pubIds : undefined,
        datasets: dsIds.length > 0 ? dsIds : undefined,
        documents: docIds.length > 0 ? docIds : undefined,
      })
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

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
