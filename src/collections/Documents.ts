import type { CollectionConfig } from 'payload'

const GEOGRAPHIC_SCOPE_OPTIONS = [
  { label: 'East River', value: 'east_river' },
  { label: 'Gothic', value: 'gothic' },
  { label: 'Crested Butte Area', value: 'crested_butte' },
  { label: 'Gunnison Basin', value: 'gunnison_basin' },
  { label: 'Upper Gunnison', value: 'upper_gunnison' },
  { label: 'Western Colorado', value: 'western_colorado' },
  { label: 'Other', value: 'other' },
]

export const Documents: CollectionConfig = {
  slug: 'documents',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'dateOriginal', 'categories'],
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
      name: 'summary',
      type: 'richText',
      admin: {
        description: 'Short description or abstract (Dublin Core: dc:description)',
      },
    },
    {
      name: 'fullText',
      type: 'textarea',
      admin: {
        description: 'Extracted from PDF; used for search indexing, not displayed in full',
        condition: (_, siblingData) => Boolean(siblingData?.fullText),
      },
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'topics',
      hasMany: true,
      required: true,
      admin: {
        description: 'Topics taxonomy (Dublin Core: dc:subject)',
      },
    },
    {
      name: 'dateOriginal',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayOnly',
          displayFormat: 'yyyy-MM-dd',
        },
        description: 'Date of the original document, if known (Dublin Core: dc:date)',
      },
    },
    {
      name: 'dateRange',
      type: 'group',
      admin: {
        description: 'For documents spanning a period (Dublin Core: dc:coverage.temporal)',
      },
      fields: [
        {
          name: 'start',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
          },
        },
        {
          name: 'end',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
          },
        },
      ],
    },
    {
      name: 'sourceFile',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'PDF document (Dublin Core: dc:format)',
      },
    },
    {
      name: 'geographicScope',
      type: 'select',
      hasMany: true,
      options: GEOGRAPHIC_SCOPE_OPTIONS,
      admin: {
        description: 'Predefined geographic areas (Dublin Core: dc:coverage.spatial)',
      },
    },
    {
      name: 'sourceUrl',
      type: 'text',
      admin: {
        description: 'Original URL on Sustainable Library site (Dublin Core: dc:source)',
      },
    },
    {
      name: 'ingestionDate',
      type: 'date',
      admin: {
        readOnly: true,
        date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
        description: 'When the record was added to the Knowledge Hub',
      },
      hooks: {
        beforeChange: [
          ({ value, operation }) => {
            if (operation === 'create' && !value) {
              return new Date().toISOString()
            }
            return value
          },
        ],
      },
    },
  ],
}
