import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { curatedFieldsField, curationHookFor } from './shared/curationHook'
import { curatedFieldsWidget } from './shared/curationWidgetField'
import { CURATABLE_FIELDS } from './shared/curatableFields'
import { flagsForItemField } from './shared/flagsField'

const PROTOCOL_CATEGORIES = [
  { label: 'Sampling', value: 'sampling' },
  { label: 'Measurement', value: 'measurement' },
  { label: 'Analytical', value: 'analytical' },
  { label: 'Experimental', value: 'experimental' },
  { label: 'Observational', value: 'observational' },
  { label: 'Computational', value: 'computational' },
  { label: 'Laboratory', value: 'laboratory' },
]

export const Protocols: CollectionConfig = {
  slug: 'protocols',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'category', 'approved', 'publicationCount'],
    group: 'Entities',
  },
  hooks: {
    beforeChange: [curationHookFor(CURATABLE_FIELDS.protocols)],
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Protocol name (canonical or proposed by VLM clustering)' },
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      admin: { description: 'URL-safe identifier' },
    },
    {
      name: 'category',
      type: 'select',
      options: PROTOCOL_CATEGORIES,
      index: true,
    },
    {
      name: 'subcategory',
      type: 'text',
      admin: { description: 'Free-form subcategory (e.g., "demographic monitoring", "remote sensing")' },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { description: '2-3 paragraph synthesis (auto-generated, curator-editable)' },
    },
    {
      name: 'typicalEquipment',
      type: 'text',
      hasMany: true,
    },
    {
      name: 'typicalDuration',
      type: 'text',
    },
    {
      name: 'typicalFrequency',
      type: 'text',
    },
    {
      name: 'prerequisites',
      type: 'text',
      hasMany: true,
    },
    {
      name: 'outputMeasurements',
      type: 'text',
      hasMany: true,
      admin: { description: 'What data this produces (individual weights, capture histories, etc.)' },
    },
    {
      name: 'standardized',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'True if this is a recognized standard method' },
    },
    {
      name: 'standardReference',
      type: 'text',
      admin: { description: 'Citation for the canonical methods paper' },
    },
    {
      name: 'originPaper',
      type: 'relationship',
      relationTo: 'publications',
      admin: { description: 'Paper that introduced this protocol, if known' },
    },
    {
      name: 'parentProtocol',
      type: 'relationship',
      relationTo: 'protocols',
      admin: { description: 'Parent protocol if this is a variant' },
    },
    {
      name: 'approved',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description: 'Curator approval flag — only approved protocols appear on the public /protocols page',
        position: 'sidebar',
      },
    },
    {
      name: 'mentionCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'publicationCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { readOnly: true },
    },
    flagsForItemField,
    curatedFieldsField,
    curatedFieldsWidget,
  ],
}
