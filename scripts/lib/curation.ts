/**
 * Curation-aware SQL helpers for pipeline writes.
 *
 * Every curatable table has a `curated_fields` jsonb column (a JSON array of
 * Payload camelCase field names that an admin has asserted). Pipeline writes
 * must not overwrite those cells. These helpers build the SQL fragments that
 * make the protection automatic.
 *
 * `curated_fields` stores Payload field names (camelCase). Pipeline scripts
 * speak DB column names (snake_case). The helpers convert internally so each
 * call site can keep using its existing snake_case identifiers.
 */

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())
}

/**
 * Wrap a single SET assignment in a CASE expression that preserves the
 * existing value when the field is listed in `curated_fields`. Use when
 * building dynamic SET clauses that may include several curatable columns.
 *
 * Example:
 *   const sets: string[] = []
 *   sets.push(curatedSafe('title', '$1'))
 *   sets.push(curatedSafe('description', '$2'))
 *   await db.query(
 *     `UPDATE datasets SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $3`,
 *     [title, description, id],
 *   )
 */
export function curatedSafe(column: string, valueExpr: string): string {
  const camel = snakeToCamel(column)
  // jsonb @> with a single-element array tests for membership.
  return `${column} = CASE WHEN curated_fields @> '["${camel}"]'::jsonb THEN ${column} ELSE ${valueExpr} END`
}

/**
 * Build a WHERE-clause fragment that skips the row entirely when any of the
 * given columns is curated. Cheaper than per-column CASE expressions for
 * single-column writes; rolls all-or-nothing for multi-column writes.
 *
 * Example:
 *   await db.query(
 *     `UPDATE publications SET abstract = $1 WHERE id = $2 AND ${curatedSkipClause(['abstract'])}`,
 *     [abstract, id],
 *   )
 */
export function curatedSkipClause(columns: string[]): string {
  if (columns.length === 0) return 'TRUE'
  const camelNames = columns.map((c) => `"${snakeToCamel(c)}"`).join(', ')
  // jsonb ?| array['k'] tests whether any of the array elements equals a
  // top-level string element in the jsonb array.
  return `NOT (curated_fields ?| array[${camelNames}])`
}
