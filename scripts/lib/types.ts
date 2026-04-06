/**
 * Shared type definitions for normalized data across all pipeline scripts.
 */

import type { ParsedAuthor } from './author-parsing.js'

export type { ParsedAuthor }

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export interface NormalizedPublication {
  _sourceId: string
  title: string
  authors: ParsedAuthor[]
  year: number
  publicationType: string
  journal: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  doi: string | null
  publisher: string | null
  abstract: string | null
  keywords: { keyword: string }[]
  pdfLink: string | null
  externalUrl: string | null
  editors: ParsedAuthor[]
  _chaptertitle: string | null
  _degree: string | null
  _institution: string | null
  _crossrefEnriched: boolean
  _unpaywallEnriched: boolean
  _oaStatus: string | null
  _source: 'rmbl_database' | 'discovered' | 'manual'
  _discoveryMethod: string
}

// ---------------------------------------------------------------------------
// Sustainable Library Documents
// ---------------------------------------------------------------------------

export interface ScrapedDocument {
  postId: string
  title: string
  detailUrl: string
  summary: string
  categories: { name: string; slug: string }[]
  tags: string[]
  pdfUrl: string | null
  pdfSizeBytes: number | null
  datePosted: string | null
  fileType: string | null
  sourceUrl: string
}

export interface NormalizedDocument {
  _sourcePostId: string
  title: string
  summary: string
  categories: string[]
  dateOriginal: string | null
  geographicScope: string[]
  sourceFile: string | null
  sourceUrl: string
  ingestionDate: string
  _tags: string[]
  _pdfSizeBytes: number | null
}

// ---------------------------------------------------------------------------
// Data Catalog Datasets
// ---------------------------------------------------------------------------

export interface NormalizedDataset {
  _sourceId: string
  title: string
  description: string
  creators: { name: string; orcid: string | null; affiliation: string | null }[]
  datePublished: string | null
  publicationYear: number
  spatialExtent: {
    westBoundLongitude: number
    eastBoundLongitude: number
    southBoundLatitude: number
    northBoundLatitude: number
  } | null
  temporalExtent: { start: string | null; end: string | null }
  downloadUrl: string | null
  doi: string | null
  _doiStatus: 'valid' | 'pending' | 'none' | 'invalid'
  repository: string | null
  externalCatalogUrl: string | null
  spatialDescription: string
  tags: string[]
  license: string | null
  resourceType: string
  dataPublisher: string
  _citation: string | null
  _source: string
  _metadataLink: string | null
  _webMapLink: string | null
  _methods?: string
  _metadataFullText?: string
}

// ---------------------------------------------------------------------------
// Raw API types
// ---------------------------------------------------------------------------

export interface RawPublication {
  id: string
  reftypeId: string
  reftypename: string
  year: string
  title: string
  volume: string | null
  edition: string | null
  publisherId: string | null
  publishername: string | null
  publishercity_state: string | null
  pages: string | null
  restofreference: string | null
  journalname: string | null
  journalissue: string | null
  catalognumber: string | null
  donatedby: string | null
  chaptertitle: string | null
  bookeditors: string | null
  degree: string | null
  institution: string | null
  keywords: string | null
  comments: string | null
  bn_url: string | null
  abstract_url: string | null
  fulltext_url: string | null
  pdf_url: string | null
  copyinlibrary: string | null
  RMBL: string | null
  pending: string | null
  email: string | null
  student: string | null
  authors: string | null
  authorIds: string | null
  tagIds: string | null
}
