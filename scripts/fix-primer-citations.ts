/**
 * Fix year-only and arrow-only citations in existing primers.
 *
 * Finds patterns like [2010](/publications/N) or [→](/publications/N)
 * and replaces them with [Author et al., Year](/publications/N) by
 * looking up the publication's first author and year.
 *
 * Usage:
 *   npx tsx scripts/fix-primer-citations.ts [--dry-run]
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log('Fix Primer Citations')
  console.log('====================')
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    const { rows: primers } = await db.query('SELECT id, title, primer FROM neighborhoods WHERE primer IS NOT NULL')
    console.log(`${primers.length} primers to check`)

    // Build citation labels for all publications
    const { rows: pubAuthors } = await db.query(`
      SELECT p.id as pub_id, p.year, a.family_name, ar."order"
      FROM publications p
      LEFT JOIN authors_rels ar ON ar.publications_id = p.id AND ar.path = 'publications'
      LEFT JOIN authors a ON a.id = ar.parent_id
      ORDER BY p.id, ar."order" NULLS LAST
    `)
    const citationLabels = new Map<number, { label: string; year: string | number }>()
    const pubAuthorGroups = new Map<number, { family: string; order: number }[]>()
    const pubYears = new Map<number, string | number>()
    for (const r of pubAuthors) {
      if (!pubAuthorGroups.has(r.pub_id)) pubAuthorGroups.set(r.pub_id, [])
      if (r.family_name) pubAuthorGroups.get(r.pub_id)!.push({ family: r.family_name, order: r.order || 999 })
      if (r.year) pubYears.set(r.pub_id, r.year)
    }
    for (const [pubId, authors] of pubAuthorGroups) {
      authors.sort((a, b) => a.order - b.order)
      let label = 'Unknown'
      if (authors.length === 1) label = authors[0].family
      else if (authors.length === 2) label = `${authors[0].family} & ${authors[1].family}`
      else if (authors.length > 2) label = `${authors[0].family} et al.`
      citationLabels.set(pubId, { label, year: pubYears.get(pubId) || '?' })
    }
    console.log(`Built citation labels for ${citationLabels.size} publications`)

    let fixed = 0, totalReplacements = 0

    for (const p of primers) {
      let updated = p.primer as string
      let replacements = 0

      // Fix year-only citations: [2010](/publications/N) → [Author et al., 2010](/publications/N)
      updated = updated.replace(
        /\[(\d{4})\]\(\/publications\/(\d+)\)/g,
        (match, year, id) => {
          const pubId = parseInt(id)
          const info = citationLabels.get(pubId)
          if (info) {
            replacements++
            return `[${info.label}, ${year}](/publications/${id})`
          }
          return match
        },
      )

      // Fix arrow-only citations: [→](/publications/N) → [Author et al., Year](/publications/N)
      updated = updated.replace(
        /\[→\]\(\/publications\/(\d+)\)/g,
        (match, id) => {
          const pubId = parseInt(id)
          const info = citationLabels.get(pubId)
          if (info) {
            replacements++
            return `[${info.label}, ${info.year}](/publications/${id})`
          }
          return match
        },
      )

      // Fix inline citations that are text followed by arrow link:
      // "Author, Year [→](/publications/N)" → "[Author, Year](/publications/N)"
      updated = updated.replace(
        /([A-Z][a-z]+(?:\s+(?:&\s+[A-Z][a-z]+|et al\.))?,\s*\d{4})\s*\[→\]\(\/publications\/(\d+)\)/g,
        (match, citation, id) => {
          replacements++
          return `[${citation}](/publications/${id})`
        },
      )

      if (replacements > 0) {
        if (!dryRun) {
          await db.query('UPDATE neighborhoods SET primer = $1 WHERE id = $2', [updated, p.id])
        }
        console.log(`  ${p.id}. "${p.title}" — ${replacements} citations fixed`)
        fixed++
        totalReplacements += replacements
      }
    }

    console.log(`\nFixed ${totalReplacements} citations across ${fixed} primers`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
