import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { curatedFieldsField, curationHookFor } from './shared/curationHook'
import { curatedFieldsWidget } from './shared/curationWidgetField'
import { CURATABLE_FIELDS } from './shared/curatableFields'

export const Topics: CollectionConfig = {
  slug: 'topics',
  admin: {
    useAsTitle: 'name',
  },
  hooks: {
    beforeChange: [curationHookFor(CURATABLE_FIELDS.topics)],
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'topics',
      admin: {
        description: 'Parent topic for hierarchical organization (e.g., "water quality" under "Water")',
      },
    },
    curatedFieldsField,
    curatedFieldsWidget,
  ],
}
