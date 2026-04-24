/**
 * Related works rendering — delegates data fetching to the related service.
 */

import ExpandableRelatedWorks, { type RelatedItem } from '../components/ExpandableRelatedWorks'
import { getDb } from './db'
import { getRelatedWorks } from '@/services/related'

export async function renderRelatedWorks(
  collection: 'publications' | 'datasets' | 'documents',
  itemId: number,
) {
  const result = await getRelatedWorks(getDb(), collection, itemId)

  if (result.initial.length === 0) return null

  // Cast to component's RelatedItem type (service uses typed Signal union, component uses string[])
  const initial = result.initial as RelatedItem[]
  const expanded = result.expanded as RelatedItem[]

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
