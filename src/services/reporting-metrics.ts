/**
 * Annual reporting metrics — the per-year numbers RMBL reports (formerly
 * tallied by hand against the legacy Publications Database), computed from the
 * Commons and set beside the figures previously reported.
 *
 * Shared by the /metrics "Annual reporting" table and /metrics/reporting-csv.
 *
 * Definitions (all over RMBL-research journal articles unless noted):
 *   articles       rmbl_research = 'yes' AND publication_type = 'article'
 *   sfa / sail     sfa_program / sail_program = 'yes' (classify-funding-programs.ts);
 *                  *Unclassified = still NULL (no full text, or a quote that
 *                  failed verification) — the count could rise by up to this much
 *   studentPapers  publication_type = 'student_paper' (all provenances)
 *   reuAuthors     distinct REU-tagged authors (tag-reu-authors.ts)
 *   reuArticles    articles with ≥1 REU-tagged author
 * REU is narrower than the "undergraduate" figures reported before, which also
 * counted non-REU undergrads; the roster covers cohorts 1991–2020 only.
 */

import type pg from 'pg'

export const REPORTING_YEAR_MIN = 2007
// Program counts are not applicable before these years (null, shown "—"),
// matching the "." earlier reports used for pre-SFA years.
export const SFA_FIRST_YEAR = 2016
export const SAIL_FIRST_YEAR = 2021

export interface ReportingRow {
  year: number
  articles: number
  sfa: number | null
  sfaUnclassified: number | null
  sail: number | null
  sailUnclassified: number | null
  studentPapers: number
  reuAuthors: number
  reuArticles: number
  reported: {
    articles: number | null
    sfa: number | null
    undergradAuthors: number | null
    undergradArticles: number | null
  }
}

export async function getAnnualReporting(db: pg.Pool): Promise<ReportingRow[]> {
  const [{ rows: computed }, { rows: reported }] = await Promise.all([
    db.query(
      `WITH arts AS (
         SELECT id, year, sfa_program, sail_program
           FROM publications
          WHERE rmbl_research = 'yes' AND publication_type = 'article'
       ),
       reu AS (
         SELECT a.year, count(DISTINCT s.author_name)::int AS authors, count(DISTINCT a.id)::int AS articles
           FROM publication_student_authors s
           JOIN arts a ON a.id = s.publication_id
          WHERE s.student_program = 'reu'
          GROUP BY a.year
       ),
       students AS (
         SELECT year, count(*)::int AS n FROM publications WHERE publication_type = 'student_paper' GROUP BY year
       )
       SELECT y.year::int AS year,
              count(a.id)::int AS articles,
              count(a.id) FILTER (WHERE a.sfa_program = 'yes')::int AS sfa,
              count(a.id) FILTER (WHERE a.sfa_program IS NULL)::int AS sfa_unclassified,
              count(a.id) FILTER (WHERE a.sail_program = 'yes')::int AS sail,
              count(a.id) FILTER (WHERE a.sail_program IS NULL)::int AS sail_unclassified,
              coalesce(max(st.n), 0)::int AS student_papers,
              coalesce(max(r.authors), 0)::int AS reu_authors,
              coalesce(max(r.articles), 0)::int AS reu_articles
         FROM generate_series($1::int, extract(year FROM now())::int) AS y(year)
         LEFT JOIN arts a ON a.year = y.year
         LEFT JOIN reu r ON r.year = y.year
         LEFT JOIN students st ON st.year = y.year
        GROUP BY y.year
        ORDER BY y.year DESC`,
      [REPORTING_YEAR_MIN],
    ),
    // Newest report wins where two reports give the same metric for a year.
    db.query(
      `SELECT DISTINCT ON (year, metric) year, metric, value
         FROM reported_metrics
        ORDER BY year, metric, CASE source WHEN 'report_2026' THEN 0 ELSE 1 END`,
    ),
  ])

  const rep = new Map<string, number>(reported.map((r: any) => [`${r.year}|${r.metric}`, r.value]))
  const get = (year: number, metric: string) => rep.get(`${year}|${metric}`) ?? null

  return computed.map((r: any) => ({
    year: r.year,
    articles: r.articles,
    sfa: r.year >= SFA_FIRST_YEAR ? r.sfa : null,
    sfaUnclassified: r.year >= SFA_FIRST_YEAR ? r.sfa_unclassified : null,
    sail: r.year >= SAIL_FIRST_YEAR ? r.sail : null,
    sailUnclassified: r.year >= SAIL_FIRST_YEAR ? r.sail_unclassified : null,
    studentPapers: r.student_papers,
    reuAuthors: r.reu_authors,
    reuArticles: r.reu_articles,
    reported: {
      articles: get(r.year, 'journal_articles'),
      sfa: get(r.year, 'sfa_articles'),
      undergradAuthors: get(r.year, 'undergrad_authors'),
      undergradArticles: get(r.year, 'articles_with_undergrad'),
    },
  }))
}
