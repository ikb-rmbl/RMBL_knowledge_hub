/**
 * Shared source-fetching logic for all three data sources.
 * Used by both the initial scrape scripts and the incremental updater.
 */

import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// Sustainable Library
// ---------------------------------------------------------------------------

export interface SustLibRawRecord {
  __attributes: { id: string; class: string }
  title: string
  excerpt: string
  doc_categories: string
  link: string
}

export interface SustLibDocument {
  postId: string
  title: string
  detailUrl: string
  summary: string
  categories: { name: string; slug: string }[]
  tags: string[]
  pdfUrl: string | null
  pdfSizeBytes: number | null
  datePosted: string | null
  fileType: string | null
  sourceUrl: string
}

const SUST_LIB_AJAX = 'https://sustainablelibrary.org/wp-admin/admin-ajax.php'

export async function sustLibFetchNonce(): Promise<{ nonce: string; tableId: string }> {
  const res = await fetch('https://sustainablelibrary.org/all-files/')
  const html = await res.text()
  const nonceMatch = html.match(/"ajax_nonce":"([^"]+)"/)
  const tableIdMatch = html.match(/id="(dlp_[^"]+)"/)
  if (!nonceMatch || !tableIdMatch) throw new Error('Could not extract nonce/table ID')
  return { nonce: nonceMatch[1], tableId: tableIdMatch[1] }
}

export async function sustLibFetchBatch(
  start: number,
  length: number,
  nonce: string,
  tableId: string,
): Promise<{ data: SustLibRawRecord[]; recordsTotal: number }> {
  const params = new URLSearchParams({
    action: 'dlp_load_posts',
    _ajax_nonce: nonce,
    draw: '1',
    start: String(start),
    length: String(length),
    table_id: tableId,
    'columns[0][data]': 'title',
    'columns[0][name]': 'title',
    'columns[0][searchable]': 'true',
    'columns[0][orderable]': 'true',
    'columns[1][data]': 'excerpt',
    'columns[1][name]': 'excerpt',
    'columns[1][searchable]': 'true',
    'columns[1][orderable]': 'false',
    'columns[2][data]': 'doc_categories',
    'columns[2][name]': 'doc_categories',
    'columns[2][searchable]': 'true',
    'columns[2][orderable]': 'false',
    'columns[3][data]': 'link',
    'columns[3][name]': 'link',
    'columns[3][searchable]': 'false',
    'columns[3][orderable]': 'false',
    'order[0][column]': '0',
    'order[0][dir]': 'asc',
  })

  const res = await fetch(SUST_LIB_AJAX, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`AJAX failed: ${res.status}`)
  return res.json()
}

export function sustLibParseRecord(raw: SustLibRawRecord): SustLibDocument {
  const postIdMatch = raw.__attributes.id.match(/post-row-(\d+)/)
  const postId = postIdMatch ? postIdMatch[1] : ''

  const titleDom = new JSDOM(raw.title)
  const titleLink = titleDom.window.document.querySelector('a')
  const title = titleLink?.textContent?.trim() || ''
  const detailUrl = titleLink?.getAttribute('href') || ''

  const excerptDom = new JSDOM(raw.excerpt)
  const summary = excerptDom.window.document.body?.textContent?.trim() || ''

  const catDom = new JSDOM(raw.doc_categories)
  const catLinks = catDom.window.document.querySelectorAll('a[rel="tag"]')
  const categories = Array.from(catLinks).map((a) => {
    const span = a.querySelector('span[data-slug]')
    return {
      name: span?.textContent?.trim() || a.textContent?.trim() || '',
      slug: span?.getAttribute('data-slug') || '',
    }
  })

  const linkDom = new JSDOM(raw.link)
  const downloadLink = linkDom.window.document.querySelector('a.dlp-download-link')
  const pdfUrl = downloadLink?.getAttribute('href') || null

  return {
    postId,
    title,
    detailUrl,
    summary,
    categories,
    tags: [],
    pdfUrl,
    pdfSizeBytes: null,
    datePosted: null,
    fileType: null,
    sourceUrl: detailUrl,
  }
}

export async function sustLibFetchDetailPage(doc: SustLibDocument): Promise<void> {
  if (!doc.detailUrl) return
  try {
    const res = await fetch(doc.detailUrl)
    if (!res.ok) return
    const html = await res.text()

    const tagsMatch = html.match(
      /<div class="dlp-document-info-tags">\s*<span[^>]*>Tags:\s*<\/span>\s*([\s\S]*?)<\/div>/,
    )
    if (tagsMatch) {
      doc.tags = tagsMatch[1].trim().split(',').map((t) => t.trim()).filter(Boolean)
    }

    const dateMatch = html.match(/<time class="entry-date" datetime="([^"]+)"/)
    if (dateMatch) doc.datePosted = dateMatch[1]

    const fileTypeMatch = html.match(
      /<span class="dlp-document-info-title">File Type:\s*<\/span>\s*(\w+)/,
    )
    if (fileTypeMatch) doc.fileType = fileTypeMatch[1].trim().toLowerCase()
  } catch {
    // non-critical
  }
}

export async function sustLibFetchAll(
  batchSize = 50,
): Promise<{ records: SustLibDocument[]; total: number }> {
  const { nonce, tableId } = await sustLibFetchNonce()
  const first = await sustLibFetchBatch(0, batchSize, nonce, tableId)
  const total = first.recordsTotal
  const records = first.data.map(sustLibParseRecord)

  for (let start = batchSize; start < total; start += batchSize) {
    const batch = await sustLibFetchBatch(start, batchSize, nonce, tableId)
    records.push(...batch.data.map(sustLibParseRecord))
  }

  return { records, total }
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export interface PubRawRecord {
  id: string
  reftypename: string
  year: string
  title: string
  authors: string | null
  volume: string | null
  pages: string | null
  restofreference: string | null
  journalname: string | null
  journalissue: string | null
  pdf_url: string | null
  keywords: string | null
  [key: string]: unknown
}

const PUBS_API = 'https://www.rmbl.org/wp-json/rmbl-pubs/v1/library'

export async function pubsFetchAll(batchSize = 200): Promise<PubRawRecord[]> {
  const records: PubRawRecord[] = []
  let total = Infinity
  for (let skip = 0; skip < total; skip += batchSize) {
    const res = await fetch(`${PUBS_API}?take=${batchSize}&skip=${skip}`)
    const data = await res.json()
    total = parseInt(data.total)
    records.push(...data.data)
  }
  return records
}

// ---------------------------------------------------------------------------
// Data Catalog
// ---------------------------------------------------------------------------

export interface CatalogRawEntry {
  id: string
  DatasetName: string
  ShortDescription: string
  LongDescription: string | null
  Source: string
  Citation: string | null
  DOI: string | null
  DatasetLink: string | null
  MetadataLink: string | null
  DateCollectedMin: { date: string } | null
  DateCollectedMax: { date: string } | null
  Authors_Name: string
  Tags: { Tag: string }[]
  DateCreated: string | null
  DateModified: string | null
  [key: string]: unknown
}

const CATALOG_API =
  'https://www.rmbl.org/wp-json/rmbl-data-catalog/v1/catalog?take=500&skip=0&filter%5Bfilters%5D%5B0%5D%5Bfield%5D=id&filter%5Bfilters%5D%5B0%5D%5Boperator%5D=gte&filter%5Bfilters%5D%5B0%5D%5Bvalue%5D=1'

export async function catalogFetchAll(): Promise<CatalogRawEntry[]> {
  const res = await fetch(CATALOG_API)
  if (!res.ok) throw new Error(`Catalog API failed: ${res.status}`)
  return res.json()
}
