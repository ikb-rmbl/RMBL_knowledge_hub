import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { compareEditions, getChecklist, getEntries, type Entry } from '@/services/checklists'
import { resolveFieldResources } from '@/services/field-resources'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = await getChecklist(getDb(), slug)
  if (!data) return { title: 'Checklist — RMBL Knowledge Commons' }
  return {
    title: `${data.checklist.title} — RMBL Knowledge Commons`,
    description: data.checklist.description ?? undefined,
  }
}

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '13px' }
const chip = (active: boolean): React.CSSProperties => ({
  padding: '5px 10px', borderRadius: 'var(--radius-sm)', fontSize: '12px', textDecoration: 'none',
  background: active ? 'var(--color-accent)' : 'var(--color-surface)', color: active ? '#fff' : 'inherit',
  border: '1px solid var(--color-border)',
})

/** First two words of a scientific name, for "is the link to a different name?" */
const binomial = (s: string | null) => (s ?? '').split(/\s+/).slice(0, 2).join(' ').toLowerCase()

function EntryName({ e, commonOnly }: { e: Entry; commonOnly: boolean }) {
  const written = commonOnly ? <span>{e.verbatim_name}</span> : <em>{e.verbatim_name}</em>
  const renamed = e.species_name && (commonOnly || binomial(e.species_name) !== binomial(e.verbatim_name))
  return (
    <>
      {e.species_id ? <Link href={`/species/${e.species_id}`}>{written}</Link> : written}
      {e.authority && !commonOnly && <span style={muted}> {e.authority}</span>}
      {e.common_name && !commonOnly && <span> — {e.common_name}</span>}
      {renamed && (
        <span style={muted}>
          {' '}→ <Link href={`/species/${e.species_id}`}><em>{e.species_name}</em></Link>
        </span>
      )}
      {e.page_document_id && <span style={muted}> · <Link href={`/documents/${e.page_document_id}`}>key page</Link></span>}
    </>
  )
}

function EntryNotes({ e }: { e: Entry }) {
  const d = e.details ?? {}
  const parts: string[] = []
  if (Array.isArray(d.status) && d.status.length) parts.push(d.status.join('; '))
  if (d.elev_min_ft || d.elev_max_ft) parts.push(`${d.elev_min_ft?.toLocaleString() ?? '?'}–${d.elev_max_ft?.toLocaleString() ?? '?'} ft`)
  if (Array.isArray(d.vegetation) && d.vegetation.length) parts.push(d.vegetation.join(', '))
  if (d.n_collections) parts.push(`${d.n_collections} collection${d.n_collections === 1 ? '' : 's'}`)
  if (e.remarks) parts.push(e.remarks.replace(/^\(|\)$/g, ''))
  return parts.length ? <div style={muted}>{parts.join(' · ')}</div> : null
}

export default async function ChecklistDetail({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const db = getDb()
  const data = await getChecklist(db, slug)
  if (!data) notFound()
  const { checklist, editions } = data
  if (editions.length === 0) notFound()

  const commonOnly = checklist.taxon_group === 'birds'
  const showChanges = sp.view === 'changes' && editions.length > 1
  const requested = Number(sp.edition)
  const edition = editions.find((e) => e.id === requested) ?? editions[editions.length - 1]
  const entries = await getEntries(db, edition.id)
  const published = await resolveFieldResources(db, { checklist: slug })
  const q = (sp.q ?? '').trim().toLowerCase()
  const shown = q
    ? entries.filter((e) => [e.verbatim_name, e.common_name, e.species_name, e.family, e.group_heading].some((v) => v?.toLowerCase().includes(q)))
    : entries
  const linked = entries.filter((e) => e.species_id).length
  const legend = Object.entries((checklist.legend ?? {}) as Record<string, string>)

  // Group in list order by the heading the list itself uses.
  const groups: { heading: string; items: Entry[] }[] = []
  for (const e of shown) {
    const heading = e.group_heading || e.family || e.higher_group || ''
    if (!groups.length || groups[groups.length - 1].heading !== heading) groups.push({ heading, items: [] })
    groups[groups.length - 1].items.push(e)
  }

  let changes: ReturnType<typeof compareEditions> = []
  if (showChanges) {
    const first = await getEntries(db, editions[0].id)
    const last = await getEntries(db, editions[editions.length - 1].id)
    changes = compareEditions(first, last)
  }

  return (
    <div className="detail">
      <Link href="/checklists" className="detail-back">&larr; Checklists &amp; ID Keys</Link>
      <span className="badge badge-species">{checklist.taxon_group}</span>
      <h1>{checklist.title}</h1>

      <div className="detail-meta">
        {checklist.compiler && <div><strong>Compiled by:</strong> {checklist.compiler}</div>}
        {checklist.area && <div><strong>Area:</strong> {checklist.area}</div>}
        {edition.taxonomy && !showChanges && <div><strong>Taxonomy:</strong> {edition.taxonomy}</div>}
        <div>
          <strong>Source:</strong> RMBL website, recovered from the Internet Archive
          {checklist.kind === 'identification_key' && !showChanges ? (
            <>
              {' — '}{edition.copies.length} key pages; front matter:{' '}
              {edition.copies.filter((c) => !entries.some((e) => e.page_document_id === c.id)).map((c, i) => (
                <span key={c.id}>{i > 0 && ', '}<Link href={`/documents/${c.id}`}>{c.title.split(':')[0]}</Link></span>
              ))}
            </>
          ) : edition.copies.length > 0 && !showChanges && (
            <>
              {' — '}
              {edition.copies.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link href={`/documents/${c.id}`}>{c.title}{c.date ? ` (${c.date.slice(0, 4)})` : ''}</Link>
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {checklist.description && <p style={{ maxWidth: '72ch' }}>{checklist.description}</p>}
      {(['edition', 'related'] as const).map((rel) => {
        const items = published.filter((r) => (r.relation ?? 'related') === rel)
        if (!items.length) return null
        return (
          <p key={rel} style={muted}>
            {rel === 'edition' ? 'Published edition' : 'Related publication'}:{' '}
            {items.map((r, i) => (
              <span key={r.id}>{i > 0 && '; '}<Link href={r.href}>{r.displayTitle}</Link>{r.displayYear ? ` (${r.displayYear})` : ''}</span>
            ))}
          </p>
        )
      })}

      {editions.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '12px 0' }}>
          {editions.map((e) => (
            <Link key={e.id} href={`/checklists/${slug}?edition=${e.id}`} style={chip(!showChanges && e.id === edition.id)}>{e.label}</Link>
          ))}
          <Link href={`/checklists/${slug}?view=changes`} style={chip(showChanges)}>
            What changed: {editions[0].label} → {editions[editions.length - 1].label}
          </Link>
        </div>
      )}

      {legend.length > 0 && (
        <details style={{ margin: '8px 0 12px' }}>
          <summary style={muted}>Codes used in this list</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '13px' }}>
            {legend.map(([k, v]) => <li key={k}><strong>{k}</strong> {v}</li>)}
          </ul>
        </details>
      )}

      {showChanges ? (
        <ChangesView changes={changes} commonOnly={commonOnly} from={editions[0].label} to={editions[editions.length - 1].label} />
      ) : (
        <>
          <form action={`/checklists/${slug}`} method="GET" className="search-form" style={{ margin: '12px 0' }}>
            {sp.edition && <input type="hidden" name="edition" value={sp.edition} />}
            <input className="search-input" type="text" name="q" defaultValue={sp.q ?? ''} aria-label="Filter this list" placeholder="Filter by name or family…" />
            <button className="search-button" type="submit">Filter</button>
          </form>
          <p style={muted}>
            {edition.label}: {entries.length.toLocaleString()} taxa, {linked.toLocaleString()} linked to species pages.
            {q && ` Showing ${shown.length} matching “${sp.q}”.`} Names are shown as written; an arrow gives today&apos;s accepted name where it differs.
          </p>
          {groups.map((g, i) => (
            <div key={`${g.heading}-${i}`} className="detail-section" style={{ marginTop: '14px' }}>
              {g.heading && <h2 style={{ fontSize: '16px' }}>{g.heading}</h2>}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {g.items.map((e) => (
                  <li key={e.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <EntryName e={e} commonOnly={commonOnly} />
                    {e.status_codes && <span style={{ ...muted, marginLeft: '6px', fontFamily: 'monospace' }}>{e.status_codes}</span>}
                    <EntryNotes e={e} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ChangesView({ changes, commonOnly, from, to }: {
  changes: ReturnType<typeof compareEditions>; commonOnly: boolean; from: string; to: string
}) {
  const sections: { kind: string; title: string }[] = [
    { kind: 'added', title: `Added in ${to}` },
    { kind: 'dropped', title: `Not in ${to}` },
    { kind: 'renamed', title: 'Renamed' },
    { kind: 'status', title: 'Status changed' },
  ]
  return (
    <>
      <p style={muted}>
        Taxa are compared by species, so a name change shows as renamed rather than as one taxon dropped and another added.
        Comparing {from} with {to}.
      </p>
      {sections.map(({ kind, title }) => {
        const items = changes.filter((c) => c.kind === kind)
        if (!items.length) return null
        return (
          <div key={kind} className="detail-section">
            <h2>{title} ({items.length})</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((c, i) => (
                <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                  {kind === 'status' ? (
                    <>
                      <EntryName e={c.after!} commonOnly={commonOnly} />
                      <span style={{ ...muted, fontFamily: 'monospace' }}> {c.before?.status_codes || '—'} → {c.after?.status_codes || '—'}</span>
                    </>
                  ) : (
                    <>
                      {c.before && <EntryName e={c.before} commonOnly={commonOnly} />}
                      {c.before && c.after && <span style={muted}> ⟶ </span>}
                      {c.after && <EntryName e={c.after} commonOnly={commonOnly} />}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}
