import type { CollectionBeforeDeleteHook } from 'payload'

/**
 * Before-delete hook that writes a row's identifying keys to
 * `duplicate_tombstones` so the pipeline loaders won't recreate it on the
 * next run.
 *
 * The keys schema mirrors scripts/lib/dedup-keys.ts (the script-side helper
 * used by load-to-payload.ts / load-stories.ts). Keep them in sync; if you
 * add a new collection or change a key shape here, update the script as well.
 */

type ExtractFn = (doc: any) => Record<string, any>

const norm = (s: any) => (typeof s === 'string' ? s.trim().toLowerCase() : null) || null

const EXTRACTORS: Record<string, ExtractFn> = {
  publications: (doc) => ({
    doi: norm(doc?.doi),
    title: doc?.title || null,
    year: doc?.year ?? null,
  }),
  datasets: (doc) => ({
    doi: norm(doc?.doi),
    title: doc?.title || null,
  }),
  documents: (doc) => ({
    source_url: doc?.sourceUrl ?? doc?.source_url ?? null,
    title: doc?.title || null,
  }),
  stories: (doc) => ({
    source_url: doc?.sourceUrl ?? doc?.source_url ?? null,
    title: doc?.title || null,
  }),
}

export function tombstoneHookFor(collection: string): CollectionBeforeDeleteHook {
  const extract = EXTRACTORS[collection]
  if (!extract) {
    // Collection has no tombstone shape configured; this is a no-op.
    return async () => undefined
  }
  return async ({ id, req }) => {
    try {
      const doc = await req.payload.findByID({ collection: collection as any, id, depth: 0 })
      const keys = extract(doc)
      const hasAnyKey = Object.values(keys).some((v) => v != null && v !== '')
      if (!hasAnyKey) return // Nothing to remember by; skip.
      // payload.db.drizzle exposes the underlying drizzle client; raw SQL is
      // the simplest path for a custom table that isn't a Payload collection.
      const pool = (req.payload.db as any).pool
      if (!pool) {
        req.payload.logger?.warn?.('tombstoneHook: payload.db.pool unavailable; skipping tombstone for ' + collection + '#' + id)
        return
      }
      await pool.query(
        `INSERT INTO duplicate_tombstones (collection, keys, deleted_by) VALUES ($1, $2::jsonb, $3)`,
        [collection, JSON.stringify(keys), req.user?.id ?? null],
      )
    } catch (err) {
      // Don't block the delete itself on tombstone-write failure.
      req.payload.logger?.error?.({ err }, 'tombstoneHook failed to write for ' + collection + '#' + id)
    }
  }
}
