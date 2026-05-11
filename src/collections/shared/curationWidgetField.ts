import type { Field } from 'payload'

/**
 * Sidebar UI field rendering the CuratedFields widget. Pairs with
 * `curatedFieldsField` (the hidden JSON data field) and `curationHookFor()`
 * (the beforeChange diff hook).
 */
export const curatedFieldsWidget: Field = {
  name: 'curatedFieldsWidget',
  type: 'ui',
  admin: {
    position: 'sidebar',
    components: {
      Field: '/admin/components/CuratedFields#CuratedFields',
    },
  },
}
