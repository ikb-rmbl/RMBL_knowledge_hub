import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'

export const Topics: CollectionConfig = {
  slug: 'topics',
  admin: {
    useAsTitle: 'name',
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
  ],
}
