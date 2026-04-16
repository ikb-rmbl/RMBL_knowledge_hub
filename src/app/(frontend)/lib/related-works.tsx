import ExpandableRelatedWorks, { type RelatedItem } from '../components/ExpandableRelatedWorks'
import { getDb } from './db'

const SIMILARITY_THRESHOLD = 0.3
const SHARED_ENTITY_MIN = 3      // min shared entities to show as related
const MAX_PER_SIGNAL = 15        // per-signal cap before merging
const MAX_TOTAL = 30              // final list cap

type Signal = 'semantic' | 'shared_entities' | 'coauthor' | 'citation'

interface EnrichedItem extends RelatedItem {
  signals: Signal[]
  sharedEntities?: number
  coauthors?: number
  isCitation?: boolean
}

export async function renderRelatedWorks(
  collection: 'publications' | 'datasets' | 'documents',
  itemId: number,
) {
  const db = getDb()

  // Collect candidates from each signal into a merged map keyed by (type,id)
  const candidates = new Map<string, EnrichedItem>()

  function merge(key: string, item: EnrichedItem) {
    const existing = candidates.get(key)
    if (!existing) {
      candidates.set(key, item)
    } else {
      // Combine signals and keep best scores
      existing.signals = [...new Set([...existing.signals, ...item.signals])]
      existing.similarity = Math.max(existing.similarity, item.similarity)
      if (item.sharedEntities) existing.sharedEntities = Math.max(existing.sharedEntities || 0, item.sharedEntities)
      if (item.coauthors) existing.coauthors = Math.max(existing.coauthors || 0, item.coauthors)
      if (item.isCitation) existing.isCitation = true
    }
  }

  // --- Signal 1: Semantic similarity via embeddings ---
  const { rows: [item] } = await db.query(
    `SELECT embedding FROM ${collection} WHERE id = $1`,
    [itemId],
  )
  if (item?.embedding) {
    const { rows: semantic } = await db.query(`
      (SELECT 'publication' as type, id, title, year, publication_type::text as subtype, journal,
              round((1 - (embedding <=> $1::vector))::numeric, 3) as similarity
       FROM publications WHERE embedding IS NOT NULL AND NOT (id = $2 AND 'publications' = $3)
       ORDER BY embedding <=> $1::vector LIMIT ${MAX_PER_SIGNAL})
      UNION ALL
      (SELECT 'dataset', id, title, publication_year, resource_type::text, NULL,
              round((1 - (embedding <=> $1::vector))::numeric, 3)
       FROM datasets WHERE embedding IS NOT NULL AND NOT (id = $2 AND 'datasets' = $3)
       ORDER BY embedding <=> $1::vector LIMIT ${MAX_PER_SIGNAL})
      UNION ALL
      (SELECT 'document', id, title, NULL::int, NULL::text, NULL,
              round((1 - (embedding <=> $1::vector))::numeric, 3)
       FROM documents WHERE embedding IS NOT NULL AND NOT (id = $2 AND 'documents' = $3)
       ORDER BY embedding <=> $1::vector LIMIT ${MAX_PER_SIGNAL})
    `, [item.embedding, itemId, collection])

    for (const r of semantic) {
      const sim = parseFloat(r.similarity)
      if (sim <= SIMILARITY_THRESHOLD) continue
      merge(`${r.type}-${r.id}`, {
        type: r.type, id: r.id, title: r.title, year: r.year,
        similarity: sim, journal: r.journal, subtype: r.subtype,
        signals: ['semantic'],
      })
    }
  }

  // --- Signal 2: Shared entity mentions ---
  const { rows: sharedRows } = await db.query(`
    WITH my_entities AS (
      SELECT entity_type, entity_id FROM entity_mentions
      WHERE collection = $1 AND item_id = $2
    )
    SELECT em.collection as type, em.item_id as id, count(*)::int as shared
    FROM entity_mentions em
    JOIN my_entities me ON me.entity_type = em.entity_type AND me.entity_id = em.entity_id
    WHERE NOT (em.collection = $1 AND em.item_id = $2)
    GROUP BY em.collection, em.item_id
    HAVING count(*) >= ${SHARED_ENTITY_MIN}
    ORDER BY shared DESC LIMIT ${MAX_PER_SIGNAL * 3}
  `, [collection, itemId])

  if (sharedRows.length > 0) {
    // Fetch titles for the top shared-entity matches
    const pubIds = sharedRows.filter((r: any) => r.type === 'publications').map((r: any) => r.id)
    const dsIds = sharedRows.filter((r: any) => r.type === 'datasets').map((r: any) => r.id)
    const docIds = sharedRows.filter((r: any) => r.type === 'documents').map((r: any) => r.id)

    const [pubTitles, dsTitles, docTitles] = await Promise.all([
      pubIds.length > 0
        ? db.query('SELECT id, title, year, publication_type as subtype, journal FROM publications WHERE id = ANY($1::int[])', [pubIds])
        : { rows: [] },
      dsIds.length > 0
        ? db.query('SELECT id, title, publication_year as year, resource_type as subtype FROM datasets WHERE id = ANY($1::int[])', [dsIds])
        : { rows: [] },
      docIds.length > 0
        ? db.query('SELECT id, title, document_type as subtype FROM documents WHERE id = ANY($1::int[])', [docIds])
        : { rows: [] },
    ])

    const pubMap = new Map(pubTitles.rows.map((r: any) => [r.id, r]))
    const dsMap = new Map(dsTitles.rows.map((r: any) => [r.id, r]))
    const docMap = new Map(docTitles.rows.map((r: any) => [r.id, r]))

    for (const r of sharedRows.slice(0, MAX_PER_SIGNAL)) {
      const typeSingular = r.type === 'publications' ? 'publication' : r.type === 'datasets' ? 'dataset' : 'document'
      const meta = r.type === 'publications' ? pubMap.get(r.id) : r.type === 'datasets' ? dsMap.get(r.id) : docMap.get(r.id)
      if (!meta) continue
      // Use shared entity count as a similarity proxy: log-scaled 0-1
      const simProxy = Math.min(1, Math.log(r.shared + 1) / Math.log(30))
      merge(`${typeSingular}-${r.id}`, {
        type: typeSingular, id: r.id, title: meta.title,
        year: meta.year || null, similarity: simProxy,
        journal: meta.journal || null, subtype: meta.subtype ? String(meta.subtype) : null,
        signals: ['shared_entities'], sharedEntities: r.shared,
      })
    }
  }

  // --- Signal 3: Co-authored works ---
  // Get author IDs for this item via authors_rels (parent_id = author, *_id = item)
  const authorsRelsField = collection === 'publications' ? 'publications_id'
    : collection === 'datasets' ? 'datasets_id'
    : 'documents_id'
  const { rows: authorRows } = await db.query(
    `SELECT DISTINCT parent_id FROM authors_rels WHERE ${authorsRelsField} = $1`,
    [itemId],
  )
  const authorIds = authorRows.map((r: any) => r.parent_id)

  if (authorIds.length > 0) {
    // Note: datasets_creators uses name strings, not author IDs, so we skip datasets here
    const { rows: coauthored } = await db.query(`
      SELECT type, id, title, year, subtype, journal, count(*)::int as shared_authors FROM (
        SELECT 'publication' as type, p.id, p.title, p.year, p.publication_type::text as subtype, p.journal
        FROM publications p
        JOIN authors_rels ar ON ar.publications_id = p.id
        WHERE ar.parent_id = ANY($1::int[]) AND NOT (p.id = $2 AND 'publications' = $3)
        UNION ALL
        SELECT 'document', doc.id, doc.title, NULL::int, doc.document_type::text, NULL
        FROM documents doc
        JOIN authors_rels ar ON ar.documents_id = doc.id
        WHERE ar.parent_id = ANY($1::int[]) AND NOT (doc.id = $2 AND 'documents' = $3)
      ) sub
      GROUP BY type, id, title, year, subtype, journal
      ORDER BY shared_authors DESC LIMIT ${MAX_PER_SIGNAL}
    `, [authorIds, itemId, collection])

    for (const r of coauthored) {
      // Co-authorship signal strength: 0.5-1.0 based on number of shared authors
      const simProxy = Math.min(1, 0.5 + r.shared_authors * 0.15)
      merge(`${r.type}-${r.id}`, {
        type: r.type, id: r.id, title: r.title, year: r.year,
        similarity: simProxy, journal: r.journal, subtype: r.subtype,
        signals: ['coauthor'], coauthors: r.shared_authors,
      })
    }
  }

  // --- Signal 4: Citations (published work cites/cited by this item) ---
  // For documents/publications sourcing external refs, match to internal publications
  // and surface those as citation-linked. Also include publications that cite this item.
  if (collection === 'publications' || collection === 'documents') {
    const sourceCol = collection === 'publications' ? 'source_publication_id' : 'source_document_id'
    // Cited publications with matched target_publication_id
    const { rows: cited } = await db.query(`
      SELECT DISTINCT p.id, p.title, p.year, p.publication_type::text as subtype, p.journal
      FROM references_cited r
      JOIN publications p ON p.id = r.target_publication_id
      WHERE r.${sourceCol} = $1 AND r.target_publication_id IS NOT NULL
      LIMIT ${MAX_PER_SIGNAL}
    `, [itemId])
    for (const r of cited) {
      merge(`publication-${r.id}`, {
        type: 'publication', id: r.id, title: r.title, year: r.year,
        similarity: 0.9, journal: r.journal, subtype: r.subtype,
        signals: ['citation'], isCitation: true,
      })
    }
  }

  if (candidates.size === 0) return null

  // Rank by: (multi-signal bonus + best similarity)
  const ranked = [...candidates.values()].sort((a, b) => {
    const scoreA = a.similarity + a.signals.length * 0.15
    const scoreB = b.similarity + b.signals.length * 0.15
    return scoreB - scoreA
  })

  // Build initial view: top 3 per collection type present in results
  const byType = new Map<string, EnrichedItem[]>()
  for (const itm of ranked) {
    if (!byType.has(itm.type)) byType.set(itm.type, [])
    byType.get(itm.type)!.push(itm)
  }
  const initial: RelatedItem[] = []
  for (const [, items] of byType) initial.push(...items.slice(0, 3))
  initial.sort((a, b) => b.similarity - a.similarity)

  const expanded = ranked.slice(0, MAX_TOTAL)

  return (
    <div className="detail-section">
      <h2>Related Works</h2>
      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
        Items connected by shared entities, co-authorship, citations, or semantic similarity.
      </p>
      <ExpandableRelatedWorks initial={initial} expanded={expanded} />
    </div>
  )
}
