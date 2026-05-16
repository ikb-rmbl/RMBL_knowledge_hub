/**
 * One-off backfill: re-run the citation linkifier over primers in the DB
 * whose text contains raw `pub_id:N` or `doc_id:N` tags (LLM dropped the
 * curly braces and/or author-year text). No LLM calls — purely text
 * post-processing using the same logic as generate-primers.ts.
 *
 * Usage:
 *   npx tsx scripts/relink-primers.ts          # backfill all broken primers
 *   npx tsx scripts/relink-primers.ts --dry-run # show what would change
 *   npx tsx scripts/relink-primers.ts --id=N   # target a single neighborhood id
 */

import pg from 'pg'
import './lib/config.js'

const dryRun = process.argv.includes('--dry-run')
const idArg = process.argv.find((a) => a.startsWith('--id='))?.split('=')[1]
const onlyId = idArg ? parseInt(idArg) : null

interface CitationInfo { label: string; year: string | number }

async function buildCitationLabels(db: pg.Pool, pubIds: number[]): Promise<Map<number, CitationInfo>> {
  const labels = new Map<number, CitationInfo>()
  if (pubIds.length === 0) return labels

  const { rows: authorsPerPub } = await db.query(
    `SELECT ar.publications_id as pub_id, a.family_name, ar."order"
     FROM authors_rels ar
     JOIN authors a ON a.id = ar.parent_id
     WHERE ar.publications_id = ANY($1) AND ar.path = 'publications' AND ar."order" IS NOT NULL
     ORDER BY ar.publications_id, ar."order"`,
    [pubIds],
  )
  const authorsByPub = new Map<number, { family: string; order: number }[]>()
  for (const a of authorsPerPub) {
    if (!authorsByPub.has(a.pub_id)) authorsByPub.set(a.pub_id, [])
    authorsByPub.get(a.pub_id)!.push({ family: a.family_name, order: a.order || 999 })
  }
  for (const [pubId, authors] of authorsByPub) {
    authors.sort((x, y) => x.order - y.order)
  }

  const { rows: pubMeta } = await db.query(
    `SELECT id, year FROM publications WHERE id = ANY($1)`,
    [pubIds],
  )
  for (const p of pubMeta) {
    const authors = authorsByPub.get(p.id) || []
    let label = ''
    if (authors.length === 0) label = 'Anon.'
    else if (authors.length === 1) label = authors[0].family
    else if (authors.length === 2) label = `${authors[0].family} & ${authors[1].family}`
    else label = `${authors[0].family} et al.`
    labels.set(p.id, { label, year: p.year || 'n.d.' })
  }
  return labels
}

async function buildDocLabels(db: pg.Pool, docIds: number[]): Promise<Map<number, string>> {
  const labels = new Map<number, string>()
  if (docIds.length === 0) return labels
  const { rows } = await db.query(`SELECT id, title FROM documents WHERE id = ANY($1)`, [docIds])
  for (const d of rows) labels.set(d.id, d.title?.slice(0, 60) || `document ${d.id}`)
  return labels
}

// Same logic as scripts/generate-primers.ts linkCitations — keep in sync.
function linkCitations(text: string, citationLabels: Map<number, CitationInfo>, docLabels: Map<number, string>): string {
  let linked = text

  // Bare (pub_id:N) or (pub_id:N, pub_id:M) — LLM dropped the author-year text.
  linked = linked.replace(
    /\(\{?pub_id:\d+(?:\}?[,;]\s*\{?pub_id:\d+)*\}?\)/g,
    (match) => {
      const ids = [...match.matchAll(/pub_id:(\d+)/g)].map((m) => parseInt(m[1]))
      const links = ids.map((id) => {
        const info = citationLabels.get(id)
        return info ? `[${info.label}, ${info.year}](/publications/${id})` : `[→](/publications/${id})`
      })
      return links.join('; ')
    },
  )
  linked = linked.replace(
    /\(\{?doc_id:\d+(?:\}?[,;]\s*\{?doc_id:\d+)*\}?\)/g,
    (match) => {
      const ids = [...match.matchAll(/doc_id:(\d+)/g)].map((m) => parseInt(m[1]))
      const links = ids.map((id) => {
        const title = docLabels.get(id)
        return title ? `[${title}](/documents/${id})` : `[→](/documents/${id})`
      })
      return links.join('; ')
    },
  )

  // Normalize remaining unbraced pub_id:N → {pub_id:N} for the existing rules below.
  linked = linked.replace(/(?<![\w{])pub_id:(\d+)(?![\w}])/g, '{pub_id:$1}')
  linked = linked.replace(/(?<![\w{])doc_id:(\d+)(?![\w}])/g, '{doc_id:$1}')

  // (citation text){pub_id:N; pub_id:M} — multi-pub case, link to first id.
  linked = linked.replace(
    /\(([^)]+)\)\s*\{pub_id:\d+(?:[;,]\s*pub_id:\d+)+\}/g,
    (match, citationText) => {
      const ids = [...match.matchAll(/pub_id:(\d+)/g)].map((m) => m[1])
      return `[${citationText}](/publications/${ids[0]})`
    },
  )
  // Existing rules from generate-primers.ts.
  linked = linked.replace(/\(([^)]+)\)\s*\{pub_id:(\d+)\}/g, '[$1](/publications/$2)')
  linked = linked.replace(
    /([A-Z][a-z]+(?:\s+(?:&\s+[A-Z][a-z]+|et al\.))?,\s*\d{4})\s*\{pub_id:(\d+)\}/g,
    '[$1](/publications/$2)',
  )
  linked = linked.replace(
    /"([^"]+)"\.\s*\*([^*]+)\*\.?\s*\{pub_id:(\d+)\}/g,
    '["$1."](/publications/$3) *$2*.',
  )
  linked = linked.replace(/([^\n]*?)\s*\{pub_id:(\d+)\}/g, (_m, prefix, id) => {
    const pubId = parseInt(id)
    const info = citationLabels.get(pubId)
    if (info) return `${prefix.trim()} [${info.label}, ${info.year}](/publications/${id})`
    return `${prefix.trim()} [→](/publications/${id})`
  })
  linked = linked.replace(/\(([^)]+)\)\s*\{doc_id:(\d+)\}/g, '[$1](/documents/$2)')
  linked = linked.replace(/([^\n]*?)\s*\{doc_id:(\d+)\}/g, (_m, prefix, id) => {
    const docId = parseInt(id)
    const title = docLabels.get(docId)
    if (title) return `${prefix.trim()} [${title}](/documents/${id})`
    return `${prefix.trim()} [→](/documents/${id})`
  })

  return linked
}

async function main() {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  let where = `(primer ~ 'pub_id:[0-9]+' AND primer !~ '\\{pub_id:[0-9]+\\}')
            OR (primer ~ 'doc_id:[0-9]+' AND primer !~ '\\{doc_id:[0-9]+\\}')`
  const params: any[] = []
  if (onlyId !== null) { where = `id = $1`; params.push(onlyId) }

  const { rows } = await db.query(
    `SELECT id, community_id, title, primer FROM neighborhoods WHERE ${where}`,
    params,
  )
  console.log(`${rows.length} neighborhoods to relink${dryRun ? ' (dry run)' : ''}`)

  for (const r of rows) {
    const pubIds = [...new Set([...r.primer.matchAll(/pub_id:(\d+)/g)].map((m: any) => parseInt(m[1])))]
    const docIds = [...new Set([...r.primer.matchAll(/doc_id:(\d+)/g)].map((m: any) => parseInt(m[1])))]
    const [citationLabels, docLabels] = await Promise.all([
      buildCitationLabels(db, pubIds),
      buildDocLabels(db, docIds),
    ])
    const before = r.primer
    const after = linkCitations(before, citationLabels, docLabels)
    const remainingPub = (after.match(/pub_id:/g) || []).length
    const remainingDoc = (after.match(/doc_id:/g) || []).length
    console.log(`  [${r.id}] ${r.title}`)
    console.log(`    ${pubIds.length} pub_ids, ${docIds.length} doc_ids; remaining unlinked: ${remainingPub} pub, ${remainingDoc} doc`)
    if (!dryRun && remainingPub === 0 && remainingDoc === 0) {
      await db.query(`UPDATE neighborhoods SET primer = $1 WHERE id = $2`, [after, r.id])
      console.log(`    updated`)
    } else if (remainingPub > 0 || remainingDoc > 0) {
      console.log(`    NOT updated — still has raw tags; needs manual review`)
    }
  }

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
