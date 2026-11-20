/**
 * CrossRef & Unpaywall API client.
 *
 * Shared by scrape-publications.ts (strict mode), enrich.ts (relaxed mode) and
 * extract-rescued-bibliographies.ts (bibliographic search, works by DOI).
 *
 * CrossRef's polite pool currently allows 1 request per second
 * (x-rate-limit-limit: 1, x-rate-limit-interval: 1s, seen 2026-11-20). Before
 * this module paced itself, back-to-back calls got 429s that were reported as
 * "no DOI found", silently dropping matches. Now every request goes through
 * one shared pacer, 429/5xx/network failures are retried with backoff, and a
 * request that still fails is returned with `error` set (and counted in
 * crossrefStats()) instead of looking like a genuine miss.
 */

import { titleSimilarity } from './doi-utils.js'
import { CROSSREF_API, CROSSREF_MAILTO, UNPAYWALL_API, UNPAYWALL_EMAIL } from './config.js'

// ---------------------------------------------------------------------------
// Pacing + retries
// ---------------------------------------------------------------------------

const config = { minIntervalMs: 1100, backoffMs: 2000, retries: 4, timeoutMs: 30000 }
/** Tests set intervals to 0; scripts can loosen or tighten pacing. */
export function configureCrossref(opts: Partial<typeof config>): void {
  Object.assign(config, opts)
}

const stats = { requests: 0, retried: 0, failed: 0 }
/** Requests made, retried and finally failed since start (failures are NOT "no match"). */
export function crossrefStats(): Readonly<typeof stats> {
  return { ...stats }
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())
const lastRequest = new Map<string, number>()

/** One request at a time per host, at least minIntervalMs apart. */
let queue: Promise<unknown> = Promise.resolve()
function paced<T>(host: string, interval: number, fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = (lastRequest.get(host) ?? 0) + interval - Date.now()
    await sleep(wait)
    lastRequest.set(host, Date.now())
    return fn()
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

type Fetched = { ok: true; data: any } | { ok: false; status: number | null; error: string }

/**
 * GET JSON with pacing and retries. 404 → { ok: false, status: 404 } (a real
 * "not found"); 429/5xx/network errors are retried; anything else fails fast.
 */
async function getJson(url: string, host: string, interval: number): Promise<Fetched> {
  let lastError = ''
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    stats.requests++
    try {
      const res: any = await paced(host, interval, () =>
        fetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(config.timeoutMs) } : undefined))
      if (res.ok) return { ok: true, data: await res.json() }
      const status: number | null = typeof res.status === 'number' ? res.status : null
      if (status === 404) return { ok: false, status, error: 'not found' }
      if (status !== null && (status === 429 || status >= 500)) {
        lastError = `HTTP ${status}`
      } else {
        stats.failed++
        return { ok: false, status, error: status ? `HTTP ${status}` : 'request failed' }
      }
    } catch (err: any) {
      lastError = err?.message ?? String(err)
    }
    if (attempt < config.retries) {
      stats.retried++
      await sleep(config.backoffMs * (attempt + 1))
    }
  }
  stats.failed++
  return { ok: false, status: null, error: lastError || 'request failed' }
}

const crossrefGet = (url: string) => getJson(url, 'api.crossref.org', config.minIntervalMs)
const unpaywallGet = (url: string) => getJson(url, 'api.unpaywall.org', Math.min(config.minIntervalMs, 200))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossRefResult {
  doi: string | null
  abstract: string | null
  /** Set when the lookup itself failed (rate limit, outage): retry later, don't record a miss. */
  error?: string
}

export interface UnpaywallResult {
  pdfUrl: string | null
  oaStatus: string | null
  error?: string
}

export interface CrossRefOptions {
  /** Use relaxed matching: lower similarity threshold (0.75), +/-1 year tolerance, more rows */
  relaxed?: boolean
}

// ---------------------------------------------------------------------------
// CrossRef
// ---------------------------------------------------------------------------

export async function queryCrossRef(
  title: string,
  firstAuthorFamily: string,
  year: number | string,
  opts?: CrossRefOptions,
): Promise<CrossRefResult> {
  const relaxed = opts?.relaxed ?? false
  const numYear = typeof year === 'string' ? parseInt(year) : year
  const threshold = relaxed ? 0.75 : 0.85
  const yearFrom = relaxed ? numYear - 1 : numYear
  const yearTo = relaxed ? numYear + 1 : numYear
  const rows = relaxed ? 5 : 3

  const query = encodeURIComponent(title)
  const url = `${CROSSREF_API}?query.title=${query}&query.author=${encodeURIComponent(firstAuthorFamily)}&filter=from-pub-date:${yearFrom},until-pub-date:${yearTo}&rows=${rows}&select=DOI,title,abstract,author&mailto=${CROSSREF_MAILTO}`

  const res = await crossrefGet(url)
  if (!res.ok) return { doi: null, abstract: null, ...(res.status === 404 ? {} : { error: res.error }) }
  const items = res.data?.message?.items
  if (!items || items.length === 0) return { doi: null, abstract: null }

  for (const item of items) {
    const crTitle = Array.isArray(item.title) ? item.title[0] : item.title
    if (!crTitle) continue
    if (titleSimilarity(title, crTitle) > threshold) {
      let abstract = item.abstract || null
      if (abstract) abstract = abstract.replace(/<[^>]+>/g, '').trim()
      return { doi: item.DOI, abstract }
    }
  }
  return { doi: null, abstract: null }
}

export interface CrossRefWork {
  doi: string
  title: string
  similarity: number
}

/**
 * Bibliographic search: title + venue as one query (copes with paraphrased
 * titles in old bibliographies), first author, year ± 1. Returns the best
 * candidate at or above minSimilarity (word-set similarity of titles).
 */
export async function searchCrossRefCitation(
  citation: { title: string; venue?: string | null; firstAuthorFamily?: string | null; year: number },
  minSimilarity = 0.75,
): Promise<{ work: CrossRefWork | null; error?: string }> {
  const q = encodeURIComponent(`${citation.title} ${citation.venue ?? ''}`.trim())
  const author = citation.firstAuthorFamily ? `&query.author=${encodeURIComponent(citation.firstAuthorFamily)}` : ''
  const url = `${CROSSREF_API}?query.bibliographic=${q}${author}&filter=from-pub-date:${citation.year - 1},until-pub-date:${citation.year + 1}&rows=5&select=DOI,title&mailto=${CROSSREF_MAILTO}`
  const res = await crossrefGet(url)
  if (!res.ok) return res.status === 404 ? { work: null } : { work: null, error: res.error }
  let best: CrossRefWork | null = null
  for (const it of res.data?.message?.items ?? []) {
    const t = Array.isArray(it.title) ? it.title[0] : it.title
    if (!t) continue
    const s = titleSimilarity(citation.title, t)
    if (s >= minSimilarity && (!best || s > best.similarity)) best = { doi: it.DOI, title: t, similarity: s }
  }
  return { work: best }
}

/** Full CrossRef metadata for one DOI (message object), or null when CrossRef doesn't know it. */
export async function fetchCrossRefWork(doi: string): Promise<{ work: any | null; error?: string }> {
  const res = await crossrefGet(`${CROSSREF_API}/${encodeURIComponent(doi)}?mailto=${CROSSREF_MAILTO}`)
  if (!res.ok) return res.status === 404 ? { work: null } : { work: null, error: res.error }
  return { work: res.data?.message ?? null }
}

// ---------------------------------------------------------------------------
// Unpaywall
// ---------------------------------------------------------------------------

export async function queryUnpaywall(doi: string): Promise<UnpaywallResult> {
  const url = `${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`
  const res = await unpaywallGet(url)
  if (!res.ok) return { pdfUrl: null, oaStatus: null, ...(res.status === 404 ? {} : { error: res.error }) }
  const data = res.data
  const oaStatus = data.oa_status || null

  const bestPdf = data.best_oa_location?.url_for_pdf || null
  if (bestPdf) return { pdfUrl: bestPdf, oaStatus }

  if (Array.isArray(data.oa_locations)) {
    for (const loc of data.oa_locations) {
      if (loc.url_for_pdf) return { pdfUrl: loc.url_for_pdf, oaStatus }
    }
  }
  return { pdfUrl: null, oaStatus }
}
