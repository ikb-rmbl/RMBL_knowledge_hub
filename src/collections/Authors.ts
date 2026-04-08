import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'

export const Authors: CollectionConfig = {
  slug: 'authors',
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['displayName', 'orcid', 'affiliation'],
    group: 'Content',
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'displayName',
      type: 'text',
      required: true,
      admin: {
        description: 'Full display name (e.g., "Daniel T. Blumstein")',
      },
    },
    {
      name: 'familyName',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'givenName',
      type: 'text',
    },
    {
      name: 'orcid',
      type: 'text',
      unique: true,
      admin: {
        description: 'ORCID identifier (e.g., 0000-0001-5793-9244)',
      },
    },
    {
      name: 'affiliation',
      type: 'text',
      admin: {
        description: 'Primary institutional affiliation',
      },
    },
    {
      name: 'workCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: {
        description: 'Total number of linked works (publications + datasets + documents)',
        readOnly: true,
      },
    },
    {
      name: 'publications',
      type: 'relationship',
      relationTo: 'publications',
      hasMany: true,
      admin: {
        description: 'Publications by this author',
      },
    },
    {
      name: 'datasets',
      type: 'relationship',
      relationTo: 'datasets',
      hasMany: true,
      admin: {
        description: 'Datasets created by this author',
      },
    },
    {
      name: 'documents',
      type: 'relationship',
      relationTo: 'documents',
      hasMany: true,
      admin: {
        description: 'Documents by this author',
      },
    },
  ],
}
