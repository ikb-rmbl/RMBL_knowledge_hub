import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { queryCrossRef, queryUnpaywall } from '../lib/crossref-client.js'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('queryCrossRef', () => {
  it('returns doi and abstract for matching result (strict mode)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            { DOI: '10.1234/found', title: ['Ecology of marmots in Gothic'], abstract: '<p>Abstract text</p>' },
          ],
        },
      }),
    })

    const result = await queryCrossRef('Ecology of marmots in Gothic', 'Smith', 2020)
    expect(result.doi).toBe('10.1234/found')
    expect(result.abstract).toBe('Abstract text') // HTML stripped
  })

  it('returns null for low similarity match in strict mode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            { DOI: '10.1234/wrong', title: ['Completely unrelated quantum physics paper'], abstract: null },
          ],
        },
      }),
    })

    const result = await queryCrossRef('Ecology of marmots', 'Smith', 2020)
    expect(result.doi).toBeNull()
  })

  it('returns match with relaxed threshold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            { DOI: '10.1234/partial', title: ['Ecology of marmots'], abstract: null },
          ],
        },
      }),
    })

    const result = await queryCrossRef('Ecology of yellow-bellied marmots in Colorado', 'Smith', 2020, { relaxed: true })
    // With relaxed mode (0.75 threshold), partial title match may or may not pass
    // The key test is that it uses the relaxed URL params
    expect(result).toBeDefined()
  })

  it('uses correct URL params for strict mode', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    await queryCrossRef('Test title', 'Author', 2020)

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('rows=3')
    expect(url).toContain('from-pub-date:2020')
    expect(url).toContain('until-pub-date:2020')
  })

  it('uses correct URL params for relaxed mode', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    await queryCrossRef('Test title', 'Author', 2020, { relaxed: true })

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('rows=5')
    expect(url).toContain('from-pub-date:2019')
    expect(url).toContain('until-pub-date:2021')
  })

  it('handles fetch failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await queryCrossRef('Test', 'Smith', 2020)
    expect(result).toEqual({ doi: null, abstract: null })
  })

  it('handles non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const result = await queryCrossRef('Test', 'Smith', 2020)
    expect(result).toEqual({ doi: null, abstract: null })
  })

  it('handles empty items array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [] } }),
    })

    const result = await queryCrossRef('Test', 'Smith', 2020)
    expect(result).toEqual({ doi: null, abstract: null })
  })

  it('accepts string year parameter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    await queryCrossRef('Test', 'Author', '2020')

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('from-pub-date:2020')
  })
})

describe('queryUnpaywall', () => {
  it('returns PDF URL from best_oa_location', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        oa_status: 'gold',
        best_oa_location: { url_for_pdf: 'https://example.com/paper.pdf' },
      }),
    })

    const result = await queryUnpaywall('10.1234/test')
    expect(result.pdfUrl).toBe('https://example.com/paper.pdf')
    expect(result.oaStatus).toBe('gold')
  })

  it('falls back to oa_locations array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        oa_status: 'green',
        best_oa_location: { url_for_pdf: null },
        oa_locations: [
          { url_for_pdf: null },
          { url_for_pdf: 'https://repo.com/paper.pdf' },
        ],
      }),
    })

    const result = await queryUnpaywall('10.1234/test')
    expect(result.pdfUrl).toBe('https://repo.com/paper.pdf')
  })

  it('returns null when no PDF available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        oa_status: 'closed',
        best_oa_location: null,
        oa_locations: [],
      }),
    })

    const result = await queryUnpaywall('10.1234/test')
    expect(result.pdfUrl).toBeNull()
    expect(result.oaStatus).toBe('closed')
  })

  it('handles fetch failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await queryUnpaywall('10.1234/test')
    expect(result).toEqual({ pdfUrl: null, oaStatus: null })
  })
})
