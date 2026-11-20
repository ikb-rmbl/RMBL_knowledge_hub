import Link from 'next/link'
import { getDb } from '../lib/db'
import { listChecklists, type ChecklistSummary } from '@/services/checklists'
import { resolveFieldResources, type ResolvedResource } from '@/services/field-resources'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Checklists & ID Keys — RMBL Knowledge Commons',
  description:
    'Species checklists, identification keys and published floras and faunas for Gothic, the Gunnison Basin and the Elk Mountains — historical lists rescued from the RMBL website with every taxon linked to today\'s name, plus the keys and regional floras held in the Commons.',
}

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '13px' }

function ListCard({ l }: { l: ChecklistSummary }) {
  const unit = l.kind === 'identification_key' ? 'key pages' : 'taxa'
  return (
    <Link href={`/checklists/${l.slug}`} className="result-card" style={{ display: 'block', padding: '14px 16px' }}>
      <div className="result-card-header">
        <span className="badge badge-species">{l.taxon_group}</span>
        <h3 className="result-card-title">{l.title}</h3>
      </div>
      <div className="result-card-meta">
        {l.compiler && <span>{l.compiler}</span>}
        {l.area && <span>{l.area}</span>}
      </div>
      {l.description && <p className="result-card-snippet" style={{ margin: '6px 0' }}>{l.description}</p>}
      <div style={muted}>
        {l.editions.map((e, i) => (
          <span key={e.id}>{i > 0 && ' · '}{e.label}: {e.entries.toLocaleString()} {unit}</span>
        ))}
      </div>
    </Link>
  )
}

function ResourceList({ items }: { items: ResolvedResource[] }) {
  const groups = [...new Set(items.map((r) => r.group))]
  return (
    <>
      {groups.map((g) => (
        <div key={g} style={{ marginTop: '10px' }}>
          <h3 style={{ fontSize: '15px', margin: '0 0 4px' }}>{g}</h3>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {items.filter((r) => r.group === g).map((r) => (
              <li key={`${r.collection}-${r.id}`} style={{ marginBottom: '3px' }}>
                <Link href={r.href}>{r.displayTitle}</Link>
                {r.displayYear && <span style={muted}> ({r.displayYear})</span>}
                {r.hasPdf && <span style={muted}> · PDF</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export default async function ChecklistsPage() {
  const db = getDb()
  const [lists, resources] = await Promise.all([listChecklists(db), resolveFieldResources(db)])
  const { rows: [{ n: species }] } = await db.query(
    `SELECT count(DISTINCT species_id)::int AS n FROM checklist_entries WHERE species_id IS NOT NULL`)
  const checklists = lists.filter((l) => l.kind === 'checklist')
  const keys = lists.filter((l) => l.kind === 'identification_key')
  const keyResources = resources.filter((r) => r.kind === 'key')
  const floras = resources.filter((r) => r.kind === 'flora_fauna')

  return (
    <div className="detail">
      <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 8px' }}>Checklists &amp; ID Keys</h1>
      <p style={{ maxWidth: '72ch', margin: '0 0 6px' }}>
        Species checklists, identification keys and published floras and faunas for Gothic, the Gunnison Basin and the
        Elk Mountains. The checklists and the stonefly key were recovered from RMBL&apos;s website as it stood between
        2000 and 2014 (via the Internet Archive) and are shown as written, historical names included, with every taxon
        linked to its species page under today&apos;s accepted name.
      </p>
      <p style={muted}>
        {checklists.length} checklists and {keys.length + keyResources.length} identification keys;{' '}
        {species.toLocaleString()} species linked; {floras.length} published floras and faunas.
      </p>

      <div className="detail-section">
        <h2>Checklists</h2>
        <div className="result-cards" style={{ marginTop: '12px' }}>
          {checklists.map((l) => <ListCard key={l.id} l={l} />)}
        </div>
      </div>

      <div className="detail-section">
        <h2>Identification keys</h2>
        <div className="result-cards" style={{ marginTop: '12px' }}>
          {keys.map((l) => <ListCard key={l.id} l={l} />)}
        </div>
        {keyResources.length > 0 && (
          <>
            <p style={{ ...muted, marginTop: '12px' }}>More keys in the Commons (publications and documents, not parsed into taxa):</p>
            <ResourceList items={keyResources} />
          </>
        )}
      </div>

      {floras.length > 0 && (
        <div className="detail-section">
          <h2>Published floras and faunas</h2>
          <p style={muted}>Regional floras, bird and mammal lists, and faunal surveys held in the Commons, oldest first.</p>
          <ResourceList items={floras} />
        </div>
      )}
    </div>
  )
}
