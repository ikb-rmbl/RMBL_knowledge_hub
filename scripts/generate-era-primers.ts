/**
 * Generate Era Primers
 *
 * Synthesizes a period portrait of environmental research at RMBL and the
 * Gunnison Basin for each calendar era (the decade-or-bucket rows in the
 * `eras` table). Mirrors the structure of scripts/generate-primers.ts (the
 * neighborhood primer pipeline) but with era-specific context assembly:
 *
 *   - Era metadata: name, year range, prior era for trajectory framing
 *   - Top-cited publications in the era (the anchor for grounded claims)
 *   - Recent documents + top datasets (community/policy context)
 *   - Top distinctive concepts (research lens AND policy lens) — supporting
 *     evidence only, the prompt explicitly demotes these from headline status
 *   - Top distinctive species, protocols, places, stakeholders
 *   - Trajectory: new + rising entities (no fading — the user is concerned
 *     that noisy decline signals could give false "X is over" impressions)
 *   - BROADER PATTERNS: per-era discipline share + recent trajectory tag,
 *     methodological approach share + trajectory tag, corpus context numbers
 *     (avg co-authors, refs per paper, full-text coverage, etc.), cohort
 *     composition. These give the LLM the "computational methods rising
 *     over the last two eras" sort of structural claim it can ground a
 *     paragraph in without burying it in numbers.
 *
 * Usage:
 *   npx tsx scripts/generate-era-primers.ts [--slug=ERA_SLUG] [--limit=N]
 *                                           [--dry-run] [--skip-existing]
 *                                           [--model=opus|sonnet]
 *
 * Requires: ANTHROPIC_API_KEY
 */

import pg from 'pg'
import './lib/config.js'
import { callClaudeJson } from './lib/claude-api.js'
import { sleep } from './lib/concurrency.js'
import {
  getEra,
  getEraTopEntities,
  getEraTopPublications,
  getEraRecentDocuments,
  getEraTopDatasets,
  getEraTrajectorySnapshot,
  getDiversityAcrossEras,
  getPublicationContextByEra,
  getAuthorCohortsByEra,
  getEraSignature,
  getEraNewsContext,
  RESEARCH_SOURCES,
  POLICY_SOURCES,
  type Era,
  type EraCategoryBreakdown,
  type EraSignature,
  type EraNewsItem,
  type TopEntity,
  type TrajectoryEntity,
} from '../src/services/eras.js'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const skipExisting = args.includes('--skip-existing')
const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1]
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const modelArg = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'opus'
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

const MODELS: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
}
const modelId = MODELS[modelArg] ?? MODELS.opus

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PROMPT = `You are writing a period primer about environmental research at the Rocky Mountain Biological Laboratory (RMBL) in Gothic, Colorado, and across the broader Gunnison Basin, during a specific window of years. RMBL is a non-profit field station for long-term ecological research; the Gunnison Basin is a high-elevation watershed in western Colorado where alpine and subalpine ecology has been studied since the 1920s.

Your primer should read as a period portrait of the science being done in the basin — what was studied, how, where it intersected with land management and community concerns, and what new currents were taking shape. Anchor it in the specific publications, documents, and datasets you are given below, but place those in their wider historical and scientific moment.

CRITICAL: This is NOT a description of a database, archive, or catalog. Do not refer to "the corpus," "the Commons," "the collection," "the catalog," "the database," "a record," or similar meta-vocabulary. Write about the research, the basin, and the era. The reader does not know or care about how the underlying material is organized.

Audience: a curious community member, a journalist, an RMBL scientist, and a student — all at once. Use plain language; define technical terms in passing; assume curiosity and intelligence but not specialist knowledge.

Write a 800-1400 word primer covering these sections. Use plain section labels with a blank line after each, no markdown (no ## headers, no **bold**, no *italic*, no backticks):

1. Setting (1-2 paragraphs)
   What was DIFFERENT about basin science in this particular period? Lead with one or two claims drawn from ERA SIGNATURE that wouldn't apply equally to the prior or following era — a step-change in collaboration, a sharp shift in research scope, a methodological reorientation, the first appearance of a new technique, a step-change in public attention. Place the era in its wider scientific moment by tying ERA SIGNATURE shifts to specific named events whose year falls inside the era window (e.g., "the same year as the IPCC's AR5") — vague period-mood framing ("the IPCC era," "the post-Paris era") is not acceptable in the Setting section unless an actual event year is named.

   FORBIDDEN openings for this section: any sentence whose meaning would survive substituting any other era's name in place of this one's, anything that characterizes the era as "busy," "humming," "expansion," "growth," "boom," "flourishing," or similar growth-language, anything that opens with the era's publication count or researcher count, anything that asserts most researchers were publishing in the basin for the first time (newcomers always dominate in a growing community — this is true of every era and adds nothing). Treat publication counts, researcher counts, average co-authors, average references, and newcomer share as BACKGROUND LEVELS — they may appear in prose only if ERA SIGNATURE flags them as atypical (e.g., a >20% pub-count change, a >0.3 jump in avg co-authors, a >5pp shift in any share).

2. Research focus (2-3 paragraphs)
   The intellectual content of basin science in this era — themes, organisms, study sites, and methods that recurred. Anchor the prose on the era's LANDMARK CANDIDATES (the publication list below), weaving in distinctive concepts, species, and places only when they appear in or alongside those works. Do not lead with single-distinctive-concept claims that aren't grounded in the actual research.

3. Community and policy context (0-2 paragraphs)
   How basin science intersected with land-management, community concerns, and public conversation in this period. Draw on both DOCUMENTS (policy and community materials) and NEWS COVERAGE (regional + national press coverage of basin science). When a clearly substantive story or story cluster appears in NEWS COVERAGE — a profile, a feature, a press cycle around a finding — describe it as a moment of public engagement, not just a citation. Do not name individual reporters or columnists in prose, the same way you do not name individual researchers.

   Sparseness rules for this section:
   - When ERA SIGNATURE notes news coverage as "absent" (pre-digitization eras, typically pre-1970s): do not write a Community and policy paragraph that depends on news; note the era's record on these matters is primarily document-side (if any documents exist) or skip the section entirely.
   - When coverage is "sparse" (a handful of national-press indexing hits only): you may mention national interest in basin work began appearing in this era, but do not over-read the small sample.
   - When coverage is "modest" or "rich": treat NEWS COVERAGE as a first-class source for this section alongside DOCUMENTS.

4. Emerging directions (1 paragraph)
   What new methods, organisms, or questions were beginning to take shape in this era — but only when they also appear in the era's top-cited publications or alongside them. Do not list trending or new entities for their own sake. The TRAJECTORY lists below are supporting evidence, not independent claims.

5. Landmark works (1-2 paragraphs)
   A few of the era's landmark publications, datasets, or documents, described in terms of what they were about and why they mattered for the basin. The LANDMARK CANDIDATES list below tags each paper with three signals — global citation rank (ext), basin-internal citation rank (basin), and basin-entity grounding rank (grounded). Prefer papers that score on two or more signals. When canonizing a paper that scores on only one signal, name what kind of landmark it is — globally pivotal, locally foundational, or basin-grounded — rather than implying impact the signals don't support. Cite explicitly using the format below.

6. Connections (1 paragraph)
   How this era related to the period that came before, and the threads it carried forward. Keep this short — one paragraph, not a recap.

At the end, include a REFERENCES section listing every cited publication, document, and dataset in the format:
   Author1, Author2 (Year). Title. Journal/Source. {pub_id:N}

RULES:
- Every factual claim must trace back to the provided ERA INFORMATION, publication/document/dataset listings, BROADER PATTERNS, or to widely-known scientific or historical context appropriate to the period. Do not fabricate specific events, results, or attribution.
- Do not name individual researchers in the running prose. Author names appear only inside parenthetical citations, e.g., "Studies of marmot dispersal (Armitage, 1989){pub_id:N}...". Never write "Armitage's work showed..." or "Smith and colleagues argued..."
- Do not refer to "the corpus," "the Commons," "the collection," "the catalog," "the database," or similar meta-vocabulary.
- Trajectory and step-change claims (e.g., "scope shifted toward X", "collaboration jumped from N to M co-authors") draw on ERA SIGNATURE and BROADER PATTERNS. Claims about specific concepts, species, or methods being "in play" in this era must still be grounded in either a cited publication or the era's distinctive-entity tables.
- For "new" or "rising" entities: name them in prose only when they are also present in the era's top-cited publications. ERA SIGNATURE new_concepts / new_protocols / new_species are supporting evidence — use them to characterize what entered basin work in this era, but always tie back to a specific cited paper that worked with that concept, method, or organism.
- Do not include or hint at any "fading" or "declining" topics. If a topic is less prominent in this era than earlier, simply do not feature it. Do not contrast against earlier eras with phrases like "less attention to X."
- Citation format: (Author1 & Author2, Year) for two authors; (Author1 et al., Year) for three or more. Follow each citation with {pub_id:N}, {doc_id:N}, or {dataset_id:N}. The braces are required. NEVER write a bare "pub_id:N" or wrap a citation as "(pub_id:N)" without the author-year text — readers see a broken reference if you do.
- Write for community members, journalists, scientists, and students all at once.
- Use plain section labels with a blank line after. No markdown.

CRITICAL JSON RULES:
- The primer_text value must be a valid JSON string
- Use \\n for newlines, NOT actual line breaks inside the string
- Do NOT use markdown formatting (no ## headers, no **bold**, no *italic*)
- Do NOT use backticks, quotes within quotes must be escaped as \\"
- Return valid JSON only, no code fences

Return a JSON object:
{
  "primer_text": "the full primer text including references section",
  "key_themes": ["one-line characterization 1", "..."],
  "open_questions": ["what we don't know about this era 1", "..."]
}`

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

interface AssembledContext {
  context: string
  citationLabels: Map<number, { label: string; year: string | number }>
  docLabels: Map<number, string>
  datasetLabels: Map<number, string>
  pubIds: number[]
}

function trajectoryTag(shares: number[]): { label: string; gloss: string } {
  // shares is ordered oldest → newest with focal era as the LAST element;
  // consider just the last 4 eras (focal + 3 prior).
  const recent = shares.slice(-4)
  if (recent.length < 2) return { label: 'unknown', gloss: '' }
  const first = recent[0]
  const last = recent[recent.length - 1]
  const change = last - first
  const progression = recent.map((s) => `${Math.round(s * 100)}%`).join(' → ')
  if (Math.abs(change) < 0.02) return { label: 'steady', gloss: '' }
  if (change > 0.04) return { label: 'rising', gloss: `, ${progression}` }
  if (change < -0.04) return { label: 'declining', gloss: `, ${progression}` }
  if (change > 0) return { label: 'slightly rising', gloss: '' }
  return { label: 'slightly declining', gloss: '' }
}

interface AuthorRow {
  family: string
  given: string | null
  order: number | null
}

async function fetchPublicationAuthors(
  pool: pg.Pool,
  pubIds: number[],
): Promise<Map<number, AuthorRow[]>> {
  if (pubIds.length === 0) return new Map()
  const { rows } = await pool.query<{ pub_id: number; family: string; given: string | null; order: number | null }>(
    `SELECT _parent_id::int AS pub_id, family, given, _order AS order
       FROM publications_authors
      WHERE _parent_id = ANY($1)
      ORDER BY _parent_id, _order`,
    [pubIds],
  )
  const m = new Map<number, AuthorRow[]>()
  for (const r of rows) {
    if (!m.has(r.pub_id)) m.set(r.pub_id, [])
    m.get(r.pub_id)!.push({ family: r.family, given: r.given, order: r.order })
  }
  return m
}

function formatCitationLabel(authors: AuthorRow[], year: number | null): string {
  if (authors.length === 0) return year ? `(?, ${year})` : '(?)'
  const yr = year ?? '?'
  if (authors.length === 1) return `${authors[0].family}, ${yr}`
  if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}, ${yr}`
  return `${authors[0].family} et al., ${yr}`
}

function distinctiveLine(e: TopEntity): string {
  return `  - ${e.name} (${e.in_era} in era, ${e.out_era} elsewhere, z=${e.z.toFixed(1)})`
}

function trajectoryLine(e: TrajectoryEntity): string {
  if (Number.isNaN(e.z_score)) {
    return `  - ${e.name} (${e.entity_type}, first observed ${e.first_year}, ${e.n_in_era} mentions)`
  }
  return `  - ${e.name} (${e.entity_type}, ${e.n_in_prior} → ${e.n_in_era}, z=${e.z_score.toFixed(1)})`
}

// HTML entities sometimes survive in scraped story titles ("&#038;" → "&",
// "&amp;" → "&"). Story bodies aren't exposed but titles are, so decode the
// common ones before they reach the LLM.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#0?38;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
}

// Formatting helpers for ERA SIGNATURE deltas.
function fmtPctSigned(x: number | null): string {
  if (x === null) return '—'
  const v = Math.round(x * 100)
  if (v === 0) return '~flat'
  return (v > 0 ? '+' : '') + `${v}%`
}
function fmtPP(x: number | null): string {
  if (x === null) return '—'
  const v = Math.round(x * 100)
  if (v === 0) return '~flat'
  return (v > 0 ? '+' : '') + `${v}pp`
}
function fmtAbsSigned(x: number | null, digits = 1): string {
  if (x === null) return '—'
  const v = Number(x.toFixed(digits))
  if (v === 0) return '~flat'
  return (v > 0 ? '+' : '') + `${v}`
}

/**
 * Render the ERA SIGNATURE block. This is the lead context the Setting
 * prompt is told to draw on for era-distinctive claims. Skips lines whose
 * delta is null or too small to matter — the LLM sees only the changes
 * worth naming.
 */
function formatEraSignature(sig: EraSignature): string {
  const lines: string[] = []
  lines.push(
    `ERA SIGNATURE — what is atypical about this era vs the prior era (${sig.prior_era_name ?? 'no prior era'})`,
  )
  lines.push(
    `  This block is the primary source of era-distinctive framing. Lead the Setting section with one or two`,
  )
  lines.push(
    `  claims drawn from here. Where deltas are flat or unknown, the era is unremarkable on that dimension —`,
  )
  lines.push(`  do not invent a distinctiveness claim that the data does not support.`)
  lines.push('')

  // Scale step-changes — only show the ones with non-trivial deltas.
  if (sig.prior_era_name) {
    const scaleLines: string[] = []
    if (sig.n_pubs.pct_change !== null && Math.abs(sig.n_pubs.pct_change) >= 0.1) {
      scaleLines.push(
        `    - publications: ${sig.n_pubs.curr.toLocaleString()} (${fmtPctSigned(sig.n_pubs.pct_change)} vs ${sig.prior_era_name})`,
      )
    }
    if (sig.avg_authors.abs_change !== null && Math.abs(sig.avg_authors.abs_change) >= 0.2) {
      scaleLines.push(
        `    - avg co-authors per paper: ${sig.avg_authors.curr.toFixed(1)} (${fmtAbsSigned(sig.avg_authors.abs_change)} vs prior — collaboration ${sig.avg_authors.abs_change > 0 ? 'intensifying' : 'easing'})`,
      )
    }
    if (sig.avg_refs.abs_change !== null && Math.abs(sig.avg_refs.abs_change) >= 5) {
      scaleLines.push(
        `    - avg references per paper: ${sig.avg_refs.curr.toFixed(0)} (${fmtAbsSigned(sig.avg_refs.abs_change, 0)} vs prior)`,
      )
    }
    if (
      sig.share_internal_refs.abs_change !== null &&
      Math.abs(sig.share_internal_refs.abs_change) >= 0.03
    ) {
      scaleLines.push(
        `    - share of refs to other basin work: ${(sig.share_internal_refs.curr * 100).toFixed(0)}% (${fmtPP(sig.share_internal_refs.abs_change)} vs prior)`,
      )
    }
    if (sig.newcomer_share.abs_change !== null && Math.abs(sig.newcomer_share.abs_change) >= 0.05) {
      scaleLines.push(
        `    - newcomer share: ${(sig.newcomer_share.curr * 100).toFixed(0)}% (${fmtPP(sig.newcomer_share.abs_change)} vs prior)`,
      )
    }
    if (scaleLines.length > 0) {
      lines.push(`  Scale step-changes vs prior era (only deltas worth naming):`)
      lines.push(...scaleLines)
      lines.push('')
    }
  }

  // Methodology step-changes
  if (sig.protocol_step_changes.length > 0) {
    lines.push(`  Methodological step-changes vs prior era (≥3pp; positive = rising):`)
    for (const c of sig.protocol_step_changes) {
      lines.push(
        `    - ${c.category}: ${fmtPP(c.pp_change)} (now ${(c.curr_share * 100).toFixed(0)}% of basin work)`,
      )
    }
    lines.push('')
  }

  // Research-scope step-changes
  if (sig.scope_step_changes.length > 0) {
    lines.push(`  Research-scope step-changes vs prior era (≥3pp):`)
    for (const c of sig.scope_step_changes) {
      lines.push(
        `    - ${c.category}: ${fmtPP(c.pp_change)} (now ${(c.curr_share * 100).toFixed(0)}% of basin work)`,
      )
    }
    lines.push('')
  }

  // First-appearing entities
  const newLines: string[] = []
  if (sig.new_concepts.length > 0) {
    newLines.push(
      `    Concepts: ${sig.new_concepts.map((e) => `${e.name} (${e.n_in_era})`).join(', ')}`,
    )
  }
  if (sig.new_protocols.length > 0) {
    newLines.push(
      `    Protocols/methods: ${sig.new_protocols.map((e) => `${e.name} (${e.n_in_era})`).join(', ')}`,
    )
  }
  if (sig.new_species.length > 0) {
    newLines.push(
      `    Species: ${sig.new_species.map((e) => `${e.name} (${e.n_in_era})`).join(', ')}`,
    )
  }
  if (newLines.length > 0) {
    lines.push(`  First-appearing entities in basin work this era (n = mentions in era):`)
    lines.push(...newLines)
    lines.push('')
  }

  // News
  const news = sig.news
  const coverageLabel =
    news.coverage === 'absent'
      ? 'absent (pre-digitization era; press coverage of basin science is essentially unavailable)'
      : news.coverage === 'sparse'
      ? `sparse (${news.total_curr} stories, ${news.national_curr} national + ${news.total_curr - news.national_curr} local — national-press indexing only, no local archive yet)`
      : news.coverage === 'modest'
      ? `modest (${news.total_curr} stories, ${news.national_curr} national + ${news.total_curr - news.national_curr} local)`
      : `rich (${news.total_curr} stories, ${news.national_curr} national + ${news.total_curr - news.national_curr} local)`
  lines.push(`  Press coverage of basin science: ${coverageLabel}`)
  if (news.total_prior !== null && news.total_prior >= 0 && news.coverage !== 'absent') {
    const totalPriorN = news.total_prior
    if (totalPriorN > 0 || news.total_curr > 5) {
      const pct = totalPriorN > 0 ? ((news.total_curr - totalPriorN) / totalPriorN) * 100 : null
      lines.push(
        `    (prior era ${sig.prior_era_name}: ${totalPriorN} stor${totalPriorN === 1 ? 'y' : 'ies'}${pct !== null ? `; ${pct >= 0 ? '+' : ''}${Math.round(pct)}% vs prior` : ''})`,
      )
    }
  }
  if (news.type_step_changes.length > 0) {
    lines.push(`    Story-type shifts vs prior era (≥5pp):`)
    for (const c of news.type_step_changes) {
      lines.push(
        `      - ${c.category}: ${fmtPP(c.pp_change)} (now ${(c.curr_share * 100).toFixed(0)}% of stories)`,
      )
    }
  }

  return lines.join('\n')
}

async function assembleContext(pool: pg.Pool, era: Era): Promise<AssembledContext> {
  // --- Era metadata + corpus context + cohort ---
  const [pubContexts, cohorts, scopesByEra, protocolCatsByEra] = await Promise.all([
    getPublicationContextByEra(pool),
    getAuthorCohortsByEra(pool),
    getDiversityAcrossEras(pool, 'scope', RESEARCH_SOURCES),
    getDiversityAcrossEras(pool, 'protocol_category', RESEARCH_SOURCES),
  ])
  const pubContext = pubContexts.find((p) => p.era_id === era.id) ?? null
  const cohort = cohorts.find((c) => c.era_id === era.id) ?? null

  // --- Entity tables ---
  const [topResearchConcepts, topPolicyConcepts, topSpecies, topProtocols, topPlaces, topStakeholders] =
    await Promise.all([
      getEraTopEntities(pool, era, 'concept', { limit: 12, sourceCollections: RESEARCH_SOURCES }),
      getEraTopEntities(pool, era, 'concept', { limit: 8, sourceCollections: POLICY_SOURCES }),
      getEraTopEntities(pool, era, 'species', { limit: 10 }),
      getEraTopEntities(pool, era, 'protocol', { limit: 8 }),
      getEraTopEntities(pool, era, 'place', { limit: 8 }),
      getEraTopEntities(pool, era, 'stakeholder', { limit: 8 }),
    ])

  // --- Content samples + signature + news ---
  // 30 publications spans the union of three 25-candidate buckets (external
  // citations / basin-internal citations / basin-entity grounding). With
  // partial overlap the union is typically 35-55; the SQL orders by
  // bucket-coverage then best per-bucket rank, so the cap keeps the strongest
  // multi-signal papers.
  const [topPubs, recentDocs, topDatasets, newsItems, signature] = await Promise.all([
    getEraTopPublications(pool, era, 30),
    getEraRecentDocuments(pool, era, 6),
    getEraTopDatasets(pool, era, 6),
    getEraNewsContext(pool, era, 8),
    getEraSignature(pool, era),
  ])

  // --- Trajectory ---
  const trajectory = await getEraTrajectorySnapshot(pool, era, { limit: 12 })

  // --- Author labels for top publications ---
  const pubIds = topPubs.map((p) => p.id)
  const authorsMap = await fetchPublicationAuthors(pool, pubIds)
  const citationLabels = new Map<number, { label: string; year: string | number }>()
  for (const p of topPubs) {
    const authors = authorsMap.get(p.id) ?? []
    citationLabels.set(p.id, { label: formatCitationLabel(authors, p.year ?? null), year: p.year ?? '?' })
  }
  const docLabels = new Map<number, string>()
  for (const d of recentDocs) docLabels.set(d.id, d.title)
  const datasetLabels = new Map<number, string>()
  for (const ds of topDatasets) datasetLabels.set(ds.id, ds.title)

  // --- Per-category trajectory tags ---
  function buildTrajectoryNotes(
    breakdowns: EraCategoryBreakdown[],
    label: string,
  ): string {
    // Only consider eras up to and including the focal era. The focal era is
    // the end point of the trajectory we're describing — looking backward
    // from this period's vantage point, not forward.
    const upToFocal = breakdowns
      .filter((b) => b.start_year <= era.start_year)
      .sort((a, b) => a.start_year - b.start_year)
    const focal = upToFocal[upToFocal.length - 1]
    if (!focal) return `${label}:\n  (insufficient data for this era)\n`
    const categoryNames = focal.categories.map((c) => c.category)
    const histories = new Map<string, number[]>()
    for (const cat of categoryNames) {
      const series: number[] = []
      for (const b of upToFocal) {
        const found = b.categories.find((c) => c.category === cat)
        series.push(found ? found.share : 0)
      }
      histories.set(cat, series)
    }
    const lines: string[] = [`${label} — share in this era and recent trajectory:`]
    for (const cat of focal.categories.slice(0, 10)) {
      const series = histories.get(cat.category)!
      const tag = trajectoryTag(series)
      const sharePct = (cat.share * 100).toFixed(0)
      lines.push(`  - ${cat.category}: ${sharePct}% (${tag.label}${tag.gloss})`)
    }
    return lines.join('\n') + '\n'
  }

  // --- Compose context ---
  const parts: string[] = []
  parts.push(`ERA INFORMATION`)
  parts.push(`  Name: ${era.name}`)
  parts.push(`  Years: ${era.start_year}–${era.end_year}`)
  if (trajectory.prior_era_name) {
    parts.push(`  Prior era: ${trajectory.prior_era_name}`)
  } else {
    parts.push(`  Prior era: none (earliest era)`)
  }
  if (era.description) parts.push(`  Description: ${era.description}`)
  parts.push('')

  // ERA SIGNATURE — leading context. What's actually atypical about this
  // period vs the prior era. Drives the Setting section's distinctiveness.
  parts.push(formatEraSignature(signature))
  parts.push('')

  // BROADER PATTERNS
  parts.push(`BROADER PATTERNS (basin research across multiple eras — supporting context only)`)
  parts.push('')
  parts.push(buildTrajectoryNotes(protocolCatsByEra, 'Methodological approach (protocol categories)'))
  parts.push(buildTrajectoryNotes(scopesByEra, 'Research disciplines (concept scopes)'))

  // BACKGROUND LEVELS — demoted to reference status. The Setting prompt
  // explicitly tells the LLM not to lead with these unless ERA SIGNATURE
  // already flagged them as atypical. Keeping the numbers in context so
  // citations like "X% of references" can still draw on them when needed.
  if (pubContext || cohort) {
    parts.push(`BACKGROUND LEVELS (reference values only — do not lead with these in the Setting section)`)
    parts.push(`  Baseline scale figures for the era; mention only when ERA SIGNATURE marks one as atypical.`)
    if (pubContext) {
      parts.push(`    Publications: ${pubContext.n_pubs.toLocaleString()}`)
      parts.push(`    Distinct active researchers: ${pubContext.unique_authors.toLocaleString()}`)
      parts.push(`    Share with full text indexed: ${(pubContext.share_fulltext * 100).toFixed(0)}%`)
      parts.push(`    Avg co-authors per paper: ${pubContext.avg_authors.toFixed(1)}`)
      parts.push(`    Avg references per paper: ${pubContext.avg_refs.toFixed(0)}`)
      parts.push(`    Share of references to other basin work: ${(pubContext.share_internal_refs * 100).toFixed(0)}%`)
    }
    if (cohort) {
      const newShare = cohort.total_active > 0 ? cohort.new_in_era / cohort.total_active : 0
      parts.push(`    Newcomer share (first-publishing in basin during era): ${(newShare * 100).toFixed(0)}%`)
    }
    parts.push('')
  }
  parts.push('')

  // LANDMARK CANDIDATES — the anchor. Three signals identify a paper as a
  // candidate landmark so we don't only surface what the world cited:
  //   - ext     external citation rank (global significance, via OpenAlex)
  //   - basin   internal citation rank (basin colleagues building on it)
  //   - grounded distinct basin entities mentioned (depth of basin engagement)
  // Each paper is tagged with which signals it qualified for so the LLM can
  // name what kind of landmark it is.
  parts.push(
    `LANDMARK CANDIDATES (the anchor — primer claims about specific research should ground here)`,
  )
  parts.push(
    `  Each paper is tagged with its rank in three signals: ext = external citations (global significance);`,
  )
  parts.push(
    `  basin = internal citations from other basin publications (locally foundational);`,
  )
  parts.push(
    `  grounded = distinct basin entities (species, places, protocols) the paper mentions (basin-grounded research).`,
  )
  parts.push(
    `  "—" means the paper did not appear in that signal's top bucket. Papers appearing in multiple buckets are listed first.`,
  )
  topPubs.forEach((p, i) => {
    const c = citationLabels.get(p.id)
    const tags = [
      p.rank_external != null ? `ext:#${p.rank_external}` : 'ext:—',
      p.rank_internal != null ? `basin:#${p.rank_internal}` : 'basin:—',
      p.rank_grounded != null ? `grounded:#${p.rank_grounded}` : 'grounded:—',
    ].join(' | ')
    const evidence: string[] = []
    if (p.citation_count != null) evidence.push(`${p.citation_count} ext cites`)
    if (p.internal_citation_count != null && p.internal_citation_count > 0)
      evidence.push(`${p.internal_citation_count} basin citers`)
    if (p.distinct_basin_entities != null && p.distinct_basin_entities > 0)
      evidence.push(`${p.distinct_basin_entities} basin entities`)
    parts.push(
      `\n[${i + 1}] (${c?.label ?? '?'}) [${tags}] "${p.title}" — ${
        evidence.join(', ') || 'no signal counts'
      } [pub_id:${p.id}]`,
    )
  })
  parts.push('')

  if (recentDocs.length > 0) {
    parts.push(`RECENT DOCUMENTS (community / policy context)`)
    recentDocs.forEach((d) => {
      parts.push(`  - "${d.title}" (${d.year}) [doc_id:${d.id}]`)
    })
    parts.push('')
  }

  // NEWS COVERAGE — emit only when there's enough press coverage to be
  // meaningful. Pre-1970s eras hit the 'absent' branch and the block is
  // omitted; the Setting prompt's sparseness rules tell the LLM how to
  // handle the absence.
  if (signature.news.coverage !== 'absent' && newsItems.length > 0) {
    const coverageGloss =
      signature.news.coverage === 'sparse'
        ? `${newsItems.length} stor${newsItems.length === 1 ? 'y' : 'ies'}, all national-press indexing hits — sparse sample, do not over-read`
        : signature.news.coverage === 'modest'
        ? `${newsItems.length} top stor${newsItems.length === 1 ? 'y' : 'ies'} of the era`
        : `${newsItems.length} top stor${newsItems.length === 1 ? 'y' : 'ies'} of the era`
    parts.push(`NEWS COVERAGE (${coverageGloss})`)
    parts.push(
      `  Stories ranked by basin-publication link count × story-type weight, source-balanced.`,
    )
    parts.push(
      `  Each line: [source-class / story-type] year "title" — N links to era publications.`,
    )
    parts.push(
      `  Titles only; story bodies are copyrighted and not exposed. Do not name individual reporters.`,
    )
    newsItems.forEach((n) => {
      const title = decodeHtmlEntities(n.title).slice(0, 110)
      parts.push(
        `  - [${n.source_class}/${n.story_type}] ${n.year} "${title}" — ${n.pub_link_count} link${n.pub_link_count === 1 ? '' : 's'}`,
      )
    })
    parts.push('')
  }

  if (topDatasets.length > 0) {
    parts.push(`TOP DATASETS`)
    topDatasets.forEach((ds) => {
      parts.push(`  - "${ds.title}" (${ds.year}, ${ds.citation_count ?? 0} citations) [dataset_id:${ds.id}]`)
    })
    parts.push('')
  }

  // Distinctive entities — supporting evidence
  if (topResearchConcepts.length > 0) {
    parts.push(`DISTINCTIVE CONCEPTS — RESEARCH LENS (over-represented in this era vs. all other dated content, drawn from publications + datasets)`)
    topResearchConcepts.forEach((e) => parts.push(distinctiveLine(e)))
    parts.push('')
  }
  if (topPolicyConcepts.length > 0) {
    parts.push(`DISTINCTIVE CONCEPTS — POLICY/COMMUNITY LENS (drawn from documents)`)
    topPolicyConcepts.forEach((e) => parts.push(distinctiveLine(e)))
    parts.push('')
  }
  if (topSpecies.length > 0) {
    parts.push(`DISTINCTIVE SPECIES`)
    topSpecies.forEach((e) => parts.push(distinctiveLine(e)))
    parts.push('')
  }
  if (topProtocols.length > 0) {
    parts.push(`DISTINCTIVE PROTOCOLS / METHODS`)
    topProtocols.forEach((e) => parts.push(distinctiveLine(e)))
    parts.push('')
  }
  if (topPlaces.length > 0) {
    parts.push(`DISTINCTIVE PLACES (study sites)`)
    topPlaces.forEach((e) => parts.push(distinctiveLine(e)))
    parts.push('')
  }
  if (topStakeholders.length > 0) {
    parts.push(`DISTINCTIVE STAKEHOLDERS / AGENCIES`)
    topStakeholders.forEach((e) => parts.push(distinctiveLine(e)))
    parts.push('')
  }

  // TRAJECTORY — only "new" and "rising"; never include "fading" per design
  if (trajectory.newInEra.length > 0) {
    parts.push(`TRAJECTORY — newly observed in this era (use only when also present in top-cited publications above)`)
    trajectory.newInEra.forEach((e) => parts.push(trajectoryLine(e)))
    parts.push('')
  }
  if (trajectory.rising.length > 0) {
    parts.push(`TRAJECTORY — rising vs prior era (use only when also present in top-cited publications above)`)
    trajectory.rising.forEach((e) => parts.push(trajectoryLine(e)))
    parts.push('')
  }

  return {
    context: parts.join('\n'),
    citationLabels,
    docLabels,
    datasetLabels,
    pubIds,
  }
}

// ---------------------------------------------------------------------------
// Citation post-processing: turn {pub_id:N} tags into markdown links
// ---------------------------------------------------------------------------

function postProcessCitations(
  text: string,
  citationLabels: Map<number, { label: string; year: string | number }>,
  docLabels: Map<number, string>,
  datasetLabels: Map<number, string>,
): string {
  let out = text

  // Multi-citation case: (text){pub_id:N}{pub_id:M} → [text](/publications/N)
  // (link to the first; the other ids are still verifiable in the references).
  out = out.replace(
    /\(([^)]+)\)\s*(?:\{pub_id:\d+\}\s*){2,}/g,
    (match, citationText) => {
      const firstId = match.match(/pub_id:(\d+)/)?.[1]
      return firstId ? `[${citationText}](/publications/${firstId})` : match
    },
  )
  // Inline: (text){pub_id:N} → [text](/publications/N)
  out = out.replace(/\(([^)]+)\)\s*\{pub_id:(\d+)\}/g, '[$1](/publications/$2)')
  out = out.replace(/\(([^)]+)\)\s*\{doc_id:(\d+)\}/g, '[$1](/documents/$2)')
  out = out.replace(/\(([^)]+)\)\s*\{dataset_id:(\d+)\}/g, '[$1](/datasets/$2)')

  // Standalone (typically in the REFERENCES list): {pub_id:N} alone → look up
  // a label so the link text reads as "Author, Year" rather than "#523".
  out = out.replace(/\{pub_id:(\d+)\}/g, (_m, id) => {
    const info = citationLabels.get(parseInt(id))
    return info ? `[${info.label}](/publications/${id})` : `[→](/publications/${id})`
  })
  out = out.replace(/\{doc_id:(\d+)\}/g, (_m, id) => {
    const title = docLabels.get(parseInt(id))
    return title ? `[${title}](/documents/${id})` : `[→](/documents/${id})`
  })
  out = out.replace(/\{dataset_id:(\d+)\}/g, (_m, id) => {
    const title = datasetLabels.get(parseInt(id))
    return title ? `[${title}](/datasets/${id})` : `[→](/datasets/${id})`
  })

  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface PrimerResponse {
  primer_text: string
  key_themes?: string[]
  open_questions?: string[]
}

async function main() {
  console.log(`Generating era primers (model=${modelArg} → ${modelId}, dryRun=${dryRun})`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Pick the eras to process. Calendar decade-or-bucket eras only.
    let eraQuery = `
      SELECT id FROM eras
       WHERE kind='calendar' AND (end_year - start_year) < 50
       ORDER BY start_year ASC`
    const eraParams: any[] = []
    if (slugArg) {
      eraQuery = `SELECT id FROM eras WHERE slug = $1 LIMIT 1`
      eraParams.push(slugArg)
    }
    const { rows: eraRows } = await db.query<{ id: number }>(eraQuery, eraParams)
    const eraIds = eraRows.map((r) => r.id).slice(0, Number.isFinite(limit) ? (limit as number) : eraRows.length)

    console.log(`  Targeting ${eraIds.length} era(s)`)

    let costTotal = 0
    let succeeded = 0
    let skipped = 0

    for (let i = 0; i < eraIds.length; i++) {
      const eraId = eraIds[i]
      const era = await getEra(db, eraId)
      if (!era) continue

      console.log(`\n[${i + 1}/${eraIds.length}] ${era.name} (${era.start_year}–${era.end_year}) [id=${era.id}]`)

      if (skipExisting) {
        const { rows: existRows } = await db.query<{ has: boolean }>(
          `SELECT primer IS NOT NULL AS has FROM eras WHERE id = $1`,
          [era.id],
        )
        if (existRows[0]?.has) {
          console.log(`  Skipping (--skip-existing and primer exists)`)
          skipped++
          continue
        }
      }

      const assembled = await assembleContext(db, era)
      console.log(`  Context: ${(assembled.context.length / 1000).toFixed(1)}k chars, ${assembled.pubIds.length} top pubs`)

      if (dryRun) {
        console.log(`  (DRY RUN) — context preview:`)
        console.log(assembled.context.slice(0, 1200))
        console.log(`  ...`)
        continue
      }

      const { data, response } = await callClaudeJson<PrimerResponse>({
        apiKey: ANTHROPIC_API_KEY!,
        prompt: PROMPT,
        content: assembled.context,
        maxTokens: 8192,
        model: modelId,
      })

      if (!data?.primer_text) {
        console.log(`  No primer_text in response (cost: $${response.cost.toFixed(3)})`)
        console.log(`  Response start: ${response.text.slice(0, 200)}`)
        continue
      }

      const processed = postProcessCitations(
        data.primer_text,
        assembled.citationLabels,
        assembled.docLabels,
        assembled.datasetLabels,
      )
      costTotal += response.cost

      await db.query(
        `UPDATE eras
            SET primer = $1,
                primer_generated_at = NOW(),
                primer_model = $2,
                primer_key_themes = $3::jsonb,
                primer_open_questions = $4::jsonb
          WHERE id = $5`,
        [
          processed,
          modelId,
          JSON.stringify(data.key_themes ?? []),
          JSON.stringify(data.open_questions ?? []),
          era.id,
        ],
      )

      console.log(
        `  ✓ Primer written (${processed.length} chars, cost: $${response.cost.toFixed(3)})`,
      )
      succeeded++

      // Brief pause to avoid rate limits when running --all
      if (i < eraIds.length - 1) await sleep(300)
    }

    console.log(`\n========== Summary ==========`)
    console.log(`Processed: ${eraIds.length}`)
    console.log(`Succeeded: ${succeeded}`)
    console.log(`Skipped:   ${skipped}`)
    if (!dryRun) console.log(`Total cost: $${costTotal.toFixed(2)}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
