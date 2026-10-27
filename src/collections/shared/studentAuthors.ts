import type { CollectionAfterChangeHook, CollectionAfterReadHook, CollectionBeforeChangeHook, Field } from 'payload'
import { isPipelineWrite } from './curationHook'

/**
 * Per-author student tags on publications, curated from the author list.
 *
 * Tags live in the custom SQL table publication_student_authors (one row per
 * paper × author, keyed on the author's registry display name), written by
 * tag-student-authors.ts / tag-reu-authors.ts. The author array field gets a
 * VIRTUAL "student" select: filled from the table on read, written back on save
 * as curated rows — which both tagging scripts leave alone. Storing it on the
 * array row instead would be lost: sync-publication-children replaces Neon's
 * author rows with local ones on every push.
 *
 * 'none' ("Not a student") is a stored negative: deleting a wrong auto-tag would
 * only let the next tagging run recreate it. Metrics exclude 'none' rows.
 */

export const STUDENT_PROGRAM_OPTIONS = [
  { label: 'Not a student', value: 'none' },
  { label: 'Student paper (RMBL independent research)', value: 'student_paper' },
  { label: 'Thesis / dissertation', value: 'thesis' },
  { label: 'REU', value: 'reu' },
]

export const studentProgramField: Field = {
  name: 'studentProgram',
  type: 'select',
  virtual: true,
  options: STUDENT_PROGRAM_OPTIONS,
  admin: {
    width: '25%',
    description: 'Student tag (auto-detected tags appear here; changing one marks it curated)',
  },
}

export interface StudentRow {
  id: number
  author_name: string
  author_id: number | null
  student_program: string | null
  curated: boolean
}

const letters = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')

/** Family name + first given initial of a display name ("Daniel T. Blumstein"). */
function nameKey(given: unknown, family: unknown): string {
  return `${letters(family)}|${letters(given).slice(0, 1)}`
}
function displayNameKey(display: string): string {
  const words = display.trim().split(/\s+/)
  return nameKey(words[0], words[words.length - 1])
}

/**
 * The table row for an author-list entry: same family name and first initial;
 * if several (two "J. Smith"s), the one whose display name matches given+family.
 */
export function matchStudentRow(author: { given?: unknown; family?: unknown }, rows: StudentRow[]): StudentRow | null {
  const key = nameKey(author.given, author.family)
  const hits = rows.filter((r) => displayNameKey(r.author_name) === key)
  if (hits.length <= 1) return hits[0] ?? null
  const full = letters(`${author.given} ${author.family}`)
  return hits.find((r) => letters(r.author_name) === full) ?? hits[0]
}

const poolOf = (req: any) => (req?.payload?.db as any)?.pool

async function loadRows(pool: any, publicationId: number): Promise<StudentRow[]> {
  const { rows } = await pool.query(
    `SELECT id, author_name, author_id, student_program, curated
       FROM publication_student_authors WHERE publication_id = $1`,
    [publicationId],
  )
  return rows
}

/** Fill the virtual field on single-document reads (edit view, detail pages). */
export const studentAuthorsAfterRead: CollectionAfterReadHook = async ({ doc, req, findMany }) => {
  // Admins only: publications are public-read, and per-author REU status derives
  // from the private REU roster (scripts/data/private) — only aggregates go public.
  if (!req.user || findMany || !Array.isArray(doc?.authors) || !doc.authors.length) return doc
  const pool = poolOf(req)
  if (!pool) return doc
  try {
    const rows = await loadRows(pool, doc.id)
    if (!rows.length) return doc
    for (const a of doc.authors) a.studentProgram = matchStudentRow(a, rows)?.student_program ?? null
  } catch (err: any) {
    req.payload.logger?.warn?.(`studentAuthors afterRead: ${err.message}`)
  }
  return doc
}

/** Virtual values are not persisted, so carry the submitted ones to afterChange. */
export const studentAuthorsBeforeChange: CollectionBeforeChangeHook = ({ data, req }) => {
  if (Array.isArray(data?.authors)) {
    req.context.studentPrograms = data.authors.map((a: any) => ({ given: a.given, family: a.family, studentProgram: a.studentProgram }))
  }
  return data
}

/**
 * Write curated rows for author entries whose submitted value differs from the
 * table — unchanged values are left as they are, so saving a paper never turns
 * auto tags into curated ones wholesale (the curation-flag pollution lesson).
 */
export const studentAuthorsAfterChange: CollectionAfterChangeHook = async ({ doc, req }) => {
  const submitted = req.context.studentPrograms as { given: string; family: string; studentProgram?: string | null }[] | undefined
  if (!submitted || isPipelineWrite(req)) return doc
  const pool = poolOf(req)
  if (!pool) return doc
  try {
    const rows = await loadRows(pool, doc.id)
    for (const a of submitted) {
      // A client that sent the author list without the key (a script, an API
      // caller) is not asking to clear tags — skip, never delete.
      if (a.studentProgram === undefined) continue
      const value = a.studentProgram || null
      const row = matchStudentRow(a, rows)
      if ((row?.student_program ?? null) === value) continue
      if (row) {
        // Clearing the select releases the row back to the pipeline (like the
        // CuratedFields × button); any other change is a curated assertion.
        if (value === null) await pool.query(`DELETE FROM publication_student_authors WHERE id = $1`, [row.id])
        else await pool.query(`UPDATE publication_student_authors SET student_program = $1, curated = true WHERE id = $2`, [value, row.id])
        continue
      }
      if (value === null) continue
      // New row: use the author registry's display name for the key, as the
      // tagging scripts do, so their ON CONFLICT sees the curated row.
      const { rows: reg } = await pool.query(
        `SELECT a.id, a.display_name FROM authors_rels ar JOIN authors a ON a.id = ar.parent_id
          WHERE ar.publications_id = $1 AND ar.path = 'publications'`,
        [doc.id],
      )
      const match = reg.find((r: any) => displayNameKey(r.display_name) === nameKey(a.given, a.family))
      await pool.query(
        `INSERT INTO publication_student_authors (publication_id, author_id, author_name, student_program, detection_method, curated)
         VALUES ($1, $2, $3, $4, 'admin', true)
         ON CONFLICT (publication_id, author_name) DO UPDATE SET student_program = EXCLUDED.student_program, curated = true`,
        [doc.id, match?.id ?? null, match?.display_name ?? `${a.given} ${a.family}`.trim(), value],
      )
    }
  } catch (err: any) {
    req.payload.logger?.error?.(`studentAuthors afterChange: ${err.message}`)
  }
  return doc
}
