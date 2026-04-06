import ExpandableRelatedWorks, { type RelatedItem } from '../components/ExpandableRelatedWorks'
import { getDb } from './db'

const SIMILARITY_THRESHOLD = 0.3

export async function renderRelatedWorks(
  collection: 'publications' | 'datasets' | 'documents',
  itemId: number,
) {
  const db = getDb()

  // Get the embedding for this item
  const { rows: [item] } = await db.query(
    `SELECT embedding FROM ${collection} WHERE id = $1`,
    [itemId],
  )
  if (!item?.embedding) return null

  // Fetch top 10 per collection (30 total) for the expanded view
  const { rows } = await db.query(`
    (SELECT 'publication' as type, id, title, year, publication_type::text as subtype, journal,
            round((1 - (embedding <=> $1::vector))::numeric, 3) as similarity
     FROM publications WHERE embedding IS NOT NULL AND NOT (id = $2 AND 'publications' = $3)
     ORDER BY embedding <=> $1::vector LIMIT 10)
    UNION ALL
    (SELECT 'dataset', id, title, publication_year, resource_type::text, NULL,
            round((1 - (embedding <=> $1::vector))::numeric, 3)
     FROM datasets WHERE embedding IS NOT NULL AND NOT (id = $2 AND 'datasets' = $3)
     ORDER BY embedding <=> $1::vector LIMIT 10)
    UNION ALL
    (SELECT 'document', id, title, NULL::int, NULL::text, NULL,
            round((1 - (embedding <=> $1::vector))::numeric, 3)
     FROM documents WHERE embedding IS NOT NULL AND NOT (id = $2 AND 'documents' = $3)
     ORDER BY embedding <=> $1::vector LIMIT 10)
    ORDER BY similarity DESC
  `, [item.embedding, itemId, collection])

  // Filter by similarity threshold
  const all: RelatedItem[] = rows
    .filter((r: any) => r.similarity > SIMILARITY_THRESHOLD)
    .map((r: any) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      year: r.year,
      similarity: parseFloat(r.similarity),
      journal: r.journal,
      subtype: r.subtype,
    }))

  if (all.length === 0) return null

  // Build initial view: top 3 per collection type present in results
  const byType = new Map<string, RelatedItem[]>()
  for (const item of all) {
    if (!byType.has(item.type)) byType.set(item.type, [])
    byType.get(item.type)!.push(item)
  }

  const initial: RelatedItem[] = []
  for (const [, items] of byType) {
    initial.push(...items.slice(0, 3))
  }
  initial.sort((a, b) => b.similarity - a.similarity)

  // Expanded view: all items up to 30
  const expanded = all.slice(0, 30)

  return (
    <div className="detail-section">
      <h2>Related Works</h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
        Conceptually similar items across the Knowledge Hub
      </p>
      <ExpandableRelatedWorks initial={initial} expanded={expanded} />
    </div>
  )
}
