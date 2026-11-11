/**
 * Annual reporting metrics — the per-year numbers RMBL reports (formerly
 * tallied by hand against the legacy Publications Database), computed from the
 * Commons and set beside the figures previously reported.
 *
 * Shared by the /metrics "Annual reporting" table and /metrics/reporting-csv.
 *
 * Definitions (all over RMBL-research journal articles unless noted):
 *   articles       rmbl_research = 'yes' AND publication_type = 'article'
 *   sfa            on the Watershed Function SFA's own publication list
 *                  (sfa_program = 'yes'; list is authoritative — see
 *                  classify-funding-programs.ts)
 *   sail           sail_program = 'yes' (acknowledgment/text classifier)
 *   *Unclassified  still NULL — the count could rise by up to this much
 *   studentPapers  publication_type = 'student_paper' (all provenances)
 *
 * Student authorship (Ian, 2026-11-10/11) — over RMBL-research PEER-REVIEWED
 * publications (article, chapter, book), counted by publication year:
 *   studentPubs     "# Pubs with Student Authors": "Undergraduate author" = Yes
 *                   (undergrad_author) — set from an author who was in RMBL's
 *                   undergraduate program (UNDERGRAD_TAGS) or the legacy
 *                   Publications Database's student marking (the source of the
 *                   previously reported figures; that student isn't always
 *                   identifiable), and correctable by an admin
 *   studentAuthors  "# Student Authors on Pubs": distinct tagged people
 *   reuPubs         "# Pubs with REU Authors": an NSF REU (or URP) student
 *   reuAuthors      "# REU Authors"
 * REU ⊂ undergraduate program, so reuPubs ≤ studentPubs and reuAuthors ≤
 * studentAuthors. Tags come from tag-student-authors.ts (participants: students
 * on RMBL student papers, on pubs within 6 years), tag-reu-authors.ts (REU
 * roster + the REU program's list), import-legacy-student-signals.ts (asterisked
 * authors) and admin curation. Graduate students (thesis tags) are not counted.
 */

import type pg from 'pg'

/** Peer-reviewed publication types. */
export const PEER_REVIEWED = `('article', 'chapter', 'book')`

/**
 * publication_student_authors rows that count a person as an undergraduate-
 * program author: REU, participant/asterisk ('student_paper') and admin-curated
 * non-REU ('student'). Excludes graduate tags ('thesis'), the structural tags on
 * student papers and theses themselves, and curated "Not a student" ('none').
 * Unqualified columns — use where the student-authors table is in scope.
 */
export const UNDERGRAD_TAGS = `student_program IN ('reu', 'student_paper', 'student') AND detection_method <> 'publication_type'`

/**
 * One row per RMBL peer-reviewed publication: year, has_student, has_reu.
 * has_student is the publication's "Undergraduate author" field
 * (undergrad_author, derived by derive-undergrad-authorship.ts from the tags +
 * legacy flag, overridable by an admin); an admin "No" also drops its REU and
 * author counts.
 */
export const STUDENT_PUBS_SQL = `
  SELECT p.id AS publication_id, p.year::int AS year,
         (p.undergrad_author = 'yes') AS has_student,
         (p.undergrad_author = 'yes' AND EXISTS (
            SELECT 1 FROM publication_student_authors s WHERE s.publication_id = p.id AND s.student_program = 'reu')) AS has_reu
    FROM publications p
   WHERE p.rmbl_research = 'yes' AND p.publication_type IN ${PEER_REVIEWED} AND p.year IS NOT NULL`

/** One row per undergraduate-program author tag on an RMBL peer-reviewed publication. */
export const STUDENT_AUTHORS_SQL = `
  SELECT s.publication_id, p.year::int AS year,
         coalesce('a' || s.author_id::text, 'n' || s.author_name) AS person,
         (s.student_program = 'reu') AS reu
    FROM publication_student_authors s
    JOIN publications p ON p.id = s.publication_id
   WHERE p.rmbl_research = 'yes' AND p.publication_type IN ${PEER_REVIEWED} AND p.year IS NOT NULL
     AND p.undergrad_author = 'yes'
     AND ${UNDERGRAD_TAGS}`

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
  studentPubs: number
  studentAuthors: number
  reuPubs: number
  reuAuthors: number
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
       spubs AS (
         SELECT year, count(*) FILTER (WHERE has_student)::int AS pubs, count(*) FILTER (WHERE has_reu)::int AS reu_pubs
           FROM (${STUDENT_PUBS_SQL}) x GROUP BY year
       ),
       sauth AS (
         SELECT year, count(DISTINCT person)::int AS authors, count(DISTINCT person) FILTER (WHERE reu)::int AS reu_authors
           FROM (${STUDENT_AUTHORS_SQL}) x GROUP BY year
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
              coalesce(max(sp.pubs), 0)::int AS student_pubs,
              coalesce(max(sa.authors), 0)::int AS student_authors,
              coalesce(max(sp.reu_pubs), 0)::int AS reu_pubs,
              coalesce(max(sa.reu_authors), 0)::int AS reu_authors
         FROM generate_series($1::int, extract(year FROM now())::int) AS y(year)
         LEFT JOIN arts a ON a.year = y.year
         LEFT JOIN spubs sp ON sp.year = y.year
         LEFT JOIN sauth sa ON sa.year = y.year
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
    studentPubs: r.student_pubs,
    studentAuthors: r.student_authors,
    reuPubs: r.reu_pubs,
    reuAuthors: r.reu_authors,
    reported: {
      articles: get(r.year, 'journal_articles'),
      sfa: get(r.year, 'sfa_articles'),
      undergradAuthors: get(r.year, 'undergrad_authors'),
      undergradArticles: get(r.year, 'articles_with_undergrad'),
    },
  }))
}
