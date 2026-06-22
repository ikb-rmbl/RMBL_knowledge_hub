import type { CollectionConfig } from 'payload'
import { GEOGRAPHIC_SCOPE_OPTIONS } from './shared/constants'
import { publicReadAuthWrite } from './shared/access'
import { tombstoneHookFor } from './shared/tombstoneHook'
import { curatedFieldsField, curationHookFor } from './shared/curationHook'
import { curatedFieldsWidget } from './shared/curationWidgetField'
import { CURATABLE_FIELDS } from './shared/curatableFields'
import { flagsForItemField } from './shared/flagsField'

export const Documents: CollectionConfig = {
  slug: 'documents',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'dateOriginal', 'categories'],
    group: 'Content',
  },
  hooks: {
    beforeChange: [curationHookFor(CURATABLE_FIELDS.documents)],
    beforeDelete: [tombstoneHookFor('documents')],
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'summary',
      type: 'textarea',
      admin: {
        description: 'Short description or abstract (Dublin Core: dc:description)',
      },
    },
    {
      name: 'fullText',
      type: 'textarea',
      // Payload's default `textarea` maxLength is 40,000 chars — that's
      // too small for many policy docs (RMPs, EISs, ESA recovery plans
      // routinely run 200–800 KB of text; the largest critical-habitat
      // designations crest 2 MB). Set to 5 MB which covers the corpus
      // we've seen (max 2.4 MB) with comfortable headroom. The DB
      // column is unconstrained `text` already, so this is a Payload
      // validator-only change.
      maxLength: 5_000_000,
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
      name: 'pdfLink',
      type: 'text',
      admin: {
        description: 'Direct URL to the PDF file',
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
        description: 'Where a restricted PDF was obtained (e.g., "ILL via UC Davis library").',
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
        description: 'When the record was added to the Knowledge Commons',
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
    flagsForItemField,
    curatedFieldsField,
    curatedFieldsWidget,
  ],
}
