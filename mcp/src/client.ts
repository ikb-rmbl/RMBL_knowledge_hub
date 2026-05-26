/**
 * HTTP client for the RMBL Knowledge Commons REST API v1.
 *
 * All methods return plain text (format=text) for LLM consumption.
 */

const DEFAULT_BASE_URL = 'http://localhost:3000'
const TIMEOUT_MS = 15_000

export class RMBLClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || process.env.RMBL_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  }

  private async fetch(path: string, params: Record<string, string | number | undefined> = {}): Promise<string> {
    const url = new URL(`${this.baseUrl}${path}`)
    url.searchParams.set('format', 'text')
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`)
      }
      return await res.text()
    } finally {
      clearTimeout(timeout)
    }
  }

  async search(query: string, type?: string, limit?: number): Promise<string> {
    return this.fetch('/api/v1/search', { q: query, type, limit })
  }

  async getPublication(id: number): Promise<string> {
    return this.fetch(`/api/v1/publications/${id}`)
  }

  async getDataset(id: number): Promise<string> {
    return this.fetch(`/api/v1/datasets/${id}`)
  }

  async getDocument(id: number): Promise<string> {
    return this.fetch(`/api/v1/documents/${id}`)
  }

  async getAuthor(id: number): Promise<string> {
    return this.fetch(`/api/v1/authors/${id}`)
  }

  async getEntity(type: string, id: number): Promise<string> {
    return this.fetch(`/api/v1/entities/${type}/${id}`)
  }

  async listEntities(type: string, query?: string, limit?: number): Promise<string> {
    return this.fetch(`/api/v1/entities/${type}`, { q: query, limit })
  }

  async getRelated(collection: string, id: number): Promise<string> {
    return this.fetch(`/api/v1/related/${collection}/${id}`)
  }

  async getNeighborhood(id: number): Promise<string> {
    return this.fetch(`/api/v1/neighborhoods/${id}`)
  }

  async listNeighborhoods(query?: string): Promise<string> {
    return this.fetch('/api/v1/neighborhoods', { q: query })
  }

  async getFrontier(id: number): Promise<string> {
    return this.fetch(`/api/v1/frontiers/${id}`)
  }

  async listFrontiers(query?: string, sort?: string): Promise<string> {
    return this.fetch('/api/v1/frontiers', { q: query, sort })
  }
}
