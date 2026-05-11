import type { CollectionBeforeChangeHook, Field } from 'payload'

/**
 * Field tracking which cells on this row were last set by a human admin.
 * Pipeline scripts (Phase 2) consult this array and skip listed fields on
 * UPDATE. Released via the sidebar widget (admin removes a field name).
 */
export const curatedFieldsField: Field = {
  name: 'curatedFields',
  type: 'json',
  defaultValue: [] as string[],
  admin: { hidden: true },
}

/**
 * Build a `beforeChange` hook that diffs `data` against `originalDoc` for the
 * given allowlist of fields and maintains `data.curatedFields`:
 *  - A field whose value changes to a non-empty value is added to the array.
 *  - A field cleared to null/empty is removed from the array (= "release").
 *  - Create operations leave `curatedFields` empty — admin edits start
 *    tracking on the first update.
 *
 * The widget at src/admin/components/CuratedFields.tsx writes directly to the
 * same array to support release-without-clearing.
 */
export function curationHookFor(curatableFields: string[]): CollectionBeforeChangeHook {
  if (curatableFields.length === 0) {
    return ({ data }) => data
  }
  return ({ data, originalDoc, req }) => {
    if (!originalDoc) return data
    // Pipeline scripts pass ?context[pipeline]=true so their writes don't
    // get falsely marked as admin-curated.
    if (req?.context?.pipeline) return data

    const prevList = Array.isArray(originalDoc.curatedFields) ? originalDoc.curatedFields : []
    // If the incoming `data` already changed curatedFields (e.g. the widget
    // released a cell), use that as the baseline rather than originalDoc's.
    const incomingList = Array.isArray(data.curatedFields) ? data.curatedFields : prevList
    const curated = new Set<string>(incomingList)

    for (const field of curatableFields) {
      const before = originalDoc[field]
      const after = data[field]
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue
      // value actually changed
      if (after == null || after === '' || (Array.isArray(after) && after.length === 0)) {
        curated.delete(field)
      } else {
        curated.add(field)
      }
    }

    data.curatedFields = [...curated]
    return data
  }
}
