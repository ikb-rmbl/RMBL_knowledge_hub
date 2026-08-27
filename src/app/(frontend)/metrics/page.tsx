import type { Metadata } from 'next'
import Link from 'next/link'
import { getDb } from '../lib/db'
import PublicationsMetricsChart, { type MetricsSeries } from '../components/PublicationsMetricsChart'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Publication Metrics — RMBL Knowledge Commons',
  description: 'RMBL publication output over time: RMBL research, student-author publications, and REU publications.',
}

// RMBL was founded in 1928; earlier "years" in the data are entry errors.
const YEAR_MIN = 1928

// Peer-reviewed publication types — the primary metric. Theses and student
// papers are reported separately (they inflate raw publication counts).
const PEER_REVIEWED = `('article', 'chapter', 'book')`

// Colors validated for both site surfaces (dataviz palette checks, light+dark).
const SERIES_META = [
  { key: 'peer', label: 'Peer-reviewed (RMBL research)', color: '#0f7d9e' },
  { key: 'students_theses', label: 'Student papers & theses', color: '#5e8b2f' },
  { key: 'student', label: 'With student authors', color: '#F05028' },
  { key: 'reu', label: 'REU students', color: '#9a4ec4' },
] as const

export default async function MetricsPage() {
  const db = getDb()

  const [{ rows: perYear }, { rows: [totals] }] = await Promise.all([
    db.query(`
      SELECT p.year::int AS year,
             count(*) FILTER (WHERE p.rmbl_research = 'yes' AND p.publication_type IN ${PEER_REVIEWED})::int AS peer,
             count(*) FILTER (WHERE p.publication_type IN ('student_paper', 'thesis'))::int AS students_theses,
             count(*) FILTER (WHERE sa.publication_id IS NOT NULL)::int AS student,
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
        (SELECT count(DISTINCT publication_id) FROM publication_student_authors)::int AS student_pubs,
        (SELECT count(DISTINCT author_id) FROM publication_student_authors WHERE author_id IS NOT NULL)::int AS student_authors,
        (SELECT count(DISTINCT publication_id) FROM publication_student_authors WHERE student_program = 'reu')::int AS reu_pubs
    `),
  ])

  const yearMax = perYear.length > 0 ? perYear[perYear.length - 1].year : new Date().getFullYear()
  const yearMin = perYear.length > 0 ? perYear[0].year : YEAR_MIN

  const haveReuData = totals.reu_pubs > 0
  const series: MetricsSeries[] = SERIES_META
    // hide the REU series until roster data exists — a flat zero line is noise
    .filter((m) => m.key !== 'reu' || haveReuData)
    .map((m) => ({
      ...m,
      values: Object.fromEntries(perYear.map((r: any) => [r.year, r[m.key]])),
    }))

  const tiles = [
    { label: 'Peer-reviewed publications', value: totals.peer.toLocaleString(), note: `RMBL research · ${totals.unreviewed} awaiting review` },
    { label: 'Student papers & theses', value: totals.students_theses.toLocaleString(), note: 'reported separately' },
    { label: 'With student authors', value: totals.student_pubs.toLocaleString(), note: `${totals.student_authors.toLocaleString()} student authors` },
    { label: 'REU publications', value: haveReuData ? totals.reu_pubs.toLocaleString() : '—', note: haveReuData ? undefined : 'awaiting REU cohort roster' },
  ]

  return (
    <div className="detail" style={{ maxWidth: '960px' }}>
      <h1>Publication Metrics</h1>
      <p style={{ color: 'var(--fg-2)', maxWidth: '68ch' }}>
        RMBL publication output over time ({totals.total.toLocaleString()} records in all).
        <strong> Peer-reviewed publications from RMBL research are the primary metric</strong>;
        student papers and theses are reported separately. Student tags come from
        student papers, theses, and manual curation.
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
          <h2 style={{ margin: 0 }}>Publications per year</h2>
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
                {perYear.slice().reverse().map((r: any) => (
                  <tr key={r.year}>
                    <td style={{ padding: '3px 12px 3px 0' }}>{r.year}</td>
                    {series.map((s) => (
                      <td key={s.key} style={{ textAlign: 'right', padding: '3px 12px' }}>{r[s.key]}</td>
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
