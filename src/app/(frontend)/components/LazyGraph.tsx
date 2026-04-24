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
  const focalNode = props.nodes.find(n => n.id === props.focalId)
  const topNodes = props.nodes.filter(n => !n.isFocal).sort((a, b) => b.degree - a.degree).slice(0, 5)
  const description = `Knowledge graph centered on ${focalNode?.label || 'entity'} with ${props.nodes.length} nodes and ${props.edges.length} connections. Top connected: ${topNodes.map(n => n.label).join(', ')}.`

  return (
    <>
      <NeighborhoodGraph {...props} />
      <p className="sr-only">{description}</p>
    </>
  )
}
