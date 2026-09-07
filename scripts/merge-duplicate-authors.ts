/**
 * Merge duplicate author rows created when a registry rebuild changed
 * canonical given-name forms and the sync matcher failed to pair the new
 * forms with existing rows (e.g. "B. L. Peckarsky" vs "Barbara L.
 * Peckarsky", "Nickolas M. Waser" vs "Nicholas M. Waser").
 *
 * Merge criteria within a family-name group (conservative — see the
 * conflation history in audit-author-conflations.ts / issue #46):
 *   1. Identical given name (case/dot-insensitive), incl. both empty
 *   2. givenNamesCompatible: initials agree + token-wise prefix match
 *      ("B. L." ~ "Barbara L.", "David W." ~ "David William")
 *   3. Initials agree AND the two rows share >= --min-shared-works linked
 *      works (catches spelling variants like Nickolas/Nicholas, where the
 *      shared-works overlap is decisive evidence of the same person)
 * A pair with two DIFFERENT ORCIDs is never merged. A row only joins a
 * cluster if it is pair-compatible with EVERY member (prevents an
 * initials-only row from bridging "Barbara Smith" and "Benjamin Smith").
 *
 * Survivor: curated row > row with ORCID > highest work_count > oldest.
 * Loser links are remapped (authors_rels deduped, projects.pi_author_id,
 * publication_student_authors.author_id), missing orcid/affiliation are
 * filled onto the survivor, work_count recomputed, losers deleted.
 *
 * --artifact-since=YYYY-MM-DD: rows created on/after this date whose
 * updated_at still equals created_at (never touched since creation) carry
 * curation-hook create artifacts, not admin edits (the hook falsely marked
 * fields curated on create until the operation guard was added). Such rows
 * are treated as uncurated for survivor selection and their curated_fields
 * are cleared. Rows edited after creation keep their curation untouched.
 *
 * Usage:
 *   npx tsx scripts/merge-duplicate-authors.ts [--dry-run] [--target=neon] [--min-shared-works=3] [--artifact-since=2026-09-07]
 */

import pg from 'pg'
import './lib/config.js'
import { givenNamesCompatible, givenInitialsMatch } from './lib/author-dedup.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] || 'local'
const minSharedArg = args.find((a) => a.startsWith('--min-shared-works='))
const MIN_SHARED_WORKS = minSharedArg ? parseInt(minSharedArg.split('=')[1], 10) : 3
const artifactSince = args.find((a) => a.startsWith('--artifact-since='))?.split('=')[1] || null

interface AuthorRow {
  id: number
  display_name: string
  family_name: string
  given_name: string | null
  orcid: string | null
  affiliation: string | null
  work_count: number
  curated_fields: string[]
  created_at: Date
  artifact_curation: boolean
  works: Set<string>
}

const isCurated = (a: AuthorRow) => a.curated_fields.length > 0 && !a.artifact_curation

const normGiven = (s: string | null) => (s || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim()

function sharedWorks(a: AuthorRow, b: AuthorRow): number {
  let n = 0
  const [small, large] = a.works.size <= b.works.size ? [a.works, b.works] : [b.works, a.works]
  for (const w of small) if (large.has(w)) n++
  return n
}

function pairMergeable(a: AuthorRow, b: AuthorRow): boolean {
  if (a.orcid && b.orcid && a.orcid !== b.orcid) return false
  if (normGiven(a.given_name) === normGiven(b.given_name)) return true
  if (!a.given_name || !b.given_name) return false
  if (givenNamesCompatible(a.given_name, b.given_name)) return true
  if (givenInitialsMatch(a.given_name, b.given_name) && sharedWorks(a, b) >= MIN_SHARED_WORKS) return true
  return false
}

function pickSurvivor(cluster: AuthorRow[]): AuthorRow {
  // Older rows win ties so long-lived public /authors/<id> URLs survive the
  // merge; the fuller name form is grafted onto the survivor afterwards.
  return [...cluster].sort((a, b) => {
    const curA = isCurated(a) ? 1 : 0
    const curB = isCurated(b) ? 1 : 0
    if (curA !== curB) return curB - curA
    const orcA = a.orcid ? 1 : 0
    const orcB = b.orcid ? 1 : 0
    if (orcA !== orcB) return orcB - orcA
    const created = a.created_at.getTime() - b.created_at.getTime()
    if (created !== 0) return created
    if (a.work_count !== b.work_count) return b.work_count - a.work_count
    return a.id - b.id
  })[0]
}

async function main() {
  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }
  const db = new pg.Pool({ connectionString, max: 2 })

  console.log(`Target: ${target}${dryRun ? ' (dry run)' : ''}; min shared works for initials-only merges: ${MIN_SHARED_WORKS}`)

  const { rows } = await db.query(`
    SELECT a.id, a.display_name, a.family_name, a.given_name, a.orcid, a.affiliation,
           a.work_count, a.curated_fields, a.created_at,
           (a.created_at >= COALESCE($1::timestamptz, 'infinity'::timestamptz)
             AND a.updated_at < a.created_at + interval '5 seconds') AS artifact_curation,
           COALESCE(array_agg(DISTINCT 'p' || ar.publications_id) FILTER (WHERE ar.publications_id IS NOT NULL), '{}')
             || COALESCE(array_agg(DISTINCT 'd' || ar.datasets_id) FILTER (WHERE ar.datasets_id IS NOT NULL), '{}')
             || COALESCE(array_agg(DISTINCT 'c' || ar.documents_id) FILTER (WHERE ar.documents_id IS NOT NULL), '{}') AS works
    FROM authors a
    LEFT JOIN authors_rels ar ON ar.parent_id = a.id
    GROUP BY a.id
  `, [artifactSince])
  const authors: AuthorRow[] = rows.map((r: any) => ({
    ...r,
    curated_fields: Array.isArray(r.curated_fields) ? r.curated_fields : [],
    works: new Set<string>(r.works || []),
  }))
  console.log(`${authors.length} authors loaded`)

  // Group by family name; greedy clustering requiring compatibility with
  // every existing member (most-linked rows seed clusters first).
  const byFamily = new Map<string, AuthorRow[]>()
  for (const a of authors) {
    const key = a.family_name.toLowerCase().trim()
    if (!key) continue
    if (!byFamily.has(key)) byFamily.set(key, [])
    byFamily.get(key)!.push(a)
  }

  const clusters: AuthorRow[][] = []
  for (const [, group] of byFamily) {
    if (group.length < 2) continue
    group.sort((a, b) => b.work_count - a.work_count)
    const groupClusters: AuthorRow[][] = []
    for (const a of group) {
      const home = groupClusters.find((cl) => cl.every((m) => pairMergeable(a, m)))
      if (home) home.push(a)
      else groupClusters.push([a])
    }
    clusters.push(...groupClusters.filter((cl) => cl.length > 1))
  }

  console.log(`\n${clusters.length} merge clusters found:`)
  for (const cl of clusters) {
    const survivor = pickSurvivor(cl)
    const losers = cl.filter((m) => m.id !== survivor.id)
    console.log(
      `  KEEP ${survivor.id} "${survivor.display_name}"${survivor.orcid ? ' [ORCID]' : ''}${isCurated(survivor) ? ' [curated]' : ''} (${survivor.work_count} works)  <=  ` +
        losers.map((l) => `${l.id} "${l.display_name}" (${l.work_count})`).join(', '),
    )
  }

  if (dryRun) {
    console.log('\nDry run — no changes made.')
    await db.end()
    return
  }

  // Clear create-artifact curation flags (never-edited rows only — any row an
  // admin has touched since creation keeps its curated_fields untouched).
  if (artifactSince) {
    const { rowCount } = await db.query(
      `UPDATE authors SET curated_fields = '[]'::jsonb
       WHERE created_at >= $1::timestamptz
         AND updated_at < created_at + interval '5 seconds'
         AND curated_fields::text != '[]'`,
      [artifactSince],
    )
    console.log(`\nCleared create-artifact curation flags on ${rowCount} never-edited rows`)
  }

  let merged = 0
  for (const cl of clusters) {
    const survivor = pickSurvivor(cl)
    const losers = cl.filter((m) => m.id !== survivor.id)
    const loserIds = losers.map((l) => l.id)

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      // Remap relationship rows, dropping ones the survivor already has
      await client.query(
        `DELETE FROM authors_rels ar
         WHERE ar.parent_id = ANY($1)
           AND EXISTS (
             SELECT 1 FROM authors_rels s
             WHERE s.parent_id = $2 AND s.path = ar.path
               AND s.publications_id IS NOT DISTINCT FROM ar.publications_id
               AND s.datasets_id IS NOT DISTINCT FROM ar.datasets_id
               AND s.documents_id IS NOT DISTINCT FROM ar.documents_id
           )`,
        [loserIds, survivor.id],
      )
      await client.query(`UPDATE authors_rels SET parent_id = $2 WHERE parent_id = ANY($1)`, [loserIds, survivor.id])
      // Collapse duplicates among rows that came from different losers
      await client.query(
        `DELETE FROM authors_rels ar USING authors_rels keep
         WHERE ar.parent_id = $1 AND keep.parent_id = $1 AND ar.id > keep.id
           AND ar.path = keep.path
           AND ar.publications_id IS NOT DISTINCT FROM keep.publications_id
           AND ar.datasets_id IS NOT DISTINCT FROM keep.datasets_id
           AND ar.documents_id IS NOT DISTINCT FROM keep.documents_id`,
        [survivor.id],
      )

      await client.query(`UPDATE projects SET pi_author_id = $2 WHERE pi_author_id = ANY($1)`, [loserIds, survivor.id])
      await client.query(`UPDATE publication_student_authors SET author_id = $2 WHERE author_id = ANY($1)`, [
        loserIds,
        survivor.id,
      ])

      // Capture fill-in values before deleting losers (ORCID is unique, so
      // the loser row must be gone before the survivor takes its ORCID)
      const fillOrcid = survivor.orcid || losers.find((l) => l.orcid)?.orcid || null
      const fillAffiliation = survivor.affiliation || losers.find((l) => l.affiliation)?.affiliation || null
      const longest = [...cl].sort((a, b) => (b.given_name || '').length - (a.given_name || '').length)[0]
      const nameIsCurated =
        isCurated(survivor) &&
        (survivor.curated_fields.includes('displayName') || survivor.curated_fields.includes('givenName'))
      const fillGiven =
        !nameIsCurated && (longest.given_name || '').length > (survivor.given_name || '').length
          ? longest.given_name
          : survivor.given_name
      const fillDisplay =
        !nameIsCurated && fillGiven !== survivor.given_name ? `${fillGiven} ${survivor.family_name}` : survivor.display_name

      await client.query(`DELETE FROM authors WHERE id = ANY($1)`, [loserIds])

      await client.query(
        `UPDATE authors SET
           orcid = COALESCE($2, orcid),
           affiliation = COALESCE($3, affiliation),
           given_name = $4,
           display_name = $5,
           work_count = (
             SELECT count(*) FROM authors_rels ar
             WHERE ar.parent_id = $1
               AND (ar.publications_id IS NOT NULL OR ar.datasets_id IS NOT NULL OR ar.documents_id IS NOT NULL)
           ),
           updated_at = now()
         WHERE id = $1`,
        [survivor.id, fillOrcid, fillAffiliation, fillGiven, fillDisplay],
      )

      await client.query('COMMIT')
      merged += losers.length
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`  FAILED cluster around ${survivor.id} "${survivor.display_name}":`, (err as Error).message)
    } finally {
      client.release()
    }
  }

  const { rows: after } = await db.query('SELECT count(*)::int AS n FROM authors')
  console.log(`\nMerged ${merged} duplicate rows; ${after[0].n} authors remain.`)
  await db.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
