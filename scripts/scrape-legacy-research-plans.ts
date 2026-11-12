/**
 * Snapshot the legacy (1996–2020) research-plan database from old.rmbl.org.
 *
 * The old site is behind Cloudflare Access (email one-time PIN), so this goes
 * through `cloudflared access curl`, which reuses a token saved by an
 * interactive login. Log in first, in your own terminal (it prints the token):
 *
 *   cloudflared access login https://old.rmbl.org/research-plan/
 *
 * The /research-plan/ page is a Kendo grid over the rmbl-rplan plugin's JSON
 * endpoint; we page that endpoint directly instead of scraping HTML.
 *
 * Output: scripts/data/research-plans-legacy-1996-2020.json — committed, like
 * the 2022–2026 CSV, because the old site is being retired. The PI career-stage
 * fields (Job, ResearchPlanProfessionID) are dropped: they are not displayed and
 * the repo is public.
 *
 * Usage:
 *   npx tsx scripts/scrape-legacy-research-plans.ts [--out=path]
 */

import { execFile } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { sleep } from './lib/concurrency.js'

const run = promisify(execFile)

const ENDPOINT = 'https://old.rmbl.org/wp-json/rmbl-rplan/v1/rplan'
const PAGE_SIZE = 100
const DROP = new Set(['Job', 'ResearchPlanProfessionID'])

const out =
  process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ??
  join(import.meta.dirname, 'data', 'research-plans-legacy-1996-2020.json')

interface Page {
  data: Record<string, unknown>[]
  total: number
}

async function fetchPage(skip: number): Promise<Page> {
  const url = `${ENDPOINT}?take=${PAGE_SIZE}&skip=${skip}&page=${skip / PAGE_SIZE + 1}&pageSize=${PAGE_SIZE}`
  const { stdout } = await run('cloudflared', ['access', 'curl', url, '-sS', '--fail'], {
    maxBuffer: 64 * 1024 * 1024,
  })
  try {
    return JSON.parse(stdout) as Page
  } catch {
    // An expired token gets the Access login page (HTML) instead of JSON.
    throw new Error(
      'Response was not JSON — the Cloudflare Access session has probably expired.\n' +
        'Run `cloudflared access login https://old.rmbl.org/research-plan/` and retry.',
    )
  }
}

async function main() {
  const byId = new Map<number, Record<string, unknown>>()
  let total = Infinity
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const page = await fetchPage(skip)
    total = Number(page.total) // the API sends it as a string
    for (const row of page.data) {
      const kept = Object.fromEntries(Object.entries(row).filter(([k]) => !DROP.has(k)))
      byId.set(Number(row.ResearchPlanID), kept)
    }
    console.log(`  ${Math.min(skip + PAGE_SIZE, total)}/${total}`)
    await sleep(1000)
  }
  if (byId.size !== total) throw new Error(`Expected ${total} plans, got ${byId.size} unique IDs`)

  const rows = [...byId.values()].sort((a, b) => Number(a.ResearchPlanID) - Number(b.ResearchPlanID))
  writeFileSync(out, JSON.stringify(rows, null, 1) + '\n')
  console.log(`Wrote ${rows.length} plans to ${out}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
