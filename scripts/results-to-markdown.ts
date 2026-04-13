/**
 * Convert VLM extraction results.json to a plain Markdown report.
 *
 * Usage:
 *   npx tsx scripts/results-to-markdown.ts [--input=path] [--output=path]
 *
 * Defaults:
 *   --input=scripts/output/extraction-full/results.json
 *   --output=scripts/output/extraction-full/report.md
 */

import { readFileSync, writeFileSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const inputPath = args.find(a => a.startsWith('--input='))?.split('=')[1] || `${OUTPUT_DIR}/extraction-full/results.json`
const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1] || inputPath.replace(/\.json$/, '.md')

const results = JSON.parse(readFileSync(inputPath, 'utf-8'))

const lines: string[] = []

// Summary
const total = results.length
const extracted = results.filter((r: any) => r.strategy3?.extraction).length
const errors = results.filter((r: any) => r.strategy3?.error).length
const totalCost = results.reduce((sum: number, r: any) => sum + (r.strategy3?.cost || 0), 0)

lines.push('# VLM Extraction Report')
lines.push('')
lines.push(`**Papers processed:** ${total} | **Extracted:** ${extracted} | **Errors:** ${errors} | **Total cost:** $${totalCost.toFixed(2)}`)
lines.push('')
lines.push('---')
lines.push('')

for (const r of results) {
  lines.push(`## ${r.id}: ${r.title}`)
  lines.push('')
  lines.push(`**Type:** ${r.type || '?'} | **PDF:** ${r.hasPdf ? 'yes' : 'no'} | **Full text:** ${r.hasFullText ? 'yes' : 'no'}`)

  if (r.strategy3?.error) {
    lines.push('')
    lines.push(`> **Error:** ${r.strategy3.error}`)
    lines.push('')
    lines.push('---')
    lines.push('')
    continue
  }

  const e = r.strategy3?.extraction
  if (!e) {
    lines.push('')
    lines.push('> No extraction data.')
    lines.push('')
    lines.push('---')
    lines.push('')
    continue
  }

  lines.push(` | **Cost:** $${r.strategy3.cost?.toFixed(4) || '?'}`)
  lines.push('')

  if (e.researchQuestion) {
    lines.push(`**Research Question:** ${e.researchQuestion}`)
    lines.push('')
  }

  if (e.keyFindings?.length > 0) {
    lines.push('**Key Findings:**')
    for (const f of e.keyFindings) {
      lines.push(`- [${f.confidence || '?'}] ${f.finding}`)
    }
    lines.push('')
  }

  if (e.methods) {
    lines.push(`**Methods:** ${e.methods.slice(0, 300)}${e.methods.length > 300 ? '...' : ''}`)
    lines.push('')
  }

  if (e.protocolsNamed?.length > 0) {
    lines.push('**Protocols:**')
    for (const p of e.protocolsNamed) {
      let line = `- **${p.proposedName}** [${p.category || '?'}]`
      if (p.isStandardized) line += ' (standardized)'
      if (p.role) line += ` — ${p.role}`
      lines.push(line)
    }
    lines.push('')
  }

  if (e.species?.length > 0) {
    lines.push('**Species:**')
    for (const s of e.species) {
      let line = `- *${s.scientificName}*`
      if (s.commonName) line += ` (${s.commonName})`
      if (s.family) line += ` [${s.family}]`
      if (s.role) line += ` — ${s.role}`
      lines.push(line)
    }
    lines.push('')
  }

  if (e.places?.length > 0) {
    lines.push('**Places:**')
    for (const pl of e.places) {
      let line = `- **${pl.name}** (${pl.type || '?'})`
      if (pl.parentName) line += ` in ${pl.parentName}`
      if (pl.coordinates) line += ` @ ${pl.coordinates}`
      if (pl.elevation) line += `, ${pl.elevation}`
      lines.push(line)
    }
    lines.push('')
  }

  if (e.concepts?.length > 0) {
    lines.push('**Concepts:**')
    for (const c of e.concepts) {
      lines.push(`- **${c.name}** [${c.type || '?'}] — ${c.role || ''}`)
    }
    lines.push('')
  }

  if (e.statisticalMethods?.length > 0) {
    lines.push('**Statistical Methods:**')
    for (const sm of e.statisticalMethods) {
      if (typeof sm === 'string') { lines.push(`- ${sm}`); continue }
      let line = `- **${sm.name}**`
      if (sm.software) line += ` (${sm.software})`
      if (sm.purpose) line += ` — ${sm.purpose}`
      lines.push(line)
    }
    lines.push('')
  }

  if (e.equipment?.length > 0) {
    lines.push(`**Equipment:** ${e.equipment.join(', ')}`)
    lines.push('')
  }

  if (e.chemicals?.length > 0) {
    lines.push(`**Chemicals/Nutrients:** ${e.chemicals.join(', ')}`)
    lines.push('')
  }

  if (e.timespan) {
    lines.push(`**Timespan:** ${e.timespan.start || '?'} – ${e.timespan.end || '?'} (${e.timespan.duration || '?'})`)
    lines.push('')
  }

  if (e.studySite) {
    const ss = e.studySite
    const parts = [ss.habitat, ss.elevation, ss.coordinates].filter(Boolean)
    if (parts.length) {
      lines.push(`**Study Site:** ${parts.join(' | ')}`)
      lines.push('')
    }
  }

  if (e.figures?.length > 0 || e.tables?.length > 0 || e.photographs?.length > 0) {
    const counts = [
      e.figures?.length && `${e.figures.length} figures`,
      e.tables?.length && `${e.tables.length} tables`,
      e.photographs?.length && `${e.photographs.length} photos`,
    ].filter(Boolean)
    lines.push(`**Visual elements:** ${counts.join(', ')}`)
    lines.push('')
  }

  if (e.codeAvailability?.length > 0) {
    lines.push('**Code:**')
    for (const c of e.codeAvailability) lines.push(`- [${c.platform}](${c.url})`)
    lines.push('')
  }

  if (e.dataAvailability?.length > 0) {
    lines.push('**Data:**')
    for (const d of e.dataAvailability) lines.push(`- [${d.platform}](${d.url})`)
    lines.push('')
  }

  if (e.metadataEnrichment) {
    const m = e.metadataEnrichment
    const filled = [
      m.doi && 'DOI', m.abstract && 'abstract',
      m.keywords?.length && `${m.keywords.length} keywords`,
      m.authors?.length && `${m.authors.length} authors`,
    ].filter(Boolean)
    if (filled.length) {
      lines.push(`**Metadata enrichment:** ${filled.join(', ')}`)
      lines.push('')
    }
  }

  lines.push('---')
  lines.push('')
}

writeFileSync(outputPath, lines.join('\n'))
console.log(`Report written to ${outputPath}`)
console.log(`  ${total} papers, ${extracted} extracted, ${errors} errors, $${totalCost.toFixed(2)} total cost`)
