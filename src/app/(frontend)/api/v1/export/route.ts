/**
 * Batch citation export endpoint.
 *
 * POST /api/v1/export
 * Body: { ids: [{ type: "publication"|"dataset"|"document", id: number }], format: "ris"|"bibtex" }
 *
 * Returns a downloadable file with citations for all requested items.
 * Uses bulk queries for performance on large exports.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../lib/db'
import { checkRateLimit } from '../lib/rate-limit'
import {
  publicationToRIS, datasetToRIS, documentToRIS,
  publicationToBibTeX, datasetToBibTeX, documentToBibTeX,
} from '../lib/citation-format'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 5000

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, { expensive: true })
  if (rl) return rl

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ids, format } = body
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }
  if (ids.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Maximum ${MAX_ITEMS} items per export` }, { status: 400 })
  }
  if (format !== 'ris' && format !== 'bibtex') {
    return NextResponse.json({ error: 'format must be "ris" or "bibtex"' }, { status: 400 })
  }

  const pool = getDb()
  const parts: string[] = []

  // Group IDs by type for bulk queries
  const pubIds = ids.filter((i: any) => i.type === 'publication').map((i: any) => i.id)
  const dsIds = ids.filter((i: any) => i.type === 'dataset').map((i: any) => i.id)
  const docIds = ids.filter((i: any) => i.type === 'document').map((i: any) => i.id)

  // Bulk fetch publications with authors
  if (pubIds.length > 0) {
    const { rows: pubs } = await pool.query(`
      SELECT id, title, year, journal, doi, abstract, publication_type,
             volume, issue, pages
      FROM publications WHERE id = ANY($1) ORDER BY year DESC NULLS LAST, title
    `, [pubIds])

    const { rows: authors } = await pool.query(`
      SELECT ar.publications_id as pub_id, a.display_name, a.family_name, a.given_name, a.orcid, ar."order"
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
      WHERE ar.publications_id = ANY($1) AND ar.path = 'publications'
      ORDER BY ar.publications_id, ar."order" NULLS LAST
    `, [pubIds])

    const { rows: keywords } = await pool.query(`
      SELECT _parent_id as pub_id, keyword
      FROM publications_keywords
      WHERE _parent_id = ANY($1) ORDER BY _parent_id, _order
    `, [pubIds])

    // Group authors and keywords by pub
    const authorsByPub = new Map<number, any[]>()
    for (const a of authors) {
      if (!authorsByPub.has(a.pub_id)) authorsByPub.set(a.pub_id, [])
      authorsByPub.get(a.pub_id)!.push(a)
    }
    const kwByPub = new Map<number, string[]>()
    for (const k of keywords) {
      if (!kwByPub.has(k.pub_id)) kwByPub.set(k.pub_id, [])
      if (k.keyword) kwByPub.get(k.pub_id)!.push(k.keyword)
    }

    for (const pub of pubs) {
      const enriched = { ...pub, authors: authorsByPub.get(pub.id) || [], keywords: kwByPub.get(pub.id) || [] }
      parts.push(format === 'ris' ? publicationToRIS(enriched) : publicationToBibTeX(enriched))
    }
  }

  // Bulk fetch datasets with creators
  if (dsIds.length > 0) {
    const { rows: datasets } = await pool.query(`
      SELECT id, title, doi, description, repository, publication_year
      FROM datasets WHERE id = ANY($1) ORDER BY publication_year DESC NULLS LAST, title
    `, [dsIds])

    const { rows: creators } = await pool.query(`
      SELECT ar.datasets_id as ds_id, a.display_name
      FROM authors_rels ar
      JOIN authors a ON a.id = ar.parent_id
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

  // Bulk fetch documents
  if (docIds.length > 0) {
    const { rows: docs } = await pool.query(`
      SELECT id, title, summary::text as summary, document_type, date_original
      FROM documents WHERE id = ANY($1) ORDER BY title
    `, [docIds])

    for (const doc of docs) {
      parts.push(format === 'ris' ? documentToRIS(doc) : documentToBibTeX(doc))
    }
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
