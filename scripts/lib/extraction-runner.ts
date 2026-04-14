/**
 * Shared infrastructure for entity extraction scripts:
 * - Resume support (load existing results, skip processed items)
 * - Incremental saves (crash-safe)
 * - Progress tracking with ETA
 *
 * Consolidates identical patterns from extract-dataset-entities.ts,
 * extract-document-entities.ts, and extract-longform-entities.ts.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'

/**
 * Manages resume support and incremental saves for extraction runs.
 */
export class ResultsManager {
  private results: any[] = []
  private processedKeys = new Set<string>()

  constructor(
    private resultsPath: string,
    private keyFn: (r: any) => string = (r) => String(r.id),
  ) {}

  /** Load existing results and build processed set. */
  load(): any[] {
    if (existsSync(this.resultsPath)) {
      this.results = JSON.parse(readFileSync(this.resultsPath, 'utf-8'))
      for (const r of this.results) this.processedKeys.add(this.keyFn(r))
    }
    return this.results
  }

  /** Check if an item has already been processed. */
  isProcessed(key: string): boolean {
    return this.processedKeys.has(key)
  }

  /** Filter items to only unprocessed ones, with optional limit. */
  filterRemaining<T>(items: T[], keyFn: (item: T) => string, limit: number = Infinity): T[] {
    return items.filter((item) => !this.processedKeys.has(keyFn(item))).slice(0, limit)
  }

  /** Number of already-processed items. */
  get processedCount(): number {
    return this.processedKeys.size
  }

  /** Add a result and save incrementally. */
  add(result: any): void {
    this.results.push(result)
    this.processedKeys.add(this.keyFn(result))
    writeFileSync(this.resultsPath, JSON.stringify(this.results, null, 2))
  }

  /** Get all results. */
  getAll(): any[] {
    return this.results
  }
}

/**
 * Tracks progress and computes ETA for long-running extraction jobs.
 */
export class ProgressTracker {
  private startTime = Date.now()
  private processed = 0
  private totalCost = 0

  constructor(
    private total: number,
    private interval: number = 25,
  ) {}

  /** Record one item processed, optionally with cost. */
  tick(cost: number = 0): void {
    this.processed++
    this.totalCost += cost
  }

  /** Check if a progress report is due (every N items or at the end). */
  shouldReport(): boolean {
    return this.processed % this.interval === 0 || this.processed === this.total
  }

  /** Format a progress report line. */
  report(label: string = 'items'): string {
    const elapsed = (Date.now() - this.startTime) / 1000
    const rate = this.processed / (elapsed / 60)
    const remaining = this.total - this.processed
    const etaMin = rate > 0 ? remaining / rate : 0
    const parts = [
      `[${this.processed}/${this.total}]`,
      `${(elapsed / 60).toFixed(1)}min`,
      `${rate.toFixed(0)} ${label}/min`,
    ]
    if (this.totalCost > 0) parts.push(`cost=$${this.totalCost.toFixed(2)}`)
    parts.push(`ETA ${Math.round(etaMin)}min`)
    return `  ${parts.join(', ')}`
  }

  get count(): number { return this.processed }
  get cost(): number { return this.totalCost }
}
