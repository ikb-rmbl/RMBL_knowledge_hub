/**
 * Text formatters for LLM-friendly API responses.
 *
 * Each function converts structured data to plain text suitable
 * for consumption by AI assistants via format=text.
 */

import type { SearchResult } from '@/services/search'

export function searchResultsToText(results: SearchResult[], total: number, query: string): string {
  const lines = [`Search results for "${query}" (${total} total):\n`]
  for (const r of results) {
    lines.push(`[${r.type}:${r.id}] ${r.title}`)
    if (r.year) lines.push(`  Year: ${r.year}`)
    if (r.subtype) lines.push(`  Type: ${r.subtype}`)
    if (r.meta.length > 0) lines.push(`  ${r.meta.join(' · ')}`)
    lines.push(`  Relevance: ${r.rank.toFixed(3)}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function neighborhoodToText(n: any): string {
  const lines = [
    `Neighborhood: ${n.title}`,
    `ID: ${n.id}`,
    `Size: ${n.size} items`,
  ]
  if (n.summary) lines.push(`Summary: ${n.summary}`)

  const tc = n.type_counts || {}
  const typeLine = Object.entries(tc)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([t, cnt]) => `${cnt} ${t}${(cnt as number) > 1 ? 's' : ''}`)
    .join(', ')
  if (typeLine) lines.push(`Contains: ${typeLine}`)

  if (n.themes?.length > 0) lines.push(`Themes: ${n.themes.join(', ')}`)

  if (n.primer) {
    lines.push('')
    lines.push('--- Research Primer ---')
    lines.push(n.primer)
  }

  if (n.members) {
    for (const [type, members] of Object.entries(n.members)) {
      const items = members as any[]
      if (items.length === 0) continue
      lines.push('')
      lines.push(`--- ${type} (${items.length}) ---`)
      for (const m of items.slice(0, 20)) {
        lines.push(`  ${m.label} (degree: ${m.degree})`)
      }
      if (items.length > 20) lines.push(`  ... and ${items.length - 20} more`)
    }
  }

  return lines.join('\n')
}

export function neighborhoodListToText(rows: any[]): string {
  const lines = [`${rows.length} neighborhoods:\n`]
  for (const n of rows) {
    const tc = n.type_counts || {}
    const typeLine = Object.entries(tc)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([t, cnt]) => `${cnt} ${t}s`)
      .join(', ')
    lines.push(`[${n.id}] ${n.title} (${n.size} items: ${typeLine})`)
    if (n.summary) lines.push(`  ${n.summary.slice(0, 150)}${n.summary.length > 150 ? '...' : ''}`)
    if (n.primer) lines.push('  [has primer]')
    lines.push('')
  }
  return lines.join('\n')
}

export function publicationToText(pub: any, authors?: any[], citations?: any): string {
  const lines = [
    `Title: ${pub.title}`,
    `ID: ${pub.id}`,
  ]
  if (authors?.length) lines.push(`Authors: ${authors.map((a: any) => a.display_name || a.family_name).join('; ')}`)
  if (pub.year) lines.push(`Year: ${pub.year}`)
  if (pub.journal) lines.push(`Journal: ${pub.journal}`)
  if (pub.doi) lines.push(`DOI: ${pub.doi}`)
  if (pub.publication_type) lines.push(`Type: ${pub.publication_type}`)
  if (pub.abstract) lines.push(`\nAbstract: ${pub.abstract}`)
  if (pub.external_citation_count) lines.push(`Citations: ${pub.external_citation_count}`)
  return lines.join('\n')
}

export function datasetToText(ds: any): string {
  const lines = [
    `Title: ${ds.title}`,
    `ID: ${ds.id}`,
  ]
  if (ds.repository) lines.push(`Repository: ${ds.repository}`)
  if (ds.publication_year) lines.push(`Year: ${ds.publication_year}`)
  if (ds.doi) lines.push(`DOI: ${ds.doi}`)
  if (ds.description) lines.push(`\nDescription: ${ds.description}`)
  return lines.join('\n')
}

export function documentToText(doc: any): string {
  const lines = [
    `Title: ${doc.title}`,
    `ID: ${doc.id}`,
  ]
  if (doc.document_type) lines.push(`Type: ${doc.document_type}`)
  if (doc.date_original) lines.push(`Date: ${doc.date_original}`)
  if (doc.summary) lines.push(`\nSummary: ${typeof doc.summary === 'string' ? doc.summary : JSON.stringify(doc.summary)}`)
  return lines.join('\n')
}

export function frontierToText(f: any): string {
  const lines = [
    `Frontier: ${f.title}`,
    `ID: ${f.id}`,
    `Source statements: ${f.source_cluster_size} across ${f.source_neighborhoods} neighborhood${f.source_neighborhoods !== 1 ? 's' : ''}`,
  ]
  if (f.avg_management_relevance != null) {
    lines.push(`Management relevance (0=basic, 3=applied): ${Number(f.avg_management_relevance).toFixed(2)}`)
  }
  if (f.tractability) lines.push(`Tractability: ${f.tractability}`)
  if (f.cross_cutting_summary) lines.push(`\nSummary: ${f.cross_cutting_summary}`)
  if (f.context) lines.push(`\n--- Context ---\n${f.context}`)
  if (f.frontier_description) lines.push(`\n--- Frontier ---\n${f.frontier_description}`)

  const questions: string[] = f.key_questions || []
  if (questions.length > 0) {
    lines.push('\n--- Key questions ---')
    for (const q of questions) lines.push(`  - ${q}`)
  }

  if (f.barriers) lines.push(`\n--- Barriers ---\n${f.barriers}`)
  if (f.research_opportunities) lines.push(`\n--- Research opportunities ---\n${f.research_opportunities}`)

  const actions: { category?: string; effort?: string; action: string }[] = f.pushing_the_frontier || []
  if (actions.length > 0) {
    lines.push('\n--- Pushing the frontier ---')
    for (const a of actions) {
      const tags = [a.category, a.effort].filter(Boolean).join('/')
      lines.push(`  - ${tags ? `[${tags}] ` : ''}${a.action}`)
    }
  }

  const gaps: string[] = f.data_gaps || []
  if (gaps.length > 0) {
    lines.push('\n--- Data gaps ---')
    for (const g of gaps.slice(0, 20)) lines.push(`  - ${g}`)
    if (gaps.length > 20) lines.push(`  ... and ${gaps.length - 20} more`)
  }

  if (f.impacts) lines.push(`\n--- Impacts ---\n${f.impacts}`)

  const nbrs = f.contributing_neighborhoods || []
  if (nbrs.length > 0) {
    lines.push('\n--- Contributing neighborhoods ---')
    for (const n of nbrs) {
      lines.push(`  [${n.id}] ${n.title} (${n.statement_count} statement${n.statement_count !== 1 ? 's' : ''})`)
    }
  }

  const entities = f.linked_entities || {}
  for (const etype of ['concept', 'species', 'place', 'protocol', 'stakeholder', 'author', 'publication', 'dataset', 'document', 'project']) {
    const items: any[] = entities[etype] || []
    if (items.length === 0) continue
    lines.push(`\n--- Linked ${etype}s (${items.length}) ---`)
    for (const item of items.slice(0, 10)) {
      lines.push(`  [${item.id}] ${item.name}`)
    }
    if (items.length > 10) lines.push(`  ... and ${items.length - 10} more`)
  }

  const stmts = f.source_statements || []
  if (stmts.length > 0) {
    lines.push(`\n--- Source statements (${stmts.length}) ---`)
    for (const s of stmts.slice(0, 30)) {
      const rel = s.management_relevance != null ? ` [mgmt=${s.management_relevance}]` : ''
      lines.push(`  [${s.neighborhood_title}]${rel} ${s.statement_text}`)
    }
    if (stmts.length > 30) lines.push(`  ... and ${stmts.length - 30} more`)
  }

  return lines.join('\n')
}

export function frontierListToText(rows: any[], total: number, query?: string): string {
  const header = query
    ? `${rows.length} of ${total} frontiers matching "${query}":\n`
    : `${rows.length} of ${total} frontiers:\n`
  const lines = [header]
  for (const f of rows) {
    const mgmt = f.avg_management_relevance != null ? `, mgmt ${Number(f.avg_management_relevance).toFixed(2)}` : ''
    lines.push(`[${f.id}] ${f.title}`)
    lines.push(`  ${f.source_cluster_size} statements across ${f.source_neighborhoods} neighborhood${f.source_neighborhoods !== 1 ? 's' : ''}${mgmt}`)
    if (f.cross_cutting_summary) {
      const s = f.cross_cutting_summary
      lines.push(`  ${s.length > 200 ? s.slice(0, 200) + '...' : s}`)
    }
    if (f.question_count) lines.push(`  ${f.question_count} key question${f.question_count !== 1 ? 's' : ''} · ${f.action_count} action${f.action_count !== 1 ? 's' : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}
