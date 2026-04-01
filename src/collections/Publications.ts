import type { CollectionConfig } from 'payload'
import { GEOGRAPHIC_SCOPE_OPTIONS } from './shared/constants'

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
  access: {
    read: () => true,
  },
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
      name: 'researchTopics',
      type: 'relationship',
      relationTo: 'topics',
      hasMany: true,
      admin: {
        description: 'Shared taxonomy with other collections',
      },
    },
  ],
}
