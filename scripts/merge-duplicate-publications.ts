/**
 * Merge duplicate publication rows: move everything attached to the dropped
 * copy onto the kept one, tombstone the dropped copy, then delete it.
 *
 * An admin delete in Payload is a pure delete (+ tombstone). For true
 * duplicates that loses data — each copy can carry different citations,
 * entity mentions, project links, flags, student tags (the 2026-09 legacy
 * duplicates did). This moves them first. Everything runs in ONE
 * transaction per database: all pairs merge or none do.
 *
 * Per pair (keep ← drop):
 *   - columns NULL on keep take drop's value (abstract, full text, flags, …).
 *     The keeper's curated_fields stand; drop's are NOT carried over — they
 *     describe drop's cells, and on pipeline-created duplicates they are the
 *     2026-09 insert-time pollution (every field marked curated on creation),
 *     which would freeze the keeper's metadata against pipeline updates.
 *   - every table referencing publications is repointed, skipping rows that
 *     would duplicate one the keeper already has (those are deleted)
 *   - Payload child arrays (authors, keywords, …) move only if the keeper
 *     has none; topics are unioned
 *   - neighborhood membership is dropped, not repointed (graph node ids are
 *     rebuilt by the pipeline)
 *   - a duplicate_tombstones row is written exactly as tombstoneHook does,
 *     so loaders won't reintroduce the dropped copy; deleted URLs 404
 *
 * Identity guard: a pair must share a DOI or an exact title — unless it is
 * marked decision=merge in a --reviewed CSV (columns keep_id, drop_id,
 * decision), i.e. a human checked it. Reviewed pairs still need title trigram
 * similarity >= 0.5 and years within 1, so a typo'd id can't merge two papers.
 * With --reviewed and no --pairs, every decision=merge row is merged.
 *
 * Usage:
 *   npx tsx scripts/merge-duplicate-publications.ts --pairs=1190:1269,436:437 [--dry-run] [--target=neon]
 *   npx tsx scripts/merge-duplicate-publications.ts --reviewed=<review.csv> [--dry-run] [--target=neon]
 *
 * Writes directly to PostgreSQL — no dev server needed.
 */

import pg from 'pg'
import './lib/config.js' // .env auto-load
import { readCsvFile } from './lib/csv.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
const pairsArg = args.find((a) => a.startsWith('--pairs='))?.split('=')[1]
const reviewedArg = args.find((a) => a.startsWith('--reviewed='))?.split('=')[1]
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)
if (!pairsArg && !reviewedArg) throw new Error('--pairs=keep:drop[,keep:drop…] or --reviewed=<csv> is required')

/** Pairs a human marked decision=merge, keyed "keep:drop". */
const reviewed = new Set(
  reviewedArg
    ? readCsvFile(reviewedArg).filter((r) => r.decision?.trim() === 'merge').map((r) => `${Number(r.keep_id)}:${Number(r.drop_id)}`)
    : [],
)

const pairs = (pairsArg ? pairsArg.split(',') : [...reviewed]).map((p) => {
  const [keep, drop] = p.split(':').map((n) => Number(n))
  if (!Number.isInteger(keep) || !Number.isInteger(drop) || keep === drop) throw new Error(`Bad pair: ${p}`)
  return { keep, drop }
})

// Scalar columns filled from drop only where keep is NULL.
const FILL_COLUMNS = [
  'abstract', 'full_text', 'doi', 'journal', 'volume', 'issue', 'pages', 'publisher',
  'pdf_link', 'external_url', 'embedding', 'sfa_program', 'sail_program',
  'funding_program_evidence', 'rmbl_research', 'rmbl_research_score',
]

// Payload child arrays: moved wholesale only when the keeper has none.
const CHILD_TABLES = [
  { table: 'publications_authors', fk: '_parent_id' },
  { table: 'publications_keywords', fk: '_parent_id' },
  { table: 'publications_editors', fk: '_parent_id' },
  { table: 'publications_mentors', fk: '_parent_id' },
  { table: 'publications_geographic_scope', fk: 'parent_id' },
]

/**
 * Repoint `col` from drop to keep where the keeper has no equivalent row
 * (same values in `same`), then delete drop's leftovers. `where` scopes
 * polymorphic tables (collection / entity_type).
 */
function repoint(table: string, col: string, same: string[], where = 'TRUE') {
  const eq = same.map((c) => `t2.${c} IS NOT DISTINCT FROM t.${c}`).join(' AND ') || 'TRUE'
  return [
    `UPDATE ${table} t SET ${col} = $1 WHERE t.${col} = $2 AND ${where.replaceAll('@', 't.')}
       AND NOT EXISTS (SELECT 1 FROM ${table} t2 WHERE t2.${col} = $1 AND ${where.replaceAll('@', 't2.')} AND ${eq})`,
    `DELETE FROM ${table} t WHERE t.${col} = $2 AND ${where.replaceAll('@', 't.')}`,
  ]
}

const REFERENCES: { label: string; sql: string[] }[] = [
  { label: 'authors_rels', sql: repoint('authors_rels', 'publications_id', ['parent_id', 'path']) },
  { label: 'datasets_rels', sql: repoint('datasets_rels', 'publications_id', ['parent_id', 'path']) },
  { label: 'projects_rels', sql: repoint('projects_rels', 'publications_id', ['parent_id', 'path']) },
  { label: 'frontier cites', sql: repoint('frontier_statement_papers', 'pub_id', ['statement_id']) },
  { label: 'student authors', sql: repoint('publication_student_authors', 'publication_id', ['author_name']) },
  { label: 'code repos', sql: repoint('code_repositories', 'publication_id', ['url']) },
  { label: 'data repos', sql: repoint('data_repositories', 'publication_id', ['url']) },
  { label: 'reuse events', sql: repoint('dataset_reuse_events', 'citing_publication_id', ['dataset_id', 'channel', 'citing_doi']) },
  {
    label: 'cited by (incoming refs)',
    sql: repoint('references_cited', 'target_publication_id',
      ['source_publication_id', 'source_document_id', 'source_story_id', 'target_dataset_id', 'cited_doi', 'cited_title']),
  },
  {
    label: 'cites (outgoing refs)',
    sql: [
      // A drop→keep reference would become a self-citation.
      `DELETE FROM references_cited WHERE source_publication_id = $2 AND target_publication_id = $1`,
      ...repoint('references_cited', 'source_publication_id', ['target_publication_id', 'target_dataset_id', 'cited_doi', 'cited_title']),
    ],
  },
  { label: 'entity mentions', sql: repoint('entity_mentions', 'item_id', ['entity_type', 'entity_id', 'role'], `@collection = 'publications'`) },
  {
    // Raw extractions — the rebuild-safe source entity mentions are recovered from.
    label: 'entity candidates',
    sql: repoint('entity_candidates', 'source_item_id', ['entity_type', 'raw_name'], `@source_collection = 'publications'`),
  },
  { label: 'era members', sql: repoint('era_members', 'item_id', ['era_id'], `@collection = 'publications'`) },
  { label: 'frontier entities', sql: repoint('frontier_entities', 'entity_id', ['frontier_id'], `@entity_type IN ('publication', 'publications')`) },
  { label: 'content flags', sql: repoint('content_flags', 'item_id', [], `@collection IN ('publications', 'publication')`) },
  {
    label: 'content chunks',
    // Chunks are per-text; keep the keeper's own when it has any.
    sql: [
      `UPDATE content_chunks SET item_id = $1 WHERE collection = 'publications' AND item_id = $2
         AND NOT EXISTS (SELECT 1 FROM content_chunks WHERE collection = 'publications' AND item_id = $1)`,
      `DELETE FROM content_chunks WHERE collection = 'publications' AND item_id = $2`,
    ],
  },
  {
    label: 'protocol steps',
    sql: [
      `UPDATE publication_protocol_steps SET publication_id = $1 WHERE publication_id = $2
         AND NOT EXISTS (SELECT 1 FROM publication_protocol_steps WHERE publication_id = $1)`,
    ],
  },
  { label: 'protocol origin', sql: [`UPDATE protocols SET origin_paper_id = $1 WHERE origin_paper_id = $2`] },
  {
    label: 'topics',
    sql: [
      `UPDATE publications_rels t SET parent_id = $1 WHERE t.parent_id = $2 AND t.topics_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM publications_rels t2 WHERE t2.parent_id = $1 AND t2.path = t.path AND t2.topics_id = t.topics_id)`,
    ],
  },
  { label: 'neighborhood membership (dropped)', sql: [`DELETE FROM neighborhood_members WHERE entity_type = 'publication' AND entity_id = $2`] },
  { label: 'admin locks', sql: [`DELETE FROM payload_locked_documents_rels WHERE publications_id = $2`] },
]

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url })
  const client = await db.connect()
  console.log(`Target: ${target}${dryRun ? ' (dry-run — rolled back)' : ''}; ${pairs.length} pair(s)`)
  try {
    await client.query('BEGIN')
    const totals: Record<string, number> = {}
    for (const { keep, drop } of pairs) {
      const { rows } = await client.query(`SELECT id, title, year::int AS year, doi FROM publications WHERE id = ANY($1)`, [[keep, drop]])
      const k = rows.find((r) => r.id === keep)
      const d = rows.find((r) => r.id === drop)
      if (!k || !d) throw new Error(`Pair ${keep}:${drop} — missing row(s) (keep ${!!k}, drop ${!!d})`)
      // Guard against a typo merging two different papers.
      const same = (d.doi && k.doi && d.doi.toLowerCase() === k.doi.toLowerCase()) ||
        k.title.trim().toLowerCase() === d.title.trim().toLowerCase()
      if (!same) {
        if (!reviewed.has(`${keep}:${drop}`)) throw new Error(`Pair ${keep}:${drop} is not a duplicate: "${k.title}" vs "${d.title}"`)
        const { rows: [{ s }] } = await client.query(`SELECT similarity(lower($1), lower($2)) AS s`, [k.title, d.title])
        if (Number(s) < 0.5 || Math.abs((k.year ?? 0) - (d.year ?? 0)) > 1) {
          throw new Error(`Reviewed pair ${keep}:${drop} fails the sanity check (title similarity ${Number(s).toFixed(2)}, years ${k.year}/${d.year})`)
        }
      }

      console.log(`\n#${keep} ← #${drop}  ${k.title.slice(0, 70)}`)
      const { rows: [fillBefore] } = await client.query(
        `SELECT ${FILL_COLUMNS.map((c) => `(${c} IS NOT NULL) AS ${c}`).join(', ')} FROM publications WHERE id = $1`, [keep])
      const fill = await client.query(
        `UPDATE publications k SET ${FILL_COLUMNS.map((c) => `${c} = coalesce(k.${c}, d.${c})`).join(', ')},
                updated_at = now()
           FROM publications d WHERE k.id = $1 AND d.id = $2
         RETURNING ${FILL_COLUMNS.map((c) => `(k.${c} IS NOT NULL) AS ${c}`).join(', ')}`,
        [keep, drop],
      )
      for (const [col, had] of Object.entries(fillBefore)) if (!had && fill.rows[0]?.[col]) totals[`filled ${col}`] = (totals[`filled ${col}`] ?? 0) + 1
      for (const { table, fk } of CHILD_TABLES) {
        const r = await client.query(
          `UPDATE ${table} SET ${fk} = $1 WHERE ${fk} = $2 AND NOT EXISTS (SELECT 1 FROM ${table} WHERE ${fk} = $1)`,
          [keep, drop],
        )
        if (r.rowCount) console.log(`  moved ${r.rowCount} ${table}`)
        if (r.rowCount) totals[table] = (totals[table] ?? 0) + r.rowCount
      }
      for (const ref of REFERENCES) {
        let moved = 0
        let removed = 0
        for (const sql of ref.sql) {
          // Postgres can't type a parameter a statement never mentions, so a
          // drop-only statement gets drop as its sole ($1) parameter.
          const r = /\$1\b/.test(sql)
            ? await client.query(sql, [keep, drop])
            : await client.query(sql.replace(/\$2\b/g, '$$1'), [drop])
          if (/^\s*UPDATE/i.test(sql)) moved += r.rowCount ?? 0
          else removed += r.rowCount ?? 0
        }
        if (moved || removed) console.log(`  ${ref.label}: ${moved} moved${removed ? `, ${removed} duplicate/dropped` : ''}`)
        totals[ref.label] = (totals[ref.label] ?? 0) + moved
      }
      // Same row shape tombstoneHook writes (dedup-keys.ts extractKeys).
      await client.query(
        `INSERT INTO duplicate_tombstones (collection, keys, deleted_by, notes) VALUES ('publications', $1::jsonb, NULL, $2)`,
        [JSON.stringify({ doi: d.doi ? d.doi.trim().toLowerCase() : null, title: d.title || null, year: d.year ?? null }),
          `duplicate of #${keep}; merged by merge-duplicate-publications.ts`],
      )
      await client.query(`DELETE FROM publications WHERE id = $1`, [drop])
      console.log(`  tombstoned + deleted #${drop}`)
    }
    console.log(`\n== ${pairs.length} pairs merged; moved onto keepers:`)
    for (const [k, v] of Object.entries(totals).sort()) console.log(`  ${k.padEnd(28)} ${v}`)
    if (dryRun) {
      await client.query('ROLLBACK')
      console.log('\n[dry-run] rolled back — nothing changed.')
    } else {
      await client.query('COMMIT')
      console.log('\nCommitted.')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
