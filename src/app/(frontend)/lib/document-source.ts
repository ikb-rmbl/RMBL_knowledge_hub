/**
 * Where a document came from, for display. Documents arrive from several sources
 * (Sustainable Living Library, Federal Register, the legacy rmbl.org website rescue);
 * the source is derived from documents.provenance (SQL-only, z-2026-11-12-01), the
 * SQL-only document_type, and the source_url host — never assumed.
 */

export interface DocumentProvenance {
  discoveryMethod?: string
  source?: string
  originalUrl?: string
  waybackUrl?: string
  captureTimestamp?: string
  contentFormat?: string
  figuresMissing?: boolean
  [key: string]: unknown
}

export interface DocumentSource {
  label: string
  /** Text for the button that opens sourceUrl. */
  linkLabel: string
  /** Extra provenance lines, for sources that ship a source trail. */
  archive?: {
    originalUrl: string
    capturedOn: string | null
    waybackUrl: string | null
  }
}

const LEGACY_LABEL = 'RMBL legacy website (rmbl.org, 2000–2014), via the Internet Archive'

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function capturedOn(ts: string | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function documentSource(input: {
  sourceUrl?: string | null
  documentType?: string | null
  provenance?: DocumentProvenance | null
}): DocumentSource | null {
  const { sourceUrl, documentType, provenance } = input
  if (provenance?.discoveryMethod === 'wayback_rescue') {
    const isFile = provenance.contentFormat && provenance.contentFormat !== 'html'
    return {
      label: LEGACY_LABEL,
      linkLabel: isFile ? 'View Archived File' : 'View Archived Page',
      archive: provenance.originalUrl
        ? {
            originalUrl: provenance.originalUrl,
            capturedOn: capturedOn(provenance.captureTimestamp),
            waybackUrl: provenance.waybackUrl ?? sourceUrl ?? null,
          }
        : undefined,
    }
  }
  const host = hostOf(sourceUrl)
  if (documentType?.startsWith('federal_') || host === 'federalregister.gov' || host === 'govinfo.gov') {
    return { label: 'Federal Register', linkLabel: 'View on Federal Register' }
  }
  if (host === 'sustainablelibrary.org') {
    return { label: 'Sustainable Living Library', linkLabel: 'View on Source Site' }
  }
  if (host) return { label: host, linkLabel: 'View on Source Site' }
  return null
}
