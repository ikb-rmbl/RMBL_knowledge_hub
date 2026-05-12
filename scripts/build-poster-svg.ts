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
const hullLabelTop = parseInt(args.find((a) => a.startsWith('--hull-label-top='))?.split('=')[1] || '24', 10)
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

const graphX = MARGIN
const graphY = MARGIN + TITLE_H + TITLE_GAP + SUBTITLE_H + 10
const graphW = W - 2 * MARGIN
const graphH = H - graphY - FOOTER_H - FOOTER_GAP - MARGIN

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

// --- Neighborhood hulls (drawn first so they sit under edges + nodes) ------
// "Fuzzy" effect: thick rounded-linejoin stroke + low-alpha fill in matching
// color. The wide stroke + linejoin=round inflates the hull and softens
// corners; combined with feGaussianBlur it reads as a soft halo.
if (drawHulls) {
  out.push(`<g id="neighborhood-hulls" filter="url(#hull-blur)">`)
  const byCommunity = new Map<number, Node[]>()
  for (const n of nodes) {
    if (n.community === undefined || n.community < 0) continue
    if (!byCommunity.has(n.community)) byCommunity.set(n.community, [])
    byCommunity.get(n.community)!.push(n)
  }
  // Largest neighborhoods first so smaller ones overlay on top
  const sortedHullComms = [...byCommunity.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [commId, members] of sortedHullComms) {
    if (members.length < 8) continue  // too small to draw meaningfully
    const pts = members.map((n) => ({ x: sx(n.x), y: sy(n.y) }))
    const hull = convexHull(pts)
    if (hull.length < 3) continue
    const d = 'M ' + hull.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z'
    // Always neutral warm gray for hulls so node-type colors stay legible
    const hullColor = '#8A8268'
    const strokeWidth = Math.min(18, Math.max(6, Math.sqrt(members.length) * 1.0))
    out.push(`<path d="${d}" fill="${hullColor}" fill-opacity="0.07" stroke="${hullColor}" stroke-width="${strokeWidth.toFixed(1)}" stroke-opacity="0.10" stroke-linejoin="round" stroke-linecap="round"/>`)
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

// --- Per-node labels (off by default when hulls drawn; opt in via flag) ----
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
      out.push(`<text x="${sx(m.x).toFixed(2)}" y="${(sy(m.y) - 4).toFixed(2)}" text-anchor="middle" font-size="${fontSize.toFixed(2)}" font-style="${fontStyle}">${escapeXml(label)}</text>`)
    }
  }
  out.push(`</g>`)
}

// --- Hull labels: title each top-N neighborhood at its centroid ------------
if (drawHulls && hullLabelTop > 0) {
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
    for (const part of parts) {
      out.push(`<text x="${c.x.toFixed(2)}" y="${(c.y + dy).toFixed(2)}" text-anchor="middle" class="hull-label" font-size="${fontSize.toFixed(2)}">${escapeXml(part)}</text>`)
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

// --- Footer panels ---------------------------------------------------------
const footerY = graphY + graphH + FOOTER_GAP
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

writeFileSync('public/poster.svg', out.join('\n'))
console.log(`Wrote public/poster.svg (${(out.join('\n').length / 1024).toFixed(1)} KB)`)
console.log(`Color: ${colorBy}; hulls: ${drawHulls}; hull labels: ${hullLabelTop}`)
console.log(`Open with: open public/poster.svg`)

// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
