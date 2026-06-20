/**
 * STAGE-A PILOT: paper-grounded frontier extraction
 * ==================================================
 *
 * Tests whether existing `keyFindings + abstracts` content is enough source
 * material to extract frontier statements grounded in *verbatim citations
 * from the source papers* — not in the primer-as-intermediate.
 *
 * Input shape for each neighborhood:
 *   - Top N papers (mix of most-cited + most-recent), with their:
 *     - title, year, pub_id
 *     - abstract (when present)
 *     - keyFindings array (when present): {finding, confidence, supportingEvidence}
 *
 * Output shape (per neighborhood):
 *   {
 *     "neighborhood": { community_id, title, ... },
 *     "input_paper_count": N,
 *     "statements": [
 *       {
 *         "text": "...",
 *         "kind": "open_question" | "data_gap" | "methodological_blocker" | "coordination_gap",
 *         "confidence": "low" | "moderate" | "high",
 *         "cites": [
 *           { "pub_id": ..., "snippet": "verbatim quote from input", "role": "articulates" | "..." }
 *         ]
 *       }
 *     ],
 *     "verification": {
 *       "statements_emitted": N,
 *       "statements_grounded": M,           // all cites verified verbatim
 *       "statements_dropped_ungrounded": N - M,
 *       "cites_emitted": K,
 *       "cites_verified": V,                // snippet found verbatim in input
 *     }
 *   }
 *
 * Outputs land in:
 *   scripts/output/grounded-frontiers-pilot.json   (machine-readable)
 *   scripts/output/grounded-frontiers-pilot.md     (human-readable, easy hand-check)
 *
 * Cost: ~$0.10 per neighborhood with Sonnet 4.6.
 *       Default = Sonnet for the pilot; pass --model=opus to compare.
 *
 * Usage:
 *   npx tsx scripts/pilot-grounded-frontiers.ts
 *   npx tsx scripts/pilot-grounded-frontiers.ts --community-ids=0,40,47
 *   npx tsx scripts/pilot-grounded-frontiers.ts --papers=20 --model=opus
 *   npx tsx scripts/pilot-grounded-frontiers.ts --dry-run     (print prompt, no LLM)
 *
 * Tracks: refactor design for grounded Frontier extraction (no GH issue yet).
 */

import pg from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const PAPERS_PER_NBR = parseInt(args.find(a => a.startsWith('--papers='))?.split('=')[1] || '30')
const MODEL = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'claude-sonnet-4-6'
const COMMUNITY_IDS = (args.find(a => a.startsWith('--community-ids='))?.split('=')[1] || '0,40,47,91,95')
  .split(',').map(s => parseInt(s.trim())).filter(Number.isFinite)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
if (!dryRun && !ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Either export it or pass --dry-run.')
  process.exit(1)
}

interface KeyFinding {
  finding: string
  confidence: string
  supportingEvidence?: string
}

interface InputPaper {
  pub_id: number
  year: number | null
  title: string
  abstract: string | null
  keyFindings: KeyFinding[]
}

interface Citation {
  pub_id: number
  snippet: string
  role: string
}

interface Statement {
  text: string
  kind: string
  confidence: string
  cites: Citation[]
}

interface Verification {
  statements_emitted: number
  statements_grounded: number
  statements_dropped_ungrounded: number
  cites_emitted: number
  cites_verified: number
  ungrounded_examples: { statement: string; bad_cite: Citation; reason: string }[]
}

/** Compose the input papers list into the prompt body the LLM sees. */
function renderPapersForPrompt(papers: InputPaper[]): string {
  const parts: string[] = []
  for (const p of papers) {
    parts.push(`### PUB #${p.pub_id} (${p.year ?? 'n.d.'})`)
    parts.push(`Title: ${p.title}`)
    if (p.abstract) parts.push(`Abstract: ${p.abstract.replace(/\s+/g, ' ').trim()}`)
    if (p.keyFindings.length > 0) {
      parts.push(`Key findings (with supporting quotes from the paper):`)
      for (const f of p.keyFindings) {
        const ev = f.supportingEvidence ? ` — Supporting: "${f.supportingEvidence}"` : ''
        parts.push(`  - [${f.confidence}] ${f.finding}${ev}`)
      }
    }
    parts.push('')
  }
  return parts.join('\n')
}

function buildPrompt(neighborhoodTitle: string, papers: InputPaper[]): string {
  return `You are an expert research synthesist reading a curated set of ${papers.length} research papers from the "${neighborhoodTitle}" research neighborhood at the Rocky Mountain Biological Laboratory.

YOUR TASK
Identify atomic frontier statements that the literature articulates. A frontier statement is a specific open question, data gap, methodological blocker, or coordination gap. NOT a finding ("X happens") — only the unanswered side ("we don't know X" / "Y is unresolved" / "the data needed to test Z is unavailable").

GROUNDING REQUIREMENT — STRICT
Each statement MUST cite 1+ specific papers from the input below. Each citation MUST include a VERBATIM SNIPPET drawn from that paper's Abstract, Key finding, or Supporting quote text. The snippet must articulate or reinforce the gap.

If you cannot find a verbatim source-text quote that articulates a gap, DO NOT emit the statement. We prefer fewer well-grounded statements over many paraphrased ones.

KINDS
- "open_question": something the literature explicitly notes as unresolved
- "data_gap": specific data the literature says is missing
- "methodological_blocker": a method or tool the literature says is needed
- "coordination_gap": something the literature flags as requiring cross-group integration

INPUT PAPERS

${renderPapersForPrompt(papers)}

OUTPUT FORMAT — STRICT JSON

{
  "statements": [
    {
      "text": "<one specific frontier statement, 1-2 sentences>",
      "kind": "open_question" | "data_gap" | "methodological_blocker" | "coordination_gap",
      "confidence": "low" | "moderate" | "high",
      "cites": [
        {
          "pub_id": <numeric pub_id from input>,
          "snippet": "<VERBATIM substring of the paper's Abstract / Key finding / Supporting evidence text from the input above>",
          "role": "articulates" | "reinforces"
        }
      ]
    }
  ]
}

Emit between 3 and 10 statements. If you cannot find at least 3 well-grounded ones, emit fewer. Quality over quantity.`
}

/** Normalize text for substring matching. Beyond whitespace collapse, this
 *  handles the failure modes the first pilot run surfaced:
 *
 *   - Smart quotes vs straight (LLM output, then verbatim check, disagree)
 *   - Em / en dashes vs hyphens
 *   - Non-breaking spaces, zero-width chars
 *   - Trailing ellipses on the LLM-side snippet ("…" or "...")
 *   - Case differences (already handled, kept)
 *
 *  The trailing-ellipsis strip is conservative: only when it's at the very
 *  end of the snippet and clearly a truncation marker, not when it appears
 *  mid-quote.
 */
function normalize(s: string): string {
  return s
    // unicode-normalize so curly quotes / accented chars compare cleanly
    .normalize('NFKC')
    // smart quotes → straight
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    // em / en dash → hyphen
    .replace(/[–—―]/g, '-')
    // non-breaking spaces, zero-width → regular space / drop
    .replace(/[  ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Strip trailing-ellipsis truncation markers from an LLM-emitted snippet
 *  before matching. The LLM sometimes adds "..." to signal "and there was
 *  more text in the source after this" — that's fine, we just want to
 *  verify the substring it DID quote actually appears verbatim. */
function trimTrailingEllipsis(s: string): string {
  return s.replace(/[\s,;:!?]*(?:\.\.\.|…|\.\.|\.)\s*$/g, '').trimEnd()
}

/** Find the longest contiguous prefix of `needle` that appears in
 *  `haystack`. Used as a fallback when an exact full-snippet match fails
 *  — if the LLM quoted, say, 90% of a real sentence and then drifted into
 *  paraphrase, we'd rather accept the verbatim portion than reject the
 *  whole cite. Returns the length of the matched prefix.
 */
function longestVerbatimPrefix(needle: string, haystack: string): number {
  if (needle.length === 0) return 0
  let lo = 1, hi = needle.length, best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (haystack.includes(needle.slice(0, mid))) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/** Verify each cited snippet appears verbatim somewhere in the input
 *  for its claimed pub_id. Returns the verified statements + verification
 *  summary. */
function verifyGrounding(statements: Statement[], papers: InputPaper[]): {
  kept: Statement[]
  verification: Verification
} {
  const paperLookup = new Map<number, string>()
  for (const p of papers) {
    const allText = [
      p.title,
      p.abstract || '',
      ...p.keyFindings.map(f => `${f.finding} ${f.supportingEvidence ?? ''}`),
    ].join(' ')
    paperLookup.set(p.pub_id, normalize(allText))
  }

  const ungrounded_examples: Verification['ungrounded_examples'] = []
  let cites_emitted = 0
  let cites_verified = 0
  const kept: Statement[] = []

  for (const stmt of statements) {
    const verifiedCites: Citation[] = []
    for (const cite of stmt.cites || []) {
      cites_emitted++
      const haystack = paperLookup.get(cite.pub_id)
      if (!haystack) {
        ungrounded_examples.push({ statement: stmt.text, bad_cite: cite, reason: `pub_id ${cite.pub_id} not in input` })
        continue
      }
      const needle = normalize(trimTrailingEllipsis(cite.snippet))
      if (needle.length < 20) {
        ungrounded_examples.push({ statement: stmt.text, bad_cite: cite, reason: 'snippet too short to verify (<20 chars)' })
        continue
      }
      if (haystack.includes(needle)) {
        cites_verified++
        verifiedCites.push(cite)
        continue
      }
      // Fallback: longest verbatim prefix. Accept if ≥90% of the snippet
      // is exactly verbatim from the source — the LLM probably truncated
      // or drifted at the tail of the quote, not in the meat of it.
      const prefixLen = longestVerbatimPrefix(needle, haystack)
      if (prefixLen >= Math.max(40, Math.floor(needle.length * 0.9))) {
        cites_verified++
        verifiedCites.push({
          ...cite,
          // Truncate the snippet shown to the user to just the verbatim portion.
          // We can't perfectly reverse the normalization, but we can find the
          // corresponding character range in the original.
          snippet: cite.snippet.slice(0, Math.ceil(cite.snippet.length * prefixLen / needle.length)),
        })
        continue
      }
      ungrounded_examples.push({
        statement: stmt.text, bad_cite: cite,
        reason: prefixLen >= 20
          ? `partial: only ${prefixLen}/${needle.length} chars verbatim`
          : 'snippet not found verbatim in source',
      })
    }
    if (verifiedCites.length > 0) {
      kept.push({ ...stmt, cites: verifiedCites })
    }
  }

  return {
    kept,
    verification: {
      statements_emitted: statements.length,
      statements_grounded: kept.length,
      statements_dropped_ungrounded: statements.length - kept.length,
      cites_emitted,
      cites_verified,
      ungrounded_examples: ungrounded_examples.slice(0, 20),
    },
  }
}

async function fetchInputPapers(db: pg.Pool, neighborhoodId: number, n: number): Promise<InputPaper[]> {
  // Mix: top half by external citation count, top half by recency.
  // Coalesce into a unique set, prefer rows with both abstract AND keyFindings.
  const half = Math.ceil(n / 2)
  const { rows } = await db.query(
    `
    WITH neighbor_pubs AS (
      SELECT DISTINCT p.id, p.year, p.title, p.abstract,
             coalesce(p.external_citation_count, 0) AS citations,
             cc.metadata->'keyFindings' AS kf
        FROM neighborhood_members nm
        JOIN publications p ON p.id = nm.entity_id
        LEFT JOIN content_chunks cc ON cc.item_id = p.id AND cc.collection = 'publications'
       WHERE nm.neighborhood_id = $1 AND nm.entity_type = 'publication'
         AND (p.abstract IS NOT NULL OR cc.metadata ? 'keyFindings')
    ),
    by_cit AS (
      SELECT *, 'cit' AS source FROM neighbor_pubs ORDER BY citations DESC NULLS LAST LIMIT $2
    ),
    by_recent AS (
      SELECT *, 'recent' AS source FROM neighbor_pubs ORDER BY year DESC NULLS LAST LIMIT $2
    ),
    merged AS (
      SELECT DISTINCT ON (id) * FROM (
        SELECT * FROM by_cit UNION ALL SELECT * FROM by_recent
      ) x
      ORDER BY id
    )
    SELECT id, year, title, abstract, kf FROM merged
    `,
    [neighborhoodId, half],
  )
  return rows.map((r) => ({
    pub_id: r.id,
    year: r.year,
    title: r.title,
    abstract: r.abstract,
    keyFindings: Array.isArray(r.kf) ? r.kf as KeyFinding[] : [],
  }))
}

interface NeighborhoodResult {
  community_id: number
  neighborhood_id: number
  title: string
  input_paper_count: number
  input_papers: { pub_id: number; year: number | null; title: string; has_abstract: boolean; n_keyfindings: number }[]
  statements: Statement[]
  verification: Verification
  llm_raw_count: number
}

async function processNeighborhood(db: pg.Pool, communityId: number): Promise<NeighborhoodResult | null> {
  const { rows: [nbr] } = await db.query(
    `SELECT id, community_id, title FROM neighborhoods WHERE community_id = $1 LIMIT 1`,
    [communityId],
  )
  if (!nbr) {
    console.log(`  ⚠ community_id ${communityId} — no neighborhood found, skipping`)
    return null
  }

  const papers = await fetchInputPapers(db, nbr.id, PAPERS_PER_NBR)
  if (papers.length === 0) {
    console.log(`  ⚠ ${nbr.title} — no source papers with abstract or keyFindings, skipping`)
    return null
  }

  const prompt = buildPrompt(nbr.title, papers)
  console.log(`  → ${nbr.title}: ${papers.length} papers, prompt ${prompt.length} chars`)

  if (dryRun) {
    console.log(`     (dry-run: skipping LLM call)`)
    return {
      community_id: communityId, neighborhood_id: nbr.id, title: nbr.title,
      input_paper_count: papers.length,
      input_papers: papers.map(p => ({ pub_id: p.pub_id, year: p.year, title: p.title, has_abstract: !!p.abstract, n_keyfindings: p.keyFindings.length })),
      statements: [], verification: { statements_emitted: 0, statements_grounded: 0, statements_dropped_ungrounded: 0, cites_emitted: 0, cites_verified: 0, ungrounded_examples: [] },
      llm_raw_count: 0,
    }
  }

  const { data: llmOutput, response } = await callClaudeJson<{ statements: Statement[] }>({
    apiKey: ANTHROPIC_API_KEY,
    prompt,
    content: '',
    model: MODEL,
    maxTokens: 4000,
  })
  if (!llmOutput) {
    console.log(`     ⚠ failed to parse JSON from LLM (raw len ${response.text.length})`)
    return null
  }

  const rawStatements = llmOutput.statements || []
  console.log(`     cost: $${response.cost.toFixed(4)}  (in=${response.inputTokens} out=${response.outputTokens})`)
  const { kept, verification } = verifyGrounding(rawStatements, papers)

  console.log(`     emitted=${rawStatements.length}  verified=${verification.statements_grounded}  cites_verified=${verification.cites_verified}/${verification.cites_emitted}`)

  return {
    community_id: communityId,
    neighborhood_id: nbr.id,
    title: nbr.title,
    input_paper_count: papers.length,
    input_papers: papers.map(p => ({ pub_id: p.pub_id, year: p.year, title: p.title, has_abstract: !!p.abstract, n_keyfindings: p.keyFindings.length })),
    statements: kept,
    verification,
    llm_raw_count: rawStatements.length,
  }
}

function renderMarkdown(results: NeighborhoodResult[]): string {
  const lines: string[] = []
  lines.push(`# Grounded Frontier Extraction — Stage A Pilot`)
  lines.push('')
  lines.push(`Model: \`${MODEL}\`  ·  Papers per neighborhood: ${PAPERS_PER_NBR}  ·  Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`## Headline grounding rates`)
  lines.push('')
  lines.push(`| Neighborhood | input papers | LLM-emitted | grounded | cite-verify rate |`)
  lines.push(`|---|---:|---:|---:|---:|`)
  for (const r of results) {
    const rate = r.verification.cites_emitted > 0
      ? `${Math.round(100 * r.verification.cites_verified / r.verification.cites_emitted)}%`
      : 'n/a'
    lines.push(`| ${r.title} | ${r.input_paper_count} | ${r.llm_raw_count} | ${r.verification.statements_grounded} | ${rate} (${r.verification.cites_verified}/${r.verification.cites_emitted}) |`)
  }
  lines.push('')

  for (const r of results) {
    lines.push(`---`)
    lines.push('')
    lines.push(`## ${r.title}`)
    lines.push(`**community_id**: ${r.community_id}  ·  **input papers**: ${r.input_paper_count}  ·  **LLM emitted**: ${r.llm_raw_count}  ·  **grounded**: ${r.verification.statements_grounded}`)
    lines.push('')

    if (r.statements.length === 0) {
      lines.push(`_No statements survived grounding verification._`)
      lines.push('')
    }

    for (let i = 0; i < r.statements.length; i++) {
      const s = r.statements[i]
      lines.push(`### Statement ${i + 1} — ${s.kind} (${s.confidence})`)
      lines.push('')
      lines.push(`> ${s.text}`)
      lines.push('')
      lines.push(`**Citations** (${s.cites.length}):`)
      for (const c of s.cites) {
        lines.push(`- **pub #${c.pub_id}** [${c.role}] — *"${c.snippet}"*`)
      }
      lines.push('')
    }

    if (r.verification.ungrounded_examples.length > 0) {
      lines.push(`<details><summary>Ungrounded examples (${r.verification.ungrounded_examples.length}) — for diagnosis</summary>`)
      lines.push('')
      for (const ex of r.verification.ungrounded_examples) {
        lines.push(`- Statement: *"${ex.statement.slice(0, 100)}..."*`)
        lines.push(`  - bad cite: pub #${ex.bad_cite.pub_id}, snippet: *"${ex.bad_cite.snippet.slice(0, 80)}..."*`)
        lines.push(`  - reason: ${ex.reason}`)
      }
      lines.push('')
      lines.push(`</details>`)
      lines.push('')
    }
  }
  return lines.join('\n')
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
  const db = new pg.Pool({ connectionString: url })

  console.log(`Stage A pilot: grounded frontier extraction`)
  console.log(`  model:    ${MODEL}`)
  console.log(`  papers:   ${PAPERS_PER_NBR} per neighborhood`)
  console.log(`  pilot:    ${COMMUNITY_IDS.join(', ')}`)
  console.log(`  dry-run:  ${dryRun}`)
  console.log('')

  const results: NeighborhoodResult[] = []
  for (const cid of COMMUNITY_IDS) {
    const r = await processNeighborhood(db, cid)
    if (r) results.push(r)
  }

  await db.end()

  mkdirSync('scripts/output', { recursive: true })
  writeFileSync('scripts/output/grounded-frontiers-pilot.json', JSON.stringify(results, null, 2))
  writeFileSync('scripts/output/grounded-frontiers-pilot.md', renderMarkdown(results))

  console.log('')
  console.log(`Done. Wrote:`)
  console.log(`  scripts/output/grounded-frontiers-pilot.json`)
  console.log(`  scripts/output/grounded-frontiers-pilot.md   ← hand-check this`)

  const total = results.reduce((acc, r) => ({
    e: acc.e + r.verification.statements_emitted,
    g: acc.g + r.verification.statements_grounded,
    ce: acc.ce + r.verification.cites_emitted,
    cv: acc.cv + r.verification.cites_verified,
  }), { e: 0, g: 0, ce: 0, cv: 0 })
  console.log('')
  console.log(`Aggregate:`)
  console.log(`  statements emitted by LLM:   ${total.e}`)
  console.log(`  statements grounded (kept):  ${total.g}  (${total.e > 0 ? Math.round(100 * total.g / total.e) : 0}%)`)
  console.log(`  cites verified verbatim:     ${total.cv}/${total.ce}  (${total.ce > 0 ? Math.round(100 * total.cv / total.ce) : 0}%)`)
}

main().catch(e => { console.error(e); process.exit(1) })
