import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'

export const Media: CollectionConfig = {
  slug: 'media',
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: true,
}
