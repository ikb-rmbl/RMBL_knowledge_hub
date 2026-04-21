'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { GRAPH_COLORS } from '../lib/graph-colors'

// Color palettes per colorField
const COLOR_PALETTES: Record<string, Record<string, string>> = {
  scope: {
    community_ecology: '#2e7d32', population_ecology: '#388e3c', general_ecology: '#43a047',
    behavioral_ecology: '#4caf50', climate: '#1565c0', hydrology: '#1976d2',
    biogeochemistry: '#0097a7', landscape: '#00838f', evolution: '#e65100',
    molecular: '#d84315', methodological: '#6d4c41',
  },
  kingdom: {
    Animalia: '#1565c0', Plantae: '#2e7d32', Fungi: '#e65100',
    Bacteria: '#d84315', Chromista: '#6d4c41', Protozoa: '#795548',
  },
  category: {
    observational: '#2e7d32', sampling: '#1565c0', experimental: '#e65100',
    measurement: '#0097a7', analytical: '#7b1fa2', computational: '#6d4c41',
    laboratory: '#d84315',
  },
  place_type: {
    study_site: '#2e7d32', town: '#6d4c41', watershed: '#1565c0',
    valley: '#0097a7', stream: '#1976d2', lake: '#0288d1',
    peak: '#795548', meadow: '#43a047', county: '#e65100',
    trail: '#7b1fa2', named_point: '#999', bioregion: '#d84315',
  },
  scale: {
    site: '#2e7d32',
    local: '#1565c0',
    regional: '#e65100',
    state: '#7b1fa2',
    national: '#d84315',
  },
  publication_type: {
    article: '#1565c0', thesis: '#e65100', student_paper: '#2e7d32',
    book: '#7b1fa2', chapter: '#6d4c41', other: '#795548',
  },
  year: {
    // Datasets colored by decade
    '2020s': '#1565c0', '2010s': '#2e7d32', '2000s': '#e65100',
    '1990s': '#7b1fa2', 'older': '#6d4c41',
  },
  research_area: {
    'Life Sciences': '#2e7d32',
    'Earth & Water': '#1565c0',
    'Climate': '#0097a7',
    'Human Dimensions': '#6d4c41',
    'Technology & Data': '#7b1fa2',
    'Education': '#e65100',
    'Other': '#999',
  },
  nodeType: {
    species: '#558b2f',
    concept: '#7b1fa2',
    protocol: '#1565c0',
    author: '#c62828',
    publication: '#3a6b7b',
    dataset: '#7b5a3a',
  },
}

function getColor(colorField: string, value: string): string {
  if (COLOR_PALETTES[colorField]?.[value]) return COLOR_PALETTES[colorField][value]
  // For year-based coloring, bucket into decades
  if (colorField === 'year' && value) {
    const y = parseInt(value)
    if (y >= 2020) return '#1565c0'
    if (y >= 2010) return '#2e7d32'
    if (y >= 2000) return '#e65100'
    if (y >= 1990) return '#7b1fa2'
    return '#6d4c41'
  }
  // Hash-based color for unbounded fields like affiliation
  if (value) {
    let hash = 0
    for (let i = 0; i < value.length; i++) hash = value.charCodeAt(i) + ((hash << 5) - hash)
    const hue = (Math.abs(hash) % 360) / 360
    const sat = 0.55, light = 0.45
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
    const p = 2 * light - q
    const toRgb = (t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }
    const r = Math.round(toRgb(hue + 1/3) * 255)
    const g = Math.round(toRgb(hue) * 255)
    const b = Math.round(toRgb(hue - 1/3) * 255)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  return '#999'
}

interface GraphData {
  entityType: string
  colorField: string
  nodes: any[]
  edges: { source: string; target: string; weight: number }[]
  meta: { nodeCount: number; edgeCount: number }
}

interface Props {
  data: GraphData
  detailSlug: string  // e.g. 'concepts', 'species', 'protocols'
  detailField?: string // which node attribute to show as description (e.g. 'definition', 'description')
  labelField?: string  // secondary label (e.g. 'common_names' for species)
  extraControls?: React.ReactNode // optional controls to render alongside search/slider
}

export default function ExploreEntityGraph({ data, detailSlug, detailField, labelField, extraControls }: Props) {
  // Build a dynamic palette for colorFields not in COLOR_PALETTES (e.g. communityTitle)
  const dynamicPalette = useMemo(() => {
    const cf = data.colorField
    if (COLOR_PALETTES[cf]) return null // static palette exists
    const values = [...new Set(data.nodes.map(n => n[cf]).filter(Boolean))]
    if (values.length === 0) return null
    const GOLDEN_ANGLE = 137.508
    const palette: Record<string, string> = {}
    values.forEach((v, i) => {
      const hue = (i * GOLDEN_ANGLE) % 360
      const sat = (55 + (i % 3) * 10) / 100
      const light = (40 + (i % 4) * 5) / 100
      // Convert HSL to hex (Sigma.js WebGL needs hex, not hsl() strings)
      const h = hue / 360
      const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
      const p = 2 * light - q
      const toRgb = (t: number) => {
        if (t < 0) t += 1; if (t > 1) t -= 1
        if (t < 1/6) return p + (q - p) * 6 * t
        if (t < 1/2) return q
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
        return p
      }
      const r = Math.round(toRgb(h + 1/3) * 255)
      const g = Math.round(toRgb(h) * 255)
      const b = Math.round(toRgb(h - 1/3) * 255)
      palette[v] = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    })
    return palette
  }, [data])

  const resolveColor = useCallback((colorFld: string, value: string) => {
    if (dynamicPalette?.[value]) return dynamicPalette[value]
    return getColor(colorFld, value)
  }, [dynamicPalette])

  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<any>(null)
  const graphRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [minDegree, setMinDegree] = useState(2)
  const [theme, setTheme] = useState('light')

  // Watch for theme changes so graph re-renders with correct edge/label colors
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const t = document.documentElement.getAttribute('data-theme') || 'light'
      setTheme(t)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    setTheme(document.documentElement.getAttribute('data-theme') || 'light')
    return () => observer.disconnect()
  }, [])

  const colorField = data.colorField

  // Collect color field values for legend
  const colorCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of data.nodes) {
      const v = n[colorField] || 'other'
      counts.set(v, (counts.get(v) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [data, colorField, resolveColor])

  const [hiddenColors, setHiddenColors] = useState<Set<string>>(new Set())
  const toggleColor = useCallback((val: string) => {
    setHiddenColors((prev) => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n })
  }, [])

  const filtersRef = useRef({ search, minDegree, hiddenColors })
  filtersRef.current = { search, minDegree, hiddenColors }

  function applyFilters(renderer: any, graph: any, f: typeof filtersRef.current) {
    const q = f.search.toLowerCase()
    renderer.setSetting('nodeReducer', (node: string, d: any) => {
      if (!graph.hasNode(node)) return { ...d, hidden: true }
      const a = graph.getNodeAttributes(node)
      if (a.degree < f.minDegree) return { ...d, hidden: true }
      if (f.hiddenColors.has(a[colorField] || 'other')) return { ...d, hidden: true }
      if (q && !a.label.toLowerCase().includes(q)) return { ...d, color: '#e0e0e0', label: null, size: a.size * 0.5 }
      return d
    })
    renderer.setSetting('edgeReducer', (edge: string, d: any) => {
      const src = graph.source(edge), tgt = graph.target(edge)
      const sa = graph.getNodeAttributes(src), ta = graph.getNodeAttributes(tgt)
      if (sa.degree < f.minDegree || ta.degree < f.minDegree) return { ...d, hidden: true }
      if (f.hiddenColors.has(sa[colorField] || 'other') || f.hiddenColors.has(ta[colorField] || 'other')) return { ...d, hidden: true }
      if (q) {
        const sm = sa.label.toLowerCase().includes(q), tm = ta.label.toLowerCase().includes(q)
        if (!sm && !tm) return { ...d, hidden: true }
        if (sm || tm) return { ...d, color: '#999' }
      }
      return d
    })
    renderer.refresh()
  }

  useEffect(() => {
    const r = sigmaRef.current, g = graphRef.current
    if (r && g) applyFilters(r, g, filtersRef.current)
  }, [search, minDegree, hiddenColors])

  const initGraph = useCallback(async () => {
    if (!containerRef.current || data.nodes.length === 0) return
    const { default: Graph } = await import('graphology')
    const { default: Sigma } = await import('sigma')

    const graph = new Graph()
    for (const node of data.nodes) {
      graph.addNode(node.id, {
        ...node,
        color: resolveColor(colorField, node[colorField]),
      })
    }
    // Theme-aware edge colors — use pre-mixed solid hex (Sigma WebGL ignores rgba alpha)
    const isDark = theme === 'dark'
    // Background RGB to blend toward
    const bgR = isDark ? 26 : 244, bgG = isDark ? 26 : 238, bgB = isDark ? 16 : 228
    // Edge target RGB (what strong edges approach)
    const edgeR = isDark ? 200 : 40, edgeG = isDark ? 195 : 38, edgeB = isDark ? 180 : 30

    // Compute edge weight range for normalization
    let maxWeight = 1
    for (const edge of data.edges) if (edge.weight > maxWeight) maxWeight = edge.weight
    const logMax = Math.log(maxWeight + 1)

    // Sort edges by weight ascending so heavy edges render on top
    const sortedEdges = [...data.edges].sort((a, b) => a.weight - b.weight)

    const seen = new Set<string>()
    for (const edge of sortedEdges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
      const k = `${edge.source}--${edge.target}`
      if (seen.has(k) || seen.has(`${edge.target}--${edge.source}`)) continue
      seen.add(k)
      // Scale size (0.15–2px) and mix edge color from background→foreground by weight
      const logW = Math.log(edge.weight + 1)
      const ratio = logMax > 0 ? logW / logMax : 0
      const size = 0.15 + ratio * 1.85
      // Mix: weak edges = nearly background color, strong = darker/lighter
      const t = 0.03 + ratio * 0.62 // blend factor: 3%–65% toward edge target color
      const r = Math.round(bgR + (edgeR - bgR) * t)
      const g = Math.round(bgG + (edgeG - bgG) * t)
      const b = Math.round(bgB + (edgeB - bgB) * t)
      const color = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
      try { graph.addEdge(edge.source, edge.target, { weight: edge.weight, size, color }) }
      catch {}
    }

    // Custom label renderer: draws a background pill behind each label
    function drawLabel(ctx: CanvasRenderingContext2D, data: any, settings: any) {
      if (!data.label) return
      const size = settings.labelSize
      const font = settings.labelFont
      const weight = settings.labelWeight
      ctx.font = `${weight} ${size}px ${font}`
      const textWidth = ctx.measureText(data.label).width
      const bgX = data.x + data.size + 2
      const bgY = data.y - size / 2 - 1
      const bgW = textWidth + 4
      const bgH = size + 3
      ctx.fillStyle = isDark ? 'rgba(26, 26, 16, 0.88)' : 'rgba(244, 238, 228, 0.88)'
      ctx.beginPath()
      ctx.roundRect(bgX - 2, bgY - 1, bgW, bgH, 2)
      ctx.fill()
      ctx.fillStyle = isDark ? '#F4EEE4' : '#32321E'
      ctx.fillText(data.label, bgX, data.y + size / 3)
    }

    if (sigmaRef.current) sigmaRef.current.kill()
    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false, labelRenderedSizeThreshold: 5, defaultEdgeType: 'line',
      labelFont: 'Jost, "Futura PT", Futura, "Helvetica Neue", Arial, sans-serif',
      labelSize: 11, labelWeight: '500', labelGridCellSize: 150, labelDensity: 0.5,
      defaultDrawNodeLabel: drawLabel,
    } as any)

    sigmaRef.current = renderer
    graphRef.current = graph

    renderer.on('clickNode', ({ node }: { node: string }) => {
      if (!graph.hasNode(node)) return
      const attrs = graph.getNodeAttributes(node)
      const neighborIds = new Set(graph.neighbors(node))
      const neighbors = graph.neighbors(node).map((n: string) => graph.getNodeAttributes(n).label).slice(0, 8)
      setSelectedNode({ id: node, ...attrs, neighborCount: neighborIds.size, topNeighbors: neighbors })

      const f = filtersRef.current
      renderer.setSetting('nodeReducer', (n: string, d: any) => {
        if (!graph.hasNode(n)) return { ...d, hidden: true }
        const a = graph.getNodeAttributes(n)
        if (a.degree < f.minDegree || f.hiddenColors.has(a[colorField] || 'other')) return { ...d, hidden: true }
        if (n === node || neighborIds.has(n)) return d
        return { ...d, color: '#e8e8e8', label: null, size: a.size * 0.4 }
      })
      renderer.setSetting('edgeReducer', (e: string, d: any) => {
        const s = graph.source(e), t = graph.target(e)
        if (s === node || t === node) return { ...d, color: '#999', size: 1 }
        return { ...d, hidden: true }
      })
      renderer.refresh()
    })

    renderer.on('clickStage', () => {
      setSelectedNode(null)
      applyFilters(renderer, graph, filtersRef.current)
    })

    renderer.on('enterNode', () => { containerRef.current!.style.cursor = 'pointer' })
    renderer.on('leaveNode', () => { containerRef.current!.style.cursor = 'default' })

    // Apply initial filters so default threshold takes effect
    applyFilters(renderer, graph, filtersRef.current)

    setLoaded(true)
  }, [data, colorField, resolveColor, theme])

  useEffect(() => {
    initGraph()
    return () => { if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null }; graphRef.current = null }
  }, [initGraph])

  if (data.nodes.length === 0) return <p>No graph data. Run: <code>npx tsx scripts/build-explore-graph.ts --type={data.entityType}</code></p>

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 12px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', width: '220px' }} />
        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Min papers:
          <input type="range" min={1} max={50} value={minDegree} onChange={(e) => setMinDegree(parseInt(e.target.value))} style={{ width: '100px' }} />
          <span style={{ minWidth: '20px' }}>{minDegree}</span>
        </label>
        {extraControls}
      </div>

      <div ref={containerRef} style={{ aspectRatio: '4/3', maxHeight: '80vh', width: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />

      {selectedNode && (
        <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.97)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '14px 18px', fontSize: '13px', maxWidth: '300px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '8px' }}>
            <strong style={{ fontSize: '15px', fontStyle: data.entityType === 'species' ? 'italic' : undefined }}>{selectedNode.label}</strong>
            <button onClick={() => { setSelectedNode(null); applyFilters(sigmaRef.current, graphRef.current, filtersRef.current) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
          </div>
          {labelField && selectedNode[labelField] && (
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
              {Array.isArray(selectedNode[labelField]) ? selectedNode[labelField].slice(0, 3).join(', ') : selectedNode[labelField]}
            </div>
          )}
          <div style={{ color: 'var(--color-text-muted)', marginTop: '4px', fontSize: '12px' }}>
            {(selectedNode[colorField] || '').replace(/_/g, ' ')} · {selectedNode.degree} papers · {selectedNode.neighborCount} connections
          </div>
          {selectedNode.lat && selectedNode.lon && (
            <div style={{ color: 'var(--color-text-muted)', marginTop: '2px', fontSize: '11px' }}>
              {Number(selectedNode.lat).toFixed(4)}, {Number(selectedNode.lon).toFixed(4)}
              {selectedNode.elevation_m && ` · ${selectedNode.elevation_m}m`}
            </div>
          )}
          {detailField && selectedNode[detailField] && (
            <p style={{ marginTop: '8px', fontSize: '12px', lineHeight: 1.4, color: 'var(--color-text-secondary)' }}>
              {String(selectedNode[detailField]).slice(0, 150)}{String(selectedNode[detailField]).length > 150 ? '...' : ''}
            </p>
          )}
          <a href={(() => {
              // For unified graphs, derive slug from node ID prefix or nodeType attribute
              const nt = selectedNode.nodeType || ''
              const slugMap: Record<string, string> = {
                species: 'species', concept: 'concepts', protocol: 'protocols',
                author: 'authors', publication: 'publications', dataset: 'datasets', pub: 'publications',
              }
              const slug = slugMap[nt] || detailSlug
              // For unified graph, IDs are prefixed (e.g. "species-42"), strip the prefix
              const nodeId = selectedNode.id.includes('-') && nt ? selectedNode.id.split('-').slice(1).join('-') : selectedNode.id
              return `/${slug}/${nodeId}`
            })()}
            style={{ display: 'inline-block', marginTop: '10px', fontSize: '12px', color: 'var(--color-accent)', fontWeight: 500 }}>
            View full detail &rarr;
          </a>
        </div>
      )}

      {loaded && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px', fontSize: '11px', alignItems: 'center' }}>
          {colorCounts.filter(([, cnt]) => cnt >= 3).length > 5 && (
            <button onClick={() => {
              // Uncheck all hides every unique value, including small categories
              // not shown in the legend (otherwise their nodes remain visible)
              const allVals = colorCounts.map(([v]) => v)
              setHiddenColors((prev) => prev.size >= allVals.length ? new Set() : new Set(allVals))
            }} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              {hiddenColors.size >= colorCounts.length ? 'Check all' : 'Uncheck all'}
            </button>
          )}
          {colorCounts.filter(([, cnt]) => cnt >= 3).map(([val, cnt]) => {
            const hidden = hiddenColors.has(val)
            return (
              <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', opacity: hidden ? 0.3 : 1 }}>
                <input type="checkbox" checked={!hidden} onChange={() => toggleColor(val)}
                  style={{ accentColor: resolveColor(colorField, val), width: 12, height: 12, cursor: 'pointer' }} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: resolveColor(colorField, val), display: 'inline-block' }} />
                {val.replace(/_/g, ' ')} ({cnt})
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
