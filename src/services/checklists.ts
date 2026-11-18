/**
 * Species checklists rescued from the legacy rmbl.org website
 * (scripts/load-checklists.ts; tables in scripts/sql/z-2026-11-18-01-checklists.sql).
 * Checklist links live in checklist_entries, not entity_mentions, so they never
 * reach the co-occurrence graph.
 */

import type { Pool } from 'pg'

export interface ChecklistSummary {
  id: number
  slug: string
  title: string
  taxon_group: string
  compiler: string | null
  area: string | null
  description: string | null
  editions: { id: number; label: string; year: number | null; entries: number; linked: number }[]
}

export interface Edition {
  id: number
  label: string
  year: number | null
  taxonomy: string | null
  source_ids: string[]
  entries_source_id: string | null
  /** Rescued documents holding a copy of this edition (ids differ per database). */
  copies: { id: number; title: string; date: string | null; parsed: boolean }[]
}

export interface Entry {
  id: number
  line_no: number
  higher_group: string | null
  family: string | null
  group_heading: string | null
  verbatim_name: string
  authority: string | null
  common_name: string | null
  status_codes: string | null
  remarks: string | null
  details: Record<string, any>
  species_id: number | null
  species_name: string | null
  match_method: string | null
}

export async function listChecklists(db: Pool): Promise<ChecklistSummary[]> {
  const { rows } = await db.query(
    `SELECT c.id, c.slug, c.title, c.taxon_group, c.compiler, c.area, c.description,
            coalesce(json_agg(json_build_object('id', e.id, 'label', e.label, 'year', e.year,
                       'entries', (SELECT count(*) FROM checklist_entries x WHERE x.edition_id = e.id),
                       'linked', (SELECT count(*) FROM checklist_entries x WHERE x.edition_id = e.id AND x.species_id IS NOT NULL))
                     ORDER BY e.year NULLS FIRST, e.label) FILTER (WHERE e.id IS NOT NULL), '[]') AS editions
       FROM checklists c LEFT JOIN checklist_editions e ON e.checklist_id = c.id
      WHERE c.kind = 'checklist'
      GROUP BY c.id ORDER BY c.sort_order, c.title`)
  return rows.map((r: any) => ({ ...r, editions: r.editions.map((e: any) => ({ ...e, entries: Number(e.entries), linked: Number(e.linked) })) }))
}

export async function getChecklist(db: Pool, slug: string) {
  const { rows: [checklist] } = await db.query(`SELECT * FROM checklists WHERE slug = $1`, [slug])
  if (!checklist) return null
  const { rows: editions } = await db.query<Omit<Edition, 'copies'>>(
    `SELECT id, label, year, taxonomy, source_ids, entries_source_id FROM checklist_editions
      WHERE checklist_id = $1 ORDER BY year NULLS FIRST, label`, [checklist.id])
  const allIds = editions.flatMap((e) => e.source_ids)
  const { rows: docs } = await db.query(
    `SELECT id, title, date_original::date::text AS date, provenance->>'sourceId' AS source_id
       FROM documents WHERE provenance->>'sourceId' = ANY($1)`, [allIds])
  const withCopies: Edition[] = editions.map((e) => ({
    ...e,
    copies: docs.filter((d: any) => e.source_ids.includes(d.source_id))
      .map((d: any) => ({ id: d.id, title: d.title, date: d.date, parsed: d.source_id === e.entries_source_id })),
  }))
  return { checklist, editions: withCopies }
}

export async function getEntries(db: Pool, editionId: number): Promise<Entry[]> {
  const { rows } = await db.query<Entry>(
    `SELECT e.id, e.line_no, e.higher_group, e.family, e.group_heading, e.verbatim_name, e.authority, e.common_name,
            e.status_codes, e.remarks, e.details, e.species_id, s.canonical_name AS species_name, e.match_method
       FROM checklist_entries e LEFT JOIN species s ON s.id = e.species_id
      WHERE e.edition_id = $1 ORDER BY e.position`, [editionId])
  return rows
}

/** Every checklist entry naming a species, for the species page. */
export async function getSpeciesChecklistEntries(db: Pool, speciesId: number) {
  const { rows } = await db.query(
    `SELECT c.slug, c.title, ed.label, ed.year, e.verbatim_name, e.common_name, e.status_codes, e.remarks, e.details
       FROM checklist_entries e
       JOIN checklist_editions ed ON ed.id = e.edition_id
       JOIN checklists c ON c.id = ed.checklist_id
      WHERE e.species_id = $1
      ORDER BY c.sort_order, ed.year NULLS FIRST, e.position`, [speciesId])
  return rows as {
    slug: string; title: string; label: string; year: number | null; verbatim_name: string
    common_name: string | null; status_codes: string | null; remarks: string | null; details: Record<string, any>
  }[]
}

/** The checklist a rescued document is a copy of, for a banner on the document page. */
export async function getChecklistForDocument(db: Pool, documentId: number) {
  const { rows: [row] } = await db.query(
    `SELECT c.slug, c.title, ed.label
       FROM documents d
       JOIN checklist_editions ed ON d.provenance->>'sourceId' = ANY(ed.source_ids)
       JOIN checklists c ON c.id = ed.checklist_id
      WHERE d.id = $1 LIMIT 1`, [documentId])
  return (row ?? null) as { slug: string; title: string; label: string } | null
}

export type ChangeKind = 'added' | 'dropped' | 'renamed' | 'status'

/**
 * What changed between two editions. Taxa are compared by species (falling back
 * to the name as written), so a renamed taxon shows as renamed, not as one
 * dropped and one added.
 */
/** Status codes as an order-free set: "R,M,B*" and "R,B*,M" are the same status. */
const codeSet = (codes: string) => codes.split(/[,\s]+/).filter(Boolean).sort().join(',')

export function compareEditions(older: Entry[], newer: Entry[]) {
  const key = (e: Entry) => (e.species_id ? `s${e.species_id}` : `n${e.verbatim_name.toLowerCase()}`)
  const a = new Map(older.map((e) => [key(e), e]))
  const b = new Map(newer.map((e) => [key(e), e]))
  const changes: { kind: ChangeKind; before: Entry | null; after: Entry | null }[] = []
  for (const [k, e] of b) {
    const prev = a.get(k)
    if (!prev) changes.push({ kind: 'added', before: null, after: e })
    else if (prev.verbatim_name.toLowerCase() !== e.verbatim_name.toLowerCase()) changes.push({ kind: 'renamed', before: prev, after: e })
    // Only when both editions code this taxon: the 1993 plant list uses no codes at all.
    else if (prev.status_codes && e.status_codes && codeSet(prev.status_codes) !== codeSet(e.status_codes)) changes.push({ kind: 'status', before: prev, after: e })
  }
  for (const [k, e] of a) if (!b.has(k)) changes.push({ kind: 'dropped', before: e, after: null })
  return changes
}
