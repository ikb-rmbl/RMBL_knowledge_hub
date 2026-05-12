/**
 * Generate plain-language descriptions for knowledge neighborhoods.
 *
 * Reads community data from communities.json, enriches context by querying
 * the database for detailed metadata on each community's top members, then
 * sends to Claude for a descriptive title + summary sentence.
 *
 * Usage:
 *   npx tsx scripts/describe-communities.ts [--dry-run] [--limit=N]
 *
 * Requires: ANTHROPIC_API_KEY
 */

import { readFileSync, writeFileSync } from 'fs'
import pg from 'pg'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

const PROMPT = `You are writing short descriptions of knowledge neighborhoods in the RMBL Knowledge Fabric — a platform connecting scientific research, community documents, and environmental datasets from the Rocky Mountain Biological Laboratory and the Gunnison Basin of western Colorado.

Each neighborhood is a cluster of densely connected entities (species, concepts, protocols, places), collection items (publications, datasets, documents), stakeholders (agencies, organizations), and authors detected by community analysis of the knowledge graph.

Neighborhoods vary in character:
- **Research-focused** neighborhoods center on scientific publications, species, protocols, and researchers. Describe the scientific questions and methods.
- **Policy/management-focused** neighborhoods center on community documents, government agencies, and land/water management concepts. Describe the management issues and stakeholders involved.
- **Mixed** neighborhoods bridge research and policy. Describe how the science connects to management or community concerns.

Use the type breakdown (e.g., "300 documents, 180 stakeholders, 20 concepts") to gauge character. Document/stakeholder-heavy = policy; publication/protocol-heavy = research.

Generate:
1. A short descriptive title (5-10 words, no researcher names, captures the core theme)
2. A one-sentence plain-language summary (do NOT begin with "This neighborhood" or "This community" — start directly with the substance, e.g., "Studies how alpine wildflowers respond to..." or "Connects federal water policy with...")
3. A list of 3-5 key themes or keywords

Return a JSON object:
{
  "title": "short descriptive title",
  "summary": "One sentence starting with the substance, not 'This community...'",
  "themes": ["theme1", "theme2", "theme3"]
}

Return valid JSON only.`

const TOP_N = 4

/** Fetch enriched metadata for top members from the database */
async function enrichContext(db: pg.Pool, community: any): Promise<string> {
  const parts: string[] = [`Neighborhood with ${community.size} nodes: ${community.description}`]

  const topByType: Record<string, any[]> = community.topByType || {}

  // Species: include common names, family, kingdom
  const speciesIds = (topByType.species || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (speciesIds.length > 0) {
    const { rows } = await db.query(
      `SELECT canonical_name, common_names, family, kingdom FROM species WHERE id = ANY($1)`,
      [speciesIds],
    )
    const descs = rows.map((r: any) => {
      const common = Array.isArray(r.common_names) && r.common_names.length > 0 ? ` (${r.common_names[0]})` : ''
      const taxon = [r.family, r.kingdom].filter(Boolean).join(', ')
      return `${r.canonical_name}${common}${taxon ? ' — ' + taxon : ''}`
    })
    if (descs.length > 0) parts.push(`Species: ${descs.join('; ')}`)
  }

  // Concepts: include definition, scope
  const conceptIds = (topByType.concept || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (conceptIds.length > 0) {
    const { rows } = await db.query(
      `SELECT name, definition, scope, concept_type FROM concepts WHERE id = ANY($1)`,
      [conceptIds],
    )
    const descs = rows.map((r: any) => {
      const def = r.definition ? `: ${r.definition.slice(0, 100)}` : ''
      const scope = r.scope ? ` [${r.scope}]` : ''
      return `${r.name}${scope}${def}`
    })
    if (descs.length > 0) parts.push(`Concepts: ${descs.join('; ')}`)
  }

  // Protocols: include description, category
  const protocolIds = (topByType.protocol || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (protocolIds.length > 0) {
    const { rows } = await db.query(
      `SELECT name, description, category FROM protocols WHERE id = ANY($1)`,
      [protocolIds],
    )
    const descs = rows.map((r: any) => {
      const desc = r.description ? `: ${r.description.slice(0, 80)}` : ''
      const cat = r.category ? ` [${r.category}]` : ''
      return `${r.name}${cat}${desc}`
    })
    if (descs.length > 0) parts.push(`Protocols: ${descs.join('; ')}`)
  }

  // Places: include place_type, elevation
  const placeIds = (topByType.place || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (placeIds.length > 0) {
    const { rows } = await db.query(
      `SELECT name, place_type, elevation_m FROM places WHERE id = ANY($1)`,
      [placeIds],
    )
    const descs = rows.map((r: any) => {
      const type = r.place_type ? ` (${r.place_type.replace(/_/g, ' ')})` : ''
      const elev = r.elevation_m ? `, ${r.elevation_m}m` : ''
      return `${r.name}${type}${elev}`
    })
    if (descs.length > 0) parts.push(`Places: ${descs.join('; ')}`)
  }

  // Stakeholders: include type
  const stakeholderIds = (topByType.stakeholder || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (stakeholderIds.length > 0) {
    const { rows } = await db.query(
      `SELECT name, stakeholder_type FROM stakeholders WHERE id = ANY($1)`,
      [stakeholderIds],
    )
    const descs = rows.map((r: any) => {
      const type = r.stakeholder_type ? ` [${r.stakeholder_type.replace(/_/g, ' ')}]` : ''
      return `${r.name}${type}`
    })
    if (descs.length > 0) parts.push(`Stakeholders: ${descs.join('; ')}`)
  }

  // Authors: just names (already in topByType)
  const authorNames = (topByType.author || []).slice(0, TOP_N).map((m: any) => m.name)
  if (authorNames.length > 0) parts.push(`Authors: ${authorNames.join(', ')}`)

  // Publications: full titles from DB
  const pubIds = (topByType.publication || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (pubIds.length > 0) {
    const { rows } = await db.query(`SELECT title, year, journal FROM publications WHERE id = ANY($1)`, [pubIds])
    const descs = rows.map((r: any) => {
      const meta = [r.year, r.journal].filter(Boolean).join(', ')
      return `${r.title}${meta ? ' (' + meta + ')' : ''}`
    })
    if (descs.length > 0) parts.push(`Publications: ${descs.join('; ')}`)
  }

  // Documents: titles + type
  const docIds = (topByType.document || []).slice(0, TOP_N).map((m: any) => {
    const rawId = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id
    return parseInt(rawId)
  }).filter((id: number) => !isNaN(id))
  if (docIds.length > 0) {
    const { rows } = await db.query(
      `SELECT title, document_type FROM documents WHERE id = ANY($1)`,
      [docIds],
    )
    const descs = rows.map((r: any) => {
      const type = r.document_type ? ` [${r.document_type.replace(/_/g, ' ')}]` : ''
      return `${r.title?.slice(0, 80)}${type}`
    })
    if (descs.length > 0) parts.push(`Documents: ${descs.join('; ')}`)
  }

  return parts.join('\n')
}

async function main() {
  console.log('Generate Community Descriptions')
  console.log('===============================')
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  const commData = JSON.parse(readFileSync('public/graph/communities.json', 'utf-8'))
  const communities = commData.communities as any[]
  console.log(`${communities.length} communities to describe`)

  const toProcess = communities.slice(0, limit)
  let described = 0
  let cost = 0

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i]
    const context = await enrichContext(db, c)

    if (dryRun) {
      console.log(`  ${i + 1}. ${c.label} (${c.size} nodes)`)
      if (i < 3) { console.log(`    Context:\n${context.split('\n').map((l: string) => '      ' + l).join('\n')}`) }
      continue
    }

    try {
      const { data, response } = await callClaudeJson({
        apiKey: ANTHROPIC_API_KEY,
        prompt: PROMPT,
        content: context,
        maxTokens: 256,
      })

      if (data) {
        c.title = data.title || c.label
        c.summary = data.summary || null
        c.themes = data.themes || []
        cost += response.cost
        described++
        console.log(`  ${i + 1}. "${c.title}" — ${c.summary?.slice(0, 80)}...`)
      }
    } catch (err: any) {
      console.log(`  ${i + 1}. Error: ${err.message?.slice(0, 80)}`)
    }

    await sleep(300)
  }

  if (!dryRun) {
    writeFileSync('public/graph/communities.json', JSON.stringify(commData, null, 2))
    console.log(`\nDescribed ${described} communities, cost: $${cost.toFixed(2)}`)
    console.log('Written to public/graph/communities.json')
  }

  await db.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
