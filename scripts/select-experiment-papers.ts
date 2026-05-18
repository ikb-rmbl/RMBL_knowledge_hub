/**
 * STATUS: Experiment artifact (completed). Part of the VLM extraction
 *         experiment from spring 2026. Kept for reference / re-stratification
 *         if a new sampling pass is needed.
 *
 * Select Experiment Papers
 *
 * Picks a stratified sample of publications for the GraphRAG VLM extraction
 * experiment. Filters to papers that:
 *   - Have a PDF on disk in scripts/output/pdf-staging/publications/
 *   - Have ≤40 pages (per the Phase 4a page limit)
 *   - Span multiple publication types and decades
 *
 * Writes the selected IDs to a file (one per line) for use with:
 *   npx tsx scripts/experiment-extraction.ts --strategy=3 --ids-file=<path>
 *
 * Usage:
 *   npx tsx scripts/select-experiment-papers.ts [--count=100] [--out=path] [--seed=N]
 */

import { execSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import pg from 'pg'
import { STAGING_DIR, OUTPUT_DIR } from './lib/config.js'

const args = process.argv.slice(2)
const countArg = args.find((a) => a.startsWith('--count='))?.split('=')[1]
const outArg = args.find((a) => a.startsWith('--out='))?.split('=')[1]
const seedArg = args.find((a) => a.startsWith('--seed='))?.split('=')[1]

const TARGET_COUNT = countArg ? parseInt(countArg, 10) : 100
const OUTPUT_PATH = outArg || `${OUTPUT_DIR}/extraction-experiment/test-${TARGET_COUNT}-ids.txt`
const SEED = seedArg ? parseInt(seedArg, 10) : 42
const MAX_PAGES = 40

// Stratification targets — totals to TARGET_COUNT
// Reflects the corpus distribution + a focus on the most useful types
const STRATA: Record<string, Record<string, number>> = TARGET_COUNT === 100
  ? {
      article: { '2020s': 18, '2010s': 15, '2000s': 10, '1990s': 4, '1980s': 2, 'pre-1980': 1 }, // 50
      student_paper: { '2020s': 8, '2010s': 12, '2000s': 5 },                                      // 25
      thesis: { '2020s': 7, '2010s': 7, '2000s': 1 },                                              // 15
      chapter: { '2020s': 2, '2010s': 1, '2000s': 1, '1990s': 1 },                                 // 5
      other: { '2020s': 2, '2010s': 2, '2000s': 1 },                                               // 5
    }
  : {} // for non-100 counts, fall back to proportional sampling

// Simple seedable PRNG (xmur3 + sfc32)
function seededRandom(seed: number): () => number {
  let a = (seed | 0) || 1
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function decadeOf(year: number | null): string {
  if (!year || year <= 0) return 'unknown'
  if (year >= 2020) return '2020s'
  if (year >= 2010) return '2010s'
  if (year >= 2000) return '2000s'
  if (year >= 1990) return '1990s'
  if (year >= 1980) return '1980s'
  return 'pre-1980'
}

function getPdfPageCount(pdfPath: string): number {
  try {
    const out = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | awk '/^Pages:/{print $2}'`, { encoding: 'utf-8' }).trim()
    return parseInt(out, 10) || 0
  } catch {
    return 0
  }
}

async function main() {
  console.log('Select Experiment Papers')
  console.log('========================')
  console.log(`Target count: ${TARGET_COUNT}`)
  console.log(`Max pages: ${MAX_PAGES}`)
  console.log(`Seed: ${SEED}`)
  console.log(`Output: ${OUTPUT_PATH}`)
  console.log()

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  try {
    // Pull all candidate publications: have PDFs (any kind), have full_text, have year
    const { rows } = await db.query(`
      SELECT id, publication_type, year, title
      FROM publications
      WHERE full_text IS NOT NULL
        AND year IS NOT NULL AND year > 0
        AND publication_type IS NOT NULL
      ORDER BY id
    `)
    console.log(`Loaded ${rows.length} publications with full_text + year + type`)

    // Bucket by (type, decade)
    const buckets = new Map<string, any[]>()
    for (const row of rows) {
      const key = `${row.publication_type}|${decadeOf(row.year)}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(row)
    }

    // Check PDF existence + page count for each candidate, lazily by stratum
    // (we don't want to pdfinfo all 4500 PDFs — only what we sample from)
    const rng = seededRandom(SEED)
    const selected: any[] = []
    const stratumStats: { type: string; decade: string; want: number; got: number; checked: number }[] = []

    for (const [type, decadeMap] of Object.entries(STRATA)) {
      for (const [decade, want] of Object.entries(decadeMap)) {
        const key = `${type}|${decade}`
        const pool = buckets.get(key) || []
        // Shuffle pool with seeded RNG (Fisher-Yates)
        const shuffled = [...pool]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }

        let got = 0
        let checked = 0
        for (const row of shuffled) {
          if (got >= want) break
          checked++
          const pdfPath = `${STAGING_DIR}/publications/pub_${row.id}.pdf`
          if (!existsSync(pdfPath)) continue
          const pages = getPdfPageCount(pdfPath)
          if (pages === 0 || pages > MAX_PAGES) continue
          selected.push({ ...row, pages })
          got++
        }
        stratumStats.push({ type, decade, want, got, checked })
      }
    }

    // Print stratum report
    console.log('\nStratum results (want / got, checked):')
    let totalWant = 0
    let totalGot = 0
    for (const s of stratumStats) {
      totalWant += s.want
      totalGot += s.got
      const marker = s.got === s.want ? '✓' : (s.got > 0 ? '~' : '✗')
      console.log(`  ${marker} ${s.type.padEnd(15)} ${s.decade.padEnd(10)} ${s.got}/${s.want} (checked ${s.checked})`)
    }
    console.log(`\nTotal selected: ${totalGot}/${totalWant}`)

    if (totalGot < TARGET_COUNT) {
      console.log(`\nFalling short by ${TARGET_COUNT - totalGot}. Filling from any remaining candidates...`)
      const selectedIds = new Set(selected.map((r) => r.id))
      const remaining: any[] = []
      for (const row of rows) {
        if (selectedIds.has(row.id)) continue
        const pdfPath = `${STAGING_DIR}/publications/pub_${row.id}.pdf`
        if (!existsSync(pdfPath)) continue
        remaining.push(row)
      }
      // Shuffle and try
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
      }
      let added = 0
      for (const row of remaining) {
        if (totalGot + added >= TARGET_COUNT) break
        const pdfPath = `${STAGING_DIR}/publications/pub_${row.id}.pdf`
        const pages = getPdfPageCount(pdfPath)
        if (pages === 0 || pages > MAX_PAGES) continue
        selected.push({ ...row, pages })
        added++
      }
      console.log(`  Added ${added} fallback papers`)
    }

    // Sort selected by ID for stable output
    selected.sort((a, b) => a.id - b.id)

    // Write IDs to file
    const idLines = selected.map((s) => String(s.id)).join('\n')
    writeFileSync(OUTPUT_PATH, idLines + '\n')
    console.log(`\nWrote ${selected.length} IDs to ${OUTPUT_PATH}`)

    // Print summary by type/decade for sanity check
    const summary = new Map<string, number>()
    let totalPages = 0
    for (const s of selected) {
      const key = `${s.publication_type}|${decadeOf(s.year)}`
      summary.set(key, (summary.get(key) || 0) + 1)
      totalPages += s.pages
    }
    console.log('\nFinal sample distribution:')
    for (const [key, count] of [...summary.entries()].sort()) {
      console.log(`  ${key.padEnd(28)} ${count}`)
    }
    console.log(`\nTotal pages across all ${selected.length} papers: ${totalPages}`)
    console.log(`Average pages per paper: ${(totalPages / selected.length).toFixed(1)}`)
    console.log(`Estimated cost (~$0.012/page): $${(totalPages * 0.012).toFixed(2)}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
