import { getDb } from '../../lib/db'
import { getAnnualReporting } from '@/services/reporting-metrics'

export const dynamic = 'force-dynamic'

/** CSV of the /metrics "Annual reporting" table, computed beside previously reported figures. */
export async function GET() {
  const rows = await getAnnualReporting(getDb())
  const header = [
    'year', 'journal_articles', 'journal_articles_reported',
    'sfa_papers', 'sfa_unclassified', 'sfa_papers_reported',
    'sail_papers', 'sail_unclassified', 'student_papers',
    'pubs_with_student_authors', 'articles_with_undergrad_reported',
    'student_authors_on_pubs', 'undergrad_authors_reported',
    'pubs_with_reu_authors', 'reu_authors',
  ].join(',')
  const v = (n: number | null) => (n == null ? '' : String(n))
  const body = rows
    .map((r) =>
      [
        r.year, r.articles, v(r.reported.articles),
        r.sfa, r.sfaUnclassified, v(r.reported.sfa),
        r.sail, r.sailUnclassified, r.studentPapers,
        r.studentPubs, v(r.reported.undergradArticles),
        r.studentAuthors, v(r.reported.undergradAuthors),
        r.reuPubs, r.reuAuthors,
      ].join(','),
    )
    .join('\n')
  return new Response(`${header}\n${body}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rmbl-annual-reporting.csv"',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
