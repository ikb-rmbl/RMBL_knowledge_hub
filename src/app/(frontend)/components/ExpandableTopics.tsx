'use client'

import { useState } from 'react'
import Link from 'next/link'

interface TopicItem {
  name: string
  id: string
  count: number
}

export default function ExpandableTopics({ topics }: { topics: TopicItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? topics : topics.slice(0, 8)

  return (
    <>
      <div className="topic-grid">
        {visible.map((topic) => (
          <Link
            key={topic.id}
            className="topic-card"
            href={`/search?topic=${encodeURIComponent(topic.name)}`}
          >
            <div className="topic-card-name">{topic.name}</div>
            <div className="topic-card-count">
              {topic.count} resource{topic.count !== 1 ? 's' : ''}
            </div>
          </Link>
        ))}
      </div>
      {topics.length > 8 && (
        <button
          className="expand-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show fewer topics' : `Show all ${topics.length} topics`}
        </button>
      )}
    </>
  )
}
