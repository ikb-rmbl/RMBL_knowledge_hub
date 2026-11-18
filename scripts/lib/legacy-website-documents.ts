/**
 * Legacy rmbl.org website documents (2000-2014), rescued from the Wayback Machine.
 *
 * Staged by github.com/ikb-rmbl/RMBL_metadata_rescue (`scripts/04_export_kc.py`) as
 * `scripts/output/rmbl-legacy-documents.json`: Payload-shaped Documents records with
 * redacted `fullText`, a Wayback `sourceUrl`, a `documentType`, and a `_provenance`
 * source trail. Pure helpers here; load-to-payload.ts does the I/O.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export const LEGACY_DOCUMENTS_FILE = 'rmbl-legacy-documents.json'
export const LEGACY_DISCOVERY_METHOD = 'wayback_rescue'

export interface LegacyDocument {
  _sourceId: string
  title: string
  summary?: string | null
  categories: string[]
  dateOriginal?: string | null
  geographicScope?: string[]
  sourceUrl: string
  sourceFile?: string | null
  fullText?: string | null
  documentType?: string | null
  ingestionDate?: string
  _tags?: string[]
  _provenance: Record<string, unknown> & { discoveryMethod?: string }
}

/** Staged legacy documents, or [] when the rescue export hasn't been copied in. */
export function readLegacyDocuments(outputDir: string): LegacyDocument[] {
  const path = join(outputDir, LEGACY_DOCUMENTS_FILE)
  if (!existsSync(path)) return []
  const docs = JSON.parse(readFileSync(path, 'utf-8'))
  if (!Array.isArray(docs)) throw new Error(`${LEGACY_DOCUMENTS_FILE}: expected a JSON array`)
  return docs
}

export function isLegacyDocument(doc: unknown): doc is LegacyDocument {
  const prov = (doc as LegacyDocument | null)?._provenance
  return Boolean(prov && prov.discoveryMethod === LEGACY_DISCOVERY_METHOD)
}

/**
 * Topic names the legacy docs use, split by whether they are registered parent
 * categories (topic-rules.ts). Registered-but-missing topics may be created by the
 * loader; unregistered names are never created ad hoc, because manage-topics.ts
 * --organize-only would re-parent any unregistered parentless topic.
 */
export function partitionTopics(
  docs: LegacyDocument[],
  registered: ReadonlySet<string>,
): { registered: string[]; unregistered: string[] } {
  const names = new Set(docs.flatMap((d) => d.categories ?? []))
  const sorted = [...names].sort()
  return {
    registered: sorted.filter((n) => registered.has(n)),
    unregistered: sorted.filter((n) => !registered.has(n)),
  }
}

/** Value for documents.provenance: the staged trail plus the rescue's stable record id. */
export function provenanceRecord(doc: LegacyDocument): Record<string, unknown> {
  return { ...doc._provenance, sourceId: doc._sourceId }
}
