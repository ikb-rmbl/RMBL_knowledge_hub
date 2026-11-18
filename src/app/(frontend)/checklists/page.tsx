import Link from 'next/link'
import { getDb } from '../lib/db'
import { listChecklists } from '@/services/checklists'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Species Checklists — RMBL Knowledge Commons',
  description:
    'Historical species checklists for Gothic and the Gunnison Basin — birds, vascular plants, mammals, butterflies, mushrooms, amphibians and reptiles — rescued from the RMBL website archive, with each taxon linked to today\'s name.',
}

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '13px' }

export default async function ChecklistsPage() {
  const db = getDb()
  const lists = await listChecklists(db)
  const { rows: [{ n: species }] } = await db.query(
    `SELECT count(DISTINCT species_id)::int AS n FROM checklist_entries WHERE species_id IS NOT NULL`)

  return (
    <div className="detail">
      <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 8px' }}>Species Checklists</h1>
      <p style={{ maxWidth: '72ch', margin: '0 0 6px' }}>
        Checklists that RMBL researchers compiled for Gothic and the Gunnison Basin, recovered from the lab&apos;s
        website as it stood between 2000 and 2014 (via the Internet Archive). Each list is shown as written — historical
        names included — with every taxon linked to its species page under today&apos;s accepted name.
      </p>
      <p style={muted}>
        {lists.length} lists naming {species.toLocaleString()} species. Lists that were revised appear with each edition, so
        you can see what changed.
      </p>

      <div className="result-cards" style={{ marginTop: '16px' }}>
        {lists.map((l) => (
          <Link key={l.id} href={`/checklists/${l.slug}`} className="result-card" style={{ display: 'block', padding: '14px 16px' }}>
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
                <span key={e.id}>
                  {i > 0 && ' · '}
                  {e.label}: {e.entries.toLocaleString()} taxa
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
