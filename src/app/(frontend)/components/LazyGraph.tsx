'use client'

import dynamic from 'next/dynamic'
import type { GraphNode, GraphEdge } from '../lib/graph-data'

const NeighborhoodGraph = dynamic(() => import('./NeighborhoodGraph'), {
  ssr: false,
  loading: () => <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>Loading graph...</div>,
})

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  focalId: string
}

export default function LazyGraph(props: Props) {
  return <NeighborhoodGraph {...props} />
}
