/**
 * Load Document Authors from Extraction Results
 *
 * Reads scripts/output/document-authors.json and for each author:
 *   1. Tries to match against existing authors table by full name (case-insensitive)
 *      and by (family_name + given_name initial) for better matching
 *   2. If no match, creates a new author record
 *   3. Creates an entry in authors_rels linking the author to the document
 *
 * Idempotent: authors_rels has a unique constraint preventing duplicates.
 *
 * Usage:
 *   npx tsx scripts/load-document-authors.ts [--dry-run]
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const RESULTS_PATH = `${OUTPUT_DIR}/document-authors.json`

function normalize(s: string | null): string {
  return (s || '').toLowerCase().replace(/[.,'"]/g, '').replace(/\s+/g, ' ').trim()
}

interface AuthorCandidate {
  fullName: string
  givenName: string | null
  familyName: string | null
  affiliation: string | null
}

interface DocResult {
  docId: number
  title: string
  authors: AuthorCandidate[]
  error?: string
}

async function main() {
  console.log('Load Document Authors')
  console.log('=====================')
  if (dryRun) console.log('(DRY RUN)')

  const results: DocResult[] = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
  console.log(`${results.length} documents in results file`)
  const totalAuthorMentions = results.reduce((s, r) => s + r.authors.length, 0)
  console.log(`${totalAuthorMentions} total author mentions`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Load existing authors for matching
    const { rows: existingAuthors } = await db.query(`
      SELECT id, display_name, family_name, given_name, orcid, affiliation
      FROM authors
    `)
    console.log(`Loaded ${existingAuthors.length} existing authors`)

    // Build lookup maps
    const byFullName = new Map<string, any>()
    const byFamilyAndInitial = new Map<string, any[]>() // "smith|j" → [author, ...]
    for (const a of existingAuthors) {
      const full = normalize(a.display_name)
      if (full) byFullName.set(full, a)
      const fam = normalize(a.family_name)
      const initial = normalize(a.given_name?.[0] || '')
      if (fam && initial) {
        const key = `${fam}|${initial}`
        if (!byFamilyAndInitial.has(key)) byFamilyAndInitial.set(key, [])
        byFamilyAndInitial.get(key)!.push(a)
      }
    }

    let matched = 0, created = 0, linked = 0, skipped = 0
    const createdCache = new Map<string, number>() // normalized fullName → new author id

    for (const r of results) {
      if (!r.authors || r.authors.length === 0) continue
      for (const cand of r.authors) {
        if (!cand.familyName && !cand.fullName) { skipped++; continue }

        // Find or create author
        const fullNorm = normalize(cand.fullName)
        let authorId: number | null = null

        // 1. Exact full name match
        if (fullNorm && byFullName.has(fullNorm)) {
          authorId = byFullName.get(fullNorm).id
          matched++
        }

        // 2. Family + initial match (if unambiguous)
        if (!authorId && cand.familyName && cand.givenName) {
          const fam = normalize(cand.familyName)
          const initial = normalize(cand.givenName[0])
          const candidates = byFamilyAndInitial.get(`${fam}|${initial}`) || []
          if (candidates.length === 1) {
            authorId = candidates[0].id
            matched++
          }
        }

        // 3. Check created-cache
        if (!authorId && fullNorm && createdCache.has(fullNorm)) {
          authorId = createdCache.get(fullNorm)!
        }

        // 4. Create new
        if (!authorId) {
          if (!dryRun) {
            const displayName = cand.fullName || [cand.givenName, cand.familyName].filter(Boolean).join(' ')
            const { rows: [newAuthor] } = await db.query(
              `INSERT INTO authors (display_name, family_name, given_name, affiliation, work_count, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 0, NOW(), NOW())
               RETURNING id`,
              [displayName, cand.familyName, cand.givenName, cand.affiliation],
            )
            authorId = newAuthor.id
            if (fullNorm) createdCache.set(fullNorm, authorId!)
            // Add to lookup so further mentions dedupe
            byFullName.set(fullNorm, { id: authorId })
          }
          created++
        }

        // Link to document
        if (!dryRun && authorId) {
          try {
            // authors_rels has implicit uniqueness via path + ids
            const { rowCount } = await db.query(
              `INSERT INTO authors_rels (parent_id, path, documents_id, "order")
               SELECT $1, 'documents', $2, 1
               WHERE NOT EXISTS (
                 SELECT 1 FROM authors_rels
                 WHERE parent_id = $1 AND documents_id = $2 AND path = 'documents'
               )`,
              [authorId, r.docId],
            )
            if ((rowCount || 0) > 0) linked++
          } catch (err: any) {
            // continue on error
          }
        } else if (dryRun) {
          linked++
        }
      }
    }

    console.log('\n========== Summary ==========')
    console.log(`Matched existing authors: ${matched}`)
    console.log(`Created new authors:      ${created}`)
    console.log(`Author-document links:    ${linked}`)
    console.log(`Skipped:                  ${skipped}`)

    if (!dryRun) {
      const { rows: [{ count: docAuthors }] } = await db.query(
        `SELECT count(*)::int as count FROM authors_rels WHERE documents_id IS NOT NULL`,
      )
      console.log(`\nTotal author-document links in DB: ${docAuthors}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
