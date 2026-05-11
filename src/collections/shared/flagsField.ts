import type { Field } from 'payload'

/**
 * Sidebar UI field that lists curation flags submitted against the current
 * document. Renders a compact panel via src/admin/components/FlagsForItem.tsx.
 * Added to every collection that the public flag form can target.
 */
export const flagsForItemField: Field = {
  name: 'flagsForItem',
  type: 'ui',
  admin: {
    position: 'sidebar',
    components: {
      Field: '/admin/components/FlagsForItem#FlagsForItem',
    },
  },
}
