'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getBadgeLabel, getBadgeClass } from '../lib/badges'

export interface RelatedItem {
  type: string
  id: number
  title: string
  year: number | null
  similarity: number
  journal: string | null
  subtype: string | null
}

const hrefMap: Record<string, string> = {
  publication: '/publications',
  dataset: '/datasets',
  document: '/documents',
}

export default function ExpandableRelatedWorks({
  initial,
  expanded: expandedItems,
}: {
  initial: RelatedItem[]
  expanded: RelatedItem[]
}) {
  const [showAll, setShowAll] = useState(false)
  const items = showAll ? expandedItems : initial
  const hasMore = expandedItems.length > initial.length

  if (items.length === 0) return null

  return (
    <>
      <div className="result-list">
        {items.map((row) => (
          <Link
            key={`${row.type}-${row.id}`}
            className="result-card"
            href={`${hrefMap[row.type]}/${row.id}`}
          >
            <div className="result-card-header">
              <span className={getBadgeClass(row.type as any)}>
                {getBadgeLabel(row.type as any, row.subtype)}
              </span>
              <h3 className="result-card-title">{row.title}</h3>
            </div>
            <div className="result-card-meta">
              {row.year && <span>{row.year}</span>}
              {row.journal && <span>{row.journal}</span>}
              <span style={{ color: 'var(--color-text-muted)' }}>
                {Math.round(row.similarity * 100)}% similar
              </span>
            </div>
          </Link>
        ))}
      </div>
      {hasMore && (
        <button
          className="expand-toggle"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show fewer' : `Show all ${expandedItems.length} related works`}
        </button>
      )}
    </>
  )
}
