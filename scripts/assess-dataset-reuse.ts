/**
 * Dataset re-use assessment, Phase 1 (deterministic — no LLM).
 * See specification/dataset-reuse-design.md.
 *
 * Builds dataset_reuse_events from two channels:
 *   internal_link — publications linked to a dataset via datasets_rels
 *   openalex      — external works citing the dataset's DOI (OpenAlex)
 * and classifies INDEPENDENCE for each event against the author registry:
 *   same_group    — citing work shares ≥1 author with the dataset's creators
 *   collaborators — no shared author, but some citing author has co-authored
 *                   other work with some creator (co-authorship distance 1)
 *   independent   — neither
 *   unknown       — creators or citing authors unresolvable
 *
 * Phase 1 use_class is a prior, not a verdict: 'data_used' for formal DOI
 * citations (confidence 0.7), 'unclear' for internal links (Phase 2 LLM
 * upgrades these from citation context).
 *
 * Rollups on datasets: reuse_internal_count, reuse_external_count,
 * reuse_independent (≥1 independent event of any channel).
 *
 * Idempotent: events upsert on (dataset, channel, citing work); rollups are
 * recomputed each run. External matching by ORCID first, then normalized
 * "family given-initial" name.
 *
 * Usage:
 *   npx tsx scripts/assess-dataset-reuse.ts [--dry-run] [--limit=N] [--skip-openalex]
 */

import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'

const dryRun = process.argv.includes('--dry-run')
const skipOpenalex = process.argv.includes('--skip-openalex')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const MAILTO = process.env.OPENALEX_MAILTO || 'ikb@rmbl.org'

function nameKey(family?: string | null, given?: string | null): string | null {
  if (!family) return null
  const f = family.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const g = (given || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return f ? `${f}|${g.charAt(0)}` : null
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // --- author registry lookups ---
    const { rows: authorRows } = await db.query(
      `SELECT id, family_name, given_name, orcid FROM authors`,
    )
    const byOrcid = new Map<string, number>()
    const byName = new Map<string, number>()
    for (const a of authorRows) {
      if (a.orcid) byOrcid.set(a.orcid.replace(/^https?:\/\/orcid\.org\//, '').toLowerCase(), a.id)
      const k = nameKey(a.family_name, a.given_name)
      if (k && !byName.has(k)) byName.set(k, a.id)
    }

    // creators per dataset + authors per publication
    const { rows: rels } = await db.query(
      `SELECT parent_id AS author_id, datasets_id, publications_id FROM authors_rels
       WHERE datasets_id IS NOT NULL OR publications_id IS NOT NULL`,
    )
    const datasetCreators = new Map<number, Set<number>>()
    const pubAuthors = new Map<number, Set<number>>()
    for (const r of rels) {
      if (r.datasets_id) {
        if (!datasetCreators.has(r.datasets_id)) datasetCreators.set(r.datasets_id, new Set())
        datasetCreators.get(r.datasets_id)!.add(r.author_id)
      }
      if (r.publications_id) {
        if (!pubAuthors.has(r.publications_id)) pubAuthors.set(r.publications_id, new Set())
        pubAuthors.get(r.publications_id)!.add(r.author_id)
      }
    }

    // co-authorship adjacency (across all works in the registry)
    const coauthors = new Map<number, Set<number>>()
    const byWork = new Map<string, number[]>()
    for (const r of rels) {
      const work = r.datasets_id ? `d${r.datasets_id}` : `p${r.publications_id}`
      if (!byWork.has(work)) byWork.set(work, [])
      byWork.get(work)!.push(r.author_id)
    }
    for (const ids of byWork.values()) {
      if (ids.length > 80) continue // consortium works create degenerate cliques
      for (const a of ids)
        for (const b of ids)
          if (a !== b) {
            if (!coauthors.has(a)) coauthors.set(a, new Set())
            coauthors.get(a)!.add(b)
          }
    }

    function classify(citing: Set<number>, creators: Set<number>): string {
      if (!creators.size || !citing.size) return 'unknown'
      for (const a of citing) if (creators.has(a)) return 'same_group'
      for (const a of citing) {
        const co = coauthors.get(a)
        if (co) for (const c of creators) if (co.has(c)) return 'collaborators'
      }
      return 'independent'
    }

    async function upsert(e: {
      dataset_id: number; channel: string; citing_publication_id?: number | null
      citing_doi?: string | null; citing_title?: string | null; citing_year?: number | null
      use_class: string; independence: string; evidence?: string | null; confidence: number
    }) {
      if (dryRun) return
      await db.query(
        `INSERT INTO dataset_reuse_events
           (dataset_id, channel, citing_publication_id, citing_doi, citing_title, citing_year,
            use_class, independence, evidence, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (dataset_id, channel, coalesce(citing_publication_id, -1), coalesce(citing_doi, ''))
         DO UPDATE SET use_class = EXCLUDED.use_class, independence = EXCLUDED.independence,
                       citing_year = EXCLUDED.citing_year, confidence = EXCLUDED.confidence,
                       extracted_at = now()`,
        [e.dataset_id, e.channel, e.citing_publication_id ?? null, e.citing_doi ?? null,
         e.citing_title?.slice(0, 500) ?? null, e.citing_year ?? null,
         e.use_class, e.independence, e.evidence?.slice(0, 400) ?? null, e.confidence],
      )
    }

    // --- Channel 1: internal links ---
    const { rows: links } = await db.query(`
      SELECT dr.parent_id AS dataset_id, dr.publications_id, p.title, p.year, p.doi
      FROM datasets_rels dr JOIN publications p ON p.id = dr.publications_id
      WHERE dr.publications_id IS NOT NULL
    `)
    let internal = 0
    for (const l of links) {
      const creators = datasetCreators.get(l.dataset_id) ?? new Set<number>()
      const citing = pubAuthors.get(l.publications_id) ?? new Set<number>()
      await upsert({
        dataset_id: l.dataset_id, channel: 'internal_link',
        citing_publication_id: l.publications_id, citing_doi: l.doi,
        citing_title: l.title, citing_year: l.year,
        use_class: 'unclear', independence: classify(citing, creators), confidence: 0.5,
      })
      internal++
    }
    console.log(`Channel 1 (internal links): ${internal} events`)

    // --- Channel 2: OpenAlex citing works for dataset DOIs ---
    let external = 0
    let externalDatasets = 0
    if (!skipOpenalex) {
      const { rows: doiDatasets } = await db.query(`
        SELECT id, doi FROM datasets
        WHERE doi IS NOT NULL AND external_citation_count > 0
        ORDER BY external_citation_count DESC ${limit ? `LIMIT ${limit}` : ''}
      `)
      console.log(`Channel 2 (OpenAlex): checking ${doiDatasets.length} cited DOI'd datasets`)
      for (const d of doiDatasets) {
        try {
          const doi = d.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '')
          const wRes = await fetch(
            `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?mailto=${MAILTO}`,
          )
          await sleep(120)
          if (!wRes.ok) continue
          const work = await wRes.json()
          const creators = datasetCreators.get(d.id) ?? new Set<number>()
          let cursor = '*'
          let fetched = 0
          while (cursor && fetched < 200) {
            const cRes = await fetch(
              `https://api.openalex.org/works?filter=cites:${work.id.split('/').pop()}` +
                `&per-page=50&cursor=${encodeURIComponent(cursor)}&mailto=${MAILTO}` +
                `&select=id,doi,title,publication_year,authorships`,
            )
            await sleep(120)
            if (!cRes.ok) break
            const page = await cRes.json()
            for (const cw of page.results ?? []) {
              fetched++
              const citing = new Set<number>()
              for (const au of cw.authorships ?? []) {
                const orcid = au.author?.orcid?.replace(/^https?:\/\/orcid\.org\//, '')?.toLowerCase()
                let id = orcid ? byOrcid.get(orcid) : undefined
                if (!id && au.author?.display_name) {
                  const parts = au.author.display_name.trim().split(/\s+/)
                  id = byName.get(nameKey(parts[parts.length - 1], parts[0]) ?? '')
                }
                if (id) citing.add(id)
              }
              // unresolvable citing authors + resolvable creators → likely external team
              const independence =
                citing.size === 0 && creators.size > 0 ? 'independent' : classify(citing, creators)
              await upsert({
                dataset_id: d.id, channel: 'openalex',
                citing_doi: cw.doi?.replace(/^https?:\/\/doi\.org\//, '') ?? null,
                citing_title: cw.title, citing_year: cw.publication_year,
                use_class: 'data_used', independence,
                evidence: 'formal citation of dataset DOI (OpenAlex)',
                confidence: citing.size === 0 ? 0.5 : 0.7,
              })
              external++
            }
            cursor = page.meta?.next_cursor ?? null
            if (!page.results?.length) break
          }
          if (fetched > 0) externalDatasets++
        } catch {
          /* skip dataset on API error */
        }
      }
      console.log(`Channel 2 (OpenAlex): ${external} citing works across ${externalDatasets} datasets`)
    }

    // --- Rollups ---
    if (!dryRun) {
      await db.query(`
        UPDATE datasets d SET
          reuse_internal_count = s.internal, reuse_external_count = s.external,
          reuse_independent = s.independent
        FROM (
          SELECT ds.id,
            count(e.*) FILTER (WHERE e.citing_publication_id IS NOT NULL)::int AS internal,
            count(e.*) FILTER (WHERE e.citing_publication_id IS NULL)::int AS external,
            bool_or(e.independence = 'independent') AS independent
          FROM datasets ds LEFT JOIN dataset_reuse_events e ON e.dataset_id = ds.id
          GROUP BY ds.id
        ) s WHERE s.id = d.id
      `)
    }
    const { rows: [summary] } = await db.query(`
      SELECT
        count(*) FILTER (WHERE reuse_independent) AS independent,
        count(*) FILTER (WHERE reuse_external_count > 0 OR reuse_internal_count > 0) AS any_reuse,
        count(*) AS total
      FROM datasets
    `)
    console.log(`\nR-rate (strict): ${summary.independent}/${summary.total} datasets with ≥1 independent re-use event`)
    console.log(`Any citation/link evidence: ${summary.any_reuse}/${summary.total}`)
  } finally {
    await db.end()
  }
}

main()
