import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { flagsForItemField } from './shared/flagsField'

/**
 * Eras: named time spans for temporal analysis.
 *
 * Phase 1 ships calendar eras (pre-1950 + decades + century parents). Their
 * *membership* is computed from the year on each content row at query time
 * — no rows in era_members. The `kind` select is wired with 'curated' and
 * 'theme' options so future explicit-membership eras don't need a schema
 * or config change.
 *
 * Schema lives in scripts/sql/add-eras.sql (push:false). No hasMany text
 * fields, no relationship fields without a matching _rels table — parent
 * link is exposed as a plain integer FK (parentEraId) for the same reason
 * we did this on Species/Places/Protocols/Concepts.
 */

const ERA_KINDS = [
  { label: 'Calendar', value: 'calendar' },
  { label: 'Curated', value: 'curated' },
  { label: 'Theme', value: 'theme' },
]

export const Eras: CollectionConfig = {
  slug: 'eras',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'startYear', 'endYear', 'kind', 'sortOrder'],
    group: 'Entities',
    description:
      'Named time spans. Calendar eras (decades, centuries) compute membership from each content row’s year; curated / theme eras (future) use the era_members table.',
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Display name (e.g., "1970s", "20th Century").' },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: { description: 'URL-safe identifier (e.g., "1970s", "20th-century").' },
    },
    {
      name: 'startYear',
      type: 'number',
      required: true,
      index: true,
      admin: { description: 'First year covered by this era (inclusive).' },
    },
    {
      name: 'endYear',
      type: 'number',
      required: true,
      index: true,
      admin: { description: 'Last year covered by this era (inclusive).' },
    },
    {
      name: 'kind',
      type: 'select',
      options: ERA_KINDS,
      defaultValue: 'calendar',
      index: true,
      admin: {
        description:
          'How membership is determined. Calendar: computed from the content row’s year. Curated / Theme: explicit rows in era_members.',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { description: 'Curator-editable description of the era.' },
    },
    {
      name: 'parentEraId',
      type: 'number',
      admin: {
        description:
          'Parent era ID (integer FK into eras) for hierarchy, e.g., the 1970s under "20th Century". Plain FK because eras_rels is not provisioned.',
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: {
        description:
          'Browse order. Decades use 1-9 sequentially; centuries use 100 / 200 so they sort to the end of any flat list.',
      },
    },
    flagsForItemField,
  ],
}
