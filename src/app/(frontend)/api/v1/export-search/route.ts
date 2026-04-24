/**
 * Export all search results as RIS or BibTeX.
 *
 * GET /api/v1/export-search?q=...&type=...&format=ris|bibtex
 *
 * Runs the same search query but fetches ALL matching IDs,
 * then bulk-exports citations. Avoids sending thousands of IDs from the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../lib/db'
import { checkRateLimit } from '../lib/rate-limit'
import {
  publicationToRIS, datasetToRIS, documentToRIS,
  publicationToBibTeX, datasetToBibTeX, documentToBibTeX,
} from '../lib/citation-format'

export const dynamic = 'force-dynamic'

const MAX_EXPORT = 5000

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(request, { expensive: true })
  if (rl) return rl

  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')?.trim()
  const typeFilter = searchParams.get('type') || ''
  const format = searchParams.get('format') as 'ris' | 'bibtex'

  if (!format || (format !== 'ris' && format !== 'bibtex')) {
    return NextResponse.json({ error: 'format must be "ris" or "bibtex"' }, { status: 400 })
  }

  const pool = getDb()
  const parts: string[] = []

  const searchDocs = !typeFilter || typeFilter === 'documents'
  const searchPubs = !typeFilter || typeFilter === 'publications'
  const searchData = !typeFilter || typeFilter === 'datasets'

  // If there's a query, use tsvector to find matching IDs; otherwise export all of the filtered type
  const tsCondition = query
    ? `search_vector @@ plainto_tsquery('english', $1)`
    : null
  const qParams = query ? [query] : []

  if (searchPubs) {
    const where = tsCondition || 'TRUE'
    const { rows: pubs } = await pool.query(
      `SELECT id, title, year, journal, doi, abstract, publication_type, volume, issue, pages
       FROM publications WHERE ${where} ORDER BY year DESC NULLS LAST LIMIT ${MAX_EXPORT}`,
      qParams,
    )
    if (pubs.length > 0) {
      const pubIds = pubs.map((p: any) => p.id)
      const { rows: authors } = await pool.query(`
        SELECT ar.publications_id as pub_id, a.display_name, a.family_name, a.given_name, a.orcid, ar."order"
        FROM authors_rels ar JOIN authors a ON a.id = ar.parent_id
        WHERE ar.publications_id = ANY($1) AND ar.path = 'publications'
        ORDER BY ar.publications_id, ar."order" NULLS LAST
      `, [pubIds])
      const authorsByPub = new Map<number, any[]>()
      for (const a of authors) {
        if (!authorsByPub.has(a.pub_id)) authorsByPub.set(a.pub_id, [])
        authorsByPub.get(a.pub_id)!.push(a)
      }
      for (const pub of pubs) {
        const enriched = { ...pub, authors: authorsByPub.get(pub.id) || [] }
        parts.push(format === 'ris' ? publicationToRIS(enriched) : publicationToBibTeX(enriched))
      }
    }
  }

  if (searchData) {
    const where = tsCondition || 'TRUE'
    const { rows: datasets } = await pool.query(
      `SELECT id, title, doi, description, repository, publication_year
       FROM datasets WHERE ${where} ORDER BY publication_year DESC NULLS LAST LIMIT ${MAX_EXPORT}`,
      qParams,
    )
    if (datasets.length > 0) {
      const dsIds = datasets.map((d: any) => d.id)
      const { rows: creators } = await pool.query(`
        SELECT ar.datasets_id as ds_id, a.display_name
        FROM authors_rels ar JOIN authors a ON a.id = ar.parent_id
        WHERE ar.datasets_id = ANY($1) AND ar.path = 'datasets'
        ORDER BY ar.datasets_id, ar."order" NULLS LAST
      `, [dsIds])
      const creatorsByDs = new Map<number, any[]>()
      for (const c of creators) {
        if (!creatorsByDs.has(c.ds_id)) creatorsByDs.set(c.ds_id, [])
        creatorsByDs.get(c.ds_id)!.push(c)
      }
      for (const ds of datasets) {
        const enriched = { ...ds, creators: creatorsByDs.get(ds.id) || [] }
        parts.push(format === 'ris' ? datasetToRIS(enriched) : datasetToBibTeX(enriched))
      }
    }
  }

  if (searchDocs) {
    const where = tsCondition || 'TRUE'
    const { rows: docs } = await pool.query(
      `SELECT id, title, summary::text as summary, document_type, date_original
       FROM documents WHERE ${where} ORDER BY title LIMIT ${MAX_EXPORT}`,
      qParams,
    )
    for (const doc of docs) {
      parts.push(format === 'ris' ? documentToRIS(doc) : documentToBibTeX(doc))
    }
  }

  if (parts.length === 0) {
    return new Response('No results to export.', { status: 404, headers: { 'Content-Type': 'text/plain' } })
  }

  const content = parts.join('\n')
  const ext = format === 'ris' ? 'ris' : 'bib'
  const contentType = format === 'ris' ? 'application/x-research-info-systems' : 'application/x-bibtex'

  return new Response(content, {
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="rmbl-export.${ext}"`,
    },
  })
}
