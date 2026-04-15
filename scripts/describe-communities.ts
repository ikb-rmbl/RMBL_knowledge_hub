/**
 * Generate plain-language descriptions for knowledge neighborhoods.
 *
 * Reads community data from communities.json, sends each community's
 * top members to Claude for a descriptive title + summary sentence,
 * then writes enriched data back.
 *
 * Usage:
 *   npx tsx scripts/describe-communities.ts [--dry-run] [--limit=N]
 *
 * Requires: ANTHROPIC_API_KEY
 */

import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

const PROMPT = `You are describing research communities at the Rocky Mountain Biological Laboratory (RMBL) in Gothic, Colorado. Each community is a cluster of related species, concepts, protocols, places, authors, publications, and datasets that are densely connected in the knowledge graph.

For each community, generate:
1. A short descriptive title (5-10 words, no researcher names, captures the research theme)
2. A one-sentence plain-language summary describing what this research community studies and why it matters
3. A list of 3-5 key themes or keywords

Return a JSON object:
{
  "title": "short descriptive title",
  "summary": "One sentence describing what this research community focuses on.",
  "themes": ["theme1", "theme2", "theme3"]
}

Return valid JSON only.`

async function main() {
  console.log('Generate Community Descriptions')
  console.log('===============================')
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }

  const commData = JSON.parse(readFileSync('public/graph/communities.json', 'utf-8'))
  const communities = commData.communities as any[]
  console.log(`${communities.length} communities to describe`)

  const toProcess = communities.slice(0, limit)
  let described = 0
  let cost = 0

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i]

    // Build context from top members
    const parts: string[] = [`Community with ${c.size} nodes: ${c.description}`]
    for (const [type, members] of Object.entries(c.topByType || {})) {
      const names = (members as any[]).map((m) => m.name).join(', ')
      parts.push(`Top ${type}s: ${names}`)
    }
    const context = parts.join('\n')

    if (dryRun) {
      console.log(`  ${i + 1}. ${c.label} (${c.size} nodes)`)
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
}

main().catch((err) => { console.error(err); process.exit(1) })
