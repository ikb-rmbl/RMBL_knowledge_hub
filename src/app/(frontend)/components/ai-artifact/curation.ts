/**
 * Read-side helper for the curation indicator on AI-artifact pages.
 *
 * `curated_fields` is a JSONB array of camelCase Payload-field names that
 * have been admin-edited (see project CLAUDE.md → Curation & Deletion).
 * SQL-only tables (neighborhoods, frontiers, eras) all got the column via
 * scripts/sql/add-curated-fields-to-sql-only-tables.sql.
 *
 * This helper safely asks "has field X been curated?" without forcing the
 * page-level types to declare `curated_fields` on every server-fetched row.
 * The shape varies (Era from a service interface, frontier from a raw row,
 * neighborhood from yet another shape), so we coerce here once.
 */
export function hasCuratedField(row: unknown, fieldName: string): boolean {
  if (!row || typeof row !== 'object') return false
  const cf = (row as { curated_fields?: unknown }).curated_fields
  return Array.isArray(cf) && cf.includes(fieldName)
}
