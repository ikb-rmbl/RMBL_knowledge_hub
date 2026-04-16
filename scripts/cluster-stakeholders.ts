/**
 * Cluster Stakeholders from Document/Longform Extractions
 *
 * Agencies are extracted as flat strings (not structured objects), so this script:
 *   1. Reads all agency mentions from extraction JSONs
 *   2. Loads them as entity_candidates with entity_type='stakeholder'
 *   3. Normalizes names (expand abbreviations, strip "U.S.", "The", punctuation)
 *   4. Groups by normalized name (exact match)
 *   5. Uses Voyage AI embeddings + cosine similarity to merge near-duplicates
 *      (e.g., "USFS" with "U.S. Forest Service")
 *   6. Creates canonical stakeholders rows + entity_mentions
 *
 * Usage:
 *   npx tsx scripts/cluster-stakeholders.ts [--threshold=0.90] [--dry-run]
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import './lib/config.js'
import { embedTexts, clusterCandidates } from './lib/embedding-cluster.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const threshold = parseFloat(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || '0.90')

// Common abbreviation expansions — apply before normalizing so "USFS" and
// "U.S. Forest Service" resolve to the same key
const ABBREVIATIONS: Record<string, string> = {
  'usfs': 'us forest service',
  'forest service': 'us forest service',
  'national forest service': 'us forest service',
  'usda forest service': 'us forest service',
  'us forest service': 'us forest service',
  'united states forest service': 'us forest service',
  'u s department of agriculture forest service': 'us forest service',
  'blm': 'us bureau of land management',
  'u s bureau of land management': 'us bureau of land management',
  'bureau of land management': 'us bureau of land management',
  'united states bureau of land management': 'us bureau of land management',
  'epa': 'us environmental protection agency',
  'us epa': 'us environmental protection agency',
  'u s epa': 'us environmental protection agency',
  'environmental protection agency': 'us environmental protection agency',
  'united states environmental protection agency': 'us environmental protection agency',
  'usgs': 'us geological survey',
  'u s geological survey': 'us geological survey',
  'geological survey': 'us geological survey',
  'usfws': 'us fish and wildlife service',
  'u s fish and wildlife service': 'us fish and wildlife service',
  'fish and wildlife service': 'us fish and wildlife service',
  'usda': 'us department of agriculture',
  'u s department of agriculture': 'us department of agriculture',
  'department of agriculture': 'us department of agriculture',
  'doi': 'us department of the interior',
  'u s department of the interior': 'us department of the interior',
  'department of the interior': 'us department of the interior',
  'nps': 'national park service',
  'cdow': 'colorado division of wildlife',
  'colorado department of wildlife': 'colorado division of wildlife',
  'cwcb': 'colorado water conservation board',
  'csu': 'colorado state university',
  'rmbl': 'rocky mountain biological laboratory',
  'bor': 'us bureau of reclamation',
  'bureau of reclamation': 'us bureau of reclamation',
  'noaa': 'national oceanic and atmospheric administration',
  'nsf': 'national science foundation',
  'doe': 'us department of energy',
  'department of energy': 'us department of energy',
  'nrc': 'us nuclear regulatory commission',
  'nrcs': 'natural resources conservation service',
  'fema': 'federal emergency management agency',
}

/** Normalize a stakeholder name for grouping */
function normalize(name: string): string {
  let n = name.trim().toLowerCase()
  // Strip quotes, parentheses content, trailing punctuation
  n = n.replace(/["'"]/g, '')
  n = n.replace(/\([^)]*\)/g, '')
  n = n.replace(/[.,;:]+$/g, '')
  n = n.replace(/\./g, ' ') // "U.S." → "u s"
  n = n.replace(/\s+/g, ' ').trim()
  // Strip leading "the"
  n = n.replace(/^the\s+/, '')
  // Normalize common prefixes
  n = n.replace(/^u s a?\s+/, 'us ')
  n = n.replace(/^united states\s+/, 'us ')
  // Collapse multiple spaces
  n = n.replace(/\s+/g, ' ').trim()
  // Apply abbreviation expansion
  if (ABBREVIATIONS[n]) n = ABBREVIATIONS[n]
  return n
}

/** Guess stakeholder type from name patterns */
function guessType(name: string): string {
  const n = name.toLowerCase()
  // Federal agencies (acronyms, USDA branches, major services)
  if (/\b(epa|usfs|blm|usgs|usfws|usda|nps|noaa|nsf|doe|nrc|fema|nrcs|bor|boem|bsee|faa|fcc|fda)\b/.test(n)) return 'federal_agency'
  if (/\b(forest service|bureau of land management|bureau of reclamation|environmental protection agency|fish and wildlife service|geological survey|department of agriculture|department of energy|department of the interior|park service|army corps of engineers|congress|senate|house of representatives)\b/.test(n)) return 'federal_agency'
  if (/\bfederal\b|\bunited states\b|^us\s|^u\.?s\.?\s/.test(n)) return 'federal_agency'
  // State agencies
  if (/^colorado\s|^state of colorado|\bcdow\b|\bcwcb\b|\bcdnr\b/.test(n)) return 'state_agency'
  // Local government
  if (/\bcounty\b|\bcity of\b|\btown of\b|\bmunicipal\b|\bschool district\b/.test(n)) return 'local_gov'
  // Water conservancy districts are typically quasi-governmental / special districts
  if (/\b(conservancy district|water district|irrigation district|special district)\b/.test(n)) return 'local_gov'
  // Academic
  if (/\buniversity\b|\bcollege\b|\binstitute\b|\blaboratory\b|\brmbl\b|\bresearch center\b/.test(n)) return 'academic'
  // Tribal
  if (/\btribal\b|\btribe\b|\bpueblo\b|\breservation\b/.test(n) && !/\bnational\b/.test(n)) return 'tribal'
  // NGOs, non-profits
  if (/\balliance\b|\bcoalition\b|\bassociation\b|\bconservancy\b|\bsociety\b|\bcouncil\b|\bcommittee\b|\btrust\b|\bfoundation\b|\bclub\b|\bcenter for\b|\bwatch\b/.test(n)) return 'ngo'
  // Industry / private
  if (/\b(inc|corp|llc|company|co\.|industries|ltd|group|partners|holdings)\b/.test(n)) return 'industry'
  return 'other'
}

async function main() {
  console.log('Cluster Stakeholders')
  console.log('====================')
  console.log(`Threshold: ${threshold}`)
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // --- Collect all agency mentions from extraction files ---
    const mentions: { name: string; collection: string; itemId: number }[] = []
    const files = [
      'scripts/output/document-entity-extraction.json',
      'scripts/output/longform-entity-extraction.json',
    ]
    for (const path of files) {
      let items: any[]
      try { items = JSON.parse(readFileSync(path, 'utf-8')) }
      catch { console.log(`  ${path}: not found, skipping`); continue }
      for (const item of items) {
        const collection = item.collection
        if (!['documents', 'publications'].includes(collection)) continue
        const itemId = typeof item.id === 'string'
          ? parseInt(item.id.replace(/^(doc_|pub_)/, ''), 10)
          : item.id
        if (!itemId) continue
        for (const agency of item.strategy3?.extraction?.agencies || []) {
          if (typeof agency !== 'string') continue
          const trimmed = agency.trim()
          if (trimmed.length < 2 || trimmed.length > 200) continue
          mentions.push({ name: trimmed, collection, itemId })
        }
      }
    }
    console.log(`\n${mentions.length} agency mentions across all files`)

    // --- Group by normalized name ---
    const groups = new Map<string, typeof mentions>()
    for (const m of mentions) {
      const key = normalize(m.name)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(m)
    }
    console.log(`${groups.size} unique names after normalization`)

    // --- Select canonical (most-frequent exact variant) per group ---
    interface GroupData { key: string; canonical: string; type: string; aliases: Set<string>; mentions: typeof mentions; embedding?: number[] }
    const groupData: GroupData[] = []
    for (const [key, members] of groups) {
      // Canonical = longest name in the group (more informative)
      const nameCounts = new Map<string, number>()
      for (const m of members) nameCounts.set(m.name, (nameCounts.get(m.name) || 0) + 1)
      const sorted = [...nameCounts.entries()].sort((a, b) => {
        // Prefer longer names, then more frequent
        if (b[0].length !== a[0].length) return b[0].length - a[0].length
        return b[1] - a[1]
      })
      const canonical = sorted[0][0]
      const aliases = new Set([...nameCounts.keys()].filter((n) => n !== canonical))
      groupData.push({ key, canonical, type: guessType(canonical), aliases, mentions: members })
    }

    // --- Embed groups with >=1 mention for near-duplicate clustering ---
    console.log('\nComputing embeddings...')
    const toEmbed = groupData.map((g) => g.canonical)
    const embeddings = await embedTexts(toEmbed)
    for (let i = 0; i < groupData.length; i++) groupData[i].embedding = embeddings[i]

    // --- Cluster via embedding similarity ---
    console.log(`Clustering with threshold ${threshold}...`)
    const withEmb = groupData.filter((g): g is GroupData & { embedding: number[] } => !!g.embedding)
    const clusters = clusterCandidates(withEmb, threshold)
    console.log(`  ${clusters.length} final clusters`)

    // Pick a canonical for each cluster (most mentions across merged groups)
    interface Canonical {
      name: string
      type: string
      aliases: string[]
      centroid: number[]
      mentions: typeof mentions
    }
    const canonicals: Canonical[] = clusters.map((cluster) => {
      // Sort members by mention count (descending)
      const sorted = [...cluster.members].sort((a, b) => b.mentions.length - a.mentions.length)
      const primary = sorted[0]
      const mergedMentions: typeof mentions = []
      const mergedAliases = new Set<string>()
      for (const m of cluster.members) {
        mergedMentions.push(...m.mentions)
        // Add all variants (including other group canonicals) as aliases
        if (m.canonical !== primary.canonical) mergedAliases.add(m.canonical)
        for (const a of m.aliases) mergedAliases.add(a)
      }
      return {
        name: primary.canonical,
        type: primary.type,
        aliases: [...mergedAliases],
        centroid: cluster.centroid,
        mentions: mergedMentions,
      }
    })

    // Sort by mention count, show top 15
    canonicals.sort((a, b) => b.mentions.length - a.mentions.length)
    console.log('\nTop stakeholders after clustering:')
    for (const c of canonicals.slice(0, 15)) {
      console.log(`  ${c.mentions.length}x "${c.name}" [${c.type}] aliases: ${c.aliases.slice(0, 3).join(', ')}${c.aliases.length > 3 ? '...' : ''}`)
    }

    if (dryRun) {
      console.log(`\n(DRY RUN) Would create ${canonicals.length} stakeholders and ${canonicals.reduce((s, c) => s + c.mentions.length, 0)} mentions`)
      return
    }

    // --- Clear existing + insert new ---
    console.log('\nClearing previous stakeholder data...')
    await db.query("DELETE FROM entity_mentions WHERE entity_type = 'stakeholder'")
    await db.query('DELETE FROM stakeholders')

    console.log(`Creating ${canonicals.length} stakeholder records...`)
    let created = 0
    const entityIds: number[] = []
    const entityItemIds: number[] = []
    const entityCollections: string[] = []

    for (const c of canonicals) {
      const { rows: [sh] } = await db.query(
        `INSERT INTO stakeholders (name, stakeholder_type, aliases, embedding)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [c.name, c.type, c.aliases, JSON.stringify(c.centroid)],
      )
      created++
      for (const m of c.mentions) {
        entityIds.push(sh.id)
        entityItemIds.push(m.itemId)
        entityCollections.push(m.collection)
      }
      if (created % 500 === 0) process.stdout.write(`\r  ${created}/${canonicals.length}`)
    }
    console.log(`\r  ${created}/${canonicals.length} stakeholders created`)

    // Batch insert entity_mentions
    if (entityIds.length > 0) {
      console.log(`Inserting ${entityIds.length} entity_mentions...`)
      const roles = entityIds.map(() => 'mentioned')
      await db.query(`
        INSERT INTO entity_mentions (entity_type, entity_id, collection, item_id, role, confidence, extraction_method)
        SELECT 'stakeholder', unnest($1::int[]), unnest($3::text[]), unnest($2::int[]), unnest($4::text[]), 1.0, 'llm_extract'
        ON CONFLICT (entity_type, entity_id, collection, item_id, role) DO NOTHING
      `, [entityIds, entityItemIds, entityCollections, roles])
    }

    // Update mention + publication/document counts
    console.log('Updating counts...')
    await db.query(`
      UPDATE stakeholders SET
        mention_count = sub.total,
        publication_count = sub.pubs,
        document_count = sub.docs
      FROM (
        SELECT entity_id,
          count(*) as total,
          count(*) FILTER (WHERE collection = 'publications') as pubs,
          count(*) FILTER (WHERE collection = 'documents') as docs
        FROM entity_mentions
        WHERE entity_type = 'stakeholder'
        GROUP BY entity_id
      ) sub
      WHERE stakeholders.id = sub.entity_id
    `)

    // Final stats
    const { rows: [stats] } = await db.query(`
      SELECT count(*) as total,
        count(*) FILTER (WHERE document_count > 0) as in_docs,
        count(*) FILTER (WHERE publication_count > 0) as in_pubs
      FROM stakeholders
    `)
    console.log(`\nFinal stakeholder stats:`)
    console.log(`  Total: ${stats.total}`)
    console.log(`  In documents: ${stats.in_docs}`)
    console.log(`  In publications: ${stats.in_pubs}`)

    const { rows: byType } = await db.query(`
      SELECT stakeholder_type, count(*) as n
      FROM stakeholders
      GROUP BY stakeholder_type
      ORDER BY n DESC
    `)
    console.log('\nBy type:')
    for (const r of byType) console.log(`  ${r.n}: ${r.stakeholder_type}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
