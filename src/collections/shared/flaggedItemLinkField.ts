import type { Field } from 'payload'

/**
 * Sidebar UI field on the Flags collection that renders a link to the flagged
 * record's edit page. Renders via src/admin/components/FlaggedItemLink.tsx.
 * Pairs with the `collection` + `itemId` fields that identify the target.
 */
export const flaggedItemLinkField: Field = {
  name: 'flaggedItemLink',
  type: 'ui',
  admin: {
    position: 'sidebar',
    components: {
      Field: '/admin/components/FlaggedItemLink#FlaggedItemLink',
    },
  },
}
