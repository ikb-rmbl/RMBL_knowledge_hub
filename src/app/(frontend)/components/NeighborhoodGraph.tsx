'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { GraphNode, GraphEdge } from '../lib/graph-data'
import { GRAPH_COLORS, ENTITY_TYPE_LABELS } from '../lib/graph-colors'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  focalId: string
}

export default function NeighborhoodGraph({ nodes, edges, focalId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<any>(null)
  const graphRef = useRef<any>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; type: string; degree: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const router = useRouter()

  // Determine which entity types are present in the data
  const presentTypes = useMemo(() => {
    const types = new Set<string>()
    for (const n of nodes) if (!n.isFocal) types.add(n.type)
    return types
  }, [nodes])

  // Filter state: all types visible by default
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  // Apply filters via Sigma's reducers when hiddenTypes changes
  useEffect(() => {
    const renderer = sigmaRef.current
    const graph = graphRef.current
    if (!renderer || !graph) return

    renderer.setSetting('nodeReducer', (node: string, data: any) => {
      if (!graph.hasNode(node)) return { ...data, hidden: true }
      const attrs = graph.getNodeAttributes(node)
      if (attrs.isFocal) return data
      if (hiddenTypes.has(attrs.entityType)) return { ...data, hidden: true }
      return data
    })

    renderer.setSetting('edgeReducer', (edge: string, data: any) => {
      const source = graph.source(edge)
      const target = graph.target(edge)
      const srcAttrs = graph.getNodeAttributes(source)
      const tgtAttrs = graph.getNodeAttributes(target)
      if ((!srcAttrs.isFocal && hiddenTypes.has(srcAttrs.entityType)) ||
          (!tgtAttrs.isFocal && hiddenTypes.has(tgtAttrs.entityType))) {
        return { ...data, hidden: true }
      }
      return data
    })

    renderer.refresh()
  }, [hiddenTypes])

  const initGraph = useCallback(async () => {
    if (!containerRef.current || nodes.length === 0) return

    const { default: Graph } = await import('graphology')
    const { default: Sigma } = await import('sigma')
    const forceAtlas2Module = await import('graphology-layout-forceatlas2')
    const fa2Assign = forceAtlas2Module.default || forceAtlas2Module

    const graph = new Graph()

    // Deduplicate nodes by ID (safety net for duplicate entity_mentions)
    const seenNodeIds = new Set<string>()
    const dedupedNodes = nodes.filter((n) => {
      if (seenNodeIds.has(n.id)) return false
      seenNodeIds.add(n.id)
      return true
    })

    // Seed positions: focal at center, others in a circle by type
    // Nodes with stronger connections to the focal start closer to center
    const nonFocal = dedupedNodes.filter((n) => !n.isFocal)
    const typeOrder = ['species', 'protocol', 'concept', 'author', 'publication', 'dataset', 'document']
    nonFocal.sort((a, b) => {
      const ai = typeOrder.indexOf(a.type), bi = typeOrder.indexOf(b.type)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

    // Build edge weight lookup for seed radius
    const focalWeights = new Map<string, number>()
    const maxWeight = Math.max(1, ...edges.filter((e) => e.source === focalId || e.target === focalId)
      .map((e) => { const nid = e.source === focalId ? e.target : e.source; focalWeights.set(nid, e.weight); return e.weight }))

    for (const node of dedupedNodes) {
      const size = node.isFocal ? 14 : 4 + Math.log(node.degree + 1) * 2
      let x = 0, y = 0
      if (!node.isFocal) {
        const idx = nonFocal.indexOf(node)
        const angle = (idx / nonFocal.length) * 2 * Math.PI
        // Stronger connections start closer to center
        const w = focalWeights.get(node.id) || 1
        const radius = 20 + 60 * (1 - w / maxWeight) + Math.random() * 15
        x = Math.cos(angle) * radius
        y = Math.sin(angle) * radius
      }
      graph.addNode(node.id, {
        label: node.label,
        size,
        color: GRAPH_COLORS[node.type] || '#888',
        x,
        y,
        entityType: node.type,
        degree: node.degree,
        isFocal: node.isFocal,
      })
    }

    // Normalize edge weights: use log scale so citation/author edges (weight 2-3)
    // don't dominate over high-cooccurrence entity edges (weight 5-50)
    const allWeights = edges.map((e) => e.weight)
    const maxEdgeWeight = Math.max(1, ...allWeights)

    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        try {
          const normalizedWeight = 1 + Math.log(edge.weight + 1) / Math.log(maxEdgeWeight + 1) * 2
          graph.addEdge(edge.source, edge.target, {
            weight: normalizedWeight,
            size: Math.max(0.5, Math.log(edge.weight + 1) * 0.5),
            color: edge.source === focalId || edge.target === focalId ? '#999' : '#ddd',
          })
        } catch { /* skip duplicate edges */ }
      }
    }

    fa2Assign(graph, {
      iterations: 150,
      settings: {
        gravity: 0.5,
        scalingRatio: 8,
        strongGravityMode: true,
        barnesHutOptimize: true,
        edgeWeightInfluence: 1,
      },
    })

    // Center the focal node
    const focalAttrs = graph.getNodeAttributes(focalId)
    graph.forEachNode((_node, attrs) => {
      graph.setNodeAttribute(_node, 'x', attrs.x - focalAttrs.x)
      graph.setNodeAttribute(_node, 'y', attrs.y - focalAttrs.y)
    })

    if (sigmaRef.current) sigmaRef.current.kill()

    // Custom label renderer: wraps long labels to multiple lines
    function drawLabel(
      context: CanvasRenderingContext2D,
      data: any,
      settings: any,
    ) {
      if (!data.label) return
      const fontSize = settings.labelSize || 12
      const font = `${settings.labelWeight || '500'} ${fontSize}px ${settings.labelFont || 'sans-serif'}`
      context.font = font
      context.fillStyle = settings.labelColor?.color || '#333'

      const label = data.label as string
      const maxWidth = 160
      const lineHeight = fontSize + 2
      const x = data.x + data.size + 4
      let y = data.y + fontSize / 3

      // Split into words and wrap
      if (context.measureText(label).width <= maxWidth) {
        context.fillText(label, x, y)
        return
      }

      const words = label.split(/\s+/)
      let line = ''
      const lines: string[] = []
      for (const word of words) {
        const test = line ? `${line} ${word}` : word
        if (context.measureText(test).width > maxWidth && line) {
          lines.push(line)
          line = word
        } else {
          line = test
        }
      }
      if (line) lines.push(line)

      // Cap at 3 lines
      if (lines.length > 3) {
        lines.length = 3
        lines[2] = lines[2].slice(0, -3) + '...'
      }

      // Center vertically around the node
      y = data.y - ((lines.length - 1) * lineHeight) / 2 + fontSize / 3
      for (const l of lines) {
        context.fillText(l, x, y)
        y += lineHeight
      }
    }

    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 1,
      defaultEdgeType: 'line',
      labelFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      labelSize: 11,
      labelWeight: '500',
      defaultDrawNodeLabel: drawLabel,
      labelGridCellSize: 80,
      labelDensity: 1,
    } as any)

    sigmaRef.current = renderer
    graphRef.current = graph

    renderer.on('clickNode', ({ node }: { node: string }) => {
      const dashIdx = node.indexOf('-')
      const type = node.slice(0, dashIdx)
      const id = node.slice(dashIdx + 1)
      const slugMap: Record<string, string> = {
        species: 'species', place: 'places', protocol: 'protocols', concept: 'concepts',
        author: 'authors',
        publication: 'publications', publications: 'publications',
        dataset: 'datasets', datasets: 'datasets',
        document: 'documents', documents: 'documents',
      }
      const slug = slugMap[type]
      if (slug) router.push(`/${slug}/${id}`)
    })

    renderer.on('enterNode', ({ node }: { node: string }) => {
      if (!graph.hasNode(node)) return
      const attrs = graph.getNodeAttributes(node)
      const pos = renderer.graphToViewport({ x: attrs.x, y: attrs.y })
      setTooltip({ x: pos.x, y: pos.y, label: attrs.label, type: attrs.entityType, degree: attrs.degree })
      containerRef.current!.style.cursor = 'pointer'
    })

    renderer.on('leaveNode', () => {
      setTooltip(null)
      containerRef.current!.style.cursor = 'default'
    })

    setLoaded(true)
  }, [nodes, edges, focalId, router])

  useEffect(() => {
    initGraph()
    return () => {
      if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null }
      graphRef.current = null
    }
  }, [initGraph])

  if (nodes.length === 0) return null

  // Only show legend entries for types present in data
  const legendTypes = Object.entries(ENTITY_TYPE_LABELS).filter(([type]) => presentTypes.has(type))

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          aspectRatio: '1',
          maxHeight: '700px',
          width: '100%',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
        }}
      />
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x + 10,
          top: tooltip.y - 30,
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <strong>{tooltip.label}</strong>
          <br />
          <span style={{ opacity: 0.7 }}>{ENTITY_TYPE_LABELS[tooltip.type] || tooltip.type} · {tooltip.degree} papers</span>
        </div>
      )}
      {loaded && legendTypes.length > 0 && (
        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', marginTop: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
          {legendTypes.map(([type, label]) => {
            const isHidden = hiddenTypes.has(type)
            return (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', opacity: isHidden ? 0.4 : 1 }}>
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggleType(type)}
                  style={{ accentColor: GRAPH_COLORS[type], width: 14, height: 14, cursor: 'pointer' }}
                />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: GRAPH_COLORS[type], display: 'inline-block' }} />
                {label}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
