/**
 * Experiment: Compare three strategies for extracting research methods
 * from scientific papers.
 *
 * Strategy 1: Caption/table regex extraction from full text (free)
 * Strategy 2: Multimodal page embeddings via Voyage AI (~$0.01)
 * Strategy 3: VLM page analysis via Claude API (~$0.50-1.00)
 *
 * Runs on 10 representative test papers and saves structured results
 * for human evaluation.
 *
 * Usage:
 *   npx tsx scripts/experiment-extraction.ts [--strategy=1|2|3|all] [--paper=ID]
 *
 * Requires: VOYAGE_API_KEY (strategy 2), ANTHROPIC_API_KEY (strategy 3)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import pg from 'pg'
import { sleep } from './lib/concurrency.js'
import { VOYAGE_API_KEY, VOYAGE_MODEL, STAGING_DIR, OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const strategyArg = args.find((a) => a.startsWith('--strategy='))?.split('=')[1] || 'all'
const paperArg = args.find((a) => a.startsWith('--paper='))?.split('=')[1]
const idsFileArg = args.find((a) => a.startsWith('--ids-file='))?.split('=')[1]
const outputDirArg = args.find((a) => a.startsWith('--output-dir='))?.split('=')[1]

const TEST_PAPER_IDS = [9, 15, 21, 24, 26, 30, 36, 40, 41, 96]
const RESULTS_DIR = outputDirArg || `${OUTPUT_DIR}/extraction-experiment`

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// ---------------------------------------------------------------------------
// Strategy 1: Caption/table regex extraction from full text
// ---------------------------------------------------------------------------

interface RegexExtraction {
  figureCaptions: string[]
  tableCaptions: string[]
  methodsSection: string | null
  equipmentMentions: string[]
  studySiteDescription: string | null
  speciesMentions: string[]
  statisticalMethods: string[]
}

function strategy1Regex(fullText: string): RegexExtraction {
  // Figure captions
  const figureCaptions: string[] = []
  const figRegex = /(?:Figure|Fig\.?)\s*(\d+)[.:]\s*([^\n]{10,500})/gi
  let match
  while ((match = figRegex.exec(fullText)) !== null) {
    figureCaptions.push(`Figure ${match[1]}: ${match[2].trim()}`)
  }

  // Table captions
  const tableCaptions: string[] = []
  const tableRegex = /Table\s*(\d+)[.:]\s*([^\n]{10,500})/gi
  while ((match = tableRegex.exec(fullText)) !== null) {
    tableCaptions.push(`Table ${match[1]}: ${match[2].trim()}`)
  }

  // Methods section
  let methodsSection: string | null = null
  const methodsRegex = /(?:^|\n)\s*(?:METHODS|Methods|MATERIALS AND METHODS|Materials and Methods|Study (?:Site|Area|System))\s*\n([\s\S]{100,5000}?)(?:\n\s*(?:RESULTS|Results|DISCUSSION|Discussion|ACKNOWLEDGMENT)\b)/i
  const methodsMatch = fullText.match(methodsRegex)
  if (methodsMatch) {
    methodsSection = methodsMatch[1].replace(/\s+/g, ' ').trim().slice(0, 3000)
  }

  // Equipment mentions
  const equipmentMentions: string[] = []
  const equipRegex = /\b(thermometer|thermocouple|data ?logger|iButton|HOBO|transect|quadrat|pitfall trap|mist net|sherman trap|camera trap|GPS|GIS|spectrophotometer|balance|caliper|rain gauge|stream gauge|flume|lysimeter|tensiometer|anemometer|radiometer|eddy covariance|flux tower|dendrometer|phenocam|soil ?core|pollen trap)\b/gi
  const equipSet = new Set<string>()
  while ((match = equipRegex.exec(fullText)) !== null) {
    equipSet.add(match[1].toLowerCase())
  }
  equipmentMentions.push(...equipSet)

  // Study site description
  let studySiteDescription: string | null = null
  const siteRegex = /(?:study (?:site|area|was conducted)|field site|research was (?:conducted|carried out)|(?:located|situated) (?:at|in|near))\s+([^.]{20,300}\.)/i
  const siteMatch = fullText.match(siteRegex)
  if (siteMatch) {
    studySiteDescription = siteMatch[0].trim()
  }

  // Species (italicized binomial names)
  const speciesMentions: string[] = []
  const speciesRegex = /\b([A-Z][a-z]+)\s+([a-z]{3,}(?:oides|ensis|alis|atus|icus|inus|osum|alis|cola|ana|ii))\b/g
  const speciesSet = new Set<string>()
  while ((match = speciesRegex.exec(fullText)) !== null) {
    speciesSet.add(`${match[1]} ${match[2]}`)
  }
  speciesMentions.push(...speciesSet)

  // Statistical methods
  const statisticalMethods: string[] = []
  const statsRegex = /\b(ANOVA|ANCOVA|MANOVA|t-test|chi-square|chi-squared|regression|mixed.?(?:effects?|model)|generalized linear|GLM|GLMM|Bayesian|bootstrapp?|permutation test|Tukey|Bonferroni|Kruskal.Wallis|Mann.Whitney|Wilcoxon|PCA|principal component|ordination|NMDS|correlation|survival analysis|Kaplan.Meier|AIC|BIC|model selection|multivariate)\b/gi
  const statsSet = new Set<string>()
  while ((match = statsRegex.exec(fullText)) !== null) {
    statsSet.add(match[1])
  }
  statisticalMethods.push(...statsSet)

  return { figureCaptions, tableCaptions, methodsSection, equipmentMentions, studySiteDescription, speciesMentions, statisticalMethods }
}

// ---------------------------------------------------------------------------
// Strategy 2: Multimodal page embeddings via Voyage AI
// ---------------------------------------------------------------------------

interface PageEmbedding {
  pageNumber: number
  hasVisualContent: boolean
  embeddingDimensions: number
}

async function strategy2Multimodal(pdfPath: string): Promise<{ pages: PageEmbedding[]; error?: string }> {
  if (!VOYAGE_API_KEY) return { pages: [], error: 'VOYAGE_API_KEY not set' }

  // Render PDF pages as images
  const tmpDir = `${RESULTS_DIR}/pages`
  mkdirSync(tmpDir, { recursive: true })

  const basename = pdfPath.split('/').pop()?.replace('.pdf', '') || 'doc'

  try {
    // Get page count
    const pageCountStr = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep Pages | awk '{print $2}'`, { encoding: 'utf-8' }).trim()
    const pageCount = Math.min(parseInt(pageCountStr) || 1, 20) // cap at 20 pages

    // Render pages as JPEG images
    execSync(`pdftoppm -jpeg -r 150 -l ${pageCount} "${pdfPath}" "${tmpDir}/${basename}"`, { encoding: 'utf-8' })

    const pages: PageEmbedding[] = []

    // Embed each page image
    for (let p = 1; p <= pageCount; p++) {
      const pageFile = `${tmpDir}/${basename}-${String(p).padStart(pageCount > 9 ? 2 : 1, '0')}.jpg`
      if (!existsSync(pageFile)) continue

      const imageData = readFileSync(pageFile)
      const base64 = imageData.toString('base64')

      try {
        const res = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${VOYAGE_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'voyage-multimodal-3',
            inputs: [{
              content: [{ type: 'image_base64', image_base64: `data:image/jpeg;base64,${base64}` }],
            }],
            output_dimension: 1024,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          pages.push({
            pageNumber: p,
            hasVisualContent: true,
            embeddingDimensions: data.data?.[0]?.embedding?.length || 0,
          })
        } else {
          const errText = await res.text()
          pages.push({ pageNumber: p, hasVisualContent: false, embeddingDimensions: 0 })
          if (p === 1) console.log(`    Voyage error: ${errText.slice(0, 100)}`)
        }
      } catch (err: any) {
        pages.push({ pageNumber: p, hasVisualContent: false, embeddingDimensions: 0 })
      }

      // Rate limit
      await sleep(200)
    }

    return { pages }
  } catch (err: any) {
    return { pages: [], error: err.message?.slice(0, 100) }
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: VLM page analysis via Claude API
// ---------------------------------------------------------------------------

interface VLMExtraction {
  // Core findings
  keyFindings: { finding: string; confidence: string; supportingEvidence: string }[]
  researchQuestion: string
  conclusions: string

  // Methods & protocols
  methods: string
  protocolSteps: {
    step: number
    action: string
    details: string
    quantities?: string
    duration?: string
    conditions?: string
    equipment?: string[]
  }[]
  protocolsNamed: {
    proposedName: string                  // short descriptive name
    category: string                      // sampling/measurement/analytical/experimental/observational/computational/laboratory
    subcategory?: string
    description: string                   // 2-3 sentence abstract
    isStandardized: boolean
    standardName?: string                 // recognized standard name if applicable
    standardReference?: string            // citation for the canonical methods paper
    outputMeasurements?: string[]
    protocolStepIndices?: number[]        // links into protocolSteps
    equipmentUsed?: string[]
    role: string                          // introducing|using|modifying|comparing
  }[]
  equipment: string[]
  studySite: { description: string; coordinates?: string; elevation?: string; habitat?: string }
  samplingDesign: string
  statisticalMethods: {
    name: string
    purpose: string
    software?: string
    details?: string
  }[]

  // Entities (for knowledge graph)
  species: {
    scientificName: string
    commonName?: string
    authority?: string                    // e.g., "Linnaeus, 1758"
    family?: string
    order?: string
    class?: string
    kingdom?: string
    role: string                          // study subject, predator, pollinator, host, etc.
    conservationStatus?: string           // IUCN code (LC/NT/VU/EN/CR/DD) — only if explicitly stated
    nativeStatus?: string                 // native|introduced|invasive|unknown — only if explicitly stated
    synonymsUsed?: string[]               // abbreviations and alternate names used in this paper
  }[]
  places: {
    name: string
    type: string                          // study_site/peak/valley/watershed/stream/lake/meadow/town/county/state/country/region/trail/named_point/bioregion
    scale?: string                        // site/local/regional/state/national
    parentName?: string                   // containing place name
    coordinates?: string                  // "lat,lon" decimal degrees
    elevation?: string                    // meters
    elevationRange?: string               // e.g., "2800-3400 m"
    habitat?: string
    role: string                          // primary_study_site|secondary_site|reference_location|comparison_site|mentioned
  }[]
  // legacy `locations` retained for backward compat with results.json from prior runs
  locations?: { name: string; type: string }[]
  chemicals: string[]
  datasets: string[]
  timespan: { start?: string; end?: string; duration?: string }

  // Concepts (theories, frameworks, measurements)
  concepts: {
    name: string
    type: string                          // theory|hypothesis|process|phenomenon|measurement|metric|framework|model_type
    definition?: string                   // 1-sentence as used in the paper, or null if assumed
    role: string                          // central|tested|framework|referenced|measured
    scope?: string                        // general_ecology|climate|hydrology|population_ecology|community_ecology|evolution|biogeochemistry|landscape|molecular|methodological
    aliases?: string[]
  }[]

  // Metadata enrichment (verbatim from paper, used to fill gaps in DB record)
  metadataEnrichment?: {
    title?: string                        // verbatim title
    doi?: string                          // verbatim DOI
    abstract?: string                     // verbatim abstract
    keywords?: string[]                   // author-supplied keywords
    authors?: { given: string; family: string; orcid?: string }[]
  }

  // Visual content
  figures: { page: number; type: string; description: string; keyInsight: string }[]
  tables: { page: number; description: string; variables: string[]; keyData: string }[]
  photographs: { page: number; description: string; methodsRelevance: string }[]

  // Code & data availability
  codeAvailability: {
    url: string
    platform: string                      // 'GitHub', 'GitLab', 'Zenodo', 'Dryad', 'Figshare', 'CRAN', 'PyPI', 'other'
    description: string                   // what the code does
    language?: string                     // 'R', 'Python', 'MATLAB', etc.
    license?: string                      // if stated
  }[]
  dataAvailability: {
    url: string
    platform: string                      // 'Dryad', 'Zenodo', 'EDI', 'USGS', 'GitHub', 'other'
    description: string                   // what data is available
    doi?: string                          // dataset DOI if given
  }[]

  // Relationships to other work
  methodsSharedWith: string[]
  comparableTo: string[]
  buildsOn: string[]
}

const VLM_PROMPT = `Analyze this scientific paper. Extract the following as JSON. Be thorough and precise — only include information explicitly present in the paper. Do NOT invent details.

{
  "researchQuestion": "The central question or hypothesis",
  "keyFindings": [
    {"finding": "Main result in one sentence", "confidence": "strong/moderate/preliminary", "supportingEvidence": "Which figure, table, or analysis supports this"}
  ],
  "conclusions": "2-3 sentence summary of conclusions and implications",

  "methods": "Comprehensive description of research methods (2-3 paragraphs). Include study design, sampling approach, and analysis techniques.",
  "protocolSteps": [
    {
      "step": 1,
      "action": "Brief action title (e.g., 'Establish study plots')",
      "details": "Detailed description of exactly what was done, as specifically as possible. Include exact measurements, counts, spacing, timing. A reader should be able to replicate this step from the description alone.",
      "quantities": "Specific numbers: how many plots, transects, individuals, replicates, samples. Exact measurements with units.",
      "duration": "How long this step took or how often it was repeated (e.g., 'daily for 6 weeks', '3 hours per site')",
      "conditions": "Environmental conditions, time of day, season, weather constraints, temperature ranges",
      "equipment": ["specific tools used in this step"]
    }
  ],
  "protocolsNamed": [
    {
      "proposedName": "A short descriptive name for this method (e.g., 'Mark-recapture of yellow-bellied marmots', 'Sterivex eDNA filtration', 'Phenocam NDVI timeseries')",
      "category": "sampling | measurement | analytical | experimental | observational | computational | laboratory",
      "subcategory": "short descriptor (e.g., 'demographic monitoring', 'remote sensing', 'molecular')",
      "description": "2-3 sentence abstract of the method as used in this paper",
      "isStandardized": true,
      "standardName": "Established name of this protocol if it is a recognized standard method (e.g., 'Breeding Bird Survey', 'Daubenmire frame cover estimation', 'mark-recapture'), or null",
      "standardReference": "citation if the paper cites a methods paper for this protocol, or null",
      "outputMeasurements": ["what data this protocol produces (e.g., 'individual mass', 'capture histories', 'NDVI timeseries')"],
      "protocolStepIndices": [1, 2, 3],
      "equipmentUsed": ["subset of top-level equipment list used by this protocol"],
      "role": "introducing | using | modifying | comparing"
    }
  ],
  "equipment": ["ALL specific instruments, sensors, traps, software, tools — include model numbers and manufacturers if stated"],
  "studySite": {
    "description": "Full location description",
    "coordinates": "lat/lon if given, or null",
    "elevation": "elevation with units if given, or null",
    "habitat": "habitat type (subalpine meadow, stream, conifer forest, etc.)"
  },
  "samplingDesign": "Plot layout, transect spacing, replication, randomization, controls. Include specific numbers.",
  "statisticalMethods": [
    {
      "name": "Full name of the statistical test or model (e.g., 'generalized linear mixed model')",
      "purpose": "What this analysis tested or estimated (e.g., 'tested effect of elevation on survival probability')",
      "software": "Software package used (e.g., 'R package lme4', 'JMP 14', 'SAS PROC MIXED'), or null if not stated",
      "details": "Key details: response variable, fixed/random effects, distribution family, link function, transformations, multiple comparison corrections, model selection criteria. Be specific."
    }
  ],

  "species": [
    {
      "scientificName": "Genus species (italicized binomial)",
      "commonName": "common English name if given, or null",
      "authority": "taxonomic authority if cited (e.g., 'Linnaeus, 1758'), or null",
      "family": "taxonomic family if stated or inferable (e.g., 'Sciuridae'), or null",
      "order": "taxonomic order if stated or inferable (e.g., 'Rodentia'), or null",
      "class": "taxonomic class if inferable (e.g., 'Mammalia'), or null",
      "kingdom": "Animalia / Plantae / Fungi / etc.",
      "role": "study subject / predator / prey / pollinator / host plant / parasite / competitor / indicator species / etc.",
      "conservationStatus": "IUCN code (LC/NT/VU/EN/CR/DD) — ONLY if explicitly stated in the paper, otherwise null",
      "nativeStatus": "native | introduced | invasive | unknown — ONLY if explicitly stated in the paper, otherwise null",
      "synonymsUsed": ["abbreviations and alternate names used for this taxon in this paper, e.g., 'M. flaviventris'"]
    }
  ],
  "places": [
    {
      "name": "Gothic",
      "type": "study_site | peak | valley | watershed | stream | lake | meadow | town | county | state | country | region | trail | named_point | bioregion",
      "scale": "site | local | regional | state | national",
      "parentName": "name of the containing place if mentioned (e.g., 'East River watershed', 'Gunnison County'), or null",
      "coordinates": "lat,lon in decimal degrees if given (e.g., '38.9583,-106.9881'), or null",
      "elevation": "elevation in meters if given, or null",
      "elevationRange": "e.g., '2800-3400 m' if a range is given, or null",
      "habitat": "habitat type (subalpine meadow, riparian, alpine tundra, conifer forest, etc.), or null",
      "role": "primary_study_site | secondary_site | reference_location | comparison_site | mentioned"
    }
  ],
  "chemicals": ["compounds, elements, nutrients measured or manipulated"],
  "datasets": ["names of datasets produced or referenced"],
  "timespan": {"start": "earliest year of data", "end": "latest year", "duration": "e.g., 3 summers"},

  "concepts": [
    {
      "name": "canonical concept name (e.g., 'phenological mismatch', 'trophic cascade', 'NDVI', 'metapopulation theory', 'thermal performance curve')",
      "type": "theory | hypothesis | process | phenomenon | measurement | metric | framework | model_type",
      "definition": "1-sentence definition of this concept as used in this paper, or null if the paper assumes familiarity",
      "role": "central | tested | framework | referenced | measured",
      "scope": "general_ecology | climate | hydrology | population_ecology | community_ecology | evolution | biogeochemistry | landscape | molecular | methodological",
      "aliases": ["abbreviations or alternative names used (e.g., 'NDVI' for 'Normalized Difference Vegetation Index')"]
    }
  ],

  "metadataEnrichment": {
    "title": "The exact paper title as printed on the title page",
    "doi": "DOI as printed in the paper (e.g., '10.1234/abc'), or null if not visible in the paper",
    "abstract": "The full abstract verbatim as printed in the paper, or null if no abstract section",
    "keywords": ["author-supplied keywords if listed under a 'Keywords' section"],
    "authors": [
      {
        "given": "given name(s) as printed",
        "family": "family name as printed",
        "orcid": "ORCID if printed near author (e.g., '0000-0001-2345-6789'), or null"
      }
    ]
  },

  "figures": [{"page": 1, "type": "scatter plot / map / photograph / diagram / bar chart", "description": "What it shows", "keyInsight": "The main finding or information this figure communicates"}],
  "tables": [{"page": 1, "description": "What the table contains", "variables": ["column names"], "keyData": "Most important values or patterns"}],
  "photographs": [{"page": 1, "description": "What is shown in the photo", "methodsRelevance": "How this relates to the study methods or site"}],

  "codeAvailability": [
    {
      "url": "Full URL to code repository or archive (e.g., 'https://github.com/user/repo')",
      "platform": "GitHub / GitLab / Zenodo / CRAN / PyPI / Figshare / Bitbucket / other",
      "description": "What the code does (e.g., 'R scripts for statistical analyses and figure generation')",
      "language": "Primary language: R / Python / MATLAB / Julia / etc., or null",
      "license": "License if stated (e.g., 'MIT', 'GPL-3'), or null"
    }
  ],
  "dataAvailability": [
    {
      "url": "Full URL to data archive or repository",
      "platform": "Dryad / Zenodo / EDI / USGS / Figshare / GitHub / Pangaea / NCBI / other",
      "description": "What data is available (e.g., 'Raw field measurements and processed datasets')",
      "doi": "Dataset DOI if given (e.g., '10.5061/dryad.xxx'), or null"
    }
  ],

  "methodsSharedWith": ["Other studies that use the same methods, if referenced"],
  "comparableTo": ["Studies with comparable results, explicitly compared in the paper"],
  "buildsOn": ["Foundational work this study extends or replicates"]
}

CRITICAL INSTRUCTIONS:
- Extract information from figures, tables, and photographs — not just text.
- For protocolSteps, provide maximum detail from the paper. Include exact quantities, timing, spacing, equipment per step.
- For protocolsNamed, identify 1-5 distinct protocols. Group related steps from protocolSteps under each protocol via protocolStepIndices. Recognize standard methods (mark-recapture, point counts, Tullgren funnels, DNA metabarcoding, Daubenmire frames). For novel methods, propose a concise descriptive name.
- For species, include ALL organisms mentioned — study subjects, predators, prey, food plants, parasites, competitors. Provide taxonomic hierarchy where you can confidently infer it (e.g., marmots → Sciuridae → Rodentia → Mammalia → Animalia). Use the formally published scientific name. If the paper uses an abbreviation (e.g., 'M. flaviventris' after introducing 'Marmota flaviventris'), record the full name in scientificName and the abbreviation in synonymsUsed. Only fill conservationStatus and nativeStatus if explicitly stated — do NOT infer from general knowledge.
- For places, extract the hierarchical context. If the paper says 'at the Rocky Mountain Biological Laboratory (RMBL) in Gothic, Colorado', emit three entries: RMBL (type=study_site, parentName=Gothic), Gothic (type=town, parentName=Gunnison County), Colorado (type=state). Extract coordinates exactly as given — do not convert between DMS and decimal unless the paper provides the conversion.
- For concepts, identify 3-8 concepts the paper *actively engages with* — tests, measures, builds on, or uses as theoretical framework. Do NOT list every term in passing. Focus on concepts that would be useful for grouping related studies. Use canonical names ('phenological mismatch', not 'mismatch in phenology between species').
- For metadataEnrichment, extract these fields verbatim from the paper. Do NOT paraphrase or invent. If a field is not present (e.g., the paper has no Keywords section), return null or an empty array. The downstream linker uses this only to fill empty fields in the existing publication record.
- For codeAvailability and dataAvailability, extract ALL URLs mentioned in Data Availability, Code Availability, or Supplementary sections. Capture the EXACT URLs — do not abbreviate or paraphrase them. Include GitHub repos, Zenodo archives, Dryad deposits, EDI packages, CRAN packages, etc. If a DOI is given for a dataset, include it.
- Do NOT fabricate information not present in the paper.`

const PAGE_BATCH_SIZE = 20 // max pages per Claude call (most articles fit in a single batch)

async function callClaudeWithPages(
  imageContents: any[],
  title: string,
  batchLabel: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384, // increased from 8192 to accommodate the enhanced schema (places, protocolsNamed, concepts, metadataEnrichment)
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          { type: 'text', text: `This is "${title}" (${batchLabel}).\n\n${VLM_PROMPT}` },
        ],
      }],
    }),
  })

  // Retry on transient errors (429 rate limit, 529 overloaded, 5xx server errors)
  if (res.status === 529 || res.status === 429 || (res.status >= 500 && res.status < 600)) {
    const errText = await res.text()
    const MAX_RETRIES = 4
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const backoff = Math.min(30 + attempt * 30, 120) // 60s, 90s, 120s, 120s
      console.log(`    Retrying (${attempt}/${MAX_RETRIES}) after ${backoff}s — ${res.status} error`)
      await sleep(backoff * 1000)
      const retry = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16384,
          messages: [{
            role: 'user',
            content: [
              ...imageContents,
              { type: 'text', text: `This is "${title}" (${batchLabel}).\n\n${VLM_PROMPT}` },
            ],
          }],
        }),
      })
      if (retry.ok) {
        const data = await retry.json()
        return {
          text: data.content?.[0]?.text || '',
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
        }
      }
      if (retry.status !== 529 && retry.status !== 429 && retry.status < 500) {
        const retryErr = await retry.text()
        throw new Error(`Claude API ${retry.status}: ${retryErr.slice(0, 200)}`)
      }
    }
    throw new Error(`Claude API ${res.status} after ${MAX_RETRIES} retries: ${errText.slice(0, 200)}`)
  }

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  return {
    text: data.content?.[0]?.text || '',
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  }
}

function parseExtractionJSON(text: string): VLMExtraction | null {
  // Strip markdown code fences if present
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')

  // Try direct parse first
  try { return JSON.parse(cleaned.trim()) } catch {}

  // Find the outermost JSON object with balanced braces
  let depth = 0
  let start = -1
  let lastValidEnd = -1
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') { if (depth === 0) start = i; depth++ }
    if (cleaned[i] === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        lastValidEnd = i
        try { return JSON.parse(cleaned.slice(start, i + 1)) } catch { /* keep looking */ }
      }
    }
  }

  // If braces were unbalanced (truncated output), try adding closing braces
  if (start >= 0 && lastValidEnd === -1 && depth > 0) {
    let attempt = cleaned.slice(start) + '}'.repeat(depth)
    // Also close any open arrays
    const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length
    if (openBrackets > 0) attempt = attempt.slice(0, -depth) + ']'.repeat(openBrackets) + '}'.repeat(depth)
    try { return JSON.parse(attempt) } catch {}
  }

  return null
}

function mergeExtractions(parts: VLMExtraction[]): VLMExtraction {
  if (parts.length === 1) return parts[0]

  // Use the first part as the base (typically has abstract/intro/methods)
  const merged = { ...parts[0] }

  // Merge arrays from subsequent parts
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.keyFindings?.length) merged.keyFindings = [...(merged.keyFindings || []), ...p.keyFindings]
    if (p.protocolSteps?.length) {
      const existingSteps = merged.protocolSteps?.length || 0
      merged.protocolSteps = [...(merged.protocolSteps || []), ...p.protocolSteps.map((s) => ({ ...s, step: s.step + existingSteps }))]
    }
    if (p.species?.length) {
      const existingNames = new Set((merged.species || []).map((s) => (s.scientificName || '').toLowerCase()))
      merged.species = [...(merged.species || []), ...p.species.filter((s) => s.scientificName && !existingNames.has(s.scientificName.toLowerCase()))]
    }
    if (p.figures?.length) merged.figures = [...(merged.figures || []), ...p.figures]
    if (p.tables?.length) merged.tables = [...(merged.tables || []), ...p.tables]
    if (p.photographs?.length) merged.photographs = [...(merged.photographs || []), ...p.photographs]
    if (p.equipment?.length) merged.equipment = [...new Set([...(merged.equipment || []), ...p.equipment])]
    if (p.statisticalMethods?.length) {
      const existingNames = new Set((merged.statisticalMethods || []).map((s: any) => (typeof s === 'string' ? s : s.name || '').toLowerCase()))
      const newMethods = p.statisticalMethods.filter((s: any) => !existingNames.has((typeof s === 'string' ? s : s.name || '').toLowerCase()))
      merged.statisticalMethods = [...(merged.statisticalMethods || []), ...newMethods]
    }
    if (p.chemicals?.length) merged.chemicals = [...new Set([...(merged.chemicals || []), ...p.chemicals])]
    if (p.places?.length) {
      // Dedupe by lowercase name + type; on conflict prefer the entry with more populated fields
      const fieldCount = (place: any) => Object.values(place).filter((v) => v != null && v !== '').length
      const byKey = new Map<string, any>()
      for (const place of merged.places || []) {
        const key = `${(place.name || '').toLowerCase()}|${place.type || ''}`
        byKey.set(key, place)
      }
      for (const place of p.places) {
        if (!place.name) continue
        const key = `${place.name.toLowerCase()}|${place.type || ''}`
        const existing = byKey.get(key)
        if (!existing || fieldCount(place) > fieldCount(existing)) {
          byKey.set(key, place)
        }
      }
      merged.places = [...byKey.values()]
    }
    if (p.protocolsNamed?.length) {
      const existingNames = new Set((merged.protocolsNamed || []).map((pn) => (pn.proposedName || '').toLowerCase()))
      merged.protocolsNamed = [...(merged.protocolsNamed || []), ...p.protocolsNamed.filter((pn) => pn.proposedName && !existingNames.has(pn.proposedName.toLowerCase()))]
    }
    if (p.concepts?.length) {
      const existingNames = new Set((merged.concepts || []).map((c) => (c.name || '').toLowerCase()))
      merged.concepts = [...(merged.concepts || []), ...p.concepts.filter((c) => c.name && !existingNames.has(c.name.toLowerCase()))]
    }
    if (p.metadataEnrichment) {
      // Merge field-by-field: prefer first non-empty value (the title page is typically in batch 1)
      merged.metadataEnrichment = merged.metadataEnrichment || {}
      const m = merged.metadataEnrichment
      const next = p.metadataEnrichment
      if (!m.title && next.title) m.title = next.title
      if (!m.doi && next.doi) m.doi = next.doi
      if ((!m.abstract || m.abstract.length < 100) && next.abstract && next.abstract.length > (m.abstract?.length || 0)) m.abstract = next.abstract
      if ((!m.keywords || m.keywords.length === 0) && next.keywords?.length) m.keywords = next.keywords
      if ((!m.authors || m.authors.length === 0) && next.authors?.length) m.authors = next.authors
    }
    if (p.codeAvailability?.length) {
      const existingUrls = new Set((merged.codeAvailability || []).map((c: any) => c.url))
      merged.codeAvailability = [...(merged.codeAvailability || []), ...p.codeAvailability.filter((c: any) => c.url && !existingUrls.has(c.url))]
    }
    if (p.dataAvailability?.length) {
      const existingUrls = new Set((merged.dataAvailability || []).map((d: any) => d.url))
      merged.dataAvailability = [...(merged.dataAvailability || []), ...p.dataAvailability.filter((d: any) => d.url && !existingUrls.has(d.url))]
    }
    if (p.buildsOn?.length) merged.buildsOn = [...new Set([...(merged.buildsOn || []), ...p.buildsOn])]
    if (p.methodsSharedWith?.length) merged.methodsSharedWith = [...new Set([...(merged.methodsSharedWith || []), ...p.methodsSharedWith])]
    if (p.comparableTo?.length) merged.comparableTo = [...new Set([...(merged.comparableTo || []), ...p.comparableTo])]

    // Take longer text fields
    if (p.methods && (!merged.methods || p.methods.length > merged.methods.length)) merged.methods = p.methods
    if (p.conclusions && (!merged.conclusions || p.conclusions.length > merged.conclusions.length)) merged.conclusions = p.conclusions
    if (p.samplingDesign && (!merged.samplingDesign || p.samplingDesign.length > merged.samplingDesign.length)) merged.samplingDesign = p.samplingDesign
  }

  return merged
}

async function strategy3VLM(pdfPath: string, title: string): Promise<{ extraction: VLMExtraction | null; error?: string; cost?: number }> {
  if (!ANTHROPIC_API_KEY) return { extraction: null, error: 'ANTHROPIC_API_KEY not set' }

  const tmpDir = `${RESULTS_DIR}/pages`
  mkdirSync(tmpDir, { recursive: true })

  const basename = pdfPath.split('/').pop()?.replace('.pdf', '') || 'doc'

  try {
    const pageCountStr = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep Pages | awk '{print $2}'`, { encoding: 'utf-8' }).trim()
    const totalPages = parseInt(pageCountStr) || 1

    if (totalPages > 40) {
      return { extraction: null, error: `Skipped: ${totalPages} pages exceeds 40-page limit (long-form documents — books, theses, multi-chapter reports — handled by separate Phase 4b pipeline with chapter-aware chunking)` }
    }

    const maxPages = totalPages // process all pages (already ≤40)

    // Render all pages
    execSync(`pdftoppm -jpeg -r 150 -l ${maxPages} "${pdfPath}" "${tmpDir}/${basename}"`, { encoding: 'utf-8' })

    // Collect page images
    const allPageImages: { page: number; content: any[] }[] = []
    for (let p = 1; p <= maxPages; p++) {
      const padLen = maxPages > 9 ? (maxPages > 99 ? 3 : 2) : 1
      const pageFile = `${tmpDir}/${basename}-${String(p).padStart(padLen, '0')}.jpg`
      if (!existsSync(pageFile)) continue

      const imageData = readFileSync(pageFile)
      const base64 = imageData.toString('base64')
      allPageImages.push({
        page: p,
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: `[Page ${p} of ${totalPages}]` },
        ],
      })
    }

    console.log(`    ${allPageImages.length} pages rendered, processing in batches of ${PAGE_BATCH_SIZE}...`)

    // Process in batches
    const extractionParts: VLMExtraction[] = []
    let totalInputTokens = 0
    let totalOutputTokens = 0

    for (let i = 0; i < allPageImages.length; i += PAGE_BATCH_SIZE) {
      const batch = allPageImages.slice(i, i + PAGE_BATCH_SIZE)
      const batchContent = batch.flatMap((p) => p.content)
      const batchLabel = `pages ${batch[0].page}-${batch[batch.length - 1].page} of ${totalPages}`

      process.stdout.write(`    Batch: ${batchLabel}...`)

      try {
        const result = await callClaudeWithPages(batchContent, title, batchLabel)
        if (result) {
          totalInputTokens += result.inputTokens
          totalOutputTokens += result.outputTokens
          const extraction = parseExtractionJSON(result.text)
          if (extraction) {
            extractionParts.push(extraction)
            console.log(` ok (${extraction.protocolSteps?.length || 0} steps, ${extraction.species?.length || 0} species)`)
          } else {
            console.log(' no JSON parsed')
            // Dump raw response for debugging
            const debugPath = `${RESULTS_DIR}/debug-${basename}-raw.txt`
            writeFileSync(debugPath, result.text)
            console.log(`    Raw response saved to ${debugPath} (${result.text.length} chars)`)
          }
        }
      } catch (err: any) {
        console.log(` error: ${err.message?.slice(0, 80)}`)
      }

      // Rate limit between batches
      if (i + PAGE_BATCH_SIZE < allPageImages.length) {
        await sleep(1000)
      }
    }

    const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000

    if (extractionParts.length === 0) {
      return { extraction: null, error: 'No batches produced valid JSON', cost }
    }

    const merged = mergeExtractions(extractionParts)
    return { extraction: merged, cost }
  } catch (err: any) {
    return { extraction: null, error: err.message?.slice(0, 200) }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Extraction Strategy Experiment')
  console.log('==============================')
  console.log(`Strategy: ${strategyArg}`)

  mkdirSync(RESULTS_DIR, { recursive: true })

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub' })

  let ids: number[]
  if (paperArg) {
    ids = [parseInt(paperArg)]
  } else if (idsFileArg) {
    const content = readFileSync(idsFileArg, 'utf-8')
    ids = content.split(/\r?\n/).map((line) => parseInt(line.trim())).filter((n) => !isNaN(n))
    console.log(`Loaded ${ids.length} paper IDs from ${idsFileArg}`)
  } else {
    ids = TEST_PAPER_IDS
  }
  console.log(`Output directory: ${RESULTS_DIR}`)

  // Resume support: load existing results and skip already-processed papers
  const outputPath = `${RESULTS_DIR}/results.json`
  let results: any[] = []
  const processedIds = new Set<number>()
  if (existsSync(outputPath)) {
    results = JSON.parse(readFileSync(outputPath, 'utf-8'))
    for (const r of results) processedIds.add(r.id)
    console.log(`Resuming: ${processedIds.size} papers already processed, ${ids.length - processedIds.size} remaining`)
  }

  // Progress tracking
  const startTime = Date.now()
  let sessionProcessed = 0
  let sessionCost = 0
  let sessionErrors = 0
  const PROGRESS_INTERVAL = 25

  for (const id of ids) {
    if (processedIds.has(id)) continue

    const { rows: [paper] } = await db.query('SELECT id, title, publication_type, full_text, abstract FROM publications WHERE id = $1', [id])
    if (!paper) { console.log(`  Paper ${id} not found, skipping`); continue }

    const pdfPath = `${STAGING_DIR}/publications/pub_${id}.pdf`
    const hasPdf = existsSync(pdfPath)

    console.log(`\n--- [${sessionProcessed + 1}/${ids.length - processedIds.size + sessionProcessed}] Paper ${id}: ${paper.title.slice(0, 60)}... ---`)
    console.log(`  Type: ${paper.publication_type}, PDF: ${hasPdf}, Text: ${paper.full_text?.length || 0} chars`)

    const result: any = {
      id,
      title: paper.title,
      type: paper.publication_type,
      hasFullText: !!paper.full_text,
      hasPdf,
      strategy1: null,
      strategy2: null,
      strategy3: null,
    }

    // Strategy 1: Regex
    if ((strategyArg === '1' || strategyArg === 'all') && paper.full_text) {
      console.log('  Strategy 1 (regex):')
      const s1 = strategy1Regex(paper.full_text)
      result.strategy1 = s1
      console.log(`    Figures: ${s1.figureCaptions.length}, Tables: ${s1.tableCaptions.length}`)
      console.log(`    Methods section: ${s1.methodsSection ? s1.methodsSection.length + ' chars' : 'not found'}`)
      console.log(`    Equipment: ${s1.equipmentMentions.join(', ') || 'none detected'}`)
      console.log(`    Species: ${s1.speciesMentions.join(', ') || 'none detected'}`)
      console.log(`    Statistical methods: ${s1.statisticalMethods.join(', ') || 'none detected'}`)
      console.log(`    Study site: ${s1.studySiteDescription ? 'found' : 'not found'}`)
    }

    // Strategy 2: Multimodal embeddings
    if ((strategyArg === '2' || strategyArg === 'all') && hasPdf) {
      console.log('  Strategy 2 (multimodal embeddings):')
      const s2 = await strategy2Multimodal(pdfPath)
      result.strategy2 = s2
      const embedded = s2.pages.filter((p) => p.embeddingDimensions > 0).length
      console.log(`    ${s2.pages.length} pages processed, ${embedded} embedded`)
      if (s2.error) console.log(`    Error: ${s2.error}`)
    }

    // Strategy 3: VLM analysis
    if ((strategyArg === '3' || strategyArg === 'all') && hasPdf) {
      console.log('  Strategy 3 (VLM/Claude):')
      const s3 = await strategy3VLM(pdfPath, paper.title)
      result.strategy3 = s3
      if (s3.extraction) {
        const e = s3.extraction
        console.log(`    Research question: ${e.researchQuestion?.slice(0, 80) || 'not found'}`)
        console.log(`    Key findings: ${e.keyFindings?.length || 0}`)
        console.log(`    Methods: ${e.methods?.length || 0} chars`)
        console.log(`    Protocol steps: ${e.protocolSteps?.length || 0}`)
        console.log(`    Equipment: ${e.equipment?.join(', ') || 'none'}`)
        console.log(`    Species: ${e.species?.map((s: any) => `${s.scientificName}${s.family ? ` [${s.family}]` : ''}`).join(', ') || 'none'}`)
        console.log(`    Study site: ${e.studySite?.habitat || 'not specified'} ${e.studySite?.elevation || ''}`)
        console.log(`    Figures: ${e.figures?.length || 0}, Tables: ${e.tables?.length || 0}, Photos: ${e.photographs?.length || 0}`)
        console.log(`    Statistical methods: ${e.statisticalMethods?.map((s: any) => typeof s === 'string' ? s : s.name).join(', ') || 'none'}`)
        console.log(`    Timespan: ${e.timespan?.start || '?'} – ${e.timespan?.end || '?'} (${e.timespan?.duration || '?'})`)
        console.log(`    Places: ${e.places?.length || 0}${e.places?.length ? ' — ' + e.places.slice(0, 3).map((pl: any) => pl.name).join(', ') + (e.places.length > 3 ? '…' : '') : ''}`)
        console.log(`    Named protocols: ${e.protocolsNamed?.length || 0}${e.protocolsNamed?.length ? ' — ' + e.protocolsNamed.map((pn: any) => pn.proposedName).join('; ') : ''}`)
        console.log(`    Concepts: ${e.concepts?.length || 0}${e.concepts?.length ? ' — ' + e.concepts.map((c: any) => c.name).join(', ') : ''}`)
        if (e.metadataEnrichment) {
          const m = e.metadataEnrichment
          const filled = [m.title && 'title', m.doi && 'doi', m.abstract && 'abstract', m.keywords?.length && 'keywords', m.authors?.length && 'authors'].filter(Boolean)
          console.log(`    Metadata enrichment: ${filled.length}/5 fields populated (${filled.join(', ') || 'none'})`)
        }
        console.log(`    Code repos: ${e.codeAvailability?.length || 0}${e.codeAvailability?.length ? ' — ' + e.codeAvailability.map((c: any) => c.platform).join(', ') : ''}`)
        console.log(`    Data repos: ${e.dataAvailability?.length || 0}${e.dataAvailability?.length ? ' — ' + e.dataAvailability.map((d: any) => d.platform).join(', ') : ''}`)
        console.log(`    Builds on: ${e.buildsOn?.length || 0} prior works`)
        console.log(`    Cost: $${s3.cost?.toFixed(4)}`)
      } else {
        console.log(`    Error: ${s3.error}`)
      }
    }

    results.push(result)
    sessionProcessed++
    if (result.strategy3?.cost) sessionCost += result.strategy3.cost
    if (result.strategy3?.error) sessionErrors++

    // Incremental save after every paper (crash-safe)
    writeFileSync(outputPath, JSON.stringify(results, null, 2))

    // Periodic progress summary
    if (sessionProcessed % PROGRESS_INTERVAL === 0 || sessionProcessed === ids.length - processedIds.size + sessionProcessed) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = sessionProcessed / (elapsed / 60)
      const remaining = ids.length - processedIds.size + sessionProcessed - sessionProcessed - (processedIds.size - (results.length - sessionProcessed))
      const totalRemaining = ids.length - results.length
      const etaMin = totalRemaining > 0 && rate > 0 ? totalRemaining / rate : 0
      const etaHrs = Math.floor(etaMin / 60)
      const etaM = Math.round(etaMin % 60)
      const totalCostSoFar = results.reduce((sum: number, r: any) => sum + (r.strategy3?.cost || 0), 0)
      console.log(`\n========== Progress: ${results.length}/${ids.length} papers ==========`)
      console.log(`  This session: ${sessionProcessed} papers in ${(elapsed / 60).toFixed(1)} min (${rate.toFixed(1)} papers/min)`)
      console.log(`  Session cost: $${sessionCost.toFixed(2)} | Total cost: $${totalCostSoFar.toFixed(2)}`)
      console.log(`  Errors: ${sessionErrors} | Remaining: ${totalRemaining}`)
      if (totalRemaining > 0 && rate > 0) console.log(`  ETA: ~${etaHrs}h ${etaM}m`)
      console.log('='.repeat(50))
    }
  }

  console.log(`\nResults saved to ${outputPath} (${results.length} papers)`)

  // Save detailed markdown report
  const reportLines: string[] = ['# Extraction Strategy Experiment Results\n']
  for (const r of results) {
    reportLines.push(`## Paper ${r.id}: ${r.title}\n`)
    reportLines.push(`**Type:** ${r.type} | **Full text:** ${r.hasFullText ? 'yes' : 'no'} | **PDF:** ${r.hasPdf ? 'yes' : 'no'}\n`)

    if (r.strategy1) {
      const s1 = r.strategy1
      reportLines.push(`### Strategy 1: Regex Extraction\n`)
      reportLines.push(`- **Figure captions (${s1.figureCaptions.length}):** ${s1.figureCaptions.slice(0, 3).join('; ') || 'none'}${s1.figureCaptions.length > 3 ? ` ... +${s1.figureCaptions.length - 3} more` : ''}`)
      reportLines.push(`- **Table captions (${s1.tableCaptions.length}):** ${s1.tableCaptions.slice(0, 3).join('; ') || 'none'}`)
      reportLines.push(`- **Methods section:** ${s1.methodsSection ? `${s1.methodsSection.length} chars` : 'not found'}`)
      reportLines.push(`- **Equipment:** ${s1.equipmentMentions.join(', ') || 'none'}`)
      reportLines.push(`- **Species:** ${s1.speciesMentions.join(', ') || 'none'}`)
      reportLines.push(`- **Statistical methods:** ${s1.statisticalMethods.join(', ') || 'none'}`)
      reportLines.push(`- **Study site:** ${s1.studySiteDescription?.slice(0, 200) || 'not found'}\n`)
    }

    if (r.strategy2) {
      const s2 = r.strategy2
      const embedded = s2.pages?.filter((p: any) => p.embeddingDimensions > 0)?.length || 0
      reportLines.push(`### Strategy 2: Multimodal Page Embeddings\n`)
      reportLines.push(`- **Pages processed:** ${s2.pages?.length || 0}`)
      reportLines.push(`- **Pages embedded:** ${embedded}`)
      if (s2.error) reportLines.push(`- **Error:** ${s2.error}`)
      reportLines.push('')
    }

    if (r.strategy3?.extraction) {
      const e = r.strategy3.extraction
      reportLines.push(`### Strategy 3: VLM/Claude Analysis (cost: $${r.strategy3.cost?.toFixed(4) || '?'})\n`)

      reportLines.push(`**Research Question:** ${e.researchQuestion || 'not extracted'}\n`)

      if (e.keyFindings?.length > 0) {
        reportLines.push(`**Key Findings:**`)
        for (const f of e.keyFindings) {
          reportLines.push(`- [${f.confidence || '?'}] ${f.finding} *(${f.supportingEvidence || 'no evidence cited'})*`)
        }
        reportLines.push('')
      }

      reportLines.push(`**Conclusions:** ${e.conclusions || 'not extracted'}\n`)

      reportLines.push(`**Methods:** ${e.methods || 'not extracted'}\n`)

      if (e.protocolSteps?.length > 0) {
        reportLines.push(`**Protocol Steps:**`)
        for (const step of e.protocolSteps) {
          if (typeof step === 'string') {
            reportLines.push(`${step}`)
          } else {
            reportLines.push(`**${step.step}. ${step.action}**`)
            reportLines.push(`   ${step.details}`)
            if (step.quantities) reportLines.push(`   - *Quantities:* ${step.quantities}`)
            if (step.duration) reportLines.push(`   - *Duration:* ${step.duration}`)
            if (step.conditions) reportLines.push(`   - *Conditions:* ${step.conditions}`)
            if (step.equipment?.length) reportLines.push(`   - *Equipment:* ${step.equipment.join(', ')}`)
          }
          reportLines.push('')
        }
      }

      reportLines.push(`**Sampling Design:** ${e.samplingDesign || 'not extracted'}\n`)
      reportLines.push(`**Equipment:** ${e.equipment?.join(', ') || 'none'}\n`)

      if (e.studySite) {
        reportLines.push(`**Study Site:**`)
        reportLines.push(`- Description: ${e.studySite.description || '?'}`)
        if (e.studySite.elevation) reportLines.push(`- Elevation: ${e.studySite.elevation}`)
        if (e.studySite.habitat) reportLines.push(`- Habitat: ${e.studySite.habitat}`)
        if (e.studySite.coordinates) reportLines.push(`- Coordinates: ${e.studySite.coordinates}`)
        reportLines.push('')
      }

      if (e.statisticalMethods?.length > 0) {
        reportLines.push(`**Statistical & Data Analysis Methods:**`)
        for (const sm of e.statisticalMethods) {
          if (typeof sm === 'string') {
            reportLines.push(`- ${sm}`)
          } else {
            reportLines.push(`- **${sm.name}**${sm.software ? ` (${sm.software})` : ''}`)
            reportLines.push(`  - Purpose: ${sm.purpose}`)
            if (sm.details) reportLines.push(`  - Details: ${sm.details}`)
          }
        }
        reportLines.push('')
      }

      if (e.species?.length > 0) {
        reportLines.push(`**Species:**`)
        for (const s of e.species) {
          let line = `- *${s.scientificName}*`
          if (s.commonName) line += ` (${s.commonName})`
          if (s.family || s.order) line += ` [${[s.family, s.order, s.class].filter(Boolean).join(' > ')}]`
          if (s.authority) line += ` — ${s.authority}`
          line += ` — **${s.role}**`
          reportLines.push(line)
        }
        reportLines.push('')
      }

      if (e.places?.length > 0) {
        reportLines.push(`**Places:**`)
        for (const pl of e.places) {
          let line = `- **${pl.name}** (${pl.type})`
          if (pl.parentName) line += ` ⊂ ${pl.parentName}`
          const details = [
            pl.coordinates && `📍 ${pl.coordinates}`,
            pl.elevation && `⛰️ ${pl.elevation}`,
            pl.elevationRange && `⛰️ ${pl.elevationRange}`,
            pl.habitat && `🌱 ${pl.habitat}`,
          ].filter(Boolean)
          if (details.length) line += ` — ${details.join(', ')}`
          if (pl.role) line += ` (${pl.role})`
          reportLines.push(line)
        }
        reportLines.push('')
      } else if (e.locations?.length > 0) {
        // legacy fallback for old result files
        reportLines.push(`**Locations:** ${e.locations.map((l: any) => `${l.name} (${l.type})`).join(', ')}\n`)
      }

      if (e.protocolsNamed?.length > 0) {
        reportLines.push(`**Named Protocols:**`)
        for (const pn of e.protocolsNamed) {
          let line = `- **${pn.proposedName}** [${pn.category}${pn.subcategory ? '/' + pn.subcategory : ''}]`
          if (pn.isStandardized) line += ` ✓ standardized`
          if (pn.standardName) line += ` (${pn.standardName})`
          line += ` — ${pn.role}`
          reportLines.push(line)
          if (pn.description) reportLines.push(`  - ${pn.description}`)
        }
        reportLines.push('')
      }

      if (e.concepts?.length > 0) {
        reportLines.push(`**Concepts:**`)
        for (const c of e.concepts) {
          let line = `- **${c.name}** [${c.type}${c.scope ? '/' + c.scope : ''}] — ${c.role}`
          reportLines.push(line)
          if (c.definition) reportLines.push(`  - ${c.definition}`)
        }
        reportLines.push('')
      }

      if (e.metadataEnrichment) {
        const m = e.metadataEnrichment
        const filled: string[] = []
        if (m.title) filled.push('title')
        if (m.doi) filled.push('doi')
        if (m.abstract) filled.push(`abstract (${m.abstract.length} chars)`)
        if (m.keywords?.length) filled.push(`${m.keywords.length} keywords`)
        if (m.authors?.length) filled.push(`${m.authors.length} authors`)
        if (filled.length) {
          reportLines.push(`**Metadata Enrichment:** ${filled.join(', ')}\n`)
        }
      }

      if (e.chemicals?.length > 0) reportLines.push(`**Chemicals/Nutrients:** ${e.chemicals.join(', ')}\n`)
      if (e.timespan) reportLines.push(`**Timespan:** ${e.timespan.start || '?'} – ${e.timespan.end || '?'} (${e.timespan.duration || '?'})\n`)

      if (e.figures?.length > 0) {
        reportLines.push(`**Figures:**`)
        for (const f of e.figures) reportLines.push(`- Page ${f.page} [${f.type}]: ${f.description} → *${f.keyInsight}*`)
        reportLines.push('')
      }

      if (e.tables?.length > 0) {
        reportLines.push(`**Tables:**`)
        for (const t of e.tables) reportLines.push(`- Page ${t.page}: ${t.description} (vars: ${t.variables?.join(', ') || '?'}) → *${t.keyData}*`)
        reportLines.push('')
      }

      if (e.photographs?.length > 0) {
        reportLines.push(`**Photographs:**`)
        for (const p of e.photographs) reportLines.push(`- Page ${p.page}: ${p.description} → *${p.methodsRelevance}*`)
        reportLines.push('')
      }

      if (e.codeAvailability?.length > 0) {
        reportLines.push(`**Code Availability:**`)
        for (const c of e.codeAvailability) {
          reportLines.push(`- [${c.platform}](${c.url})${c.language ? ` (${c.language})` : ''}`)
          reportLines.push(`  ${c.description}`)
          if (c.license) reportLines.push(`  License: ${c.license}`)
        }
        reportLines.push('')
      }

      if (e.dataAvailability?.length > 0) {
        reportLines.push(`**Data Availability:**`)
        for (const d of e.dataAvailability) {
          reportLines.push(`- [${d.platform}](${d.url})${d.doi ? ` (DOI: ${d.doi})` : ''}`)
          reportLines.push(`  ${d.description}`)
        }
        reportLines.push('')
      }

      if (e.buildsOn?.length > 0) reportLines.push(`**Builds On:** ${e.buildsOn.join('; ')}\n`)
      if (e.methodsSharedWith?.length > 0) reportLines.push(`**Methods Shared With:** ${e.methodsSharedWith.join('; ')}\n`)
      if (e.comparableTo?.length > 0) reportLines.push(`**Comparable To:** ${e.comparableTo.join('; ')}\n`)
    } else if (r.strategy3?.error) {
      reportLines.push(`### Strategy 3: VLM/Claude Analysis\n`)
      reportLines.push(`**Error:** ${r.strategy3.error}\n`)
    }

    reportLines.push('---\n')
  }

  const reportPath = `${RESULTS_DIR}/report.md`
  writeFileSync(reportPath, reportLines.join('\n'))
  console.log(`Detailed report saved to ${reportPath}`)

  // Summary table
  console.log('\n========== Summary ==========')
  console.log('Paper                                              | S1 Figs | S1 Methods | S2 Pages | S3 Steps | S3 Cost')
  console.log('-'.repeat(105))
  for (const r of results) {
    const s1Figs = r.strategy1?.figureCaptions?.length ?? '-'
    const s1Methods = r.strategy1?.methodsSection ? 'Y' : 'N'
    const s2Pages = r.strategy2?.pages?.filter((p: any) => p.embeddingDimensions > 0)?.length ?? '-'
    const s3Steps = r.strategy3?.extraction?.protocolSteps?.length ?? '-'
    const s3Cost = r.strategy3?.cost ? `$${r.strategy3.cost.toFixed(4)}` : '-'
    console.log(`${r.title.slice(0, 50).padEnd(50)} | ${String(s1Figs).padStart(7)} | ${s1Methods.padStart(10)} | ${String(s2Pages).padStart(8)} | ${String(s3Steps).padStart(8)} | ${s3Cost}`)
  }

  // Total cost
  const totalCost = results.reduce((sum, r) => sum + (r.strategy3?.cost || 0), 0)
  if (totalCost > 0) console.log(`\nTotal Strategy 3 cost: $${totalCost.toFixed(4)}`)

  await db.end()
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
