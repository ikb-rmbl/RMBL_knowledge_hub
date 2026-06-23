/**
 * Citation export formatters — RIS and BibTeX.
 */

const RIS_TYPE_MAP: Record<string, string> = {
  article: 'JOUR',
  thesis: 'THES',
  book: 'BOOK',
  chapter: 'CHAP',
  student_paper: 'RPRT',
  other: 'GEN',
  dataset: 'DATA',
  software: 'COMP',
  document: 'RPRT',
}

const BIBTEX_TYPE_MAP: Record<string, string> = {
  article: 'article',
  thesis: 'phdthesis',
  book: 'book',
  chapter: 'inbook',
  student_paper: 'techreport',
  other: 'misc',
  dataset: 'misc',
  software: 'misc',
  document: 'techreport',
}

// RIS spec requires CRLF line endings and one field per line. Zotero's RIS
// importer rejects files with bare LF endings ("The selected file is not in
// a supported format"). Many of our abstracts contain embedded newlines
// (paragraph breaks from CrossRef/OpenAlex); flatten those to single
// spaces so each tag occupies exactly one CRLF-terminated line.
function risLine(tag: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const flat = String(value).replace(/\s*\r?\n\s*/g, ' ').trim()
  if (!flat) return ''
  return `${tag}  - ${flat}\r\n`
}

const RIS_ER = 'ER  - \r\n'

function escBibtex(s: string): string {
  return s.replace(/[{}&%$#_^~\\]/g, (c) => '\\' + c)
}

// BibTeX cite keys must be alphanumeric (plus `_-:.`) with NO whitespace
// or punctuation. Compound surnames ("Pantoja Alfaro") and apostrophes
// ("O'Day") produce invalid keys that break the entire file in strict
// parsers. Sanitize aggressively and fall back to a stable id-based key.
function sanitizeBibtexKey(key: string, fallbackId?: string | number): string {
  const cleaned = key
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip diacritics
    .replace(/[^a-zA-Z0-9_\-:.]/g, '')                  // drop everything else
  if (cleaned.length > 0) return cleaned
  return fallbackId != null ? `item${fallbackId}` : 'item'
}

export function publicationToRIS(pub: any): string {
  let ris = ''
  ris += risLine('TY', RIS_TYPE_MAP[pub.publication_type] || 'GEN')
  ris += risLine('TI', pub.title)
  if (pub.authors) {
    for (const a of pub.authors) {
      const name = a.display_name || `${a.family_name || ''}${a.given_name ? ', ' + a.given_name : ''}`
      ris += risLine('AU', name.trim())
    }
  }
  ris += risLine('PY', pub.year)
  ris += risLine('JO', pub.journal)
  ris += risLine('VL', pub.volume)
  ris += risLine('IS', pub.issue)
  if (pub.pages) {
    const parts = String(pub.pages).split(/[-–]/)
    ris += risLine('SP', parts[0]?.trim())
    if (parts[1]) ris += risLine('EP', parts[1].trim())
  }
  ris += risLine('DO', pub.doi)
  ris += risLine('AB', pub.abstract)
  ris += risLine('UR', `https://rmblknowledgecommons.org/publications/${pub.id}`)
  if (pub.keywords) {
    for (const kw of pub.keywords) ris += risLine('KW', kw)
  }
  ris += risLine('DB', 'RMBL Knowledge Commons')
  ris += RIS_ER
  return ris
}

export function datasetToRIS(ds: any): string {
  let ris = ''
  ris += risLine('TY', 'DATA')
  ris += risLine('TI', ds.title)
  if (ds.creators) {
    for (const c of ds.creators) ris += risLine('AU', c.display_name || c.name)
  }
  ris += risLine('PY', ds.publication_year)
  ris += risLine('DO', ds.doi)
  ris += risLine('PB', ds.repository)
  ris += risLine('AB', ds.description)
  ris += risLine('UR', `https://rmblknowledgecommons.org/datasets/${ds.id}`)
  ris += risLine('DB', 'RMBL Knowledge Commons')
  ris += RIS_ER
  return ris
}

export function documentToRIS(doc: any): string {
  let ris = ''
  ris += risLine('TY', 'RPRT')
  ris += risLine('TI', doc.title)
  ris += risLine('PY', doc.date_original ? new Date(doc.date_original).getFullYear() : undefined)
  ris += risLine('AB', typeof doc.summary === 'string' ? doc.summary : undefined)
  ris += risLine('UR', `https://rmblknowledgecommons.org/documents/${doc.id}`)
  ris += risLine('DB', 'RMBL Knowledge Commons')
  ris += RIS_ER
  return ris
}

// ---------------------------------------------------------------------------
// Plain-text APA citation
//
// Used by the per-item "Copy citation" affordance on detail pages. Returns
// a single APA-7-ish line that pastes cleanly into an email or document.
// Not a full citation-style implementation — that's what the CSL-JSON path
// is for. Conservative on punctuation: if a field is missing, the
// surrounding glue is dropped rather than emitted as " ." or "(undefined)".
// ---------------------------------------------------------------------------

/** Format one author's full name as "Family, G. I." (APA short form).
 *  Falls back to whatever display_name we have if family + given aren't
 *  split out. */
function apaAuthor(a: any): string {
  const fam = (a?.family_name || '').trim()
  const giv = (a?.given_name || '').trim()
  if (fam) {
    const initials = giv
      .split(/[\s.-]+/)
      .filter(Boolean)
      .map((p: string) => p[0].toUpperCase() + '.')
      .join(' ')
    return initials ? `${fam}, ${initials}` : fam
  }
  return String(a?.display_name || a?.name || '').trim()
}

/** Join a list of author names APA-style:
 *    1 author:   "Smith, J."
 *    2 authors:  "Smith, J., & Jones, K."
 *    3+ authors: "Smith, J., Jones, K., & Lee, M."
 *  Drops empties; returns '' when no usable name. APA-7 truncates at 20
 *  authors with " ... " — we apply that cap. */
function apaAuthorList(authors: any[] | undefined | null): string {
  if (!authors || authors.length === 0) return ''
  const names = authors.map(apaAuthor).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]}, & ${names[1]}`
  if (names.length <= 20) {
    return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
  }
  return `${names.slice(0, 19).join(', ')}, ... ${names[names.length - 1]}`
}

/** Tail a citation with the canonical Knowledge-Commons URL when no DOI is
 *  available. DOIs are preferred per APA-7 §10.1. */
function doiOrUrl(doi: string | null | undefined, fallbackUrl: string): string {
  if (!doi) return fallbackUrl
  const s = String(doi).trim()
  if (!s) return fallbackUrl
  if (/^https?:\/\//i.test(s)) return s
  return `https://doi.org/${s.replace(/^doi:/i, '')}`
}

// APA italicizes journal + book + dataset titles, but the clipboard target
// is plain text — and the Unicode italic block reserves a slot for 'h'
// (U+1D455) which renders as a tofu on many platforms. Skip italicization
// here; readers pasting into a rich editor reformat anyway, and downstream
// CSL-JSON / BibTeX exports carry the structural intent.

export function publicationToAPA(pub: any): string {
  const parts: string[] = []
  const authors = apaAuthorList(pub.authors)
  if (authors) parts.push(authors + (authors.endsWith('.') ? '' : '.'))
  if (pub.year) parts.push(`(${pub.year}).`)
  if (pub.title) {
    const t = String(pub.title).trim().replace(/\.$/, '')
    parts.push(t + '.')
  }
  const journal = pub.journal ? String(pub.journal).trim() : ''
  const vol = pub.volume ? String(pub.volume).trim() : ''
  const iss = pub.issue ? `(${pub.issue})` : ''
  const pages = pub.pages ? String(pub.pages).trim() : ''
  const tail: string[] = []
  if (journal) tail.push(journal)
  if (vol)     tail.push((tail.length ? ', ' : '') + vol + iss)
  if (pages)   tail.push((tail.length ? ', ' : '') + pages)
  if (tail.length) parts.push(tail.join('') + '.')
  parts.push(doiOrUrl(pub.doi, `https://rmblknowledgecommons.org/publications/${pub.id}`))
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function datasetToAPA(ds: any): string {
  const parts: string[] = []
  const creators = apaAuthorList(ds.creators)
  if (creators) parts.push(creators + (creators.endsWith('.') ? '' : '.'))
  if (ds.publication_year) parts.push(`(${ds.publication_year}).`)
  if (ds.title) {
    const t = String(ds.title).trim().replace(/\.$/, '')
    parts.push(`${t} [Data set].`)
  }
  if (ds.repository) parts.push(String(ds.repository) + '.')
  parts.push(doiOrUrl(ds.doi, `https://rmblknowledgecommons.org/datasets/${ds.id}`))
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function documentToAPA(doc: any): string {
  const parts: string[] = []
  const year = doc.date_original ? new Date(doc.date_original).getFullYear() : null
  if (year) parts.push(`(${year}).`)
  if (doc.title) {
    const t = String(doc.title).trim().replace(/\.$/, '')
    parts.push(t + '.')
  }
  parts.push(`https://rmblknowledgecommons.org/documents/${doc.id}`)
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// CSL JSON
//
// https://docs.citationstyles.org/en/stable/specification.html#citation-style-language-csl-citation-items
// Zotero, Mendeley, Pandoc, and most modern reference managers consume this
// format. We emit a JSON array of CSL items; the file is canonically `.json`
// with Content-Type `application/vnd.citationstyles.csl+json`.
// ---------------------------------------------------------------------------

const CSL_TYPE_MAP: Record<string, string> = {
  article: 'article-journal',
  thesis: 'thesis',
  book: 'book',
  chapter: 'chapter',
  student_paper: 'report',
  other: 'article',
  dataset: 'dataset',
  software: 'software',
  document: 'report',
}

function splitName(displayName: string): { family: string; given?: string } {
  // "Smith, John" → {family:'Smith', given:'John'}
  // "John Smith"  → {family:'Smith', given:'John'}
  // single word   → {family:'Smith'}
  const trimmed = (displayName || '').trim()
  if (!trimmed) return { family: '' }
  if (trimmed.includes(',')) {
    const [family, given] = trimmed.split(',', 2).map((s) => s.trim())
    return given ? { family, given } : { family }
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { family: parts[0] }
  const family = parts.pop()!
  return { family, given: parts.join(' ') }
}

function cslAuthors(arr: any[] | undefined): Array<{ family: string; given?: string }> | undefined {
  if (!arr || arr.length === 0) return undefined
  return arr.map((a) => {
    if (a.family_name) {
      return a.given_name ? { family: a.family_name, given: a.given_name } : { family: a.family_name }
    }
    return splitName(a.display_name || a.name || '')
  }).filter((n) => n.family)
}

function cslDateYear(year: number | string | null | undefined): { 'date-parts': number[][] } | undefined {
  if (year === null || year === undefined || year === '') return undefined
  const y = typeof year === 'number' ? year : parseInt(String(year), 10)
  if (!Number.isFinite(y) || y <= 0) return undefined
  return { 'date-parts': [[y]] }
}

function compactItem<T extends Record<string, any>>(item: T): T {
  const out: any = {}
  for (const [k, v] of Object.entries(item)) {
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as T
}

export function publicationToCSL(pub: any): any {
  return compactItem({
    id: `publication-${pub.id}`,
    type: CSL_TYPE_MAP[pub.publication_type] || 'article-journal',
    title: pub.title,
    author: cslAuthors(pub.authors),
    issued: cslDateYear(pub.year),
    'container-title': pub.journal,
    volume: pub.volume ? String(pub.volume) : undefined,
    issue: pub.issue ? String(pub.issue) : undefined,
    page: pub.pages ? String(pub.pages).replace(/[–—]/g, '-') : undefined,
    DOI: pub.doi,
    URL: `https://rmblknowledgecommons.org/publications/${pub.id}`,
    abstract: pub.abstract || undefined,
    source: 'RMBL Knowledge Commons',
  })
}

export function datasetToCSL(ds: any): any {
  return compactItem({
    id: `dataset-${ds.id}`,
    type: 'dataset',
    title: ds.title,
    author: cslAuthors(ds.creators),
    issued: cslDateYear(ds.publication_year),
    DOI: ds.doi,
    publisher: ds.repository,
    URL: `https://rmblknowledgecommons.org/datasets/${ds.id}`,
    abstract: typeof ds.description === 'string' ? ds.description : undefined,
    source: 'RMBL Knowledge Commons',
  })
}

export function documentToCSL(doc: any): any {
  const year = doc.date_original ? new Date(doc.date_original).getFullYear() : undefined
  return compactItem({
    id: `document-${doc.id}`,
    type: 'report',
    title: doc.title,
    issued: cslDateYear(year),
    URL: `https://rmblknowledgecommons.org/documents/${doc.id}`,
    abstract: typeof doc.summary === 'string' ? doc.summary : undefined,
    genre: doc.document_type ? String(doc.document_type).replace(/_/g, ' ') : undefined,
    source: 'RMBL Knowledge Commons',
  })
}

function bibtexKey(pub: any): string {
  const author = pub.authors?.[0]?.family_name || pub.creators?.[0]?.display_name?.split(/\s+/).pop() || 'unknown'
  const year = pub.year || pub.publication_year || ''
  const word = (pub.title || '').split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || 'untitled'
  return sanitizeBibtexKey(`${author.toLowerCase()}${year}${word}`, pub.id)
}

export function publicationToBibTeX(pub: any): string {
  const type = BIBTEX_TYPE_MAP[pub.publication_type] || 'misc'
  const key = bibtexKey(pub)
  const lines = [`@${type}{${key}`]

  const authors = pub.authors?.map((a: any) =>
    a.display_name || `${a.family_name || ''}${a.given_name ? ', ' + a.given_name : ''}`,
  ).join(' and ')
  if (authors) lines.push(`  author = {${escBibtex(authors)}}`)
  lines.push(`  title = {${escBibtex(pub.title)}}`)
  if (pub.year) lines.push(`  year = {${pub.year}}`)
  if (pub.journal) lines.push(`  journal = {${escBibtex(pub.journal)}}`)
  if (pub.volume) lines.push(`  volume = {${pub.volume}}`)
  if (pub.issue) lines.push(`  number = {${pub.issue}}`)
  if (pub.pages) lines.push(`  pages = {${pub.pages.replace(/–/g, '--')}}`)
  if (pub.doi) lines.push(`  doi = {${pub.doi}}`)
  if (pub.abstract) lines.push(`  abstract = {${escBibtex(pub.abstract.slice(0, 1000))}}`)
  lines.push(`  url = {https://rmblknowledgecommons.org/publications/${pub.id}}`)

  return lines.join(',\n') + '\n}\n'
}

export function datasetToBibTeX(ds: any): string {
  const key = bibtexKey(ds)
  const lines = [`@misc{${key}`]

  const creators = ds.creators?.map((c: any) => c.display_name || c.name).join(' and ')
  if (creators) lines.push(`  author = {${escBibtex(creators)}}`)
  lines.push(`  title = {${escBibtex(ds.title)}}`)
  if (ds.publication_year) lines.push(`  year = {${ds.publication_year}}`)
  if (ds.doi) lines.push(`  doi = {${ds.doi}}`)
  if (ds.repository) lines.push(`  publisher = {${escBibtex(ds.repository)}}`)
  lines.push(`  url = {https://rmblknowledgecommons.org/datasets/${ds.id}}`)
  lines.push(`  note = {Dataset}`)

  return lines.join(',\n') + '\n}\n'
}

export function documentToBibTeX(doc: any): string {
  const key = `doc${doc.id}`
  const lines = [`@techreport{${key}`]

  lines.push(`  title = {${escBibtex(doc.title)}}`)
  if (doc.date_original) lines.push(`  year = {${new Date(doc.date_original).getFullYear()}}`)
  lines.push(`  url = {https://rmblknowledgecommons.org/documents/${doc.id}}`)
  lines.push(`  note = {${escBibtex((doc.document_type || 'Document').replace(/_/g, ' '))}}`)

  return lines.join(',\n') + '\n}\n'
}
