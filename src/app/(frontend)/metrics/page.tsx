import type { Metadata } from 'next'
import Link from 'next/link'
import { getDb } from '../lib/db'
import PublicationsMetricsChart, { type MetricsSeries } from '../components/PublicationsMetricsChart'
import { SHOW_STUDENT_AUTHOR_SERIES } from '../lib/feature-flags'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Research Metrics — RMBL Knowledge Commons',
  description:
    'RMBL research output over time: all research outputs (papers + datasets), peer-reviewed RMBL research, student work, and REU publications.',
}

// RMBL was founded in 1928; earlier "years" in the data are entry errors.
const YEAR_MIN = 1928

// Peer-reviewed publication types — the primary metric. Theses and student
// papers are reported separately (they inflate raw publication counts).
const PEER_REVIEWED = `('article', 'chapter', 'book')`

// Colors validated for both site surfaces (dataviz palette checks, light+dark).
// 'all' is a deliberate de-emphasis gray context line, drawn first so the
// colored series sit on top; the rose↔green CVD floor-band pair is covered by
// direct labels + the table view (required secondary encoding).
const SERIES_META = [
  { key: 'all', label: 'All research outputs', color: '#7d7a70' },
  { key: 'peer', label: 'Peer-reviewed (RMBL research)', color: '#0f7d9e' },
  { key: 'students_theses', label: 'Student papers & theses', color: '#5e8b2f' },
  { key: 'datasets', label: 'Datasets', color: '#c05a6e' },
  { key: 'student', label: 'Peer-reviewed w/ student authors', color: '#F05028' },
  { key: 'reu', label: 'REU students', color: '#9a4ec4' },
] as const

export default async function MetricsPage() {
  const db = getDb()

  const [{ rows: perYear }, { rows: [totals] }, { rows: datasetsPerYear }] = await Promise.all([
    db.query(`
      SELECT p.year::int AS year,
             count(*)::int AS pubs_all,
             count(*) FILTER (WHERE p.rmbl_research = 'yes' AND p.publication_type IN ${PEER_REVIEWED})::int AS peer,
             count(*) FILTER (WHERE p.publication_type IN ('student_paper', 'thesis'))::int AS students_theses,
             count(*) FILTER (WHERE sa.publication_id IS NOT NULL AND p.publication_type IN ${PEER_REVIEWED})::int AS student,
             count(*) FILTER (WHERE sa.has_reu)::int AS reu
      FROM publications p
      LEFT JOIN (
        SELECT publication_id, bool_or(student_program = 'reu') AS has_reu
        FROM publication_student_authors GROUP BY publication_id
      ) sa ON sa.publication_id = p.id
      WHERE p.year >= $1 AND p.year <= extract(year FROM now())::int
      GROUP BY p.year ORDER BY p.year
    `, [YEAR_MIN]),
    db.query(`
      SELECT
        (SELECT count(*) FROM publications)::int AS total,
        (SELECT count(*) FROM publications WHERE rmbl_research = 'yes' AND publication_type IN ${PEER_REVIEWED})::int AS peer,
        (SELECT count(*) FROM publications WHERE publication_type IN ('student_paper', 'thesis'))::int AS students_theses,
        (SELECT count(*) FROM publications WHERE rmbl_research IS NULL)::int AS unreviewed,
        (SELECT count(DISTINCT sa.publication_id) FROM publication_student_authors sa
           JOIN publications pp ON pp.id = sa.publication_id
           WHERE pp.publication_type IN ${PEER_REVIEWED})::int AS student_pubs,
        (SELECT count(DISTINCT author_id) FROM publication_student_authors WHERE author_id IS NOT NULL)::int AS student_authors,
        (SELECT count(DISTINCT publication_id) FROM publication_student_authors WHERE student_program = 'reu')::int AS reu_pubs,
        (SELECT count(*) FROM datasets)::int AS datasets_total
    `),
    db.query(
      `SELECT publication_year::int AS year, count(*)::int AS n
       FROM datasets WHERE publication_year >= $1 AND publication_year <= extract(year FROM now())::int
       GROUP BY 1 ORDER BY 1`,
      [YEAR_MIN],
    ),
  ])

  const dsByYear = new Map<number, number>(datasetsPerYear.map((r: any) => [r.year, r.n]))
  const allYears = [...new Set([...perYear.map((r: any) => r.year), ...dsByYear.keys()])].sort()
  const yearMax = allYears.length > 0 ? allYears[allYears.length - 1] : new Date().getFullYear()
  const yearMin = allYears.length > 0 ? allYears[0] : YEAR_MIN

  const pubRow = new Map<number, any>(perYear.map((r: any) => [r.year, r]))
  const valueFor = (key: string, year: number): number => {
    const r = pubRow.get(year)
    if (key === 'all') return (r?.pubs_all ?? 0) + (dsByYear.get(year) ?? 0)
    if (key === 'datasets') return dsByYear.get(year) ?? 0
    return r?.[key] ?? 0
  }

  const haveReuData = totals.reu_pubs > 0
  const series: MetricsSeries[] = SERIES_META
    // hide the REU series until roster data exists — a flat zero line is noise
    .filter((m) => m.key !== 'reu' || haveReuData)
    // student-author series hidden until tagging improves (see feature-flags.ts)
    .filter((m) => m.key !== 'student' || SHOW_STUDENT_AUTHOR_SERIES)
    .map((m) => ({
      ...m,
      values: Object.fromEntries(allYears.map((y) => [y, valueFor(m.key, y)])),
    }))

  const tiles = [
    { label: 'All research outputs', value: (totals.total + totals.datasets_total).toLocaleString(), note: `${totals.total.toLocaleString()} papers + ${totals.datasets_total.toLocaleString()} datasets, all provenances` },
    { label: 'Peer-reviewed publications', value: totals.peer.toLocaleString(), note: `RMBL research · ${totals.unreviewed} awaiting review` },
    { label: 'Datasets', value: totals.datasets_total.toLocaleString(), note: 'RMBL / non-RMBL split pending a dataset provenance flag' },
    { label: 'Student papers & theses', value: totals.students_theses.toLocaleString(), note: 'reported separately' },
    { label: 'Peer-reviewed w/ student authors', value: totals.student_pubs.toLocaleString(), note: 'tagging incomplete — trend not yet chartable' },
    { label: 'REU publications', value: haveReuData ? totals.reu_pubs.toLocaleString() : '—', note: haveReuData ? undefined : 'awaiting REU cohort roster' },
  ]

  return (
    <div className="detail" style={{ maxWidth: '960px' }}>
      <h1>Research Metrics</h1>
      <p style={{ color: 'var(--fg-2)', maxWidth: '68ch' }}>
        RMBL research output over time — papers and datasets.
        <strong> Peer-reviewed publications from RMBL research are the primary metric</strong>;
        student papers and theses are reported separately, and &ldquo;all research
        outputs&rdquo; counts every paper and dataset in the Commons regardless of
        provenance. Datasets are not yet split by RMBL vs. non-RMBL origin (a dataset
        provenance flag is planned). Student authorship on peer-reviewed papers is
        inferred from student papers and theses plus manual curation.
      </p>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', margin: '20px 0 28px' }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: 'var(--color-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--fg-1)', lineHeight: 1.1 }}>{t.value}</div>
            <div style={{ fontSize: '13px', color: 'var(--fg-2)', marginTop: '4px' }}>{t.label}</div>
            {t.note && <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{t.note}</div>}
          </div>
        ))}
      </div>

      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ margin: 0 }}>Research outputs per year</h2>
          <a href="/metrics/csv" style={{ fontSize: '13px', color: 'var(--accent)' }}>Download CSV</a>
        </div>
        <div style={{ marginTop: '16px' }}>
          <PublicationsMetricsChart series={series} yearMin={yearMin} yearMax={yearMax} />
        </div>

        {/* Table view — every charted value reachable without hovering */}
        <details style={{ marginTop: '16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '14px', color: 'var(--fg-2)' }}>Data table</summary>
          <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 12px 4px 0', borderBottom: '1px solid var(--border)' }}>Year</th>
                  {series.map((s) => (
                    <th key={s.key} style={{ textAlign: 'right', padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allYears.slice().reverse().map((y) => (
                  <tr key={y}>
                    <td style={{ padding: '3px 12px 3px 0' }}>{y}</td>
                    {series.map((s) => (
                      <td key={s.key} style={{ textAlign: 'right', padding: '3px 12px' }}>{valueFor(s.key, y)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', maxWidth: '68ch' }}>
        Review queue: <Link href="/search?type=publications">discovered publications</Link> without an
        RMBL-research determination are triaged in the admin panel. REU counts appear once the
        cohort roster is loaded.
      </p>
    </div>
  )
}
