/**
 * Build a large-format SVG poster of the RMBL Knowledge Fabric research-only
 * knowledge network. The graph centerpiece colors nodes by their type
 * (species, concept, author, etc.) and uses soft fuzzy hulls to delineate
 * each Louvain-detected neighborhood. Three sidebar/footer panels surround
 * the graph: About, How to use, Roadmap.
 *
 * Hand-edit the resulting SVG in Inkscape / Affinity / Illustrator before
 * printing.
 *
 * Inputs:
 *   public/graph/unified-research.json — nodes with x/y/community/nodeType
 *   public/graph/communities.json      — community labels
 *
 * Output:
 *   public/poster.svg
 *
 * Defaults: A0 portrait, color-by-nodetype, fuzzy convex hulls per community.
 *
 * Usage:
 *   npx tsx scripts/build-poster-svg.ts
 *   npx tsx scripts/build-poster-svg.ts --landscape
 *   npx tsx scripts/build-poster-svg.ts --size=A1
 *   npx tsx scripts/build-poster-svg.ts --color-by=community
 *   npx tsx scripts/build-poster-svg.ts --no-hulls
 *   npx tsx scripts/build-poster-svg.ts --hull-label-top=30
 */

import { readFileSync, writeFileSync } from 'fs'

const args = process.argv.slice(2)
const landscape = args.includes('--landscape')
const sizeArg = args.find((a) => a.startsWith('--size='))?.split('=')[1] || 'A0'
const colorBy = (args.find((a) => a.startsWith('--color-by='))?.split('=')[1] as 'nodetype' | 'community') || 'nodetype'
const drawHulls = !args.includes('--no-hulls')
const useKde = args.includes('--use-kde')
const kdeBandwidth = parseFloat(args.find((a) => a.startsWith('--kde-bandwidth='))?.split('=')[1] || '18')
const kdeThreshold = parseFloat(args.find((a) => a.startsWith('--kde-threshold='))?.split('=')[1] || '0.25')
const kdeKeep = parseInt(args.find((a) => a.startsWith('--kde-keep='))?.split('=')[1] || '1', 10)
const hullLabelTop = parseInt(args.find((a) => a.startsWith('--hull-label-top='))?.split('=')[1] || '24', 10)
const satellitesEnabled = !args.includes('--no-satellites')
const satelliteCell = parseFloat(args.find((a) => a.startsWith('--satellite-cell='))?.split('=')[1] || '96')
const satelliteCount = parseInt(args.find((a) => a.startsWith('--satellites='))?.split('=')[1] || '24', 10)
const nodeLabelsPerCommunity = parseInt(args.find((a) => a.startsWith('--node-labels='))?.split('=')[1] || '10', 10)
const labelDensityArg = args.find((a) => a.startsWith('--labels-per-community='))?.split('=')[1]
const labelsPerCommunity = labelDensityArg ? parseInt(labelDensityArg, 10) : 0  // default off when hulls drawn

const PAPER: Record<string, [number, number]> = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
}
const portrait = PAPER[sizeArg] || PAPER.A0
const W = landscape ? portrait[1] : portrait[0]
const H = landscape ? portrait[0] : portrait[1]

// Layout regions (mm)
const MARGIN = 24
const TITLE_H = 70
const TITLE_GAP = 14
const SUBTITLE_H = 14
const FOOTER_H = 260
const FOOTER_GAP = 18
const SATELLITE_TITLE_H = 12
const SATELLITE_FOOTER_H = 5

// Elliptical satellite layout: satellites are placed at evenly-spaced angles
// on an ellipse that hugs the page edges. Central graph fits inside the
// inscribed rectangle (constrained by the cells at the diagonal angles).
const frameAreaY = MARGIN + TITLE_H + TITLE_GAP + SUBTITLE_H + 10
const frameAreaH = H - frameAreaY - FOOTER_H - FOOTER_GAP - MARGIN
const frameAreaW = W - 2 * MARGIN

const totalSatellites = satellitesEnabled ? satelliteCount : 0
const ringCx = MARGIN + frameAreaW / 2
const ringCy = frameAreaY + frameAreaH / 2
const ringRx = frameAreaW / 2 - satelliteCell / 2
const ringRy = frameAreaH / 2 - satelliteCell / 2

// Inner rectangle expands well past the inscribed-square (1/√2 × Rx). At
// this size the diagonal cells overlap the central graph corners, but
// satellites are frameless + drawn last, so they layer cleanly on top.
const innerInsetRatio = parseFloat(args.find((a) => a.startsWith('--inner-inset-ratio='))?.split('=')[1] || '0.80')
const innerHalfW = satellitesEnabled ? Math.max(80, ringRx * innerInsetRatio) : frameAreaW / 2
const innerHalfH = satellitesEnabled ? Math.max(80, ringRy * innerInsetRatio) : frameAreaH / 2
const graphX = ringCx - innerHalfW
const graphY = ringCy - innerHalfH
const graphW = innerHalfW * 2
const graphH = innerHalfH * 2

// Largest neighborhoods first; index 0 starts at the top and proceeds clockwise.
function satelliteCellAt(idx: number): { x: number; y: number; w: number; h: number } | null {
  if (!satellitesEnabled || idx < 0 || idx >= totalSatellites) return null
  const angle = -Math.PI / 2 + (2 * Math.PI * idx) / totalSatellites
  const cx = ringCx + ringRx * Math.cos(angle)
  const cy = ringCy + ringRy * Math.sin(angle)
  return { x: cx - satelliteCell / 2, y: cy - satelliteCell / 2, w: satelliteCell, h: satelliteCell }
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

interface Node {
  id: string
  label: string
  nodeType: string
  community: number
  communityLabel: string | null
  degree: number
  size: number
  x: number
  y: number
}
interface Edge { source: string; target: string; weight: number }

const unified = JSON.parse(readFileSync('public/graph/unified-research.json', 'utf-8'))
const nodes: Node[] = unified.nodes
const edges: Edge[] = unified.edges
console.log(`Loaded ${nodes.length} nodes, ${edges.length} edges`)

let communityMeta = new Map<number, { label: string }>()
try {
  const cdata = JSON.parse(readFileSync('public/graph/communities.json', 'utf-8'))
  for (const c of cdata.communities || []) communityMeta.set(c.id, { label: c.title || c.label })
} catch {
  console.log('Note: communities.json not found.')
}

// ---------------------------------------------------------------------------
// Color palettes
// ---------------------------------------------------------------------------

// Node-type palette aligns with the web app's badge colors (see styles.css).
// CMYK-friendly: medium saturation, distinct hues, mid-luminance.
const NODE_TYPE_COLOR: Record<string, string> = {
  publication: '#3A6B7B',  // teal-blue
  dataset:     '#A86A2A',  // amber
  document:    '#6B7A4A',  // olive
  story:       '#7A4A6B',  // mauve
  species:     '#558B2F',  // forest
  place:       '#6D4C41',  // brown
  protocol:    '#1565C0',  // royal blue
  concept:     '#7B1FA2',  // purple
  author:      '#5D6A4A',  // gray-olive
  stakeholder: '#9A7B5A',  // tan
}
const NEUTRAL_GRAY = '#7A7765'

// Community palette (used only if --color-by=community)
const COMMUNITY_PALETTE = [
  '#F05028', '#3a6b7b', '#6B7A4A', '#7b5a3a', '#7a4a6b',
  '#B48BC9', '#D4B947', '#8AA9B8', '#558B2F', '#1565C0',
  '#7B1FA2', '#5D6A4A', '#3a7b6b', '#a85a2a', '#D97760',
  '#A89768', '#6D4C41', '#26A69A', '#EF6C00', '#5E35B1',
]
const communityById = new Map<number, number>()
const sortedComm = [...new Set(nodes.map((n) => n.community).filter((c) => c >= 0))]
  .map((c) => ({ c, n: nodes.filter((x) => x.community === c).length }))
  .sort((a, b) => b.n - a.n)
sortedComm.forEach((s, i) => communityById.set(s.c, i))

function nodeColor(n: Node): string {
  if (colorBy === 'community') {
    if (n.community === undefined || n.community < 0) return NEUTRAL_GRAY
    return COMMUNITY_PALETTE[(communityById.get(n.community) || 0) % COMMUNITY_PALETTE.length]
  }
  return NODE_TYPE_COLOR[n.nodeType] || NEUTRAL_GRAY
}

// ---------------------------------------------------------------------------
// Scale graph coords to the centerpiece rectangle
// ---------------------------------------------------------------------------

const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y)
const xMin = Math.min(...xs), xMax = Math.max(...xs)
const yMin = Math.min(...ys), yMax = Math.max(...ys)
const dataW = xMax - xMin, dataH = yMax - yMin
const scale = Math.min(graphW / dataW, graphH / dataH) * 0.95
const offsetX = graphX + (graphW - dataW * scale) / 2 - xMin * scale
const offsetY = graphY + (graphH - dataH * scale) / 2 - yMin * scale

function sx(x: number) { return offsetX + x * scale }
function sy(y: number) { return offsetY + y * scale }

// ---------------------------------------------------------------------------
// Convex hull (Andrew's monotone chain). Pure 2D in screen coords.
// ---------------------------------------------------------------------------

function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts.slice()
  const sorted = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y))
  const cross = (O: any, A: any, B: any) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x)
  const lower: any[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: any[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  const n = pts.length
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }
}

// ---------------------------------------------------------------------------
// 2D Gaussian KDE + marching squares for organic, possibly multi-lobed
// neighborhood boundaries. Used when --use-kde is set.
// ---------------------------------------------------------------------------

interface Grid { values: Float64Array; W: number; H: number; cellW: number; cellH: number; minX: number; minY: number }

function kde2d(
  pts: { x: number; y: number }[],
  bandwidth: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  gridSize: number,
): Grid {
  const cellW = (bounds.maxX - bounds.minX) / gridSize
  const cellH = (bounds.maxY - bounds.minY) / gridSize
  const values = new Float64Array(gridSize * gridSize)
  const twoH2 = 2 * bandwidth * bandwidth
  const reach = 3 * bandwidth
  for (const p of pts) {
    const ix0 = Math.max(0, Math.floor((p.x - bounds.minX - reach) / cellW))
    const ix1 = Math.min(gridSize - 1, Math.ceil((p.x - bounds.minX + reach) / cellW))
    const iy0 = Math.max(0, Math.floor((p.y - bounds.minY - reach) / cellH))
    const iy1 = Math.min(gridSize - 1, Math.ceil((p.y - bounds.minY + reach) / cellH))
    for (let iy = iy0; iy <= iy1; iy++) {
      const gy = bounds.minY + (iy + 0.5) * cellH
      for (let ix = ix0; ix <= ix1; ix++) {
        const gx = bounds.minX + (ix + 0.5) * cellW
        const r2 = (gx - p.x) ** 2 + (gy - p.y) ** 2
        values[iy * gridSize + ix] += Math.exp(-r2 / twoH2)
      }
    }
  }
  return { values, W: gridSize, H: gridSize, cellW, cellH, minX: bounds.minX, minY: bounds.minY }
}

// Marching squares — returns line-segment list at a given threshold.
function marchingSquares(g: Grid, threshold: number): { ax: number; ay: number; bx: number; by: number }[] {
  const segs: { ax: number; ay: number; bx: number; by: number }[] = []
  for (let i = 0; i < g.H - 1; i++) {
    for (let j = 0; j < g.W - 1; j++) {
      const a = g.values[i * g.W + j]
      const b = g.values[i * g.W + (j + 1)]
      const c = g.values[(i + 1) * g.W + (j + 1)]
      const d = g.values[(i + 1) * g.W + j]
      let code = 0
      if (a >= threshold) code |= 1
      if (b >= threshold) code |= 2
      if (c >= threshold) code |= 4
      if (d >= threshold) code |= 8
      if (code === 0 || code === 15) continue
      const x0 = g.minX + j * g.cellW, x1 = x0 + g.cellW
      const y0 = g.minY + i * g.cellH, y1 = y0 + g.cellH
      const lerp = (v0: number, v1: number, t0: number, t1: number) => t0 + ((threshold - v0) / (v1 - v0)) * (t1 - t0)
      const top = { x: lerp(a, b, x0, x1), y: y0 }
      const right = { x: x1, y: lerp(b, c, y0, y1) }
      const bottom = { x: lerp(d, c, x0, x1), y: y1 }
      const left = { x: x0, y: lerp(a, d, y0, y1) }
      switch (code) {
        case 1: case 14: segs.push({ ax: top.x, ay: top.y, bx: left.x, by: left.y }); break
        case 2: case 13: segs.push({ ax: top.x, ay: top.y, bx: right.x, by: right.y }); break
        case 3: case 12: segs.push({ ax: left.x, ay: left.y, bx: right.x, by: right.y }); break
        case 4: case 11: segs.push({ ax: right.x, ay: right.y, bx: bottom.x, by: bottom.y }); break
        case 6: case 9: segs.push({ ax: top.x, ay: top.y, bx: bottom.x, by: bottom.y }); break
        case 7: case 8: segs.push({ ax: left.x, ay: left.y, bx: bottom.x, by: bottom.y }); break
        case 5: case 10: // ambiguous (saddle) — two non-crossing segments
          segs.push({ ax: top.x, ay: top.y, bx: left.x, by: left.y })
          segs.push({ ax: right.x, ay: right.y, bx: bottom.x, by: bottom.y })
          break
      }
    }
  }
  return segs
}

// Chain raw segments into closed polygons (or open polylines at grid edge).
function chainSegments(segs: { ax: number; ay: number; bx: number; by: number }[]): { x: number; y: number }[][] {
  const round = (v: number) => Math.round(v * 1000) / 1000
  const key = (x: number, y: number) => `${round(x)},${round(y)}`
  const adj = new Map<string, { x: number; y: number; segIdx: number; otherKey: string }[]>()
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const k1 = key(s.ax, s.ay), k2 = key(s.bx, s.by)
    if (k1 === k2) continue
    if (!adj.has(k1)) adj.set(k1, [])
    if (!adj.has(k2)) adj.set(k2, [])
    adj.get(k1)!.push({ x: s.bx, y: s.by, segIdx: i, otherKey: k2 })
    adj.get(k2)!.push({ x: s.ax, y: s.ay, segIdx: i, otherKey: k1 })
  }
  const usedSegs = new Set<number>()
  const polys: { x: number; y: number }[][] = []
  for (const startKey of adj.keys()) {
    const startNeighbors = adj.get(startKey)!
    if (startNeighbors.every((n) => usedSegs.has(n.segIdx))) continue
    const startParts = startKey.split(',').map(Number)
    const poly: { x: number; y: number }[] = [{ x: startParts[0], y: startParts[1] }]
    let currentKey = startKey
    while (true) {
      const neighbors = adj.get(currentKey) || []
      const nxt = neighbors.find((n) => !usedSegs.has(n.segIdx))
      if (!nxt) break
      usedSegs.add(nxt.segIdx)
      poly.push({ x: nxt.x, y: nxt.y })
      currentKey = nxt.otherKey
      if (currentKey === startKey) break
    }
    if (poly.length >= 3) polys.push(poly)
  }
  return polys
}

// Polygon area via shoelace formula (returns absolute area).
function polygonArea(poly: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    sum += poly[i].x * poly[j].y - poly[j].x * poly[i].y
  }
  return Math.abs(sum / 2)
}

// Build KDE contour polygons for a community's screen-space points.
// Bandwidth + threshold are tunable knobs.
function kdeContours(
  pts: { x: number; y: number }[],
  bandwidth: number,
  thresholdRatio: number,
): { x: number; y: number }[][] {
  if (pts.length < 8) return []
  // Pad bounds by 3*bandwidth so contours have room around outermost points
  const pad = 3 * bandwidth
  const bounds = {
    minX: Math.min(...pts.map((p) => p.x)) - pad,
    maxX: Math.max(...pts.map((p) => p.x)) + pad,
    minY: Math.min(...pts.map((p) => p.y)) - pad,
    maxY: Math.max(...pts.map((p) => p.y)) + pad,
  }
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  // Grid resolution scales with span: aim for ~0.25*bandwidth per cell
  const gridSize = Math.min(140, Math.max(40, Math.round(span / (bandwidth * 0.25))))
  const g = kde2d(pts, bandwidth, bounds, gridSize)
  let peak = 0
  for (let k = 0; k < g.values.length; k++) if (g.values[k] > peak) peak = g.values[k]
  if (peak === 0) return []
  const segs = marchingSquares(g, peak * thresholdRatio)
  return chainSegments(segs)
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const out: string[] = []
out.push(`<?xml version="1.0" encoding="UTF-8"?>`)
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`)

// Styles + filters
out.push(`<defs>
  <style><![CDATA[
    .title       { font-family: 'Jost', 'Helvetica Neue', sans-serif; font-weight: 600; }
    .subtitle    { font-family: 'Cormorant Garamond', 'Times New Roman', serif; font-style: italic; }
    .body        { font-family: 'Jost', 'Helvetica Neue', sans-serif; font-weight: 400; }
    .section     { font-family: 'Jost', 'Helvetica Neue', sans-serif; font-weight: 600; }
    .label       { font-family: 'Jost', 'Helvetica Neue', sans-serif; font-weight: 500; }
    .hull-label  { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-style: italic; }
  ]]></style>
  <filter id="hull-blur" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2.4"/>
  </filter>
</defs>`)

// Background
out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FBF7EE"/>`)

// --- Title -----------------------------------------------------------------
out.push(`<g id="title-block">`)
out.push(`  <text x="${W / 2}" y="${MARGIN + 50}" text-anchor="middle" class="title" font-size="48" fill="#32321E">RMBL Knowledge Fabric</text>`)
out.push(`  <text x="${W / 2}" y="${MARGIN + TITLE_H + TITLE_GAP}" text-anchor="middle" class="subtitle" font-size="16" fill="#55553D">A unified knowledge network for the Gunnison Basin · 4,852 publications · 1,426 datasets · 1,381 documents · 152 research neighborhoods</text>`)
out.push(`</g>`)

// --- Neighborhood boundaries (drawn first so they sit under edges + nodes) -
// Two rendering modes:
//   Default: fuzzy convex hulls (thick stroke + Gaussian blur)
//   --use-kde: organic boundaries from 2D Gaussian KDE + marching-squares
//              contours at a fraction of each community's peak density.
if (drawHulls) {
  const groupAttrs = useKde ? '' : ' filter="url(#hull-blur)"'
  out.push(`<g id="neighborhood-hulls"${groupAttrs}>`)
  const byCommunity = new Map<number, Node[]>()
  for (const n of nodes) {
    if (n.community === undefined || n.community < 0) continue
    if (!byCommunity.has(n.community)) byCommunity.set(n.community, [])
    byCommunity.get(n.community)!.push(n)
  }
  // Largest neighborhoods first so smaller ones overlay on top
  const sortedHullComms = [...byCommunity.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [, members] of sortedHullComms) {
    if (members.length < 8) continue  // too small to draw meaningfully
    const pts = members.map((n) => ({ x: sx(n.x), y: sy(n.y) }))
    const hullColor = '#8A8268'  // neutral warm gray; node-type colors stay legible

    if (useKde) {
      // Sort by area so we keep the dominant lobes; drop tiny artifact contours
      const polys = kdeContours(pts, kdeBandwidth, kdeThreshold)
        .filter((p) => p.length >= 3)
        .sort((a, b) => polygonArea(b) - polygonArea(a))
        .slice(0, kdeKeep)
      for (const poly of polys) {
        const d = 'M ' + poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z'
        out.push(`<path d="${d}" fill="${hullColor}" fill-opacity="0.07" stroke="${hullColor}" stroke-width="0.8" stroke-opacity="0.45" stroke-linejoin="round" stroke-linecap="round"/>`)
      }
    } else {
      const hull = convexHull(pts)
      if (hull.length < 3) continue
      const d = 'M ' + hull.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z'
      const strokeWidth = Math.min(18, Math.max(6, Math.sqrt(members.length) * 1.0))
      out.push(`<path d="${d}" fill="${hullColor}" fill-opacity="0.07" stroke="${hullColor}" stroke-width="${strokeWidth.toFixed(1)}" stroke-opacity="0.10" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
  }
  out.push(`</g>`)
}

// --- Edges -----------------------------------------------------------------
out.push(`<g id="graph-edges" stroke-linecap="round" fill="none">`)
const nodeById = new Map<string, Node>()
for (const n of nodes) nodeById.set(n.id, n)
for (const e of edges) {
  const a = nodeById.get(e.source), b = nodeById.get(e.target)
  if (!a || !b) continue
  const stroke = colorBy === 'community' && a.community === b.community && a.community >= 0
    ? (COMMUNITY_PALETTE[(communityById.get(a.community) || 0) % COMMUNITY_PALETTE.length])
    : NEUTRAL_GRAY
  const w = Math.max(0.08, Math.min(0.6, Math.log1p(e.weight || 1) * 0.16))
  out.push(`<line x1="${sx(a.x).toFixed(2)}" y1="${sy(a.y).toFixed(2)}" x2="${sx(b.x).toFixed(2)}" y2="${sy(b.y).toFixed(2)}" stroke="${stroke}" stroke-width="${w.toFixed(2)}" opacity="0.05"/>`)
}
out.push(`</g>`)

// --- Nodes -----------------------------------------------------------------
out.push(`<g id="graph-nodes" stroke="none">`)
for (const n of nodes) {
  const r = Math.max(0.5, Math.min(3.5, 0.4 + Math.sqrt(n.degree || 1) * 0.18))
  out.push(`<circle cx="${sx(n.x).toFixed(2)}" cy="${sy(n.y).toFixed(2)}" r="${r.toFixed(2)}" fill="${nodeColor(n)}" opacity="0.92"/>`)
}
out.push(`</g>`)

// (Per-node labels moved from main graph into the satellite cells, where the
// "zoom" makes labels for top high-degree nodes legible without crowding.)
// Use --node-labels=N to control top-N per satellite, default 3.
if (labelsPerCommunity > 0) {
  out.push(`<g id="graph-labels" font-family="Jost,sans-serif" font-weight="500" fill="#1f1f12">`)
  const byCommunity = new Map<number, Node[]>()
  for (const n of nodes) {
    if (n.community === undefined || n.community < 0) continue
    if (!byCommunity.has(n.community)) byCommunity.set(n.community, [])
    byCommunity.get(n.community)!.push(n)
  }
  for (const [, members] of byCommunity) {
    members.sort((a, b) => (b.degree || 0) - (a.degree || 0))
    const top = members.slice(0, labelsPerCommunity).filter((m) => (m.degree || 0) >= 4)
    for (const m of top) {
      const fontSize = Math.max(1.6, Math.min(3.2, 1.4 + Math.sqrt(m.degree || 1) * 0.12))
      const fontStyle = m.nodeType === 'species' ? 'italic' : 'normal'
      const label = m.label.length > 38 ? m.label.slice(0, 36) + '…' : m.label
      const haloW = (fontSize * 0.22).toFixed(2)
      out.push(`<text x="${sx(m.x).toFixed(2)}" y="${(sy(m.y) - 4).toFixed(2)}" text-anchor="middle" font-size="${fontSize.toFixed(2)}" font-style="${fontStyle}" paint-order="stroke" stroke="#FBF7EE" stroke-width="${haloW}" stroke-linejoin="round">${escapeXml(label)}</text>`)
    }
  }
  out.push(`</g>`)
}

// --- Neighborhood labels: title each top-N neighborhood at its centroid ----
// (Independent of hull drawing — labels are useful even when boundaries are off.)
if (hullLabelTop > 0) {
  out.push(`<g id="hull-labels" fill="#1f1f12">`)
  const byCommunity = new Map<number, Node[]>()
  for (const n of nodes) {
    if (n.community === undefined || n.community < 0) continue
    if (!byCommunity.has(n.community)) byCommunity.set(n.community, [])
    byCommunity.get(n.community)!.push(n)
  }
  const top = [...byCommunity.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, hullLabelTop)
  for (const [commId, members] of top) {
    const pts = members.map((n) => ({ x: sx(n.x), y: sy(n.y) }))
    const c = centroid(pts)
    const meta = communityMeta.get(commId)
    if (!meta?.label) continue
    // Title-case first letter
    let label = meta.label
    // Wrap labels at ~28 chars
    const parts: string[] = []
    let line = ''
    for (const word of label.split(/\s+/)) {
      if ((line + ' ' + word).length > 28) { parts.push(line); line = word }
      else line = line ? line + ' ' + word : word
    }
    if (line) parts.push(line)
    const fontSize = Math.max(3.2, Math.min(6, 2.8 + Math.sqrt(members.length) * 0.18))
    let dy = -((parts.length - 1) * fontSize * 0.6)
    const haloW = (fontSize * 0.22).toFixed(2)
    for (const part of parts) {
      out.push(`<text x="${c.x.toFixed(2)}" y="${(c.y + dy).toFixed(2)}" text-anchor="middle" class="hull-label" font-size="${fontSize.toFixed(2)}" paint-order="stroke" stroke="#FBF7EE" stroke-width="${haloW}" stroke-linejoin="round">${escapeXml(part)}</text>`)
      dy += fontSize * 1.1
    }
  }
  out.push(`</g>`)
}

// --- Node-type legend (top-right corner of graph area) ---------------------
if (colorBy === 'nodetype') {
  const legendOrder: [string, string][] = [
    ['publication', 'Publications'],
    ['dataset', 'Datasets'],
    ['document', 'Documents'],
    ['story', 'Stories'],
    ['species', 'Species'],
    ['place', 'Places'],
    ['protocol', 'Protocols'],
    ['concept', 'Concepts'],
    ['author', 'Authors'],
  ]
  const lx = graphX + graphW - 60, ly = graphY + 8
  out.push(`<g id="node-legend" font-family="Jost,sans-serif" font-size="3.2" fill="#1f1f12">`)
  out.push(`<rect x="${lx - 4}" y="${ly - 4}" width="62" height="${legendOrder.length * 4.4 + 8}" fill="#FBF7EE" stroke="#32321E" stroke-width="0.2" opacity="0.92" rx="1"/>`)
  for (let i = 0; i < legendOrder.length; i++) {
    const [t, label] = legendOrder[i]
    out.push(`<circle cx="${lx + 1}" cy="${ly + 2 + i * 4.4}" r="1.4" fill="${NODE_TYPE_COLOR[t]}"/>`)
    out.push(`<text x="${lx + 5}" y="${ly + 3 + i * 4.4}" >${escapeXml(label)}</text>`)
  }
  out.push(`</g>`)
}

// --- Satellite subgraphs (picture-frame layout) ----------------------------
// The N largest neighborhoods are rendered as small subgraphs around the
// perimeter of the main graph, in clockwise spiral order from top-left.
// Only intra-community edges are shown; node positions inherit from the
// main FA2 layout (so each satellite is a "zoom" of its slice).
if (satellitesEnabled && totalSatellites > 0) {
  const byCommunity = new Map<number, Node[]>()
  for (const n of nodes) {
    if (n.community === undefined || n.community < 0) continue
    if (!byCommunity.has(n.community)) byCommunity.set(n.community, [])
    byCommunity.get(n.community)!.push(n)
  }
  const top = [...byCommunity.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, totalSatellites)

  // Collect intra-community edges per displayed community
  const topCommSet = new Set(top.map(([id]) => id))
  const edgesByCommunity = new Map<number, Edge[]>()
  for (const [id] of top) edgesByCommunity.set(id, [])
  for (const e of edges) {
    const a = nodeById.get(e.source), b = nodeById.get(e.target)
    if (!a || !b) continue
    if (a.community === b.community && topCommSet.has(a.community)) {
      edgesByCommunity.get(a.community)!.push(e)
    }
  }

  out.push(`<g id="satellites">`)
  top.forEach(([commId, members], i) => {
    const pos = satelliteCellAt(i)
    if (!pos) return

    const drawY = pos.y + SATELLITE_TITLE_H
    const drawH = pos.h - SATELLITE_TITLE_H - SATELLITE_FOOTER_H

    // Bounding box of this community's positions in main-graph coordinates
    const xs = members.map((m) => m.x), ys = members.map((m) => m.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const dataW = Math.max(1, maxX - minX), dataH = Math.max(1, maxY - minY)
    const localScale = Math.min(pos.w / dataW, drawH / dataH) * 0.92
    const localOffsetX = pos.x + (pos.w - dataW * localScale) / 2 - minX * localScale
    const localOffsetY = drawY + (drawH - dataH * localScale) / 2 - minY * localScale
    const lx = (x: number) => localOffsetX + x * localScale
    const ly = (y: number) => localOffsetY + y * localScale

    // Title (wrap to ~24 chars; max 2 lines)
    const meta = communityMeta.get(commId)
    const fullTitle = meta?.label || `Community ${commId}`
    const titleParts: string[] = []
    let line = ''
    for (const word of fullTitle.split(/\s+/)) {
      if ((line + ' ' + word).length > 24) { titleParts.push(line); line = word }
      else line = line ? line + ' ' + word : word
      if (titleParts.length >= 2) break
    }
    if (line && titleParts.length < 2) titleParts.push(line)
    const titleFontSize = 3.4
    titleParts.slice(0, 2).forEach((part, ti) => {
      out.push(`<text x="${(pos.x + pos.w / 2).toFixed(2)}" y="${(pos.y + 4 + ti * titleFontSize * 1.1).toFixed(2)}" text-anchor="middle" class="hull-label" font-size="${titleFontSize}" fill="#1f1f12" paint-order="stroke" stroke="#FBF7EE" stroke-width="0.6" stroke-linejoin="round">${escapeXml(part)}</text>`)
    })

    // Edges
    for (const e of edgesByCommunity.get(commId) || []) {
      const a = nodeById.get(e.source)!, b = nodeById.get(e.target)!
      out.push(`<line x1="${lx(a.x).toFixed(2)}" y1="${ly(a.y).toFixed(2)}" x2="${lx(b.x).toFixed(2)}" y2="${ly(b.y).toFixed(2)}" stroke="#7A7765" stroke-width="0.1" opacity="0.30"/>`)
    }

    // Nodes
    for (const n of members) {
      const r = Math.max(0.4, Math.min(2.0, 0.35 + Math.sqrt(n.degree || 1) * 0.14))
      out.push(`<circle cx="${lx(n.x).toFixed(2)}" cy="${ly(n.y).toFixed(2)}" r="${r.toFixed(2)}" fill="${nodeColor(n)}" opacity="0.95"/>`)
    }

    // Per-node labels: greedy placement of top-N highest-degree nodes,
    // skipping any whose label rect overlaps an already-placed one or
    // extends past the cell's drawable area. Try above first, then below.
    if (nodeLabelsPerCommunity > 0) {
      const ranked = [...members]
        .sort((a, b) => (b.degree || 0) - (a.degree || 0))
        .filter((m) => (m.degree || 0) >= 2)
      const placed: { x: number; y: number; w: number; h: number }[] = []
      const fontSize = 1.7
      const cellTop = pos.y + SATELLITE_TITLE_H
      const cellBot = pos.y + pos.h - SATELLITE_FOOTER_H
      let placedCount = 0
      for (const m of ranked) {
        if (placedCount >= nodeLabelsPerCommunity) break
        const fontStyle = m.nodeType === 'species' ? 'italic' : 'normal'
        const label = m.label.length > 22 ? m.label.slice(0, 20) + '…' : m.label
        const labelW = label.length * fontSize * 0.55
        const labelH = fontSize * 1.1
        const cx = lx(m.x)
        const cy = ly(m.y)
        // Try positions: above, below, right, left
        const candidates = [
          { x: cx - labelW / 2, y: cy - 1.4 - labelH },                          // above
          { x: cx - labelW / 2, y: cy + 1.4 },                                   // below
          { x: cx + 1.4,         y: cy - labelH / 2 },                            // right
          { x: cx - labelW - 1.4, y: cy - labelH / 2 },                          // left
        ]
        let chosen: typeof candidates[number] | null = null
        for (const c of candidates) {
          const r = { x: c.x, y: c.y, w: labelW, h: labelH }
          // Must fit inside drawable cell area
          if (r.x < pos.x || r.x + r.w > pos.x + pos.w || r.y < cellTop || r.y + r.h > cellBot) continue
          // Must not overlap an already-placed label
          let overlaps = false
          for (const p of placed) {
            if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) { overlaps = true; break }
          }
          if (!overlaps) { chosen = c; break }
        }
        if (!chosen) continue
        placed.push({ x: chosen.x, y: chosen.y, w: labelW, h: labelH })
        // Position text baseline = top of bbox + fontSize * 0.85 (approx ascender)
        const textY = chosen.y + fontSize * 0.85
        const textX = chosen.x + labelW / 2
        out.push(`<text x="${textX.toFixed(2)}" y="${textY.toFixed(2)}" text-anchor="middle" font-family="Jost,sans-serif" font-weight="500" font-size="${fontSize}" font-style="${fontStyle}" fill="#1f1f12" paint-order="stroke" stroke="#FBF7EE" stroke-width="0.4" stroke-linejoin="round">${escapeXml(label)}</text>`)
        placedCount++
      }
    }

    // Footer caption: node count + dominant types
    const typeCounts = new Map<string, number>()
    for (const m of members) typeCounts.set(m.nodeType, (typeCounts.get(m.nodeType) || 0) + 1)
    const top3 = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${c} ${t}${c !== 1 ? 's' : ''}`).join(' · ')
    out.push(`<text x="${(pos.x + pos.w / 2).toFixed(2)}" y="${(pos.y + pos.h - 1.5).toFixed(2)}" text-anchor="middle" class="body" font-size="2.6" fill="#55553D" paint-order="stroke" stroke="#FBF7EE" stroke-width="0.5" stroke-linejoin="round">${escapeXml(`${members.length} · ${top3}`)}</text>`)
  })
  out.push(`</g>`)
}

// --- Footer panels ---------------------------------------------------------
const footerY = MARGIN + TITLE_H + TITLE_GAP + SUBTITLE_H + 10 + frameAreaH + FOOTER_GAP
const colW = (W - 2 * MARGIN - 2 * FOOTER_GAP) / 3

function panel(x: number, y: number, w: number, h: number, heading: string, lines: string[]) {
  out.push(`<g>`)
  out.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#F4EEE4" stroke="#32321E" stroke-width="0.4" rx="3"/>`)
  out.push(`  <text x="${x + 10}" y="${y + 18}" class="section" font-size="14" fill="#32321E">${escapeXml(heading)}</text>`)
  let ty = y + 36
  for (const line of lines) {
    const isBullet = line.startsWith('•')
    out.push(`<text x="${x + (isBullet ? 14 : 10)}" y="${ty}" class="body" font-size="8" fill="#32321E">${escapeXml(line)}</text>`)
    ty += 11
  }
  out.push(`</g>`)
}

panel(MARGIN, footerY, colW, FOOTER_H,
  'About',
  [
    'Unified search platform for environmental research',
    'at the Rocky Mountain Biological Laboratory and',
    'across the Gunnison Basin, Colorado.',
    '',
    '• 4,852 peer-reviewed publications',
    '• 1,381 community / policy documents',
    '• 1,426 research datasets',
    '• 841 news stories (1981–2026)',
    '• 6,696 deduplicated authors',
    '• 1,206 species (ITIS-validated)',
    '• 152 knowledge neighborhoods',
    '',
    'Visit: rmblknowledgefabric.org',
  ])

panel(MARGIN + colW + FOOTER_GAP, footerY, colW, FOOTER_H,
  'How to use it',
  [
    '• Search across all collections from the home page.',
    '• Browse Authors, Species, Concepts, Protocols, Places,',
    '  Projects, Stakeholders, Neighborhoods, Stories.',
    '• Each detail page surfaces a local knowledge graph,',
    '  related works, and entity-mention context.',
    '• Use the “Research Tools” menu to jump to the SDP',
    '  Browser (geospatial data) and Compute Hub.',
    '• Export citations as CSL JSON, RIS, or BibTeX.',
    '• Programmatic access:',
    '   – REST API v1 at /api/v1/',
    '   – MCP server for AI assistants (Claude Desktop)',
  ])

panel(MARGIN + 2 * (colW + FOOTER_GAP), footerY, colW, FOOTER_H,
  'Roadmap',
  [
    '• Hybrid search: pgvector + tsvector RRF',
    '• RAG pipeline grounded in the citation network',
    '• Expanded VLM extraction across remaining',
    '  publications and documents',
    '• Curation flag triage workflow with the new',
    '  per-cell field-protection system',
    '• Public LLM-grounded research primers per',
    '  knowledge neighborhood',
    '• Cross-property navigation with the SDP Browser',
    '  and RMBL Compute Hub',
  ])

out.push(`</svg>`)

const outputName = args.find((a) => a.startsWith('--output='))?.split('=')[1] || 'public/poster.svg'
writeFileSync(outputName, out.join('\n'))
console.log(`Wrote ${outputName} (${(out.join('\n').length / 1024).toFixed(1)} KB)`)
console.log(`Color: ${colorBy}; hulls: ${drawHulls}; hull labels: ${hullLabelTop}`)
console.log(`Open with: open public/poster.svg`)

// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
