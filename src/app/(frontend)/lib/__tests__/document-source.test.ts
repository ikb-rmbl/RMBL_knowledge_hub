import { describe, it, expect } from 'vitest'
import { documentSource } from '../document-source'

describe('documentSource', () => {
  it('labels legacy-website rescue documents from provenance, with the archive trail', () => {
    const src = documentSource({
      sourceUrl: 'https://web.archive.org/web/20010206053711/http://www.rmbl.org:80/birdlist.shtml',
      documentType: 'species_checklist',
      provenance: {
        discoveryMethod: 'wayback_rescue',
        originalUrl: 'http://www.rmbl.org:80/birdlist.shtml',
        waybackUrl: 'https://web.archive.org/web/20010206053711/http://www.rmbl.org:80/birdlist.shtml',
        captureTimestamp: '2001-02-06T05:37:11+00:00',
        contentFormat: 'html',
      },
    })
    expect(src?.label).toMatch(/RMBL legacy website/)
    expect(src?.linkLabel).toBe('View Archived Page')
    expect(src?.archive).toEqual({
      originalUrl: 'http://www.rmbl.org:80/birdlist.shtml',
      capturedOn: 'February 6, 2001',
      waybackUrl: 'https://web.archive.org/web/20010206053711/http://www.rmbl.org:80/birdlist.shtml',
    })
  })

  it('says "file" for archived PDFs and Word documents', () => {
    const src = documentSource({
      sourceUrl: 'https://web.archive.org/web/2011/http://www.rmbl.org/x.pdf',
      provenance: { discoveryMethod: 'wayback_rescue', contentFormat: 'pdf', originalUrl: 'http://www.rmbl.org/x.pdf' },
    })
    expect(src?.linkLabel).toBe('View Archived File')
  })

  it('keeps Sustainable Living Library documents labelled as such', () => {
    expect(documentSource({ sourceUrl: 'https://sustainablelibrary.org/document/x/' })?.label).toBe(
      'Sustainable Living Library',
    )
  })

  it('labels Federal Register notices by type or host (previously shown as Sustainable Living Library)', () => {
    expect(documentSource({ sourceUrl: 'https://example.gov/x', documentType: 'federal_rule' })?.label).toBe(
      'Federal Register',
    )
    expect(documentSource({ sourceUrl: 'https://www.federalregister.gov/d/2020-1' })?.label).toBe('Federal Register')
  })

  it('falls back to the host, or nothing without a URL', () => {
    expect(documentSource({ sourceUrl: 'https://example.org/a' })?.label).toBe('example.org')
    expect(documentSource({ sourceUrl: null })).toBeNull()
  })
})
