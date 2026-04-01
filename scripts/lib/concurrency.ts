/**
 * Shared concurrency utilities for pipeline scripts.
 *
 * Provides a concurrent queue worker with progress reporting,
 * used across all scraping, downloading, and enrichment scripts.
 */

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface ConcurrentResult {
  completed: number
  errors: number
}

/**
 * Process items concurrently with a progress display.
 *
 * @param items - Array of items to process
 * @param concurrency - Maximum number of concurrent workers
 * @param fn - Async function to process each item
 * @param label - Label for progress display (e.g., "Download")
 * @returns Count of completed and errored items
 */
export async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  label: string,
): Promise<ConcurrentResult> {
  let completed = 0
  let errors = 0
  const total = items.length

  async function worker(queue: { item: T; index: number }[]) {
    while (queue.length > 0) {
      const { item, index } = queue.shift()!
      try {
        await fn(item, index)
      } catch {
        errors++
      }
      completed++
      if (completed % 25 === 0 || completed === total) {
        process.stdout.write(`\r  ${label}: ${completed}/${total}${errors > 0 ? ` (${errors} errors)` : ''}`)
      }
    }
  }

  const queue = items.map((item, index) => ({ item, index }))
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)),
  )
  if (total > 0) console.log()
  return { completed, errors }
}

export interface BatchResult {
  success: number
  skipped: number
  errors: number
}

/**
 * Process items concurrently with success/skip/error tracking.
 * The fn should throw to indicate an error, or the caller tracks
 * success/skip via the returned stats.
 */
export async function runBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<'success' | 'skipped'>,
  label: string,
): Promise<BatchResult> {
  let completed = 0
  let success = 0
  let skipped = 0
  let errors = 0
  const total = items.length

  async function worker(queue: T[]) {
    while (queue.length > 0) {
      const item = queue.shift()!
      try {
        const result = await fn(item)
        if (result === 'success') success++
        else skipped++
      } catch (err: any) {
        errors++
        if (errors <= 5) console.error(`\n  ERROR: ${err?.message?.slice(0, 120)}`)
      }
      completed++
      if (completed % 50 === 0 || completed === total) {
        process.stdout.write(`\r  ${label}: ${completed}/${total} (${success} ok, ${skipped} skip, ${errors} err)`)
      }
    }
  }

  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker(queue)),
  )
  if (total > 0) console.log()
  return { success, skipped, errors }
}
