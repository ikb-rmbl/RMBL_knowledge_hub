/**
 * Oral-history transcript ingest → Stories
 *
 * Reads normalized transcript files from scripts/output/oral-histories/*.md
 * and upserts them into the stories table as story_type='oral_history'.
 * Unlike news stories, these are RMBL-owned recordings: full_text (the
 * transcript) is displayed on the story page, not just indexed for search.
 *
 * Input file format — a `---` header block followed by speaker turns:
 *
 *   ---
 *   title: Oral History: Jane Doe
 *   interviewee: Jane Doe
 *   interviewer: Solé Agulla
 *   interview_date: 2026-07-29        (optional)
 *   location: Gothic, Colorado        (optional)
 *   summary: One-paragraph summary
 *   source_doc: <Google Doc id>       (stable identity key)
 *   media_url: https://...            (optional; audio/video when hosted)
 *   ---
 *
 *   Speaker Name [12:34]:
 *   Paragraph text...
 *
 * Keyed on source_url (derived from source_doc) — re-runs update in place.
 * Honors duplicate_tombstones so admin-deleted rows stay deleted.
 *
 * Usage:
 *   npx tsx scripts/ingest-oral-histories.ts [--dry-run] [--target=neon]
 *
 * Writes directly to PostgreSQL — no dev server needed. Follow with
 * generate-embeddings.ts and (optionally) extract-story-entities.ts.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import pg from 'pg'
import { OUTPUT_DIR } from './lib/config.js'
import { extractKeys, matchesAnyTombstone, type TombstoneKeys } from './lib/dedup-keys.js'

const dryRun = process.argv.includes('--dry-run')
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local'
if (target !== 'local' && target !== 'neon') {
  console.error(`Unknown --target=${target} (expected local or neon)`)
  process.exit(1)
}

const INPUT_DIR = join(OUTPUT_DIR, 'oral-histories')

interface OralHistory {
  file: string
  title: string
  interviewee: string
  interviewer: string | null
  date: string | null
  location: string | null
  summary: string | null
  sourceUrl: string
  mediaUrl: string | null
  transcript: string
}

function parseFile(path: string): OralHistory {
  const raw = readFileSync(path, 'utf-8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*)$/)
  if (!m) throw new Error(`${path}: missing --- header block`)
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  for (const req of ['title', 'interviewee', 'source_doc']) {
    if (!meta[req]) throw new Error(`${path}: missing required header field "${req}"`)
  }
  return {
    file: path,
    title: meta.title,
    interviewee: meta.interviewee,
    interviewer: meta.interviewer ?? null,
    date: meta.interview_date ?? null,
    location: meta.location ?? null,
    summary: meta.summary ?? null,
    sourceUrl: `https://docs.google.com/document/d/${meta.source_doc}`,
    mediaUrl: meta.media_url ?? null,
    transcript: m[2].trim(),
  }
}

async function main() {
  if (!existsSync(INPUT_DIR)) {
    console.error(`No input directory: ${INPUT_DIR}`)
    process.exit(1)
  }
  const files = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.md'))
  if (files.length === 0) {
    console.log(`No .md files in ${INPUT_DIR} — nothing to do.`)
    return
  }
  const items = files.map((f) => parseFile(join(INPUT_DIR, f)))
  console.log(`${items.length} transcripts parsed from ${INPUT_DIR}`)

  const connectionString = target === 'neon' ? process.env.NEON_DIRECT_URL : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(`${target === 'neon' ? 'NEON_DIRECT_URL' : 'DATABASE_URL'} is not set`)
  }
  console.log(`Target: ${target}`)
  const db = new pg.Pool({ connectionString })
  try {
    const tombstones: TombstoneKeys[] = (
      await db.query(`SELECT keys FROM duplicate_tombstones WHERE collection = 'stories'`)
    ).rows.map((r) => r.keys)

    let inserted = 0
    let updated = 0
    let skipped = 0
    for (const item of items) {
      const keys = extractKeys('stories', { source_url: item.sourceUrl, title: item.title })
      if (matchesAnyTombstone(keys, tombstones)) {
        console.log(`  ~ ${item.title} — matches a tombstone, skipped`)
        skipped++
        continue
      }
      const existing = await db.query(`SELECT id FROM stories WHERE source_url = $1`, [item.sourceUrl])
      if (dryRun) {
        console.log(`  [dry-run] ${existing.rows.length ? 'UPDATE' : 'INSERT'} ${item.title}`)
      } else if (existing.rows.length > 0) {
        await db.query(
          `UPDATE stories SET
             title = $1, story_type = 'oral_history', author = $2, date = $3,
             summary = $4, full_text = $5, location = $6, media_url = $7,
             media_type = $8, updated_at = NOW()
           WHERE id = $9`,
          [
            item.title,
            item.interviewee,
            item.date,
            item.summary,
            item.transcript,
            item.location,
            item.mediaUrl,
            item.mediaUrl ? 'audio' : 'text',
            existing.rows[0].id,
          ],
        )
      } else {
        await db.query(
          `INSERT INTO stories
             (title, story_type, author, date, summary, full_text, source_url,
              location, media_url, media_type, created_at, updated_at)
           VALUES ($1, 'oral_history', $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
          [
            item.title,
            item.interviewee,
            item.date,
            item.summary,
            item.transcript,
            item.sourceUrl,
            item.location,
            item.mediaUrl,
            item.mediaUrl ? 'audio' : 'text',
          ],
        )
      }
      if (existing.rows.length > 0) updated++
      else inserted++
    }
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Done: ${inserted} inserted, ${updated} updated, ${skipped} tombstone-skipped.`,
    )
    if (!dryRun && inserted > 0 && target === 'local') {
      console.log(`\nNext: npx tsx scripts/generate-embeddings.ts  (new stories have no embedding yet)`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
