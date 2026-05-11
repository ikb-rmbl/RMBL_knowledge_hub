/**
 * Per-collection list of field names that are eligible for curation
 * tracking. When an admin saves an edit to one of these fields, the
 * `curationHookFor` hook records the change in the row's `curatedFields`
 * JSON array; sync and pipeline writes (Phase 2) will then skip that cell.
 *
 * Field names are Payload's camelCase form. Keep this list in lockstep with
 * scripts/sync-databases.ts's `curatedFields` (snake_case form there); both
 * describe the same set of admin-editable columns.
 */
export const CURATABLE_FIELDS: Record<string, string[]> = {
  publications: [
    'title', 'abstract', 'year', 'journal', 'volume', 'issue', 'pages',
    'doi', 'publisher', 'pdfLink', 'externalUrl', 'publicationType',
    'dataSource', 'discoveryMethod', 'pdfRestricted', 'pdfSourceDescription',
    'pdfAcquiredAt',
  ],
  datasets: [
    'title', 'description', 'doi', 'publicationYear', 'downloadUrl',
    'externalCatalogUrl', 'spatialDescription', 'license', 'resourceType',
    'dataPublisher', 'repository', 'methods',
  ],
  documents: [
    'title', 'summary', 'dateOriginal', 'sourceUrl', 'pdfLink',
    'pdfRestricted', 'pdfSourceDescription', 'pdfAcquiredAt',
  ],
  authors: ['displayName', 'familyName', 'givenName', 'orcid', 'affiliation'],
  topics: ['name', 'parent'],
  projects: [
    'name', 'description', 'projectType', 'status', 'pi', 'piAuthorId',
    'fieldOfScience', 'researchAreas', 'startYear', 'endYear',
    'discoveryKeywords', 'autoDiscoveryEnabled', 'parentProject',
  ],
  protocols: ['approved'],
  species: [],
  places: [],
  concepts: [],
  stories: [],
}
