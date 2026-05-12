/**
 * Pipeline Orchestrator
 *
 * Chains the full ingest flow: check sources for changes -> scrape/normalize ->
 * enrich -> load to Payload -> organize topics -> build authors.
 *
 * Long-running steps (PDF pipeline, GROBID, reference matching) are intentionally
 * excluded — they're listed as "next steps" at the end.
 *
 * Usage:
 *   npx tsx scripts/pipeline.ts [--phase=check|ingest|enrich|load|topics|authors|all] [--dry-run]
 *   npx tsx scripts/pipeline.ts --phase=all          # full pipeline
 *   npx tsx scripts/pipeline.ts --phase=check --dry-run  # preview changes only
 */

import { mkdirSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const phaseArg = args.find((a) => a.startsWith('--phase='))?.split('=')[1] || 'all'
const dryRun = args.includes('--dry-run')

const PHASES = ['check', 'ingest', 'discover', 'enrich', 'load', 'topics', 'authors', 'entities', 'citations', 'embeddings'] as const
type Phase = (typeof PHASES)[number]

function shouldRun(phase: Phase): boolean {
  if (phaseArg === 'all') return true
  return phaseArg === phase
}

// ---------------------------------------------------------------------------
// Phase 1: CHECK — detect new/changed/removed records
// ---------------------------------------------------------------------------

async function runCheck(): Promise<{ hasChanges: boolean }> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 1: CHECK — Detecting source changes')
  console.log('='.repeat(60))

  // Dynamically import to avoid loading all modules upfront
  const { execSync } = await import('child_process')

  try {
    const flags = dryRun ? '--dry-run' : ''
    const output = execSync(
      `npx tsx scripts/update-sources.ts ${flags}`,
      { cwd: process.cwd(), encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] },
    )
    console.log(output)

    // Check if any changes were detected
    const hasChanges = !output.includes('no changes detected')
    return { hasChanges }
  } catch (err: any) {
    console.log(err.stdout || '')
    console.error(err.stderr || '')
    console.error('Check phase failed — continuing with remaining phases')
    return { hasChanges: true } // assume changes if check fails
  }
}

// ---------------------------------------------------------------------------
// Phase 2: INGEST — scrape and normalize sources
// ---------------------------------------------------------------------------

async function runIngest(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 2: INGEST — Scraping and normalizing sources')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  // Run scrapers sequentially (they share API rate limits)
  const scrapers = [
    { name: 'Sustainable Library', cmd: 'npx tsx scripts/scrape-library.ts' },
    { name: 'Publications', cmd: 'npx tsx scripts/scrape-publications.ts --skip-crossref --skip-unpaywall' },
    { name: 'Data Catalog', cmd: 'npx tsx scripts/scrape-catalog.ts' },
  ]

  for (const scraper of scrapers) {
    console.log(`\n--- ${scraper.name} ---`)
    try {
      execSync(scraper.cmd, opts)
    } catch (err) {
      console.error(`  ${scraper.name} failed — continuing with other sources`)
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: DISCOVER — find new publications via OpenAlex
// ---------------------------------------------------------------------------

async function runDiscover(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 3: DISCOVER — Finding new publications via OpenAlex')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const flags = dryRun ? '--dry-run' : ''
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync(`npx tsx scripts/discover-publications.ts ${flags}`, opts)
  } catch (err) {
    console.error('Discover phase failed — continuing')
  }
}

// ---------------------------------------------------------------------------
// Phase 4: ENRICH — DOIs, ORCIDs, mentors
// ---------------------------------------------------------------------------

async function runEnrich(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 4: ENRICH — DOIs, ORCIDs, mentors')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const flags = dryRun ? '--dry-run' : ''
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync(`npx tsx scripts/enrich.ts --step=all ${flags}`, opts)
  } catch (err) {
    console.error('Enrich phase failed — continuing')
  }
}

// ---------------------------------------------------------------------------
// Phase 5: LOAD — upsert records into Payload
// ---------------------------------------------------------------------------

async function runLoad(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 5: LOAD — Loading records into Payload')
  console.log('='.repeat(60))

  if (dryRun) {
    console.log('  (Skipped in dry run — Payload writes required)')
    return
  }

  const { execSync } = await import('child_process')
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync('npx tsx scripts/load-to-payload.ts', opts)
  } catch (err) {
    console.error('Load phase failed — is the Payload server running?')
  }
}

// ---------------------------------------------------------------------------
// Phase 6: TOPICS — organize taxonomy + assign to publications
// ---------------------------------------------------------------------------

async function runTopics(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 6: TOPICS — Organizing taxonomy and assigning topics')
  console.log('='.repeat(60))

  if (dryRun) {
    console.log('  (Skipped in dry run — Payload writes required)')
    return
  }

  const { execSync } = await import('child_process')
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync('npx tsx scripts/manage-topics.ts', opts)
  } catch (err) {
    console.error('Topics phase failed — continuing')
  }
}

// ---------------------------------------------------------------------------
// Phase 7: AUTHORS — build and deduplicate author registry
// ---------------------------------------------------------------------------

async function runAuthors(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 7: AUTHORS — Building author registry')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const flags = [
    dryRun ? '--dry-run' : '',
    dryRun ? '' : '--load-payload',
  ].filter(Boolean).join(' ')
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync(`npx tsx scripts/build-authors.ts ${flags}`, opts)
  } catch (err) {
    console.error('Authors phase failed — continuing')
  }
}

// ---------------------------------------------------------------------------
// Phase 8: ENTITIES — consolidate fragmented species + backfill text-match
//                     mentions across all content collections.
// ---------------------------------------------------------------------------

async function runEntities(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 8: ENTITIES — Consolidating species + backfilling mentions')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const flags = dryRun ? '--dry-run' : ''
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    // Collapse any plural/singular species fragmentation created by recent
    // VLM/LLM extractions. Idempotent — a no-op once pairs collapse.
    execSync(`npx tsx scripts/merge-plural-species.ts ${flags}`, opts)
  } catch (err) {
    console.error('Plural-species merge failed — continuing')
  }

  try {
    // Backfill text-search mentions of every species across publications,
    // documents, datasets, and stories. Conservative term selection — see
    // scripts/backfill-species-mentions.ts. Idempotent: ON CONFLICT skips
    // existing (species, collection, item) tuples, so re-runs only add
    // mentions for newly-added content.
    execSync(`npx tsx scripts/backfill-species-mentions.ts ${flags}`, opts)
  } catch (err) {
    console.error('Species backfill failed — continuing')
  }
}

// ---------------------------------------------------------------------------
// Phase 9: CITATIONS — refresh external citation counts
// ---------------------------------------------------------------------------

async function runCitations(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 9: CITATIONS — Refreshing external citation counts')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const flags = dryRun ? '--dry-run' : ''
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync(`npx tsx scripts/fetch-citation-counts.ts --step=all --stale-days=30 ${flags}`, opts)
  } catch (err) {
    console.error('Citations phase failed — continuing')
  }
}

// ---------------------------------------------------------------------------
// Phase 10: EMBEDDINGS — generate vector embeddings for concept graph
// ---------------------------------------------------------------------------

async function runEmbeddings(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('Phase 10: EMBEDDINGS — Generating vector embeddings')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')
  const opts = { cwd: process.cwd(), encoding: 'utf-8' as const, stdio: 'inherit' as const }

  try {
    execSync('npx tsx scripts/generate-embeddings.ts --collection=all --level=summary', opts)
  } catch (err) {
    console.error('Embeddings phase failed — is VOYAGE_API_KEY set?')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const start = Date.now()
  console.log('RMBL Knowledge Hub — Pipeline Orchestrator')
  console.log('==========================================')
  console.log(`Phase: ${phaseArg}`)
  if (dryRun) console.log('(DRY RUN — no destructive changes)')
  console.log(`Started: ${new Date().toISOString()}`)

  let hasChanges = true

  if (shouldRun('check')) {
    const result = await runCheck()
    hasChanges = result.hasChanges

    if (!hasChanges && phaseArg === 'all') {
      console.log('\nNo changes detected across all sources. Pipeline complete.')
      return
    }
  }

  if (shouldRun('ingest')) await runIngest()
  if (shouldRun('discover')) await runDiscover()
  if (shouldRun('enrich')) await runEnrich()
  if (shouldRun('load')) await runLoad()
  if (shouldRun('topics')) await runTopics()
  if (shouldRun('authors')) await runAuthors()
  if (shouldRun('entities')) await runEntities()
  if (shouldRun('citations')) await runCitations()
  if (shouldRun('embeddings')) await runEmbeddings()

  // Summary
  const elapsed = ((Date.now() - start) / 1000).toFixed(0)
  console.log('\n' + '='.repeat(60))
  console.log(`Pipeline complete in ${elapsed}s`)
  console.log('='.repeat(60))

  if (!dryRun) {
    console.log('\nNext steps (run manually as needed):')
    console.log('  1. npx tsx scripts/download-pdfs.ts           # download new PDFs')
    console.log('  2. npx tsx scripts/extract-text.ts            # extract text (digital + OCR)')
    console.log('  3. npx tsx scripts/load-fulltext.ts           # load text to Payload')
    console.log('  4. npx tsx scripts/extract-references.ts --method=all  # extract references')
    console.log('  5. npx tsx scripts/match-references.ts        # match & load to DB')
    console.log('  6. npx tsx scripts/crosslink-datasets.ts      # link pubs ↔ datasets')
    console.log('  7. npx tsx scripts/discover-datasets.ts --source=all   # find new datasets')
  }
}

main().catch((err) => {
  console.error('Pipeline error:', err)
  process.exit(1)
})
