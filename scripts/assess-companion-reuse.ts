/**
 * Dataset re-use assessment, Phase 2 — the companion-paper indirection channel.
 * See specification/dataset-reuse-design.md.
 *
 * Researchers who re-use data usually cite the COMPANION PAPER, not the dataset
 * DOI, so Phase 1 (formal dataset citations) undercounts. For each RMBL-origin
 * dataset linked to a companion publication with a DOI:
 *   1. Fetch works citing the companion paper from Semantic Scholar, WITH the
 *      citation context sentences (fields=contexts,intents).
 *   2. LLM-classify each citing work (batched): did it USE the underlying
 *      dataset's data ('data_used'), or cite the paper for its findings
 *      ('mention')? Evidence = the context sentences; S2 'methodology' intent
 *      is given to the model as a prior, not a verdict.
 *   3. Classify independence against the author registry (same logic as
 *      Phase 1: shared author → same_group, co-authorship distance 1 →
 *      collaborators, else independent).
 *   4. Upsert events with channel='companion_forward'; recompute rollups.
 *
 * Only 'data_used'-or-'unclear' events are stored — 'mention' classifications
 * are dropped (they are paper-to-paper citations, not dataset re-use).
 * Idempotent per (dataset, channel, citing doi/title). Skips companion pairs
 * already processed unless --force (tracked in companion_reuse_checked on
 * dataset_reuse_scan).
 *
 * Usage:
 *   npx tsx scripts/assess-companion-reuse.ts [--dry-run] [--limit=N] [--model=...]
 */

import pg from 'pg'
import './lib/config.js'
import { sleep } from './lib/concurrency.js'
import { callClaude } from './lib/claude-api.js'

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : undefined
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-opus-5'
const S2_BASE = 'https://api.semanticscholar.org/graph/v1'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey && !dryRun) throw new Error('ANTHROPIC_API_KEY is not set')

function nameKey(family?: string | null, given?: string | null): string | null {
  if (!family) return null
  const f = family.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const g = (given || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return f ? `${f}|${g.charAt(0)}` : null
}

async function s2Citations(doi: string): Promise<any[]> {
  const out: any[] = []
  let offset = 0
  while (offset < 500) {
    const res = await fetch(
      `${S2_BASE}/paper/DOI:${encodeURIComponent(doi)}/citations` +
        `?fields=contexts,intents,title,year,externalIds,authors&limit=100&offset=${offset}`,
    )
    await sleep(1100) // unauthenticated S2: ~1 req/s
    if (res.status === 404) return out
    if (res.status === 429) { await sleep(10000); continue }
    if (!res.ok) return out
    const page = await res.json()
    out.push(...(page.data ?? []))
    if (!page.next) break
    offset = page.next
  }
  return out
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // author registry + adjacency (same as Phase 1)
    const { rows: authorRows } = await db.query(`SELECT id, family_name, given_name FROM authors`)
    const byName = new Map<string, number>()
    for (const a of authorRows) {
      const k = nameKey(a.family_name, a.given_name)
      if (k && !byName.has(k)) byName.set(k, a.id)
    }
    const { rows: rels } = await db.query(
      `SELECT parent_id AS author_id, datasets_id, publications_id FROM authors_rels
       WHERE datasets_id IS NOT NULL OR publications_id IS NOT NULL`,
    )
    const datasetCreators = new Map<number, Set<number>>()
    const byWork = new Map<string, number[]>()
    for (const r of rels) {
      if (r.datasets_id) {
        if (!datasetCreators.has(r.datasets_id)) datasetCreators.set(r.datasets_id, new Set())
        datasetCreators.get(r.datasets_id)!.add(r.author_id)
      }
      const work = r.datasets_id ? `d${r.datasets_id}` : `p${r.publications_id}`
      if (!byWork.has(work)) byWork.set(work, [])
      byWork.get(work)!.push(r.author_id)
    }
    const coauthors = new Map<number, Set<number>>()
    for (const ids of byWork.values()) {
      if (ids.length > 80) continue
      for (const a of ids)
        for (const b of ids)
          if (a !== b) {
            if (!coauthors.has(a)) coauthors.set(a, new Set())
            coauthors.get(a)!.add(b)
          }
    }
    function classifyIndependence(citing: Set<number>, creators: Set<number>): string {
      if (!creators.size) return 'unknown'
      if (!citing.size) return 'independent' // unresolvable external team, creators known
      for (const a of citing) if (creators.has(a)) return 'same_group'
      for (const a of citing) {
        const co = coauthors.get(a)
        if (co) for (const c of creators) if (co.has(c)) return 'collaborators'
      }
      return 'independent'
    }

    // (dataset, companion pub) pairs — RMBL-origin only, companion has a DOI
    const { rows: pairs } = await db.query(`
      SELECT DISTINCT d.id AS dataset_id, d.title AS dataset_title, p.id AS pub_id,
             p.doi AS pub_doi, p.title AS pub_title
      FROM datasets d
      JOIN datasets_rels dr ON dr.parent_id = d.id AND dr.publications_id IS NOT NULL
      JOIN publications p ON p.id = dr.publications_id AND p.doi IS NOT NULL
      WHERE d.rmbl_origin = 'yes'
        ${force ? '' : `AND NOT EXISTS (
          SELECT 1 FROM dataset_reuse_events e
          WHERE e.dataset_id = d.id AND e.channel = 'companion_forward'
            AND e.evidence = 'scan_marker:' || p.id)`}
      ORDER BY d.id ${limit ? `LIMIT ${limit}` : ''}
    `)
    console.log(`${pairs.length} (dataset, companion paper) pairs to scan, model ${MODEL}${dryRun ? ' (dry-run)' : ''}`)

    let events = 0
    let classified = 0
    let totalCost = 0
    for (const pair of pairs) {
      const citations = await s2Citations(pair.pub_doi.replace(/^https?:\/\/doi\.org\//, ''))
      const withContext = citations.filter((c) => c.contexts?.length && c.citingPaper?.title)
      const creators = datasetCreators.get(pair.dataset_id) ?? new Set<number>()

      // classify in batches of 12 citing papers per call
      for (let i = 0; i < withContext.length; i += 12) {
        const batch = withContext.slice(i, i + 12)
        const listing = batch
          .map((c, j) => {
            const intents = c.intents?.length ? ` [S2 intents: ${c.intents.join(', ')}]` : ''
            return `${j + 1}. "${c.citingPaper.title}" (${c.citingPaper.year ?? '?'})${intents}\n` +
              c.contexts.slice(0, 4).map((x: string) => `   context: "${x.slice(0, 350)}"`).join('\n')
          })
          .join('\n')
        const prompt = `The dataset "${pair.dataset_title}" was published alongside the companion paper "${pair.pub_title}".
Below are papers citing that companion paper, with the sentence(s) where the citation appears.

For EACH citing paper, judge from its citation context whether it USED the underlying dataset's DATA (re-analyzed, incorporated, built on the measurements — "data_used"), merely cited the paper for its findings/methods ("mention"), or the context is insufficient to tell ("unclear"). S2 intents are a weak prior only. Be conservative: claiming data_used requires the context to indicate the data itself was obtained or analyzed.

${listing}

Respond with ONLY a JSON array, one entry per numbered paper, in order:
[{"n": 1, "class": "data_used" | "mention" | "unclear", "why": "<10 words"}]`

        let results: { n: number; class: string; why: string }[] = []
        if (!dryRun) {
          try {
            const res = await callClaude({ apiKey: apiKey!, model: MODEL, maxTokens: 4000,
              messages: [{ role: 'user', content: prompt }] })
            totalCost += res.cost
            const m = res.text.match(/\[[\s\S]*\]/)
            results = JSON.parse(m ? m[0] : res.text)
          } catch { continue }
        }
        for (const r of results) {
          classified++
          if (r.class === 'mention') continue
          const c = batch[r.n - 1]
          if (!c) continue
          const citing = new Set<number>()
          for (const au of c.citingPaper.authors ?? []) {
            const parts = (au.name ?? '').trim().split(/\s+/)
            const id = byName.get(nameKey(parts[parts.length - 1], parts[0]) ?? '')
            if (id) citing.add(id)
          }
          await db.query(
            `INSERT INTO dataset_reuse_events
               (dataset_id, channel, citing_doi, citing_title, citing_year, use_class, independence, evidence, confidence)
             VALUES ($1,'companion_forward',$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (dataset_id, channel, coalesce(citing_publication_id, -1), coalesce(citing_doi, ''))
             DO UPDATE SET use_class = EXCLUDED.use_class, independence = EXCLUDED.independence,
                           evidence = EXCLUDED.evidence, extracted_at = now()`,
            [pair.dataset_id, c.citingPaper.externalIds?.DOI?.toLowerCase() ?? null,
             c.citingPaper.title?.slice(0, 500), c.citingPaper.year ?? null,
             r.class, classifyIndependence(citing, creators),
             `${r.why} | ${c.contexts[0]?.slice(0, 280) ?? ''}`, r.class === 'data_used' ? 0.8 : 0.4],
          )
          events++
        }
      }
      // scan marker so re-runs skip this pair
      if (!dryRun) {
        await db.query(
          `INSERT INTO dataset_reuse_events (dataset_id, channel, citing_doi, use_class, independence, evidence, confidence)
           VALUES ($1,'companion_forward',$2,'unclear','unknown',$3,0)
           ON CONFLICT (dataset_id, channel, coalesce(citing_publication_id, -1), coalesce(citing_doi, '')) DO NOTHING`,
          [pair.dataset_id, `scan:${pair.pub_id}`, `scan_marker:${pair.pub_id}`],
        )
      }
      process.stdout.write(`\r  ${pairs.indexOf(pair) + 1}/${pairs.length} pairs, ${events} events, $${totalCost.toFixed(2)}`)
    }
    console.log()

    // rollups (same as Phase 1, scan markers excluded via confidence > 0)
    if (!dryRun) {
      await db.query(`
        UPDATE datasets d SET
          reuse_internal_count = s.internal, reuse_external_count = s.external,
          reuse_independent = s.independent
        FROM (
          SELECT ds.id,
            count(e.*) FILTER (WHERE e.citing_publication_id IS NOT NULL AND e.confidence > 0)::int AS internal,
            count(e.*) FILTER (WHERE e.citing_publication_id IS NULL AND e.confidence > 0)::int AS external,
            bool_or(e.independence = 'independent' AND e.confidence > 0) AS independent
          FROM datasets ds LEFT JOIN dataset_reuse_events e ON e.dataset_id = ds.id
          GROUP BY ds.id
        ) s WHERE s.id = d.id
      `)
    }
    console.log(`Done: ${classified} citing papers classified, ${events} data-use events stored, LLM cost $${totalCost.toFixed(2)}`)
  } finally {
    await db.end()
  }
}

main()
