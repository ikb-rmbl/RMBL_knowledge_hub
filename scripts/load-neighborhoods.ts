/**
 * Load knowledge neighborhoods from communities.json into the neighborhoods table.
 *
 * Reads the pre-computed community data (from detect-communities.ts + describe-communities.ts)
 * and upserts into the neighborhoods PostgreSQL table.
 *
 * Usage:
 *   npx tsx scripts/load-neighborhoods.ts
 */

import { readFileSync } from 'fs'
import pg from 'pg'
import './lib/config.js'

async function main() {
  console.log('Load Knowledge Neighborhoods')
  console.log('============================')

  const commData = JSON.parse(readFileSync('public/graph/communities.json', 'utf-8'))
  const communities = commData.communities as any[]
  const resolution = commData.meta?.resolution ?? 1.0

  console.log(`${communities.length} communities to load (resolution=${resolution})`)

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rmbl_knowledge_hub',
    max: 2,
  })

  // Ensure table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS neighborhoods (
      id              SERIAL PRIMARY KEY,
      community_id    INTEGER NOT NULL UNIQUE,
      title           TEXT NOT NULL,
      summary         TEXT,
      label           TEXT,
      themes          TEXT[] DEFAULT '{}',
      size            INTEGER NOT NULL DEFAULT 0,
      type_counts     JSONB DEFAULT '{}',
      top_members     JSONB DEFAULT '[]',
      top_by_type     JSONB DEFAULT '{}',
      resolution      FLOAT DEFAULT 1.0,
      generated_at    TIMESTAMPTZ DEFAULT NOW(),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  let loaded = 0
  for (const c of communities) {
    await db.query(`
      INSERT INTO neighborhoods (community_id, title, summary, label, themes, size, type_counts, top_members, top_by_type, resolution, generated_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (community_id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        label = EXCLUDED.label,
        themes = EXCLUDED.themes,
        size = EXCLUDED.size,
        type_counts = EXCLUDED.type_counts,
        top_members = EXCLUDED.top_members,
        top_by_type = EXCLUDED.top_by_type,
        resolution = EXCLUDED.resolution,
        generated_at = EXCLUDED.generated_at,
        updated_at = NOW()
    `, [
      c.id,
      c.title || c.label,
      c.summary || null,
      c.label,
      c.themes || [],
      c.size,
      JSON.stringify(c.typeCounts || {}),
      JSON.stringify(c.topMembers || []),
      JSON.stringify(c.topByType || {}),
      resolution,
      commData.meta?.generatedAt || new Date().toISOString(),
    ])
    loaded++
  }

  console.log(`Loaded ${loaded} neighborhoods`)

  // Load members from unified.json
  console.log('\nLoading neighborhood members from unified.json...')
  const unified = JSON.parse(readFileSync('public/graph/unified.json', 'utf-8'))

  // Build community_id → neighborhood.id mapping
  const { rows: nbrRows } = await db.query('SELECT id, community_id FROM neighborhoods')
  const communityToNbr = new Map<number, number>()
  for (const r of nbrRows) communityToNbr.set(r.community_id, r.id)

  // Clear existing members
  await db.query('DELETE FROM neighborhood_members')

  // Batch insert members
  const batchSize = 200
  let memberCount = 0
  let batch: any[][] = []

  for (const node of unified.nodes) {
    const communityId = node.community
    if (communityId === undefined || communityId < 0) continue
    const nbrId = communityToNbr.get(communityId)
    if (!nbrId) continue

    const entityType = node.nodeType || node.id.split('-')[0]
    const rawId = node.id.includes('-') ? node.id.slice(node.id.indexOf('-') + 1) : node.id
    const entityId = parseInt(rawId)
    if (isNaN(entityId)) continue

    batch.push([nbrId, entityType, entityId, node.id, node.label || '', node.degree || 0])

    if (batch.length >= batchSize) {
      await insertMemberBatch(db, batch)
      memberCount += batch.length
      batch = []
    }
  }
  if (batch.length > 0) {
    await insertMemberBatch(db, batch)
    memberCount += batch.length
  }

  console.log(`Loaded ${memberCount} neighborhood members`)

  // Verify
  const { rows: [{ count }] } = await db.query('SELECT COUNT(*)::int as count FROM neighborhoods')
  const { rows: [{ mcount }] } = await db.query('SELECT COUNT(*)::int as mcount FROM neighborhood_members')
  console.log(`Total: ${count} neighborhoods, ${mcount} members`)

  await db.end()
}

async function insertMemberBatch(db: pg.Pool, batch: any[][]) {
  const placeholders = batch.map((_, i) => {
    const off = i * 6
    return `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6})`
  }).join(', ')
  const values = batch.flat()
  await db.query(
    `INSERT INTO neighborhood_members (neighborhood_id, entity_type, entity_id, node_id, label, degree) VALUES ${placeholders}`,
    values,
  )
}

main().catch((err) => { console.error(err); process.exit(1) })
