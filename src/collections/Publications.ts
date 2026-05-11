import type { CollectionConfig } from 'payload'
import { GEOGRAPHIC_SCOPE_OPTIONS } from './shared/constants'
import { publicReadAuthWrite } from './shared/access'
import { tombstoneHookFor } from './shared/tombstoneHook'
import { curatedFieldsField, curationHookFor } from './shared/curationHook'
import { curatedFieldsWidget } from './shared/curationWidgetField'
import { CURATABLE_FIELDS } from './shared/curatableFields'
import { flagsForItemField } from './shared/flagsField'

const PUBLICATION_TYPE_OPTIONS = [
  { label: 'Journal Article', value: 'article' },
  { label: 'Thesis', value: 'thesis' },
  { label: 'Book', value: 'book' },
  { label: 'Book Chapter', value: 'chapter' },
  { label: 'Student Paper', value: 'student_paper' },
  { label: 'Other', value: 'other' },
]

export const Publications: CollectionConfig = {
  slug: 'publications',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'year', 'publicationType'],
    group: 'Content',
  },
  hooks: {
    beforeChange: [curationHookFor(CURATABLE_FIELDS.publications)],
    beforeDelete: [tombstoneHookFor('publications')],
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'authors',
      type: 'array',
      required: true,
      minRows: 1,
      admin: {
        description: 'Publication authors (CSL-JSON: author[])',
      },
      fields: [
        {
          name: 'given',
          type: 'text',
          required: true,
          admin: { width: '33%' },
        },
        {
          name: 'family',
          type: 'text',
          required: true,
          admin: { width: '33%' },
        },
        {
          name: 'orcid',
          type: 'text',
          admin: { width: '33%', description: 'ORCID identifier' },
        },
      ],
    },
    {
      name: 'year',
      type: 'number',
      required: true,
      admin: {
        description: 'Publication year (CSL-JSON: issued.date-parts)',
      },
    },
    {
      name: 'publicationType',
      type: 'select',
      required: true,
      options: PUBLICATION_TYPE_OPTIONS,
      admin: {
        description: 'CSL-JSON: type',
      },
    },
    {
      name: 'journal',
      type: 'text',
      admin: {
        description: 'Journal or book title (CSL-JSON: container-title)',
      },
    },
    {
      name: 'volume',
      type: 'text',
    },
    {
      name: 'issue',
      type: 'text',
    },
    {
      name: 'pages',
      type: 'text',
      admin: {
        description: 'Page range',
      },
    },
    {
      name: 'doi',
      type: 'text',
      admin: {
        description: 'Digital Object Identifier',
      },
    },
    {
      name: 'publisher',
      type: 'text',
    },
    {
      name: 'abstract',
      type: 'textarea',
    },
    {
      name: 'keywords',
      type: 'array',
      admin: {
        description: 'Author keywords or indexed terms',
      },
      fields: [
        {
          name: 'keyword',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'fullText',
      type: 'textarea',
      admin: {
        description: 'Extracted from PDF where available; indexed for search and RAG',
        condition: (_, siblingData) => Boolean(siblingData?.fullText),
      },
    },
    {
      name: 'sourceFile',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'PDF of publication (where available)',
      },
    },
    {
      name: 'pdfAvailable',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        readOnly: true,
        description: 'Auto-set based on whether a PDF is attached',
      },
      hooks: {
        beforeChange: [
          ({ siblingData }) => {
            return Boolean(siblingData?.sourceFile || siblingData?.pdfLink)
          },
        ],
      },
    },
    {
      name: 'pdfLink',
      type: 'text',
      admin: {
        description: 'Link to PDF on publisher or open-access repository',
      },
    },
    {
      name: 'pdfRestricted',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'If true, PDF is locally indexed but not publicly downloadable (restricted licensing).',
      },
    },
    {
      name: 'pdfSourceDescription',
      type: 'text',
      admin: {
        description: 'Where a restricted PDF was obtained (e.g., "ILL via UC Davis library", "author email request").',
      },
    },
    {
      name: 'pdfAcquiredAt',
      type: 'date',
      admin: {
        description: 'When this restricted PDF was acquired.',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'externalUrl',
      type: 'text',
      admin: {
        description: 'Publisher page or alternative access URL (CSL-JSON: URL)',
      },
    },
    {
      name: 'editors',
      type: 'array',
      admin: {
        description: 'Book/chapter editors (CSL-JSON: editor[])',
      },
      fields: [
        {
          name: 'given',
          type: 'text',
          required: true,
        },
        {
          name: 'family',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'geographicScope',
      type: 'select',
      hasMany: true,
      options: GEOGRAPHIC_SCOPE_OPTIONS,
    },
    {
      name: 'dataSource',
      type: 'select',
      required: true,
      defaultValue: 'rmbl_database',
      options: [
        { label: 'RMBL Database', value: 'rmbl_database' },
        { label: 'Discovered', value: 'discovered' },
        { label: 'Manual', value: 'manual' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Where this publication was first ingested from',
      },
    },
    {
      name: 'discoveryMethod',
      type: 'select',
      required: true,
      defaultValue: 'rmbl_api',
      options: [
        { label: 'RMBL API', value: 'rmbl_api' },
        { label: 'OpenAlex Geographic', value: 'openalex_geo' },
        { label: 'CrossRef Citation', value: 'crossref_citation' },
        { label: 'CrossRef Affiliation', value: 'crossref_affiliation' },
        { label: 'Manual Entry', value: 'manual_entry' },
      ],
      admin: {
        position: 'sidebar',
        description: 'How this publication was discovered',
      },
    },
    {
      name: 'researchTopics',
      type: 'relationship',
      relationTo: 'topics',
      hasMany: true,
      admin: {
        description: 'Shared taxonomy with other collections',
      },
    },
    {
      name: 'mentors',
      type: 'array',
      admin: {
        description: 'Mentors/advisors (for student papers)',
        condition: (_, siblingData) => siblingData?.publicationType === 'student_paper',
      },
      fields: [
        { name: 'name', type: 'text', required: true },
      ],
    },
    flagsForItemField,
    curatedFieldsField,
    curatedFieldsWidget,
  ],
}
