/**
 * Payload CMS REST API client for pipeline scripts.
 *
 * Handles authentication, token management, and typed CRUD operations.
 * Used by load-to-payload.ts, organize-topics.ts, assign-publication-topics.ts.
 */

import { PAYLOAD_API, PAYLOAD_ADMIN_EMAIL, PAYLOAD_ADMIN_PASSWORD, PAYLOAD_BASE_URL } from './config.js'

let authToken: string | null = null

function assertSafeTarget() {
  if (PAYLOAD_API.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(PAYLOAD_API)) {
    throw new Error(
      `PAYLOAD_BASE_URL is a remote http:// URL (${PAYLOAD_API}) — admin credentials would travel unencrypted. Use https://.`,
    )
  }
}

export async function ensureAuth(): Promise<void> {
  assertSafeTarget()
  if (authToken) return

  // Try to log in
  const loginRes = await fetch(`${PAYLOAD_API}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PAYLOAD_ADMIN_EMAIL, password: PAYLOAD_ADMIN_PASSWORD }),
  })

  if (loginRes.ok) {
    const data = await loginRes.json()
    authToken = data.token
    return
  }

  // First-run: create admin user
  const createRes = await fetch(`${PAYLOAD_API}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PAYLOAD_ADMIN_EMAIL, password: PAYLOAD_ADMIN_PASSWORD }),
  })

  if (createRes.ok) {
    const loginRes2 = await fetch(`${PAYLOAD_API}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: PAYLOAD_ADMIN_EMAIL, password: PAYLOAD_ADMIN_PASSWORD }),
    })
    if (loginRes2.ok) {
      const data = await loginRes2.json()
      authToken = data.token
      return
    }
  }

  throw new Error('Could not authenticate with Payload. Is the dev server running?')
}

export function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `JWT ${authToken}` } : {}),
  }
}

export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${PAYLOAD_BASE_URL}/admin`, { redirect: 'manual' })
    return res.ok || res.status === 302 || res.status === 301
  } catch {
    return false
  }
}

export async function createRecord(
  collection: string,
  data: Record<string, unknown>,
): Promise<{ id: string } | null> {
  // createRecord is only called from pipeline scripts — always flag the write
  // as pipeline so the curation hook can never treat it as an admin edit.
  const res = await fetch(`${PAYLOAD_API}/${collection}?context[pipeline]=true`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 400 && body.includes('unique')) return null
    throw new Error(`POST /${collection} failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const result = await res.json()
  return { id: result.doc?.id || result.id }
}

export async function patchRecord(
  collection: string,
  id: string | number,
  data: Record<string, unknown>,
  options?: { pipeline?: boolean },
): Promise<boolean> {
  // ?context[pipeline]=true is read by the curation hook to skip marking the
  // edited fields as admin-curated. Pass options.pipeline=true on any update
  // that originates from a pipeline script.
  const suffix = options?.pipeline ? '?context[pipeline]=true' : ''
  const res = await fetch(`${PAYLOAD_API}/${collection}/${id}${suffix}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(data),
  })
  return res.ok
}

export async function findByField(
  collection: string,
  field: string,
  value: string,
): Promise<string | null> {
  const res = await fetch(
    `${PAYLOAD_API}/${collection}?where[${field}][equals]=${encodeURIComponent(value)}&limit=1`,
    { headers: authHeaders() },
  )
  if (!res.ok) return null
  const data = await res.json()
  if (data.docs?.length > 0) return String(data.docs[0].id)
  return null
}

export async function getCount(collection: string): Promise<number> {
  const res = await fetch(`${PAYLOAD_API}/${collection}?limit=0`, { headers: authHeaders() })
  if (!res.ok) return 0
  const data = await res.json()
  return data.totalDocs || 0
}

/**
 * Fetch all records from a collection, handling pagination correctly.
 */
export async function getAllPaginated(
  collection: string,
  query?: string,
): Promise<any[]> {
  const all: any[] = []
  let page = 1
  while (true) {
    const url = `${PAYLOAD_API}/${collection}?limit=500&page=${page}&depth=0${query ? '&' + query : ''}`
    const res = await fetch(url, { headers: authHeaders() })
    const data = await res.json()
    const prevSize = all.length
    for (const doc of data.docs) {
      all.push(doc)
    }
    if (data.docs.length < 500 || all.length === prevSize) break
    page++
  }
  return all
}
