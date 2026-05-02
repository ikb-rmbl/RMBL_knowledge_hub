/**
 * Community content flags API.
 *
 * POST /api/v1/flags — submit a flag (anonymous, rate-limited)
 * GET  /api/v1/flags — list flags (for admin review)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '../../../lib/db'

export const dynamic = 'force-dynamic'

const VALID_COLLECTIONS = new Set([
  'publications', 'datasets', 'documents', 'stories',
  'species', 'concepts', 'protocols', 'places',
  'neighborhoods', 'authors',
])

const VALID_REASONS = new Set([
  'incorrect_data', 'duplicate', 'missing_info', 'outdated',
  'inappropriate', 'broken_link', 'other',
])

const REASON_LABELS: Record<string, string> = {
  incorrect_data: 'Incorrect data',
  duplicate: 'Duplicate',
  missing_info: 'Missing information',
  outdated: 'Outdated',
  inappropriate: 'Inappropriate content',
  broken_link: 'Broken link',
  other: 'Other',
}

// Rate limiting: 5 flags per IP per hour
const FLAG_WINDOW_MS = 3600_000
const FLAG_LIMIT = 5
const flagStore = new Map<string, number[]>()

function checkFlagRateLimit(ip: string): boolean {
  const now = Date.now()
  let timestamps = flagStore.get(ip) || []
  timestamps = timestamps.filter(t => now - t < FLAG_WINDOW_MS)
  if (timestamps.length >= FLAG_LIMIT) return false
  timestamps.push(now)
  flagStore.set(ip, timestamps)
  // Cleanup old entries periodically
  if (flagStore.size > 5000) {
    for (const [key, ts] of flagStore) {
      if (ts.filter(t => now - t < FLAG_WINDOW_MS).length === 0) flagStore.delete(key)
    }
  }
  return true
}

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)

  if (!checkFlagRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. You can submit up to 5 flags per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { collection, itemId, reason, description, suggestion, email } = body

  // Validate required fields
  if (!collection || !VALID_COLLECTIONS.has(collection)) {
    return NextResponse.json({ error: `Invalid collection. Valid: ${[...VALID_COLLECTIONS].join(', ')}` }, { status: 400 })
  }
  if (!itemId || typeof itemId !== 'number') {
    return NextResponse.json({ error: 'itemId (number) is required' }, { status: 400 })
  }
  if (!reason || !VALID_REASONS.has(reason)) {
    return NextResponse.json({ error: `Invalid reason. Valid: ${[...VALID_REASONS].join(', ')}` }, { status: 400 })
  }

  // Validate email format if provided
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  // Validate itemId range
  if (itemId < 1 || itemId > 2147483647) {
    return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 })
  }

  // Sanitize text inputs: strip control characters, truncate
  function sanitizeText(s: string, maxLen: number): string {
    return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, maxLen)
  }
  const safeDescription = description ? sanitizeText(String(description), 2000) : null
  const safeSuggestion = suggestion ? sanitizeText(String(suggestion), 2000) : null
  const safeEmail = email ? String(email).slice(0, 255) : null

  const pool = getDb()

  try {
    // Look up item title — table/column names come from a hardcoded map, validated against VALID_COLLECTIONS
    const TABLE_MAP: Record<string, { table: string; titleCol: string }> = {
      publications: { table: 'publications', titleCol: 'title' },
      datasets: { table: 'datasets', titleCol: 'title' },
      documents: { table: 'documents', titleCol: 'title' },
      stories: { table: 'stories', titleCol: 'title' },
      species: { table: 'species', titleCol: 'canonical_name' },
      concepts: { table: 'concepts', titleCol: 'name' },
      protocols: { table: 'protocols', titleCol: 'name' },
      places: { table: 'places', titleCol: 'name' },
      neighborhoods: { table: 'neighborhoods', titleCol: 'title' },
      authors: { table: 'authors', titleCol: 'display_name' },
    }
    const mapping = TABLE_MAP[collection]
    if (!mapping) {
      return NextResponse.json({ error: 'Unknown collection' }, { status: 400 })
    }
    const { table, titleCol } = mapping
    const { rows: [item] } = await pool.query(`SELECT ${titleCol} as title FROM ${table} WHERE id = $1`, [itemId])
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Duplicate detection: same IP + collection + item + reason within 24 hours
    const { rows: [existing] } = await pool.query(
      `SELECT id FROM content_flags
       WHERE collection = $1 AND item_id = $2 AND reason = $3 AND reporter_ip = $4
         AND created_at > now() - interval '24 hours'
       LIMIT 1`,
      [collection, itemId, reason, ip],
    )
    if (existing) {
      return NextResponse.json({ error: 'You already flagged this item for this reason. Thank you for your report.' }, { status: 409 })
    }

    const { rows: [flag] } = await pool.query(
      `INSERT INTO content_flags (collection, item_id, item_title, reason, description, suggestion, reporter_email, reporter_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [collection, itemId, item.title, reason, safeDescription, safeSuggestion, safeEmail, ip],
    )

    return NextResponse.json({ success: true, flagId: flag.id }, { status: 201 })
  } catch (err: any) {
    console.error('Flag submission error:', err)
    return NextResponse.json({ error: 'Failed to submit flag' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const status = searchParams.get('status') || 'open'
  const collection = searchParams.get('collection') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 200)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0') || 0, 0)

  const pool = getDb()

  const where: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (status && status !== 'all') {
    where.push(`status = $${paramIdx}`)
    values.push(status)
    paramIdx++
  }
  if (collection && VALID_COLLECTIONS.has(collection)) {
    where.push(`collection = $${paramIdx}`)
    values.push(collection)
    paramIdx++
  }

  const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  try {
    // Public endpoint: exclude reporter_email and reporter_ip for privacy
    // Admin access would need a separate authenticated endpoint
    const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
      pool.query(
        `SELECT id, collection, item_id, item_title, reason, description, suggestion,
                status, resolution_notes, created_at, resolved_at
         FROM content_flags ${whereStr}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(`SELECT count(*)::int as n FROM content_flags ${whereStr}`, values),
    ])

    // Add reason labels
    const enriched = rows.map((r: any) => ({
      ...r,
      reason_label: REASON_LABELS[r.reason] || r.reason,
    }))

    return NextResponse.json({ data: enriched, meta: { total, limit, offset } })
  } catch (err: any) {
    console.error('Flag list error:', err)
    return NextResponse.json({ error: 'Failed to list flags' }, { status: 500 })
  }
}
