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

function risLine(tag: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  return `${tag}  - ${String(value)}\n`
}

function escBibtex(s: string): string {
  return s.replace(/[{}&%$#_^~\\]/g, (c) => '\\' + c)
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
  ris += risLine('UR', `https://rmblknowledgehub.org/publications/${pub.id}`)
  if (pub.keywords) {
    for (const kw of pub.keywords) ris += risLine('KW', kw)
  }
  ris += risLine('DB', 'RMBL Knowledge Hub')
  ris += 'ER  - \n'
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
  ris += risLine('UR', `https://rmblknowledgehub.org/datasets/${ds.id}`)
  ris += risLine('DB', 'RMBL Knowledge Hub')
  ris += 'ER  - \n'
  return ris
}

export function documentToRIS(doc: any): string {
  let ris = ''
  ris += risLine('TY', 'RPRT')
  ris += risLine('TI', doc.title)
  ris += risLine('PY', doc.date_original ? new Date(doc.date_original).getFullYear() : undefined)
  ris += risLine('AB', typeof doc.summary === 'string' ? doc.summary : undefined)
  ris += risLine('UR', `https://rmblknowledgehub.org/documents/${doc.id}`)
  ris += risLine('DB', 'RMBL Knowledge Hub')
  ris += 'ER  - \n'
  return ris
}

function bibtexKey(pub: any): string {
  const author = pub.authors?.[0]?.family_name || pub.creators?.[0]?.display_name?.split(/\s+/).pop() || 'unknown'
  const year = pub.year || pub.publication_year || ''
  const word = (pub.title || '').split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || 'untitled'
  return `${author.toLowerCase()}${year}${word}`
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
  lines.push(`  url = {https://rmblknowledgehub.org/publications/${pub.id}}`)

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
  lines.push(`  url = {https://rmblknowledgehub.org/datasets/${ds.id}}`)
  lines.push(`  note = {Dataset}`)

  return lines.join(',\n') + '\n}\n'
}

export function documentToBibTeX(doc: any): string {
  const key = `doc${doc.id}`
  const lines = [`@techreport{${key}`]

  lines.push(`  title = {${escBibtex(doc.title)}}`)
  if (doc.date_original) lines.push(`  year = {${new Date(doc.date_original).getFullYear()}}`)
  lines.push(`  url = {https://rmblknowledgehub.org/documents/${doc.id}}`)
  lines.push(`  note = {${escBibtex((doc.document_type || 'Document').replace(/_/g, ' '))}}`)

  return lines.join(',\n') + '\n}\n'
}
