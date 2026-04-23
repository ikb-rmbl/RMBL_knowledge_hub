/**
 * Generate Research Primers for Knowledge Neighborhoods
 *
 * Selects the top ~25 neighborhoods by a composite score and generates
 * 500-1000 word primers grounded in actual publication abstracts and
 * VLM-extracted key findings. Uses tiered context assembly:
 *   Tier 1: Landmark papers (top by citations) — full abstract + all findings
 *   Tier 2: Frontier papers (2020+) — title + findings
 *   Tier 3: Breadth papers — title + single best finding
 *   Tier 4: Entity + temporal context
 *
 * Usage:
 *   npx tsx scripts/generate-primers.ts [--dry-run] [--limit=N] [--id=NEIGHBORHOOD_ID]
 *
 * Requires: ANTHROPIC_API_KEY
 */

import pg from 'pg'
import { readFileSync, writeFileSync } from 'fs'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : 25
const singleId = args.find((a) => a.startsWith('--id='))?.split('=')[1]
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
}
const rawModel = args.find((a) => a.startsWith('--model='))?.split('=')[1]
const modelArg = rawModel ? (MODEL_ALIASES[rawModel] || rawModel) : undefined

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

const RESEARCH_PROMPT = `You are writing a research primer for a knowledge neighborhood in the RMBL Knowledge Hub — a platform connecting scientific research, community documents, and environmental datasets from the Rocky Mountain Biological Laboratory in Gothic, Colorado.

Write a 600-1200 word primer covering these sections:

1. **Background** (2-3 paragraphs): Introduce the reader to this area of research. Explain what it is about, why it matters for mountain ecosystems and the Gunnison Basin, and what key concepts a reader needs to understand the findings that follow. Use the KEY CONCEPTS section below as a reference — you don't need to define every concept listed, but introduce the ones that are essential for understanding the key findings and current frontier. Define these in plain language with concrete examples. Avoid specialized jargon in later sections that wasn't introduced here.

2. **Foundational work** (1-2 paragraphs): Summarize the landmark early findings that established this research area. Cite specific publications using [Author, Year] format. Draw from the "LANDMARK PAPERS" section below.

3. **Key findings** (2-3 paragraphs): The most important results across the research community. Draw from extracted key findings provided below. Emphasize findings marked "strong" confidence. Cite [Author, Year]. Weave findings into a narrative rather than listing them.

4. **Current frontier** (1-2 paragraphs): What has been published most recently? Where is the research heading? What new methods or questions are emerging? Use the "FRONTIER PAPERS" section and the year distribution to frame the temporal trajectory. ("Early work in the 1990s established... Recent studies since 2020 have shifted focus to...")

5. **Open questions** (1 paragraph): What remains unknown? What are the most promising directions for the next decade?

RULES:
- Every factual claim MUST be traceable to a provided abstract or key finding
- Use parenthetical citations ONLY for papers listed below — never fabricate
- Citation format: (Author1 & Author2, Year) for two-author papers, (Author1 et al., Year) for three or more. Follow each citation with {pub_id:N} using the pub_id from the paper listing. Example: (Campbell & Powers, 2015){pub_id:391}
- Write for community members, land managers, and undergraduate students — not specialists
- The Background section should introduce the key concepts needed to understand the findings — not necessarily every concept listed, but those essential for comprehension
- After the Background, avoid specialized terms that weren't introduced there
- Do not begin any section with "This neighborhood" or "This community"
- Frame temporal trajectory explicitly

At the end of the primer, include a REFERENCES section listing all cited publications in the format:
  Author1, Author2 (Year). Title. Journal. {pub_id:N}

Return a JSON object with these fields:
{
  "primer_text": "the full primer text including references section",
  "key_findings": ["finding 1", "finding 2", "finding 3"],
  "open_questions": ["question 1", "question 2"]
}

CRITICAL JSON RULES:
- The primer_text value must be a valid JSON string
- Use \\n for newlines, NOT actual line breaks inside the string
- Do NOT use markdown formatting (no ## headers, no **bold**, no *italic*)
- Use plain section labels like "Background" followed by \\n\\n
- Do NOT use backticks, quotes within quotes must be escaped as \\"
- Return valid JSON only, no code fences`

const POLICY_PROMPT = `You are writing a primer for a policy and management knowledge neighborhood in the RMBL Knowledge Hub — a platform connecting scientific research, community documents, and environmental datasets from the Rocky Mountain Biological Laboratory and the Gunnison Basin of western Colorado.

Write a 500-1000 word primer covering these sections:

1. **Background** (1-2 paragraphs): What management or policy area does this neighborhood address? Why does it matter for the Gunnison Basin and western Colorado? Write for an educated non-specialist.

2. **Historical context** (1-2 paragraphs): Key legislation, regulations, and management decisions that shaped this area. Reference specific documents and agencies from the context below.

3. **Management actions and stakeholder roles** (1-2 paragraphs): Who are the key agencies and organizations? What management approaches are used? Reference specific stakeholders and documents.

4. **Current challenges and future directions** (1-2 paragraphs): What are the most pressing issues today? How is the landscape changing? What documents or research point to emerging concerns?

5. **Connections to research** (1 paragraph): How does this policy/management area connect to scientific research at RMBL and in the Gunnison Basin?

RULES:
- Ground all claims in the provided document titles, stakeholder names, and research context
- Write for community members, land managers, and students
- Define technical terms and acronyms on first use
- Do not begin any section with "This neighborhood" or "This community"

Return a JSON object:
{
  "primer_text": "The full primer text",
  "citations_used": [],
  "key_findings": ["key point 1", "key point 2"],
  "open_questions": ["challenge 1", "challenge 2"]
}

Return valid JSON only.`

// ---------------------------------------------------------------------------
// Neighborhood selection
// ---------------------------------------------------------------------------

interface ScoredNeighborhood {
  id: number
  title: string
  size: number
  pubCount: number
  docCount: number
  speciesCount: number
  conceptCount: number
  score: number
  primerType: 'research' | 'policy' | 'mixed'
}

async function selectNeighborhoods(db: pg.Pool): Promise<ScoredNeighborhood[]> {
  const { rows } = await db.query(`
    SELECT n.id, n.title, n.size, n.type_counts
    FROM neighborhoods n
    ORDER BY n.size DESC
  `)

  const scored: ScoredNeighborhood[] = []
  for (const r of rows) {
    const tc = r.type_counts || {}
    const pubCount = tc.publication || 0
    const docCount = tc.document || 0
    const speciesCount = tc.species || 0
    const conceptCount = tc.concept || 0

    if (r.size < 30) continue
    if (pubCount < 10 && docCount < 10) continue

    const score = pubCount * 3 + docCount * 2 + speciesCount + conceptCount * 0.5
    const pubRatio = pubCount / (pubCount + docCount + 1)
    const primerType: 'research' | 'policy' | 'mixed' =
      pubRatio > 0.7 ? 'research' : pubRatio < 0.3 ? 'policy' : 'mixed'

    scored.push({
      id: r.id, title: r.title, size: r.size,
      pubCount, docCount, speciesCount, conceptCount,
      score, primerType,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

async function assembleContext(db: pg.Pool, nbr: ScoredNeighborhood): Promise<string> {
  const parts: string[] = []
  parts.push(`NEIGHBORHOOD: "${nbr.title}" (${nbr.size} nodes)`)
  parts.push(`Type: ${nbr.primerType} | ${nbr.pubCount} publications, ${nbr.docCount} documents, ${nbr.speciesCount} species, ${nbr.conceptCount} concepts`)

  // Get all publication IDs in this neighborhood
  const { rows: pubMembers } = await db.query(`
    SELECT nm.entity_id as pub_id FROM neighborhood_members nm
    WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'publication'
  `, [nbr.id])
  const pubIds = pubMembers.map((r: any) => r.pub_id)

  if (pubIds.length > 0) {
    // Year distribution
    const { rows: yearDist } = await db.query(`
      SELECT
        CASE
          WHEN year >= 2020 THEN '2020-present'
          WHEN year >= 2015 THEN '2015-2019'
          WHEN year >= 2010 THEN '2010-2014'
          WHEN year >= 2000 THEN '2000-2009'
          WHEN year >= 1990 THEN '1990-1999'
          ELSE 'pre-1990'
        END as period,
        COUNT(*) as n
      FROM publications WHERE id = ANY($1) AND year IS NOT NULL
      GROUP BY 1 ORDER BY MIN(year) DESC
    `, [pubIds])
    parts.push(`\nPUBLICATION TIMELINE: ${yearDist.map((r: any) => `${r.period}: ${r.n}`).join(', ')}`)

    // Tier 1: Landmark papers (top 15 by citations)
    const { rows: landmarks } = await db.query(`
      SELECT p.id, p.title, p.year, p.journal, p.doi,
        coalesce(p.external_citation_count, 0) as cites,
        left(p.abstract, 1500) as abstract,
        left(p.full_text, 800) as full_text_excerpt
      FROM publications p
      WHERE p.id = ANY($1)
      ORDER BY coalesce(p.external_citation_count, 0) DESC
      LIMIT 15
    `, [pubIds])

    // Build citation labels for all pubs we might reference
    // Returns "(Author1 & Author2, Year)" or "(Author1 et al., Year)" format
    const landmarkIds = landmarks.map((l: any) => l.id)
    const allContextPubIds = [...pubIds]
    const { rows: authorRows } = await db.query(`
      SELECT ar.publications_id as pub_id, a.family_name, ar."order"
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
      WHERE ar.publications_id = ANY($1) AND ar.path = 'publications'
      ORDER BY ar.publications_id, ar."order" NULLS LAST
    `, [allContextPubIds])

    // Group authors by pub: [{family, order}]
    const authorsByPub = new Map<number, { family: string; order: number }[]>()
    for (const a of authorRows) {
      if (!authorsByPub.has(a.pub_id)) authorsByPub.set(a.pub_id, [])
      authorsByPub.get(a.pub_id)!.push({ family: a.family_name, order: a.order || 999 })
    }

    function citationLabel(pubId: number): string {
      const authors = authorsByPub.get(pubId) || []
      authors.sort((a, b) => a.order - b.order)
      if (authors.length === 0) return 'Unknown'
      if (authors.length === 1) return authors[0].family
      if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}`
      return `${authors[0].family} et al.`
    }

    // Get keyFindings for landmarks
    const { rows: landmarkFindings } = await db.query(`
      SELECT cc.item_id as pub_id, cc.metadata->'keyFindings' as findings
      FROM content_chunks cc
      WHERE cc.item_id = ANY($1) AND cc.chunk_method = 'vlm_extract' AND cc.collection = 'publications'
        AND jsonb_array_length(cc.metadata->'keyFindings') > 0
    `, [landmarkIds])
    const findingsByPub = new Map<number, any[]>()
    for (const f of landmarkFindings) {
      findingsByPub.set(f.pub_id, f.findings || [])
    }

    parts.push('\n--- LANDMARK PAPERS (most cited) ---')
    parts.push('Citation format: use (Author1 & Author2, Year) for 2 authors, (Author1 et al., Year) for 3+. Include {pub_id:N} after each citation for linking.')
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i]
      const label = citationLabel(p.id)
      const nAuthors = (authorsByPub.get(p.id) || []).length
      parts.push(`\n[${i + 1}] "${p.title}" — ${label}, ${p.year || '?'} (${p.journal || 'unknown journal'}) [${p.cites} citations] [${nAuthors} authors] [pub_id:${p.id}]`)
      if (p.abstract) parts.push(`  Abstract: ${p.abstract}`)
      if (i < 5 && p.full_text_excerpt) parts.push(`  Excerpt: ${p.full_text_excerpt}`)
      const findings = findingsByPub.get(p.id)
      if (findings && findings.length > 0) {
        for (const f of findings) {
          parts.push(`  Finding [${f.confidence}]: ${f.finding}`)
        }
      }
    }

    // Tier 2: Frontier papers (2020+, sorted by year desc)
    const landmarkIdSet = new Set(landmarkIds)
    const { rows: frontier } = await db.query(`
      SELECT p.id, p.title, p.year, p.journal,
        coalesce(p.external_citation_count, 0) as cites,
        left(p.abstract, 800) as abstract
      FROM publications p
      WHERE p.id = ANY($1) AND p.year >= 2020 AND p.id != ALL($2)
      ORDER BY p.year DESC, p.external_citation_count DESC NULLS LAST
      LIMIT 15
    `, [pubIds, landmarkIds])

    const frontierIds = frontier.map((f: any) => f.id)
    const { rows: frontierFindings } = await db.query(`
      SELECT cc.item_id as pub_id, cc.metadata->'keyFindings' as findings
      FROM content_chunks cc
      WHERE cc.item_id = ANY($1) AND cc.chunk_method = 'vlm_extract' AND cc.collection = 'publications'
        AND jsonb_array_length(cc.metadata->'keyFindings') > 0
    `, [frontierIds])
    const frontierFindingsByPub = new Map<number, any[]>()
    for (const f of frontierFindings) frontierFindingsByPub.set(f.pub_id, f.findings || [])

    if (frontier.length > 0) {
      parts.push('\n--- FRONTIER PAPERS (2020+, most recent) ---')
      for (const p of frontier) {
        const label = citationLabel(p.id)
        parts.push(`\n"${p.title}" — ${label}, ${p.year} (${p.journal || '?'}) [pub_id:${p.id}]`)
        if (p.abstract) parts.push(`  Abstract: ${p.abstract}`)
        const findings = frontierFindingsByPub.get(p.id)
        if (findings) for (const f of findings) parts.push(`  Finding [${f.confidence}]: ${f.finding}`)
      }
    }

    // Tier 3: Breadth papers (remaining, single best finding each)
    const usedIds = new Set([...landmarkIds, ...frontierIds])
    const remainingIds = pubIds.filter((id: number) => !usedIds.has(id))
    if (remainingIds.length > 0) {
      const { rows: breadthFindings } = await db.query(`
        SELECT cc.item_id as pub_id, p.title, p.year,
          (cc.metadata->'keyFindings'->0->>'finding') as best_finding,
          (cc.metadata->'keyFindings'->0->>'confidence') as confidence
        FROM content_chunks cc
        JOIN publications p ON p.id = cc.item_id
        WHERE cc.item_id = ANY($1) AND cc.chunk_method = 'vlm_extract' AND cc.collection = 'publications'
          AND jsonb_array_length(cc.metadata->'keyFindings') > 0
        ORDER BY p.external_citation_count DESC NULLS LAST
        LIMIT 60
      `, [remainingIds])

      if (breadthFindings.length > 0) {
        parts.push('\n--- ADDITIONAL FINDINGS (one per paper) ---')
        for (const f of breadthFindings) {
          parts.push(`"${f.title}" (${f.year || '?'}) [${f.confidence}]: ${f.best_finding} [pub_id:${f.pub_id}]`)
        }
      }
    }
  }

  // Tier 4: Entity context
  // Species (all in neighborhood)
  const { rows: speciesRows } = await db.query(`
    SELECT s.canonical_name, s.common_names, s.family, s.kingdom
    FROM neighborhood_members nm JOIN species s ON s.id = nm.entity_id
    WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'species'
    ORDER BY nm.degree DESC LIMIT 15
  `, [nbr.id])
  if (speciesRows.length > 0) {
    parts.push('\n--- KEY SPECIES ---')
    for (const s of speciesRows) {
      const common = Array.isArray(s.common_names) && s.common_names[0] ? ` (${s.common_names[0]})` : ''
      parts.push(`${s.canonical_name}${common} — ${[s.family, s.kingdom].filter(Boolean).join(', ')}`)
    }
  }

  // Concepts (all in neighborhood — these ground the Background section)
  const { rows: conceptRows } = await db.query(`
    SELECT c.name, c.definition, c.scope
    FROM neighborhood_members nm JOIN concepts c ON c.id = nm.entity_id
    WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'concept'
    ORDER BY nm.degree DESC
  `, [nbr.id])
  if (conceptRows.length > 0) {
    parts.push('\n--- KEY CONCEPTS (introduce all of these in the Background section) ---')
    for (const c of conceptRows) {
      const def = c.definition ? `: ${c.definition.slice(0, 200)}` : ''
      parts.push(`${c.name} [${c.scope || '?'}]${def}`)
    }
  }

  // Protocols (up to 10)
  const { rows: protoRows } = await db.query(`
    SELECT p.name, p.description, p.category
    FROM neighborhood_members nm JOIN protocols p ON p.id = nm.entity_id
    WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'protocol'
    ORDER BY nm.degree DESC LIMIT 10
  `, [nbr.id])
  if (protoRows.length > 0) {
    parts.push('\n--- KEY METHODS ---')
    for (const p of protoRows) {
      const desc = p.description ? `: ${p.description.slice(0, 100)}` : ''
      parts.push(`${p.name} [${p.category || '?'}]${desc}`)
    }
  }

  // Places
  const { rows: placeRows } = await db.query(`
    SELECT p.name, p.place_type, p.elevation_m
    FROM neighborhood_members nm JOIN places p ON p.id = nm.entity_id
    WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'place'
    ORDER BY nm.degree DESC LIMIT 3
  `, [nbr.id])
  if (placeRows.length > 0) {
    parts.push('\n--- KEY PLACES ---')
    for (const p of placeRows) parts.push(`${p.name}${p.place_type ? ' (' + p.place_type.replace(/_/g, ' ') + ')' : ''}${p.elevation_m ? ', ' + p.elevation_m + 'm' : ''}`)
  }

  // Stakeholders (for policy/mixed)
  if (nbr.primerType !== 'research') {
    const { rows: shRows } = await db.query(`
      SELECT s.name, s.stakeholder_type
      FROM neighborhood_members nm JOIN stakeholders s ON s.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'stakeholder'
      ORDER BY nm.degree DESC LIMIT 5
    `, [nbr.id])
    if (shRows.length > 0) {
      parts.push('\n--- KEY STAKEHOLDERS ---')
      for (const s of shRows) parts.push(`${s.name} [${(s.stakeholder_type || 'other').replace(/_/g, ' ')}]`)
    }

    // Documents (for policy/mixed)
    const { rows: docRows } = await db.query(`
      SELECT d.title, d.document_type
      FROM neighborhood_members nm JOIN documents d ON d.id = nm.entity_id
      WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'document'
      ORDER BY nm.degree DESC LIMIT 8
    `, [nbr.id])
    if (docRows.length > 0) {
      parts.push('\n--- KEY DOCUMENTS ---')
      for (const d of docRows) parts.push(`"${d.title?.slice(0, 80)}" [${(d.document_type || 'document').replace(/_/g, ' ')}]`)
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Citation verification
// ---------------------------------------------------------------------------

/**
 * Post-process primer text:
 * - Convert inline (Author et al., Year){pub_id:N} → [(Author et al., Year)](/publications/N)
 * - Convert reference list entries ending with {pub_id:N} → link the title
 * - Clean up any stray {pub_id:N} tags
 */
function linkCitations(text: string): string {
  // Inline citations: (citation text){pub_id:N} → [(citation text)](/publications/N)
  let linked = text.replace(
    /\(([^)]+)\)\s*\{pub_id:(\d+)\}/g,
    '[$1](/publications/$2)',
  )
  // Reference list: "Title" ... {pub_id:N} → ["Title" ...](/publications/N)
  linked = linked.replace(
    /"([^"]+)"\.\s*\*([^*]+)\*\.?\s*\{pub_id:(\d+)\}/g,
    '["$1."](/publications/$3) *$2*.',
  )
  // Fallback: any remaining {pub_id:N} at end of a line → append link
  linked = linked.replace(
    /([^\n]+)\s*\{pub_id:(\d+)\}/g,
    (match, prefix, id) => `${prefix.trim()} [→](/publications/${id})`,
  )
  return linked
}

function verifyCitations(citationsUsed: any[], pubIdsInContext: Set<number>): { valid: number; invalid: number; details: string[] } {
  let valid = 0, invalid = 0
  const details: string[] = []
  for (const c of citationsUsed) {
    if (c.pub_id && pubIdsInContext.has(c.pub_id)) {
      valid++
    } else {
      invalid++
      details.push(`Ungrounded: [${c.author || '?'}, ${c.year || '?'}] (pub_id ${c.pub_id || 'missing'})`)
    }
  }
  return { valid, invalid, details }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Generate Research Primers')
  console.log('========================')
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1) }
  if (dryRun) console.log('(DRY RUN)')

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 3,
  })

  try {
    let selected: ScoredNeighborhood[]
    if (singleId) {
      const { rows: [nbr] } = await db.query('SELECT * FROM neighborhoods WHERE id = $1', [singleId])
      if (!nbr) { console.error(`Neighborhood ${singleId} not found`); process.exit(1) }
      const tc = nbr.type_counts || {}
      const pubCount = tc.publication || 0
      const docCount = tc.document || 0
      const pubRatio = pubCount / (pubCount + docCount + 1)
      selected = [{
        id: nbr.id, title: nbr.title, size: nbr.size,
        pubCount, docCount, speciesCount: tc.species || 0, conceptCount: tc.concept || 0,
        score: 0, primerType: pubRatio > 0.7 ? 'research' : pubRatio < 0.3 ? 'policy' : 'mixed',
      }]
    } else {
      selected = await selectNeighborhoods(db)
    }

    console.log(`\nSelected ${selected.length} neighborhoods:`)
    for (const n of selected) {
      console.log(`  ${n.id}. "${n.title}" [${n.primerType}] score=${n.score.toFixed(0)} (${n.pubCount} pubs, ${n.docCount} docs)`)
    }

    let generated = 0, totalCost = 0, citationWarnings = 0

    for (let i = 0; i < selected.length; i++) {
      const nbr = selected[i]
      const context = await assembleContext(db, nbr)

      if (dryRun) {
        const wordCount = context.split(/\s+/).length
        const tokenEst = Math.round(wordCount * 1.3)
        console.log(`\n  ${i + 1}. "${nbr.title}" [${nbr.primerType}] ~${tokenEst} tokens context`)
        if (i < 2) {
          console.log('  --- Context preview (first 2000 chars) ---')
          console.log(context.slice(0, 2000).split('\n').map((l: string) => '    ' + l).join('\n'))
          console.log('    ...')
        }
        continue
      }

      const prompt = nbr.primerType === 'policy' ? POLICY_PROMPT : RESEARCH_PROMPT

      try {
        const { data, response } = await callClaudeJson({
          apiKey: ANTHROPIC_API_KEY,
          prompt,
          content: context,
          maxTokens: 8192,
          model: modelArg,
        })

        if (!data?.primer_text) {
          console.log(`  ${i + 1}. "${nbr.title}" — no primer_text in response (cost: $${response.cost.toFixed(3)})`)
          console.log(`    Response start: ${response.text.slice(0, 200)}`)
          continue
        }

        // Post-process: convert {pub_id:N} tags to markdown links
        const linkedPrimer = linkCitations(data.primer_text)

        // Extract pub_ids from linked citations for tracking
        const linkedPubIds = [...linkedPrimer.matchAll(/\/publications\/(\d+)/g)].map(m => parseInt(m[1]))
        const citationsUsed = [...new Set(linkedPubIds)].map(id => ({ pub_id: id }))

        // Verify citations against neighborhood members
        const { rows: contextPubs } = await db.query(
          `SELECT entity_id FROM neighborhood_members WHERE neighborhood_id = $1 AND entity_type = 'publication'`,
          [nbr.id],
        )
        const pubIdSet = new Set(contextPubs.map((r: any) => r.entity_id))
        const verification = verifyCitations(citationsUsed, pubIdSet)

        // Write to DB
        await db.query(`
          UPDATE neighborhoods SET
            primer = $1, primer_type = $2, primer_generated_at = NOW(),
            primer_citations = $3
          WHERE id = $4
        `, [linkedPrimer, nbr.primerType, JSON.stringify(citationsUsed), nbr.id])

        generated++
        totalCost += response.cost
        if (verification.invalid > 0) {
          citationWarnings++
          console.log(`  ${i + 1}. "${nbr.title}" — ${linkedPrimer.length} chars, ${linkedPubIds.length} links, ${verification.invalid} ungrounded`)
        } else {
          console.log(`  ${i + 1}. "${nbr.title}" — ${linkedPrimer.length} chars, ${linkedPubIds.length} linked citations`)
        }
      } catch (err: any) {
        console.log(`  ${i + 1}. Error: ${err.message?.slice(0, 100)}`)
      }

      await sleep(500)
    }

    if (!dryRun) {
      console.log(`\n========== Summary ==========`)
      console.log(`Generated: ${generated} primers`)
      console.log(`Cost: $${totalCost.toFixed(2)}`)
      console.log(`Citation warnings: ${citationWarnings}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
