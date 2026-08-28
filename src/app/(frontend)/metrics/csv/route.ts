import { getDb } from '../../lib/db'

export const dynamic = 'force-dynamic'

/** CSV export of the /metrics per-year series (for board decks and reports). */
export async function GET() {
  const { rows } = await getDb().query(`
    SELECT p.year::int AS year,
           count(*)::int AS total,
           count(*) FILTER (WHERE p.rmbl_research = 'yes')::int AS rmbl_research,
           count(*) FILTER (WHERE p.rmbl_research = 'yes' AND p.publication_type IN ('article','chapter','book'))::int AS peer_reviewed_rmbl,
           count(*) FILTER (WHERE p.publication_type IN ('student_paper','thesis'))::int AS student_papers_theses,
           count(*) FILTER (WHERE sa.publication_id IS NOT NULL AND p.publication_type IN ('article','chapter','book'))::int AS peer_reviewed_with_student_authors,
           count(*) FILTER (WHERE sa.has_reu)::int AS reu_students
    FROM publications p
    LEFT JOIN (
      SELECT publication_id, bool_or(student_program = 'reu') AS has_reu
      FROM publication_student_authors GROUP BY publication_id
    ) sa ON sa.publication_id = p.id
    WHERE p.year >= 1928 AND p.year <= extract(year FROM now())::int
    GROUP BY p.year ORDER BY p.year
  `)
  const header = 'year,total,rmbl_research,peer_reviewed_rmbl,student_papers_theses,peer_reviewed_with_student_authors,reu_students'
  const body = rows.map((r: any) => `${r.year},${r.total},${r.rmbl_research},${r.peer_reviewed_rmbl},${r.student_papers_theses},${r.peer_reviewed_with_student_authors},${r.reu_students}`).join('\n')
  return new Response(`${header}\n${body}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rmbl-publication-metrics.csv"',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
