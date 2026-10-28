/**
 * Swap author names whose given and family fields were loaded reversed.
 *
 * Some legacy RMBL Publications Database records stored every author as
 * given = "Ellison", family = "A. M.", which sorts those papers under initials
 * ("A. M." first in Author A-Z) and created registry authors named
 * "Ellison A. M." with family name "A. M.". Found in the 2026-10 author-sort
 * audit: 74 per-paper author rows across 16 papers, 74 registry authors.
 *
 * A row is swapped when its family is only initials WITH a period ("A. M.",
 * "K.H", "J.E.") and its given is a real name with no period — so genuine short
 * surnames (Wu, Li, Le, Ge) are not touched — AND there is evidence: the whole
 * paper is reversed, or the registry already holds the reversed name ("Pardee | G."
 * when a G. Pardee exists). "Mary | V." (Mary V. Price, surname lost) has neither
 * and is listed for review instead. Library-catalog junk ("from old
 * catalog Whipple Orville | B.") is skipped; those records are reviewed apart.
 *
 * - publications_authors: given ⇄ family (sync-publication-children carries it
 *   to Neon; or run this with --target=neon).
 * - authors (registry): given_name ⇄ family_name, display_name rebuilt as
 *   "<given> <family>". Corrected registry authors may duplicate an existing
 *   author ("A. M. Ellison" vs "Aaron M. Ellison") — run
 *   merge-duplicate-authors.ts --dry-run afterwards and review its proposals.
 *
 * Idempotent (a corrected row no longer matches). One transaction.
 *
 * Usage:
 *   npx tsx scripts/fix-swapped-author-names.ts [--dry-run] [--target=neon]
 */

import pg from 'pg'
import './lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') throw new Error(`Unknown --target=${target}`)

// Initials with at least one period, nothing else: "A. M.", "K.H", "J.E.", "C. -A."
const INITIALS = `^([A-Z]\\.?\\s?-?){1,3}$`
const swapped = (familyCol: string, givenCol: string) =>
  `${familyCol} ~ '${INITIALS}' AND ${familyCol} ~ '\\.' AND length(${givenCol}) > 2 AND ${givenCol} !~ '\\.'
   AND ${givenCol} !~* '(from old catalog|^author\\s|,)'`

async function main() {
  const url = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!url) throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  const db = new pg.Pool({ connectionString: url, max: 1 })
  console.log(`Target: ${target}${dryRun ? ' (dry-run)' : ''}`)
  try {
    // The pattern alone can't tell "Pardee | G." (swapped) from "Mary | V." (Mary V.
    // Price, surname lost). Require evidence: the whole paper is reversed (>= half
    // its authors match), or the registry already holds the reversed name — an
    // author with family name = this given name and a matching first initial.
    const confirmed = (given: string, family: string, selfId = 'NULL') => `EXISTS (
      SELECT 1 FROM authors r WHERE lower(r.family_name) = lower(${given})
         AND upper(left(coalesce(r.given_name, ''), 1)) = upper(left(${family}, 1))
         -- only well-formed entries count as evidence ("Van Buren, | Mary" is itself broken)
         AND r.given_name !~ ',' AND r.family_name !~ '[,.]'
         AND r.id IS DISTINCT FROM ${selfId})`
    const { rows: pa } = await db.query(
      `WITH m AS (SELECT _parent_id AS pub, count(*) FILTER (WHERE ${swapped('family', 'given')}) AS hit, count(*) AS n
                    FROM publications_authors GROUP BY 1)
       SELECT a.id, a._parent_id AS pub, a.given, a.family, m.hit * 2 >= m.n AS record_level
         FROM publications_authors a JOIN m ON m.pub = a._parent_id
        WHERE ${swapped('a.family', 'a.given')} AND (m.hit * 2 >= m.n OR ${confirmed('a.given', 'a.family')})
        ORDER BY a._parent_id, a._order`,
    )
    const { rows: au } = await db.query(
      `SELECT au.id, au.display_name, au.given_name, au.family_name FROM authors au
        WHERE ${swapped('au.family_name', 'au.given_name')}
          AND (${confirmed('au.given_name', 'au.family_name', 'au.id')}
               OR EXISTS (SELECT 1 FROM authors_rels ar JOIN publications_authors pa ON pa._parent_id = ar.publications_id
                           WHERE ar.parent_id = au.id AND ar.path = 'publications'
                             AND lower(pa.given) = lower(au.given_name) AND pa.family = au.family_name
                             AND (SELECT count(*) FILTER (WHERE ${swapped('x.family', 'x.given')}) * 2 >= count(*)
                                    FROM publications_authors x WHERE x._parent_id = pa._parent_id)))
        ORDER BY au.id`,
    )
    const { rows: review } = await db.query(
      `SELECT _parent_id AS pub, given, family FROM publications_authors a
        WHERE ${swapped('a.family', 'a.given')} AND NOT a.id = ANY($1::text[]) ORDER BY 1`,
      [pa.map((r) => String(r.id))],
    )
    console.log(`  publications_authors: ${pa.length} rows across ${new Set(pa.map((r) => r.pub)).size} papers`)
    for (const r of pa.slice(0, 6)) console.log(`    pub ${r.pub}: "${r.given} | ${r.family}" → "${r.family} | ${r.given}"`)
    console.log(`  authors (registry): ${au.length}`)
    for (const r of au.slice(0, 6)) console.log(`    ${r.id}: "${r.display_name}" → "${r.family_name} ${r.given_name}"`)
    if (review.length) {
      console.log(`  left for review (pattern matches, no evidence of a swap): ${review.length}`)
      for (const r of review) console.log(`    pub ${r.pub}: "${r.given} | ${r.family}"`)
    }
    if (dryRun || (!pa.length && !au.length)) { console.log(dryRun ? '\n[dry-run] nothing written.' : 'Nothing to fix.'); return }

    const tx = await db.connect()
    try {
      await tx.query('BEGIN')
      await tx.query(`UPDATE publications_authors SET given = family, family = given WHERE id = ANY($1::text[])`, [pa.map((r) => String(r.id))])
      await tx.query(
        `UPDATE authors SET given_name = family_name, family_name = given_name,
                display_name = trim(family_name || ' ' || given_name), updated_at = now()
          WHERE id = ANY($1::int[])`,
        [au.map((r) => r.id)],
      )
      await tx.query('COMMIT')
    } catch (err) {
      await tx.query('ROLLBACK')
      throw err
    } finally {
      tx.release()
    }
    console.log(`\nSwapped ${pa.length} author-list rows and ${au.length} registry authors.`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
