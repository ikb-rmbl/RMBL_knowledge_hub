import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  LEGACY_DOCUMENTS_FILE,
  isLegacyDocument,
  partitionTopics,
  provenanceRecord,
  readLegacyDocuments,
  type LegacyDocument,
} from '../lib/legacy-website-documents.js'
import { PARENT_TOPIC_NAMES } from '../lib/topic-rules.js'

function legacyDoc(overrides: Partial<LegacyDocument> = {}): LegacyDocument {
  return {
    _sourceId: 'rmbl-wayback:org,rmbl)/birdlist.shtml',
    title: 'Checklist of Birds at the RMBL',
    categories: ['RMBL & Gothic', 'Species Checklists & Identification Keys'],
    sourceUrl: 'https://web.archive.org/web/20010206053711/http://www.rmbl.org:80/birdlist.shtml',
    fullText: 'Herons and Bitterns\nAmerican Bittern R,V',
    documentType: 'species_checklist',
    _provenance: {
      discoveryMethod: 'wayback_rescue',
      originalUrl: 'http://www.rmbl.org:80/birdlist.shtml',
      contentSha256: 'ab'.repeat(32),
    },
    ...overrides,
  }
}

describe('readLegacyDocuments', () => {
  it('returns [] when the staged file is absent', () => {
    expect(readLegacyDocuments(mkdtempSync(join(tmpdir(), 'kc-')))).toEqual([])
  })

  it('reads the staged array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kc-'))
    writeFileSync(join(dir, LEGACY_DOCUMENTS_FILE), JSON.stringify([legacyDoc()]))
    expect(readLegacyDocuments(dir)).toHaveLength(1)
  })

  it('rejects a non-array file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kc-'))
    writeFileSync(join(dir, LEGACY_DOCUMENTS_FILE), JSON.stringify({ documents: [] }))
    expect(() => readLegacyDocuments(dir)).toThrow(/expected a JSON array/)
  })
})

describe('isLegacyDocument', () => {
  it('recognises rescue records by discovery method', () => {
    expect(isLegacyDocument(legacyDoc())).toBe(true)
  })

  it('ignores Sustainable Library and FR records', () => {
    expect(isLegacyDocument({ title: 'x', sourceUrl: 'https://sustainablelibrary.org/x' })).toBe(false)
    expect(isLegacyDocument(null)).toBe(false)
  })
})

describe('partitionTopics', () => {
  it('splits staged topic names into registered and unregistered', () => {
    const docs = [legacyDoc(), legacyDoc({ categories: ['RMBL & Gothic', 'Made Up Topic'] })]
    expect(partitionTopics(docs, new Set(PARENT_TOPIC_NAMES))).toEqual({
      registered: ['RMBL & Gothic', 'Species Checklists & Identification Keys'],
      unregistered: ['Made Up Topic'],
    })
  })

  it('every topic the rescue pipeline emits is registered in topic-rules.ts', () => {
    // Keep in step with RMBL_metadata_rescue src/rmbl_rescue/export/topics.py
    const emitted = [
      'RMBL & Gothic',
      'RMBL Institutional History',
      'Field Station Operations',
      'Field Courses & Syllabi',
      'Species Checklists & Identification Keys',
      'RMBL Research Bibliographies',
      'RMBL Data Management',
      'RMBL Events & Community',
      'Weather & Atmospheric Science',
      'Mentoring & Research Training',
      'Science Education & Pedagogy',
      'Research Programs',
      'Insect Ecology',
      'Freshwater Ecology',
      'Biodiversity & Conservation',
    ]
    const { unregistered } = partitionTopics([legacyDoc({ categories: emitted })], new Set(PARENT_TOPIC_NAMES))
    expect(unregistered).toEqual([])
  })
})

describe('provenanceRecord', () => {
  it('adds the stable rescue id to the staged trail', () => {
    expect(provenanceRecord(legacyDoc())).toMatchObject({
      discoveryMethod: 'wayback_rescue',
      originalUrl: 'http://www.rmbl.org:80/birdlist.shtml',
      sourceId: 'rmbl-wayback:org,rmbl)/birdlist.shtml',
    })
  })
})
