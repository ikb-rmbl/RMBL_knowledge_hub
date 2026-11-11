import type { Endpoint } from 'payload'

/**
 * GET /api/publications/:id/student-evidence — admin-only explanation of a
 * publication's student-author status for the "Student evidence" sidebar panel
 * (src/admin/components/StudentEvidence.tsx): every student-author tag with
 * the reason it exists, the legacy Publications DB marking, and — on a student
 * paper — the classifier's students/mentors and the publications they were
 * matched to. Names students and REU status, so it requires a logged-in user.
 */

const poolOf = (req: any) => (req?.payload?.db as any)?.pool

/** Tags counted by the metrics (UNDERGRAD_TAGS in src/services/reporting-metrics.ts). */
const counted = (program: string, method: string) =>
  ['reu', 'student_paper', 'student'].includes(program) && method !== 'publication_type'

function reason(row: any): string {
  if (row.curated) return 'set by an admin (Student select)'
  switch (row.detection_method) {
    case 'reu_pub_list': return "on the REU program's publication list"
    case 'roster': return 'REU cohort roster (mentor co-author)'
    case 'roster_derived': return 'REU cohort identified from student papers'
    case 'legacy_asterisk': return 'asterisk in the old Publications Database'
    case 'participant': {
      const e = row.evidence ?? {}
      const basis = e.basis === 'same topic' ? 'initials + same topic' : e.basis === 'mentor co-author' ? 'initials + mentor co-author' : 'first name matches'
      return row.sp_title
        ? `student paper ${row.sp_year}: "${row.sp_title}" (as ${e.student_name}; ${basis})`
        : `RMBL student paper (${basis})`
    }
    case 'publication_type': return row.student_program === 'thesis' ? 'author of this thesis' : 'author of this student paper'
    case 'inferred_window': return 'thesis author (graduate student) — not counted'
    default: return row.detection_method
  }
}

export const studentEvidenceEndpoint: Endpoint = {
  path: '/:id/student-evidence',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const id = Number(req.routeParams?.id)
    const pool = poolOf(req)
    if (!Number.isInteger(id) || !pool) return Response.json({ error: 'Bad request' }, { status: 400 })

    const { rows: [pub] } = await pool.query(
      `SELECT id, publication_type, undergrad_author, coalesce(legacy_student_flag, false) AS legacy_flag,
              coalesce(curated_fields, '[]'::jsonb) @> '["undergradAuthor"]' AS undergrad_curated,
              student_paper_info
         FROM publications WHERE id = $1`, [id])
    if (!pub) return Response.json({ error: 'Not found' }, { status: 404 })

    const { rows: tags } = await pool.query(
      `SELECT s.author_name, s.student_program, s.detection_method, s.curated, s.evidence,
              sp.title AS sp_title, sp.year::int AS sp_year
         FROM publication_student_authors s
         LEFT JOIN publications sp ON sp.id = (s.evidence->>'student_paper_id')::int
        WHERE s.publication_id = $1
        ORDER BY s.author_name`, [id])

    let matchedTo: any[] = []
    if (pub.publication_type === 'student_paper') {
      const { rows } = await pool.query(
        `SELECT p.id, p.year::int AS year, p.title, s.author_name, s.student_program
           FROM publication_student_authors s JOIN publications p ON p.id = s.publication_id
          WHERE s.detection_method = 'participant' AND (s.evidence->>'student_paper_id')::int = $1
          ORDER BY p.year, p.title`, [id])
      matchedTo = rows
    }

    return Response.json({
      undergradAuthor: pub.undergrad_author,
      undergradCurated: pub.undergrad_curated,
      legacyFlag: pub.legacy_flag,
      tags: tags.map((t: any) => ({
        name: t.author_name,
        reu: t.student_program === 'reu',
        program: t.student_program,
        counted: counted(t.student_program, t.detection_method),
        reason: reason(t),
        studentPaperId: t.evidence?.student_paper_id ?? null,
      })),
      studentPaper: pub.publication_type === 'student_paper'
        ? {
            students: pub.student_paper_info?.students ?? [],
            mentors: pub.student_paper_info?.mentors ?? [],
            source: pub.student_paper_info?.source ?? null,
            notes: pub.student_paper_info?.notes ?? [],
            matchedTo,
          }
        : null,
    })
  },
}
