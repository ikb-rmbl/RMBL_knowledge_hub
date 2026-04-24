/**
 * In-memory rate limiter for API v1 endpoints.
 *
 * Sliding window per IP. On Vercel each serverless instance has its own
 * store — provides per-instance protection without external infrastructure.
 *
 * Usage in route handler:
 *   const rl = checkRateLimit(request)
 *   if (rl) return rl  // returns 429 Response
 */

import { NextRequest, NextResponse } from 'next/server'

const WINDOW_MS = 60_000
const DEFAULT_LIMIT = 60
const EXPENSIVE_LIMIT = 10

interface RateEntry {
  timestamps: number[]
}

const store = new Map<string, RateEntry>()
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < WINDOW_MS) return
  lastCleanup = now
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}

/**
 * Check rate limit for a request. Returns a 429 Response if exceeded, null otherwise.
 * Call with `expensive: true` for heavy queries (related works, graph).
 */
export function checkRateLimit(request: NextRequest, opts: { expensive?: boolean } = {}): NextResponse | null {
  cleanup()

  const ip = getClientIp(request)
  const limit = opts.expensive ? EXPENSIVE_LIMIT : DEFAULT_LIMIT
  const key = opts.expensive ? `exp:${ip}` : `gen:${ip}`
  const now = Date.now()

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS)

  if (entry.timestamps.length >= limit) {
    const retryAfter = Math.ceil((entry.timestamps[0] + WINDOW_MS - now) / 1000)
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  entry.timestamps.push(now)
  return null
}
